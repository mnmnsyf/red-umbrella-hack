"""SIMULATED harbour layout: local metric coordinates (x east, y north, metres).

The basin (patrol area) is convex, so straight-line inspection-boat paths stay
in water. Replace these constants with surveyed positions for a real site.
"""
from __future__ import annotations

import numpy as np

SOUND_SPEED = 1500.0  # m/s

BOUNDS = (40.0, 60.0, 1190.0, 720.0)  # xmin, ymin, xmax, ymax shown on the map (basin + channel mouth)

# Water: basin + entrance channel to open sea (south)
WATER = [(200, -150), (500, -150), (500, 120), (1150, 180), (1150, 680), (80, 680), (80, 250), (200, 180)]
# Patrol area (inspection boat geofence): the convex basin
PATROL = [(80, 250), (200, 180), (500, 120), (1150, 180), (1150, 680), (80, 680)]
QUAY_Y = 680.0
BERTHS = [(320, 655), (520, 655), (720, 655), (920, 655), (1110, 450)]

# Berth-focused array (~250 m spacing): the berths are the protected asset.
HYDROPHONES = [
    {"id": "H1", "x": 300.0, "y": 580.0},
    {"id": "H2", "x": 580.0, "y": 610.0},
    {"id": "H3", "x": 860.0, "y": 580.0},
    {"id": "H4", "x": 580.0, "y": 420.0},
]
HYD_XY = np.array([[h["x"], h["y"]] for h in HYDROPHONES])

USV_DOCK = (140.0, 630.0)
USV_SPEED = 6.0         # m/s transit (~12 kn)
USV_SEARCH_SPEED = 2.5  # m/s while searching
SONAR_RANGE = 40.0      # m, simulated forward-looking sonar
CAMERA_RANGE = 120.0    # m, surface objects only


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


def water_grid(step: float = 10.0) -> np.ndarray:
    """Candidate source positions (cell centres in the patrol basin), shape (n, 2)."""
    xs = np.arange(PATROL_BBOX[0] + step / 2, PATROL_BBOX[2], step)
    ys = np.arange(PATROL_BBOX[1] + step / 2, PATROL_BBOX[3], step)
    gx, gy = np.meshgrid(xs, ys)
    m = point_in_poly(gx, gy, PATROL)
    return np.column_stack([gx[m], gy[m]])


PATROL_BBOX = (min(p[0] for p in PATROL), min(p[1] for p in PATROL), max(p[0] for p in PATROL), max(p[1] for p in PATROL))


def layout() -> dict:
    return {
        "bounds": BOUNDS,
        "water": WATER,
        "patrol": PATROL,
        "quay_y": QUAY_Y,
        "berths": BERTHS,
        "hydrophones": HYDROPHONES,
        "dock": USV_DOCK,
        "sonar_range": SONAR_RANGE,
        "simulated": True,
    }
