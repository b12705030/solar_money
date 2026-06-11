"""
一次性執行腳本：將 20m 全台 DEM GeoTIFF 降采樣至 100m，輸出 numpy array。

使用方式（在 solar_money 根目錄執行）：
    python scripts/build_dem_cache.py

輸出：
    data/taiwan_dem_100m.npy   — float32 2D array (height × width)，TWD97 EPSG:3826
    data/taiwan_dem_meta.npy   — [origin_x, origin_y, pixel_x, pixel_y] 四元素 float64 array

後端啟動時由 shadow.py 的 load_dem() 讀入 RAM。
"""

import sys
from pathlib import Path

import numpy as np

TIF_PATH = Path('data/不分幅_全台20MDEM(2025)/DEM_tawiwan_V2025.tif')
OUT_NPY  = Path('data/taiwan_dem_100m.npy')
OUT_META = Path('data/taiwan_dem_meta.npy')

SCALE = 5  # 20m → 100m


def main() -> None:
    try:
        import rasterio
        from rasterio.enums import Resampling
    except ImportError:
        sys.exit('請先安裝 rasterio：pip install rasterio')

    if not TIF_PATH.exists():
        sys.exit(f'找不到 DEM 檔案：{TIF_PATH}')

    print(f'讀取 {TIF_PATH} ...')
    with rasterio.open(TIF_PATH) as src:
        new_w = src.width  // SCALE
        new_h = src.height // SCALE
        print(f'原始大小 {src.width}×{src.height}，降采樣至 {new_w}×{new_h}')

        dem = src.read(
            1,
            out_shape=(new_h, new_w),
            resampling=Resampling.average,
        ).astype(np.float32)

        # 計算降采樣後的 affine transform（左上角像素中心坐標 + 新像素大小）
        t = src.transform * src.transform.scale(SCALE, SCALE)
        # meta: [origin_x, origin_y, pixel_size_x, pixel_size_y]
        # origin_x = 左上角 x，origin_y = 左上角 y（通常為最大 y，因 y pixel 為負）
        meta = np.array([t.c, t.f, t.a, t.e], dtype=np.float64)

    # nodata 轉 NaN（通常 DEM 的 nodata 為極小負值）
    dem[dem < -1000] = np.nan

    OUT_NPY.parent.mkdir(parents=True, exist_ok=True)
    np.save(OUT_NPY, dem)
    np.save(OUT_META, meta)

    size_mb = OUT_NPY.stat().st_size / 1_048_576
    nan_pct  = float(np.isnan(dem).mean()) * 100
    valid_min = float(np.nanmin(dem))
    valid_max = float(np.nanmax(dem))

    print(f'完成！')
    print(f'  輸出：{OUT_NPY}  ({size_mb:.1f} MB)')
    print(f'  Meta：origin_x={meta[0]:.0f}, origin_y={meta[1]:.0f}, px={meta[2]:.0f}, py={meta[3]:.0f}')
    print(f'  高度範圍：{valid_min:.1f} ~ {valid_max:.1f} m  (NaN: {nan_pct:.1f}%)')
    print(f'  驗證：get_elevation(25.05, 121.52) 應約 5–15 m（台北信義區）')


if __name__ == '__main__':
    main()
