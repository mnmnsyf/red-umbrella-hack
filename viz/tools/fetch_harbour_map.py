"""Build the viz map of the Terminal Island container basin, aligned with the dashboard.

Usage (from viz/):  python tools/fetch_harbour_map.py

Reads the traced harbour geometry from ../software/portwatch/harbour.py, so the
viz and the dashboard share one source of truth:
- the map square is centred on the patrol basin, the same centre
  software/portwatch/viz_scenario.py uses for scenario coordinates;
- 1 scene unit = 1 local metre, in the dashboard's scale (Web Mercator x cos(LAT0)).

Writes public/maps/harbour{,-context}.jpg (USGS The National Map imagery, public
domain) and harbour{,-context}-land.png (white = land, black = water), then prints
the Web Mercator bbox for src/location.ts.
"""
from __future__ import annotations

import ast
import io
import math
import re
import time
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

VIZ = Path(__file__).resolve().parent.parent
HARBOUR = VIZ.parent / "software" / "portwatch" / "harbour.py"
OUT = VIZ / "public" / "maps"
URL = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}"
TILE = 256
R = 6378137.0
SCENE_SIZE = 2800  # must match viz/src/theme.ts
SIZE_PX = 2048
MASK_PX = 1024


def harbour_constants() -> dict:
    """Pull the traced lat/lon literals out of harbour.py without importing it (no scipy needed)."""
    src = HARBOUR.read_text()
    tree = ast.parse(src)
    out = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            if name in ("PATROL", "BERTHS") and isinstance(node.value, ast.Call):
                out[name] = ast.literal_eval(node.value.args[0])
            elif name == "PIERS":
                out[name] = ast.literal_eval(node.value.generators[0].iter)
    out["LAT0"] = float(re.search(r"_LAT0 = math\.radians\(([-\d.]+)\)", src).group(1))
    return out


def merc(lat: float, lon: float) -> tuple[float, float]:
    return R * math.radians(lon), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def unmerc(x: float, y: float) -> tuple[float, float]:
    return math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2), math.degrees(x / R)


def fetch_square(bbox, zoom: int) -> Image.Image:
    """Stitch tiles covering a Web Mercator bbox (west, south, east, north) and crop it exactly."""
    w, s, e, n = bbox
    world = 2 * math.pi * R
    to_tile = lambda mx, my: ((mx + world / 2) / world * 2**zoom, (world / 2 - my) / world * 2**zoom)
    x0f, y0f = to_tile(w, n)
    x1f, y1f = to_tile(e, s)
    x0, y0, x1, y1 = int(x0f), int(y0f), int(x1f), int(y1f)
    img = Image.new("RGB", ((x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE))
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            req = urllib.request.Request(URL.format(z=zoom, y=ty, x=tx), headers={"User-Agent": "portwatch-viz/0.1"})
            for attempt in range(3):
                try:
                    data = urllib.request.urlopen(req, timeout=30).read()
                    break
                except Exception:
                    time.sleep(1 + attempt)
            else:
                raise RuntimeError(f"tile {zoom}/{ty}/{tx} failed")
            img.paste(Image.open(io.BytesIO(data)).convert("RGB"), ((tx - x0) * TILE, (ty - y0) * TILE))
    box = ((x0f - x0) * TILE, (y0f - y0) * TILE, (x1f - x0) * TILE, (y1f - y0) * TILE)
    return img.resize((SIZE_PX, SIZE_PX), Image.LANCZOS, box=box)


def water_from_imagery(img: Image.Image) -> np.ndarray:
    """Harbour water is dark and blue-green; quays, containers and roofs are brighter or warmer."""
    a = np.asarray(img.resize((MASK_PX, MASK_PX), Image.LANCZOS)).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    luma = 0.299 * r + 0.587 * g + 0.114 * b
    spread = a.max(-1) - a.min(-1)
    water = (luma < 95) & (b + 6 >= r) & (spread < 60)
    # smooth speckle: majority filter via blur + threshold
    m = Image.fromarray((water * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2.5))
    water = np.asarray(m) > 127
    # dark roofs, shadows and roads read as water: keep only water connected to a sizeable body,
    # then drop moored ships and other small specks of land the same way
    water = _open_by_reconstruction(water, 9)
    return ~_open_by_reconstruction(~water, 9)


def _open_by_reconstruction(mask: np.ndarray, size: int) -> np.ndarray:
    """Remove blobs that vanish under a size x size erosion, keeping the full shape of the rest."""
    img = Image.fromarray((mask * 255).astype(np.uint8))
    seed = np.asarray(img.filter(ImageFilter.MinFilter(size))) > 127
    while True:
        grown = (np.asarray(Image.fromarray((seed * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))) > 127) & mask
        if (grown == seed).all():
            return seed
        seed = grown


def polygon_mask(polys, bbox) -> tuple[np.ndarray, np.ndarray]:
    """Rasterise lat/lon polygons onto the mask grid (row 0 = north)."""
    w, s, e, n = bbox
    def px(lat, lon):
        mx, my = merc(lat, lon)
        return (mx - w) / (e - w) * MASK_PX, (n - my) / (n - s) * MASK_PX
    out = []
    for group in polys:
        im = Image.new("L", (MASK_PX, MASK_PX), 0)
        d = ImageDraw.Draw(im)
        for poly in group:
            d.polygon([px(*p) for p in poly], fill=255)
        out.append(np.asarray(im) > 127)
    return out


def land_mask(img, bbox, h) -> Image.Image:
    water = water_from_imagery(img)
    patrol, piers = polygon_mask([[h["PATROL"]], h["PIERS"]], bbox)
    # the dashboard's traced water wins inside the basin, so boats never cross drawn land
    water = (water | patrol) & ~piers
    land = Image.fromarray(((~water) * 255).astype(np.uint8))
    return land.filter(ImageFilter.GaussianBlur(1.2))  # soft rim for the shader's shoreline highlight


def main() -> None:
    h = harbour_constants()
    lats = [p[0] for p in h["PATROL"]]
    mx = [merc(*p)[0] for p in h["PATROL"]]
    my = [merc(*p)[1] for p in h["PATROL"]]
    cx, cy = (min(mx) + max(mx)) / 2, (min(my) + max(my)) / 2  # patrol bbox centre, as viz_scenario.py
    scale = 1 / math.cos(math.radians(h["LAT0"]))  # mercator metres per local metre
    for name, mult, zoom in (("harbour", 1, 16), ("harbour-context", 3, 14)):
        half = SCENE_SIZE * mult / 2 * scale
        bbox = (cx - half, cy - half, cx + half, cy + half)
        img = fetch_square(bbox, zoom)
        img.save(OUT / f"{name}.jpg", quality=82, optimize=True, progressive=True)
        land_mask(img, bbox, h).save(OUT / f"{name}-land.png", optimize=True)
        print(name, [round(v) for v in bbox])
    print("centre lat/lon", unmerc(cx, cy), "lat span", min(lats), max(lats))


if __name__ == "__main__":
    main()
