"""Harbour layout: a section of the Port of Los Angeles (Terminal Island container basin).

Geometry was traced by hand from USGS aerial imagery (public domain) and is
stored as latitude/longitude; it is converted to a local metric frame
(x east, y north, metres; fixed origin near the basin's south-west).
The hydrophone array, dock and berths are a plausible *simulated* layout,
not real installations.

Water areas are not convex (finger piers, a terminal corner), so anything
that moves (inspection boat, simulated vessels) is routed with A* over a
10 m water grid.
"""
from __future__ import annotations

import heapq
import json
import math
from pathlib import Path

import numpy as np
from scipy.ndimage import distance_transform_edt

SOUND_SPEED = 1500.0  # m/s
ROOT = Path(__file__).resolve().parent.parent
BASEMAP = json.loads((ROOT / "web" / "basemap.json").read_text())

_R = 6378137.0
# fixed origin of the local frame (independent of how the basemap is cropped)
ORIGIN_LAT, ORIGIN_LON = 33.7396508, -118.2455707
_LAT0 = math.radians(33.7485)


def _merc_y(lat: float) -> float:
    return _R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def to_xy(lat: float, lon: float) -> tuple[float, float]:
    """Latitude/longitude -> local metres (Web-Mercator consistent, so it lines up with the basemap)."""
    x = _R * math.radians(lon - ORIGIN_LON) * math.cos(_LAT0)
    y = (_merc_y(lat) - _merc_y(ORIGIN_LAT)) * math.cos(_LAT0)
    return round(x, 1), round(y, 1)


def _pts(latlon: list) -> list[tuple[float, float]]:
    return [to_xy(a, b) for a, b in latlon]


BOUNDS = (*to_xy(BASEMAP["south"], BASEMAP["west"]), *to_xy(BASEMAP["north"], BASEMAP["east"]))  # basemap extent

# --- traced from imagery (lat, lon) ---------------------------------------------------
PATROL = _pts([[33.751163, -118.244601], [33.756193, -118.224635], [33.752425, -118.22314], [33.754089, -118.218654],
               [33.744851, -118.217573], [33.743761, -118.224635], [33.742996, -118.227855], [33.74204, -118.232456],
               [33.7429, -118.238206], [33.74357, -118.241657]])
PIERS = [_pts(p) for p in [
    [[33.745157, -118.232962], [33.745119, -118.23264], [33.742097, -118.2331], [33.742135, -118.233422]],
    [[33.745387, -118.227441], [33.745387, -118.226429], [33.743092, -118.226705], [33.743092, -118.227579]],
    [[33.746879, -118.224589], [33.746841, -118.224313], [33.743761, -118.224819], [33.743799, -118.225095]],
]]
BERTHS = _pts([[33.751316, -118.241197], [33.752368, -118.237286], [33.75342, -118.233146], [33.754472, -118.229005]])
# approach from the open sea, past the mole tip, into the basin mouth
ENTRY_ROUTE = _pts([[33.736014, -118.218654], [33.742327, -118.216124], [33.74883, -118.217964]])
BASIN_MOUTH = ENTRY_ROUTE[-1]

# --- simulated installations --------------------------------------------------------------
HYDROPHONES = [{"id": f"H{i + 1}", "x": x, "y": y} for i, (x, y) in enumerate(_pts([
    [33.749786, -118.241197], [33.751507, -118.237056], [33.752846, -118.232456],
    [33.753898, -118.228085], [33.745769, -118.238206], [33.7473, -118.230616]]))]
HYD_XY = np.array([[h["x"], h["y"]] for h in HYDROPHONES])
N_HYD = len(HYDROPHONES)
USV_DOCK = to_xy(33.744622, -118.233836)  # by the middle finger pier, central to the berths

USV_SPEED = 10.0        # m/s transit (~20 kn, typical harbour patrol craft)
USV_SEARCH_SPEED = 3.5  # m/s while searching
SONAR_RANGE = 60.0      # m, simulated forward-looking sonar
CAMERA_RANGE = 150.0    # m, surface objects only


def point_in_poly(x, y, poly) -> np.ndarray:
    """Vectorised ray-casting point-in-polygon."""
    x = np.asarray(x, float)
    y = np.asarray(y, float)
    inside = np.zeros(np.broadcast(x, y).shape, bool)
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        cond = (y1 > y) != (y2 > y)
        xi = (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1
        inside ^= cond & (x < xi)
    return inside


# --- water grid -------------------------------------------------------------------------------
GRID = 10.0
_px, _py = [p[0] for p in PATROL], [p[1] for p in PATROL]
GRID_BOUNDS = (min(_px) - 50, min(_py) - 50, max(_px) + 50, max(_py) + 50)
_gx = np.arange(GRID_BOUNDS[0] + GRID / 2, GRID_BOUNDS[2], GRID)
_gy = np.arange(GRID_BOUNDS[1] + GRID / 2, GRID_BOUNDS[3], GRID)
_GX, _GY = np.meshgrid(_gx, _gy)  # rows = y, cols = x
WATER = point_in_poly(_GX, _GY, PATROL)
for _p in PIERS:
    WATER &= ~point_in_poly(_GX, _GY, _p)
CLEARANCE = distance_transform_edt(WATER) * GRID  # metres to nearest land / patrol edge


def _cell(x: float, y: float) -> tuple[int, int]:
    r, c = int((y - GRID_BOUNDS[1]) // GRID), int((x - GRID_BOUNDS[0]) // GRID)
    return (int(np.clip(r, 0, WATER.shape[0] - 1)), int(np.clip(c, 0, WATER.shape[1] - 1)))


def in_water(x, y) -> bool:
    if not (GRID_BOUNDS[0] <= x < GRID_BOUNDS[2] and GRID_BOUNDS[1] <= y < GRID_BOUNDS[3]):
        return False
    r, c = _cell(x, y)
    return bool(WATER[r, c])


def clearance(x, y) -> float:
    r, c = _cell(x, y)
    return float(CLEARANCE[r, c])


def water_grid(step: float = 10.0) -> np.ndarray:
    """Cell centres of the patrol water (candidate source positions), shape (n, 2)."""
    stride = max(1, int(round(step / GRID)))
    m = WATER[::stride, ::stride]
    return np.column_stack([_GX[::stride, ::stride][m], _GY[::stride, ::stride][m]])


def line_clear(a, b) -> bool:
    n = max(2, int(math.hypot(b[0] - a[0], b[1] - a[1]) / 4))
    return all(in_water(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) for t in np.linspace(0, 1, n))


def _nearest_water(x, y) -> tuple[int, int]:
    r, c = _cell(x, y)
    if WATER[r, c]:
        return r, c
    rr, cc = np.nonzero(WATER)
    k = int(np.argmin((rr - r) ** 2 + (cc - c) ** 2))
    return int(rr[k]), int(cc[k])


def route(a, b) -> list[tuple[float, float]]:
    """Water route from a to b (excluding a). Straight if clear, else A* + string-pulling."""
    if line_clear(a, b):
        return [(float(b[0]), float(b[1]))]
    s, g = _nearest_water(*a), _nearest_water(*b)
    H_, W_ = WATER.shape
    openq = [(0.0, s)]
    came = {s: None}
    cost = {s: 0.0}
    while openq:
        _, cur = heapq.heappop(openq)
        if cur == g:
            break
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            nr, nc = cur[0] + dr, cur[1] + dc
            if 0 <= nr < H_ and 0 <= nc < W_ and WATER[nr, nc]:
                step = math.hypot(dr, dc) + (0.5 if CLEARANCE[nr, nc] < 25 else 0.0)  # prefer open water
                nxt = (nr, nc)
                c2 = cost[cur] + step
                if c2 < cost.get(nxt, 1e18):
                    cost[nxt] = c2
                    came[nxt] = cur
                    heapq.heappush(openq, (c2 + math.hypot(g[0] - nr, g[1] - nc), nxt))
    if g not in came:
        return [(float(b[0]), float(b[1]))]
    cells, cur = [], g
    while cur is not None:
        cells.append(cur)
        cur = came[cur]
    pts = [(float(_GX[r, c]), float(_GY[r, c])) for r, c in reversed(cells)]
    if in_water(*b):
        pts[-1] = (float(b[0]), float(b[1]))
    out, anchor = [], (float(a[0]), float(a[1]))
    i = 0
    while i < len(pts) - 1:  # string-pulling: skip points while the straight line stays in water
        j = len(pts) - 1
        while j > i + 1 and not line_clear(anchor, pts[j]):
            j -= 1
        out.append(pts[j])
        anchor, i = pts[j], j
    return out or [pts[-1]]


def layout() -> dict:
    return {
        "name": "Port of Los Angeles, Terminal Island container basin",
        "bounds": BOUNDS,
        "basemap": {"url": "/static/basemap.jpg", "credit": BASEMAP["credit"]},
        "patrol": PATROL,
        "piers": PIERS,
        "berths": BERTHS,
        "hydrophones": HYDROPHONES,
        "dock": USV_DOCK,
        "sonar_range": SONAR_RANGE,
        "simulated": True,
    }
