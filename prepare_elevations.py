import json
from pathlib import Path

import numpy as np
from scipy.ndimage import zoom
from scipy.sparse import load_npz  # <-- key difference

DATA_DIR = Path("data")
DATA_DIR.mkdir(exist_ok=True)

# Path to your sparse NPZ
npz_path = DATA_DIR / "usgs_srilanka.npz"  # adjust name if needed

print(f"Loading sparse elevation from: {npz_path}")
elev_sparse = load_npz(npz_path)  # this understands data/indices/indptr/shape
print("Sparse matrix loaded.")
print("  format:", elev_sparse.getformat())
print("  shape:", elev_sparse.shape)
print("  nnz  :", elev_sparse.nnz)

# Convert to dense float32 array
elev = elev_sparse.toarray().astype(np.float32)
H, W = elev.shape
print("Dense elevation shape:", H, "x", W)

# Replace NaNs if any
nan_mask = np.isnan(elev)
if nan_mask.any():
  print("Found NaNs in elevation, filling with mean.")
  elev[nan_mask] = np.nanmean(elev)

# ---- Create two resolutions: high and low ----
max_high_res = 1024  # cap high-res grid size (adjust if needed)
scale_h = min(1.0, max_high_res / H)
scale_w = min(1.0, max_high_res / W)
scale = min(scale_h, scale_w)

if scale < 1.0:
  elev_high = zoom(elev, scale, order=1)
  print("Downsampled high-res to:", elev_high.shape)
else:
  elev_high = elev
  print("Using full resolution for high-res:", elev_high.shape)

low_factor = 4  # coarsen factor relative to high-res
low_scale = scale / low_factor
elev_low = zoom(elev, low_scale, order=1)
print("Downsampled low-res to:", elev_low.shape)

# Elevation range
min_elev = float(elev.min())
max_elev = float(elev.max())
print("Elevation range:", min_elev, "to", max_elev)

# Save as raw Float32 binaries
high_path = DATA_DIR / "heights_high.bin"
low_path = DATA_DIR / "heights_low.bin"

elev_high.astype(np.float32).tofile(high_path)
elev_low.astype(np.float32).tofile(low_path)

print("Wrote:", high_path)
print("Wrote:", low_path)

# --- Coordinate metadata ---
# Your sparse NPZ doesn't include lat/lon, so we assume Sri Lanka bounds here.
# You can refine these if you know the exact grid extents.
lat_min = 5
lat_max = 9
lon_min = 78
lon_max = 82

meta = {
  "lat_min": lat_min,
  "lat_max": lat_max,
  "lon_min": lon_min,
  "lon_max": lon_max,
  "min_elev": min_elev,
  "max_elev": max_elev,
  "high": {
    "width": int(elev_high.shape[1]),
    "height": int(elev_high.shape[0]),
    "file": "heights_high.bin",
  },
  "low": {
    "width": int(elev_low.shape[1]),
    "height": int(elev_low.shape[0]),
    "file": "heights_low.bin",
  },
}

meta_path = DATA_DIR / "meta.json"
with open(meta_path, "w") as f:
  json.dump(meta, f, indent=2)

print("Wrote metadata:", meta_path)
print("Done.")

