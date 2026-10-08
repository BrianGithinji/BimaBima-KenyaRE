import rasterio
import numpy as np

tifs = [
    'nzoia_rp10y.tif','nzoia_rp20y.tif','nzoia_rp50y.tif',
    'nzoia_rp100y.tif','nzoia_rp200y.tif','nzoia_rp500y.tif'
]
for f in tifs:
    with rasterio.open(f) as src:
        data = src.read(1).astype(float)
        nd   = src.nodata
        print("FILE:", f)
        print("  shape:", src.shape, "| crs:", src.crs.to_epsg(), "| nodata:", nd)
        print("  bounds:", src.bounds)
        print("  transform:", src.transform)
        mask = data > 0
        print("  flooded cells:", int(mask.sum()), "| total:", data.size)
        if mask.sum() > 0:
            print("  depth min/median/max:",
                  round(float(data[mask].min()), 3),
                  round(float(np.median(data[mask])), 3),
                  round(float(data[mask].max()), 3))
        print()
