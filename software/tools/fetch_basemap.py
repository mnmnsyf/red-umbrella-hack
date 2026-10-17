"""Download and stitch an aerial basemap from USGS The National Map (public domain).

Usage:
  uv run python tools/fetch_basemap.py --south 33.735 --west -118.285 --north 33.760 --east -118.255 --zoom 17 --out web/basemap.jpg

Writes the image plus a JSON sidecar with its exact geographic bounds (the
tile-aligned extent actually covered), which ``harbour.py`` uses to
georeference the map. Imagery credit: USGS The National Map.
"""
from __future__ import annotations

import argparse
import io
import json
import math
import time
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

URL = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}"
TILE = 256


def lonlat_to_tile(lon: float, lat: float, z: int) -> tuple[float, float]:
    n = 2**z
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    return x, y


def tile_to_lonlat(x: float, y: float, z: int) -> tuple[float, float]:
    n = 2**z
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lon, lat


def fetch(south: float, west: float, north: float, east: float, zoom: int, out: Path) -> dict:
    x0f, y0f = lonlat_to_tile(west, north, zoom)
    x1f, y1f = lonlat_to_tile(east, south, zoom)
    x0, y0, x1, y1 = int(x0f), int(y0f), int(x1f), int(y1f)
    img = np.zeros(((y1 - y0 + 1) * TILE, (x1 - x0 + 1) * TILE, 3), np.uint8)
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            req = urllib.request.Request(URL.format(z=zoom, y=ty, x=tx), headers={"User-Agent": "portwatch-demo/0.1"})
            for attempt in range(3):
                try:
                    data = urllib.request.urlopen(req, timeout=30).read()
                    break
                except Exception:
                    time.sleep(1 + attempt)
            else:
                raise RuntimeError(f"tile {zoom}/{ty}/{tx} failed")
            tile = np.asarray(Image.open(io.BytesIO(data)).convert("RGB"))
            img[(ty - y0) * TILE : (ty - y0 + 1) * TILE, (tx - x0) * TILE : (tx - x0 + 1) * TILE] = tile
    # crop to the requested box (pixel-exact), record the bounds actually covered
    px0, py0 = int((x0f - x0) * TILE), int((y0f - y0) * TILE)
    px1, py1 = int((x1f - x0) * TILE), int((y1f - y0) * TILE)
    img = img[py0:py1, px0:px1]
    w_lon, n_lat = tile_to_lonlat(x0 + px0 / TILE, y0 + py0 / TILE, zoom)
    e_lon, s_lat = tile_to_lonlat(x0 + px1 / TILE, y0 + py1 / TILE, zoom)
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(img).save(out, quality=82, optimize=True, progressive=True)
    meta = {"south": s_lat, "west": w_lon, "north": n_lat, "east": e_lon, "zoom": zoom,
            "width": img.shape[1], "height": img.shape[0],
            "credit": "Imagery: USGS The National Map (public domain)", "source": URL}
    out.with_suffix(".json").write_text(json.dumps(meta, indent=2))
    return meta


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    for k in ("south", "west", "north", "east"):
        ap.add_argument(f"--{k}", type=float, required=True)
    ap.add_argument("--zoom", type=int, default=17)
    ap.add_argument("--out", type=Path, default=Path("web/basemap.jpg"))
    a = ap.parse_args()
    print(fetch(a.south, a.west, a.north, a.east, a.zoom, a.out))
