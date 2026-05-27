"""Shadow computation using pvlib + shapely, ported from ntu-cool."""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import httpx
import numpy as np
import pandas as pd
import pvlib
from pyproj import Transformer
from shapely.geometry import Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree

from .db import get_dem_bytes, get_lod1_cache, get_osm_cache, set_lod1_cache, set_osm_cache

OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
]

# ─── DEM numpy array（啟動時由 load_dem() 載入）────────────────────────────────

_DEM: np.ndarray | None = None
_DEM_META: tuple[float, float, float, float] | None = None  # (origin_x, origin_y, px_x, px_y)

_DEM_NPY  = Path(__file__).parent.parent / 'data' / 'taiwan_dem_100m.npy'
_META_NPY = Path(__file__).parent.parent / 'data' / 'taiwan_dem_meta.npy'


async def load_dem() -> None:
    """
    後端啟動時呼叫一次，將 100m DEM 載入 RAM。
    優先序：本機 .npy → DB bytea。兩者皆無時印警告並停用地形高程功能。
    """
    import io
    global _DEM, _DEM_META

    def _apply(dem_bytes: bytes, meta_bytes: bytes) -> None:
        global _DEM, _DEM_META
        _DEM = np.load(io.BytesIO(dem_bytes))
        m = np.load(io.BytesIO(meta_bytes))
        _DEM_META = (float(m[0]), float(m[1]), float(m[2]), float(m[3]))

    # 1. 本機 .npy（最快，repo 內的備用檔）
    if _DEM_NPY.exists() and _META_NPY.exists():
        _apply(_DEM_NPY.read_bytes(), _META_NPY.read_bytes())
        print(f'[shadow] DEM 載入完成（本機）shape={_DEM.shape}，'
              f'origin=({_DEM_META[0]:.0f}, {_DEM_META[1]:.0f})')
        return

    # 2. DB bytea fallback
    print('[shadow] 本機 .npy 不存在，嘗試從 DB 載入 DEM...')
    result = await get_dem_bytes()
    if result:
        dem_bytes, meta_bytes = result
        _apply(dem_bytes, meta_bytes)
        # 同步寫回本機，下次啟動直接用本機
        _DEM_NPY.parent.mkdir(parents=True, exist_ok=True)
        _DEM_NPY.write_bytes(dem_bytes)
        _META_NPY.write_bytes(meta_bytes)
        print(f'[shadow] DEM 載入完成（DB）shape={_DEM.shape}，已寫回本機快取')
        return

    print('[shadow] 警告：DEM 資料不存在（本機與 DB 皆無），地形高程功能停用。'
          '請執行 scripts/build_dem_cache.py 後再執行 scripts/upload_dem.py',
          file=sys.stderr)


def get_elevation(lat: float, lng: float) -> float:
    """查詢 lat/lng (WGS84) 對應的地形海拔（公尺）。DEM 未載入時回傳 0。"""
    if _DEM is None or _DEM_META is None:
        return 0.0
    to_twd97 = Transformer.from_crs('EPSG:4326', 'EPSG:3826', always_xy=True)
    e, n = to_twd97.transform(lng, lat)
    ox, oy, px, py = _DEM_META
    col = int((e - ox) / px)
    row = int((n - oy) / py)   # py 為負值
    if 0 <= row < _DEM.shape[0] and 0 <= col < _DEM.shape[1]:
        val = _DEM[row, col]
        return float(val) if not np.isnan(val) else 0.0
    return 0.0


def _bbox_key(min_lon: float, min_lat: float, max_lon: float, max_lat: float) -> str:
    return f'{min_lon:.2f},{min_lat:.2f},{max_lon:.2f},{max_lat:.2f}'


# ─── Solar position ────────────────────────────────────────────────────────────

def compute_solar_position(lat: float, lon: float, timestamp: pd.Timestamp) -> tuple[float, float]:
    """Return (azimuth_deg, apparent_elevation_deg) via pvlib NREL SPA."""
    loc = pvlib.location.Location(lat, lon, tz='Asia/Taipei')
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize('Asia/Taipei')
    solpos = loc.get_solarposition(timestamp)
    return float(solpos['azimuth'].iloc[0]), float(solpos['apparent_elevation'].iloc[0])


def _make_timestamp(local_hour: int) -> pd.Timestamp:
    today = date.today()
    return pd.Timestamp(year=today.year, month=today.month, day=today.day,
                        hour=local_hour, tz='Asia/Taipei')


# ─── Single-building shadow (used by /api/shadow) ────────────────────────────

def project_shadow(
    footprint_4326: list[list[float]],  # [[lng, lat], ...] EPSG:4326
    height: float,
    lat: float,
    lon: float,
    local_hour: int,
) -> list[list[float]] | None:
    """
    Convex hull of union(footprint, translated_footprint) — same algorithm as ntu-cool.
    Returns [[lng, lat], ...] in EPSG:4326, or None when sun is below horizon.
    """
    azimuth, altitude = compute_solar_position(lat, lon, _make_timestamp(local_hour))
    if altitude <= 0:
        return None

    to_3857 = Transformer.from_crs('EPSG:4326', 'EPSG:3857', always_xy=True)
    to_4326 = Transformer.from_crs('EPSG:3857', 'EPSG:4326', always_xy=True)

    coords_3857 = [to_3857.transform(lng, lt) for lng, lt in footprint_4326]
    building = Polygon(coords_3857)

    shadow_len = height / np.tan(np.radians(altitude))
    shadow_len = min(shadow_len, 500.0 * (altitude / 10.0) * 0.5 if altitude < 10 else 500.0)

    angle = np.radians(azimuth + 180)
    dx, dy = shadow_len * np.sin(angle), shadow_len * np.cos(angle)

    shadow_tip = Polygon([(x + dx, y + dy) for x, y in building.exterior.coords])
    shadow_poly = unary_union([building, shadow_tip]).convex_hull
    if shadow_poly.is_empty:
        return None

    return [list(to_4326.transform(x, y)) for x, y in shadow_poly.exterior.coords]


# ─── Shadow from frontend-supplied building features ─────────────────────────

def _project_buildings(buildings: list[dict], to_3857) -> list[tuple]:
    """Project footprints to EPSG:3857. Returns [(Polygon|None, height), ...]."""
    result = []
    for bldg in buildings:
        try:
            height = float(bldg.get('height') or 10)
            coords = [to_3857.transform(lng, lt) for lng, lt in bldg['footprint']]
            if len(coords) < 3:
                result.append((None, height))
                continue
            poly = Polygon(coords)
            result.append((poly.buffer(0) if not poly.is_valid else poly, height))
        except Exception:
            result.append((None, float(bldg.get('height') or 10)))
    return result


def _shadows_for_sun(
    bldg_polys: list[tuple],   # [(Polygon|None, height), ...]
    azimuth: float,
    altitude: float,
    to_4326,
) -> tuple[list, list]:
    """Return (ground_features, roof_shadow_features) for a given sun position."""
    angle = np.radians(azimuth + 180)
    max_shadow_len = 500.0 * (altitude / 10.0) * 0.5 if altitude < 10 else 500.0

    # ── Phase 1: per-building shadow polygons ─────────────────────────────────
    shadow_data: list[tuple] = []   # (bldg_poly, shadow_poly | None, height)
    features = []

    for bldg_poly, height in bldg_polys:
        if bldg_poly is None:
            shadow_data.append((None, None, height))
            continue
        try:
            shadow_len = min(height / np.tan(np.radians(altitude)), max_shadow_len)
            dx, dy = shadow_len * np.sin(angle), shadow_len * np.cos(angle)
            tip = Polygon([(x + dx, y + dy) for x, y in bldg_poly.exterior.coords])
            sp = unary_union([bldg_poly, tip]).convex_hull
            shadow_data.append((bldg_poly, sp if not sp.is_empty else None, height))
            if not sp.is_empty:
                coords_out = [list(to_4326.transform(x, y)) for x, y in sp.exterior.coords]
                features.append({'type': 'Feature',
                                  'geometry': {'type': 'Polygon', 'coordinates': [coords_out]},
                                  'properties': {}})
        except Exception:
            shadow_data.append((bldg_poly, None, height))

    # ── Phase 2: roof intersections via STRtree (O(n log n)) ─────────────────
    roof_features = []
    valid = [(i, bp, sp, h) for i, (bp, sp, h) in enumerate(shadow_data)
             if bp is not None and sp is not None]

    if len(valid) >= 2:
        tree = STRtree([sp for _, _, sp, _ in valid])
        for i, (bp_i, _, h_i) in enumerate(shadow_data):
            if bp_i is None:
                continue
            overlap = None
            for k in tree.query(bp_i):
                orig, bp_j, sp_j, h_j = valid[k]
                if orig == i or h_j <= h_i:
                    continue
                try:
                    inter = bp_i.intersection(sp_j.difference(bp_j))
                    if not inter.is_empty:
                        overlap = inter if overlap is None else overlap.union(inter)
                except Exception:
                    continue
            if overlap is not None and not overlap.is_empty:
                geoms = list(overlap.geoms) if overlap.geom_type.startswith('Multi') else [overlap]
                for g in geoms:
                    if g.geom_type == 'Polygon' and not g.is_empty:
                        try:
                            c = [list(to_4326.transform(x, y)) for x, y in g.exterior.coords]
                            roof_features.append({'type': 'Feature',
                                                   'geometry': {'type': 'Polygon', 'coordinates': [c]},
                                                   'properties': {'height': h_i}})
                        except Exception:
                            continue

    return features, roof_features


def compute_shadows_from_features(
    buildings: list[dict],
    center_lat: float,
    center_lon: float,
    local_hour: int,
) -> dict:
    if not buildings:
        return {'type': 'FeatureCollection', 'features': [], 'roofShadows': []}
    azimuth, altitude = compute_solar_position(center_lat, center_lon, _make_timestamp(local_hour))
    if altitude <= 0:
        return {'type': 'FeatureCollection', 'features': [], 'roofShadows': []}
    to_3857 = Transformer.from_crs('EPSG:4326', 'EPSG:3857', always_xy=True)
    to_4326 = Transformer.from_crs('EPSG:3857', 'EPSG:4326', always_xy=True)
    bldg_polys = _project_buildings(buildings, to_3857)
    features, roof_features = _shadows_for_sun(bldg_polys, azimuth, altitude, to_4326)
    return {'type': 'FeatureCollection', 'features': features, 'roofShadows': roof_features}


def precompute_shadows_all_hours(
    buildings: list[dict],
    center_lat: float,
    center_lon: float,
) -> dict:
    """Compute shadows for hours 6–19, projecting building footprints only once."""
    to_3857 = Transformer.from_crs('EPSG:4326', 'EPSG:3857', always_xy=True)
    to_4326 = Transformer.from_crs('EPSG:3857', 'EPSG:4326', always_xy=True)
    empty = {'type': 'FeatureCollection', 'features': [], 'roofShadows': []}
    if not buildings:
        return {str(h): empty for h in range(6, 20)}
    bldg_polys = _project_buildings(buildings, to_3857)
    result = {}
    for hour in range(6, 20):
        az, alt = compute_solar_position(center_lat, center_lon, _make_timestamp(hour))
        if alt <= 0:
            result[str(hour)] = empty
            continue
        features, roof_features = _shadows_for_sun(bldg_polys, az, alt, to_4326)
        result[str(hour)] = {'type': 'FeatureCollection', 'features': features, 'roofShadows': roof_features}
    return result


# ─── All-buildings shadow (used by /api/shadows) ──────────────────────────────

def _way_height(tags: dict) -> float:
    if tags.get('height'):
        try:
            return float(str(tags['height']).split()[0])
        except ValueError:
            pass
    if tags.get('building:levels'):
        try:
            return float(tags['building:levels']) * 3.2
        except ValueError:
            pass
    return 10.0


def _osm_to_lod1(elements: list[dict]) -> list[dict]:
    """將 OSM Overpass way 元素轉換為 LoD1 格式（與 NLSC 相容）。"""
    buildings = []
    for el in elements:
        if el.get('type') != 'way' or not el.get('geometry'):
            continue
        footprint = [[n['lon'], n['lat']] for n in el['geometry']]
        if len(footprint) < 3:
            continue
        buildings.append({
            'footprint': footprint,
            'height': _way_height(el.get('tags', {})),
            'build_id': f'osm_{el.get("id", "?")}',
        })
    return buildings


async def _get_township_info(lat: float, lng: float) -> tuple[str, str] | None:
    """
    查 climate_annual 找最近鄉鎮市，回傳 (township_code, county_name)。
    用 centroid 距離最小化（小範圍查詢，無需精確 polygon 判斷）。
    """
    from .db import get_pool
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                '''SELECT township_code, county_name,
                          (centroid_lat - $1)^2 + (centroid_lon - $2)^2 AS dist2
                   FROM climate_annual
                   ORDER BY dist2 ASC
                   LIMIT 1''',
                lat, lng,
            )
            if row:
                return str(row['township_code']), str(row['county_name'])
    except Exception:
        pass
    return None


async def get_buildings(
    min_lon: float, min_lat: float, max_lon: float, max_lat: float,
) -> list[dict]:
    """
    取得 bbox 內建物，回傳 LoD1 格式：
      [{"footprint": [[lng, lat], ...], "height": float, "build_id": str}, ...]

    優先順序：NLSC LoD1 cache → NLSC I3S API → OSM Overpass fallback。
    """
    center_lat = (min_lat + max_lat) / 2
    center_lon = (min_lon + max_lon) / 2

    # ── 嘗試 NLSC LoD1 ────────────────────────────────────────────────────────
    try:
        township_info = await _get_township_info(center_lat, center_lon)
        if township_info:
            township_code, county_name = township_info

            # 1. 檢查 DB cache
            cached = await get_lod1_cache(township_code)
            if cached is not None:
                return _filter_bbox(cached, min_lon, min_lat, max_lon, max_lat)

            # 2. cache miss → 從 NLSC 取 bbox 範圍
            # scripts/ 在 backend 的上層目錄，動態加入 sys.path
            import importlib, sys as _sys
            scripts_dir = str(Path(__file__).parent.parent / 'scripts')
            if scripts_dir not in _sys.path:
                _sys.path.insert(0, scripts_dir)
            nlsc = importlib.import_module('fetch_nlsc_lod1')

            buildings = await nlsc.fetch_nlsc_buildings(
                county_name, min_lon, min_lat, max_lon, max_lat
            )
            if buildings:
                # 將整個 bbox 結果寫入 cache（以 township 為 key）
                await set_lod1_cache(township_code, buildings)
                return buildings
    except Exception:
        pass  # NLSC 失敗 → fallback to OSM

    # ── OSM Overpass fallback ─────────────────────────────────────────────────
    osm_key = _bbox_key(min_lon, min_lat, max_lon, max_lat)
    cached_osm = await get_osm_cache(osm_key)
    if cached_osm is not None:
        return _osm_to_lod1(cached_osm)

    query = (
        f'[out:json][timeout:25];'
        f'way["building"]({min_lat},{min_lon},{max_lat},{max_lon});'
        f'out geom tags;'
    )
    async with httpx.AsyncClient(timeout=20.0) as client:
        for endpoint in OVERPASS_ENDPOINTS:
            try:
                res = await client.post(endpoint, data={'data': query})
                if res.status_code == 200:
                    elements = res.json().get('elements', [])
                    if elements:
                        await set_osm_cache(osm_key, elements)
                    return _osm_to_lod1(elements)
            except Exception:
                continue
    return []


def _filter_bbox(
    buildings: list[dict],
    min_lon: float, min_lat: float,
    max_lon: float, max_lat: float,
) -> list[dict]:
    """以 footprint centroid 過濾出落在 bbox 內的建物。"""
    result = []
    for b in buildings:
        fp = b.get('footprint', [])
        if not fp:
            continue
        cx = sum(p[0] for p in fp) / len(fp)
        cy = sum(p[1] for p in fp) / len(fp)
        if min_lon <= cx <= max_lon and min_lat <= cy <= max_lat:
            result.append(b)
    return result


def compute_usable_roof_fraction(
    target_footprint: list[list[float]],
    buildings: list[dict],
    lat: float,
    lng: float,
    setback_m: float = 1.0,
) -> dict:
    """
    Calculate usable roof fraction for a target building.

    Steps:
      1. Apply parapet setback (buffer -1 m in EPSG:3857) to target footprint.
      2. For each sample hour (8, 10, 12, 14, 16), compute shadow polygons cast
         by neighbouring buildings only (target building excluded).
      3. Compute unshaded fraction of the setback polygon for each hour.
      4. Return the average fraction clamped to [0.1, 0.95].
    """
    to_3857 = Transformer.from_crs('EPSG:4326', 'EPSG:3857', always_xy=True)

    # ── Target polygon + parapet setback ─────────────────────────────────────
    target_3857 = Polygon([to_3857.transform(p[0], p[1]) for p in target_footprint])
    if not target_3857.is_valid:
        target_3857 = target_3857.buffer(0)

    usable_poly = target_3857.buffer(-setback_m)
    if usable_poly.is_empty or usable_poly.area < 1:
        usable_poly = target_3857  # building too small for setback
    usable_area = usable_poly.area

    # ── Neighbour polygons (skip the target building itself) ──────────────────
    neighbour_polys: list[tuple] = []
    for b in buildings:
        try:
            poly = Polygon([to_3857.transform(p[0], p[1]) for p in b['footprint']])
            if not poly.is_valid:
                poly = poly.buffer(0)
            if poly.area < 1:
                continue
            # Skip if this polygon overlaps the target by > 50% (= it IS the target)
            if target_3857.area > 0 and poly.intersection(target_3857).area / target_3857.area > 0.5:
                continue
            neighbour_polys.append((poly, float(b.get('height') or 10)))
        except Exception:
            continue

    # ── Sample hours ──────────────────────────────────────────────────────────
    fractions: list[float] = []
    for hour in [8, 10, 12, 14, 16]:
        az, alt = compute_solar_position(lat, lng, _make_timestamp(hour))
        if alt <= 2:
            continue  # sun too low / below horizon

        angle = np.radians(az + 180)
        max_shadow = 500.0 * (alt / 10.0) * 0.5 if alt < 10 else 500.0

        shadow_polys = []
        for poly, height in neighbour_polys:
            try:
                shadow_len = min(height / np.tan(np.radians(alt)), max_shadow)
                dx = shadow_len * np.sin(angle)
                dy = shadow_len * np.cos(angle)
                tip = Polygon([(x + dx, y + dy) for x, y in poly.exterior.coords])
                sp = unary_union([poly, tip]).convex_hull
                if not sp.is_empty:
                    shadow_polys.append(sp)
            except Exception:
                continue

        if not shadow_polys:
            fractions.append(1.0)
            continue

        all_shadows = unary_union(shadow_polys)
        try:
            shaded_area = usable_poly.intersection(all_shadows).area
        except Exception:
            shaded_area = 0.0

        frac = max(0.0, (usable_area - shaded_area) / usable_area) if usable_area > 0 else 0.0
        fractions.append(frac)

    if not fractions:
        return {'usable_fraction': 0.6, 'setback_area_m2': round(usable_area, 1)}

    avg = sum(fractions) / len(fractions)
    avg = max(0.1, min(0.95, round(avg, 3)))
    return {'usable_fraction': avg, 'setback_area_m2': round(usable_area, 1)}


def compute_bbox_shadows(
    buildings: list[dict],
    center_lat: float,
    center_lon: float,
    local_hour: int,
) -> dict:
    """
    Compute shadow polygons for LoD1 buildings in the bbox.
    Returns a GeoJSON FeatureCollection.
    """
    if not buildings:
        return {'type': 'FeatureCollection', 'features': []}

    azimuth, altitude = compute_solar_position(center_lat, center_lon, _make_timestamp(local_hour))
    if altitude <= 0:
        return {'type': 'FeatureCollection', 'features': []}

    to_3857 = Transformer.from_crs('EPSG:4326', 'EPSG:3857', always_xy=True)
    to_4326 = Transformer.from_crs('EPSG:3857', 'EPSG:4326', always_xy=True)

    angle = np.radians(azimuth + 180)
    max_shadow_len = 500.0 * (altitude / 10.0) * 0.5 if altitude < 10 else 500.0

    features = []
    for b in buildings:
        fp = b.get('footprint', [])
        if len(fp) < 3:
            continue
        try:
            height = float(b.get('height') or 10)
            shadow_len = min(height / np.tan(np.radians(altitude)), max_shadow_len)
            dx, dy = shadow_len * np.sin(angle), shadow_len * np.cos(angle)

            coords_3857 = [to_3857.transform(lng, lat) for lng, lat in fp]
            building = Polygon(coords_3857)
            if not building.is_valid:
                building = building.buffer(0)

            shadow_tip = Polygon([(x + dx, y + dy) for x, y in building.exterior.coords])
            shadow_poly = unary_union([building, shadow_tip]).convex_hull
            if shadow_poly.is_empty:
                continue

            coords_out = [list(to_4326.transform(x, y)) for x, y in shadow_poly.exterior.coords]
            features.append({
                'type': 'Feature',
                'geometry': {'type': 'Polygon', 'coordinates': [coords_out]},
                'properties': {},
            })
        except Exception:
            continue

    return {'type': 'FeatureCollection', 'features': features}
