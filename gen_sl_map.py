import json
import math
from io import BytesIO
from pathlib import Path

import requests
from PIL import Image

# ---------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------

DATA_DIR = Path("data")
DATA_DIR.mkdir(exist_ok=True)

META_PATH = DATA_DIR / "meta.json"      # must exist (from prepare_elevation.py)
OUT_FILE = DATA_DIR / "srilanka_map.png"

TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
TILE_SIZE = 256

# Zoom level: 7–9 usually fine for whole Sri Lanka; increase for more detail
ZOOM = 10

USER_AGENT = "SL-terrain-demo/1.0 (your_email@example.com)"


# ---------------------------------------------------------------------
# TILE MATH
# ---------------------------------------------------------------------


def lonlat_to_tile_xy(lon_deg: float, lat_deg: float, zoom: int):
    """
    Convert lon/lat in degrees to fractional Slippy Map tile coordinates (x, y)
    at a given zoom level.
    """
    lat_rad = math.radians(lat_deg)
    n = 2 ** zoom
    x = (lon_deg + 180.0) / 360.0 * n
    y = (1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n
    return x, y


# ---------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------


def main():
    if not META_PATH.exists():
        raise FileNotFoundError(
            f"{META_PATH} not found. Run your elevation preprocessor (prepare_elevation.py) first."
        )

    with open(META_PATH, "r") as f:
        meta = json.load(f)

    lat_min = float(meta["lat_min"])
    lat_max = float(meta["lat_max"])
    lon_min = float(meta["lon_min"])
    lon_max = float(meta["lon_max"])

    print("Using bounds from meta.json:")
    print(f"  lat: {lat_min} .. {lat_max}")
    print(f"  lon: {lon_min} .. {lon_max}")
    print(f"  zoom: {ZOOM}")

    # Fractional tile coords for corners of the DEM bbox
    x_min_f, y_max_f = lonlat_to_tile_xy(lon_min, lat_min, ZOOM)  # southwest
    x_max_f, y_min_f = lonlat_to_tile_xy(lon_max, lat_max, ZOOM)  # northeast

    # Integer tile ranges that fully cover the bbox
    x_min = math.floor(x_min_f)
    x_max = math.floor(x_max_f)
    y_min = math.floor(y_min_f)
    y_max = math.floor(y_max_f)

    tiles_x = x_max - x_min + 1
    tiles_y = y_max - y_min + 1

    print(f"Tile X range: {x_min} .. {x_max} ({tiles_x} tiles)")
    print(f"Tile Y range: {y_min} .. {y_max} ({tiles_y} tiles)")

    # Create a canvas big enough for all whole tiles
    full_width = tiles_x * TILE_SIZE
    full_height = tiles_y * TILE_SIZE
    canvas = Image.new("RGB", (full_width, full_height))

    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT

    # Download all tiles and paste into the canvas
    for tx in range(x_min, x_max + 1):
        for ty in range(y_min, y_max + 1):
            url = TILE_URL.format(z=ZOOM, x=tx, y=ty)
            print("Fetching", url)

            resp = session.get(url, timeout=10)
            resp.raise_for_status()

            tile_img = Image.open(BytesIO(resp.content)).convert("RGB")

            px = (tx - x_min) * TILE_SIZE
            py = (ty - y_min) * TILE_SIZE
            canvas.paste(tile_img, (px, py))

    # -----------------------------------------------------------------
    # CROP TO EXACT DEM BOUNDS
    # -----------------------------------------------------------------
    #
    # Now we convert the fractional tile coords into pixel offsets
    # relative to our stitched canvas, so the output image matches
    # lat_min/max & lon_min/max EXACTLY.

    # Horizontal (X) in pixels:
    # left edge corresponds to x_min_f; right edge to x_max_f
    left_px = int(round((x_min_f - x_min) * TILE_SIZE))
    right_px = int(round((x_max_f - x_min) * TILE_SIZE))

    # Vertical (Y) in pixels:
    # top corresponds to y_min_f (north), bottom to y_max_f (south)
    top_px = int(round((y_min_f - y_min) * TILE_SIZE))
    bottom_px = int(round((y_max_f - y_min) * TILE_SIZE))

    # Clamp to canvas just in case of rounding anomalies
    left_px = max(0, min(full_width - 1, left_px))
    right_px = max(left_px + 1, min(full_width, right_px))
    top_px = max(0, min(full_height - 1, top_px))
    bottom_px = max(top_px + 1, min(full_height, bottom_px))

    print(f"Cropping to pixels: left={left_px}, top={top_px}, right={right_px}, bottom={bottom_px}")
    cropped = canvas.crop((left_px, top_px, right_px, bottom_px))

    cropped.save(OUT_FILE)
    print("Saved aligned map to:", OUT_FILE.resolve())


if __name__ == "__main__":
    main()
