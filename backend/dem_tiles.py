"""Serve Taiwan 20m DEM as Mapbox terrain-rgb PNG tiles (XYZ tile scheme)."""
from __future__ import annotations

import io
import math
from pathlib import Path

import numpy as np

_TIF_PATH = (
    Path(__file__).parent.parent
    / 'data' / '不分幅_全台20MDEM(2025)' / 'DEM_tawiwan_V2025.tif'
)
_TILE_SIZE = 256
# Approximate bounding box of Taiwan (WGS84) for fast out-of-range rejection
_TAIWAN_BBOX = (119.0, 21.5, 122.5, 26.5)  # (west, south, east, north)


def _tile_bbox_wgs84(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """Convert XYZ tile coordinates to WGS84 bounding box (west, south, east, north)."""
    n = 2 ** z
    west  = x / n * 360.0 - 180.0
    east  = (x + 1) / n * 360.0 - 180.0
    lat_n = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    lat_s = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return west, lat_s, east, lat_n


def _sea_level_tile() -> bytes:
    """Return a 256x256 PNG encoding elevation = 0m in Mapbox terrain-rgb format."""
    from PIL import Image
    # 0m → encoded_val = (0 + 10000) / 0.1 = 100000 = 0x0186A0
    # → R=1, G=134, B=160
    encoded = np.full((_TILE_SIZE, _TILE_SIZE), 100000, dtype=np.uint32)
    r = ((encoded >> 16) & 0xFF).astype(np.uint8)
    g = ((encoded >> 8)  & 0xFF).astype(np.uint8)
    b = (encoded         & 0xFF).astype(np.uint8)
    img = Image.fromarray(np.stack([r, g, b], axis=-1), mode='RGB')
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()


def render_dem_tile(z: int, x: int, y: int) -> bytes:
    """
    Read Taiwan 20m GeoTIFF for the given XYZ tile and return a
    Mapbox terrain-rgb encoded PNG (256×256, RGB).

    Returns a sea-level tile (elevation = 0m) for areas outside Taiwan.
    """
    from PIL import Image
    import rasterio
    from rasterio.crs import CRS
    from rasterio.warp import transform_bounds
    from rasterio.windows import from_bounds

    west, south, east, north = _tile_bbox_wgs84(z, x, y)

    # Fast reject: tile is entirely outside Taiwan
    tw_w, tw_s, tw_e, tw_n = _TAIWAN_BBOX
    if east < tw_w or west > tw_e or north < tw_s or south > tw_n:
        return _sea_level_tile()

    if not _TIF_PATH.exists():
        return _sea_level_tile()

    with rasterio.open(_TIF_PATH) as src:
        wgs84 = CRS.from_epsg(4326)
        # Transform tile bbox from WGS84 to source CRS (EPSG:3826 TWD97)
        left, bottom, right, top = transform_bounds(wgs84, src.crs, west, south, east, north)
        window = from_bounds(left, bottom, right, top, src.transform)

        # Check if window overlaps with source raster
        if (window.col_off + window.width <= 0 or window.col_off >= src.width or
                window.row_off + window.height <= 0 or window.row_off >= src.height):
            return _sea_level_tile()

        data = src.read(
            1,
            window=window,
            out_shape=(_TILE_SIZE, _TILE_SIZE),
            resampling=rasterio.enums.Resampling.bilinear,
            boundless=True,
            fill_value=0,
        )

    # Encode elevation as Mapbox terrain-rgb:
    # height = -10000 + (R * 65536 + G * 256 + B) * 0.1
    # → encoded_val = (height + 10000) / 0.1
    height = data.astype(np.float32)
    np.clip(height, -10000, 10000, out=height)
    np.nan_to_num(height, nan=0.0, copy=False)

    encoded = ((height + 10000.0) / 0.1).astype(np.uint32)
    r = ((encoded >> 16) & 0xFF).astype(np.uint8)
    g = ((encoded >> 8)  & 0xFF).astype(np.uint8)
    b = (encoded         & 0xFF).astype(np.uint8)

    img = Image.fromarray(np.stack([r, g, b], axis=-1), mode='RGB')
    buf = io.BytesIO()
    img.save(buf, format='PNG', optimize=False)
    return buf.getvalue()
