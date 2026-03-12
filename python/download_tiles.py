"""
Download MapTiler satellite tiles for a fixed bounding box and save them
as static assets under  webapp/public/tiles/satellite/{z}/{x}/{y}.jpg

Run once (or whenever you want to refresh imagery):
    python python/download_tiles.py
"""

import math
import os
import time
import urllib.request

# ── Configuration ──────────────────────────────────────────────────────────────
API_KEY = "ggrNEhS6ufFFsGzNwRzy"

# Alversjö centre
CENTER_LON = 14.923
CENTER_LAT = 57.620

# How much padding (in degrees) around the centre to download.
# ~0.01° ≈ 1 km at this latitude — gives a comfortable margin.
PAD_LON = 0.012
PAD_LAT = 0.008

ZOOM_MIN = 13
ZOOM_MAX = 17

TILE_URL = "https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key={key}"
# Script lives in python/, so go up one level to project root, then into webapp/public
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "webapp", "public", "tiles", "satellite")

# ── Helpers ────────────────────────────────────────────────────────────────────

def lon_to_tile_x(lon: float, zoom: int) -> int:
    """Convert longitude to tile X index."""
    return int(math.floor((lon + 180) / 360 * (1 << zoom)))


def lat_to_tile_y(lat: float, zoom: int) -> int:
    """Convert latitude to tile Y index (Web‑Mercator / slippy‑map)."""
    lat_rad = math.radians(lat)
    n = 1 << zoom
    return int(math.floor((1 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2 * n))


def download_tile(z: int, x: int, y: int) -> bool:
    """Download a single tile and save it.  Returns True on success."""
    url = TILE_URL.format(z=z, x=x, y=y, key=API_KEY)
    dest = os.path.join(OUT_DIR, str(z), str(x), f"{y}.jpg")
    if os.path.exists(dest):
        return True  # already cached

    os.makedirs(os.path.dirname(dest), exist_ok=True)
    try:
        urllib.request.urlretrieve(url, dest)
        return True
    except Exception as exc:
        print(f"  ✗ {z}/{x}/{y}  –  {exc}")
        return False


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    bbox_west = CENTER_LON - PAD_LON
    bbox_east = CENTER_LON + PAD_LON
    bbox_south = CENTER_LAT - PAD_LAT
    bbox_north = CENTER_LAT + PAD_LAT

    total = 0
    downloaded = 0

    for z in range(ZOOM_MIN, ZOOM_MAX + 1):
        x_min = lon_to_tile_x(bbox_west, z)
        x_max = lon_to_tile_x(bbox_east, z)
        y_min = lat_to_tile_y(bbox_north, z)  # note: y is inverted
        y_max = lat_to_tile_y(bbox_south, z)

        count = (x_max - x_min + 1) * (y_max - y_min + 1)
        print(f"Zoom {z}: tiles x=[{x_min}..{x_max}]  y=[{y_min}..{y_max}]  ({count} tiles)")

        for x in range(x_min, x_max + 1):
            for y in range(y_min, y_max + 1):
                total += 1
                if download_tile(z, x, y):
                    downloaded += 1
                time.sleep(0.05)  # gentle rate‑limit

    print(f"\nDone — {downloaded}/{total} tiles saved to {os.path.abspath(OUT_DIR)}")


if __name__ == "__main__":
    main()
