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

from .db import (get_dem_bytes, get_gba_buildings_from_db, get_gba_cache,
                 get_gba_buildings_from_fallback,
                 get_lod1_cache, get_osm_cache,
                 set_gba_cache, set_lod1_cache, set_osm_cache)

OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
]
_OVERPASS_TIMEOUT = 8.0   # 每個 endpoint 的 timeout（秒），合計最多 ~32s

# ─── DEM numpy array（啟動時由 load_dem() 載入）────────────────────────────────

_DEM: np.ndarray | None = None
_DEM_META: tuple[float, float, float, float] | None = None  # (origin_x, origin_y, px_x, px_y)

_DEM_NPY  = Path(__file__).parent.parent / 'data' / 'taiwan_dem_100m.npy'
_META_NPY = Path(__file__).parent.parent / 'data' / 'taiwan_dem_meta.npy'

# ─── 鄉鎮市區 SHP point-in-polygon cache ─────────────────────────────────────
_TOWN_SHP = (
    Path(__file__).parent.parent
    / 'data' / '鄉(鎮、市、區)界線1140318' / 'TOWN_MOI_1140318.shp'
)
_town_tree:    STRtree | None       = None  # shapely STRtree（空間索引）
_town_polys:   list                 = []    # shapely Polygon list
_town_records: list[tuple[str,str]] = []    # [(township_code, county_name), ...]


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

def compute_solar_position(
    lat: float, lon: float, timestamp: pd.Timestamp, altitude_m: float = 0.0,
) -> tuple[float, float]:
    """Return (azimuth_deg, apparent_elevation_deg) via pvlib NREL SPA."""
    loc = pvlib.location.Location(lat, lon, tz='Asia/Taipei', altitude=altitude_m)
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
    terrain_elev = get_elevation(center_lat, center_lon)
    azimuth, altitude = compute_solar_position(center_lat, center_lon, _make_timestamp(local_hour), altitude_m=terrain_elev)
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
    terrain_elev = get_elevation(center_lat, center_lon)
    bldg_polys = _project_buildings(buildings, to_3857)
    result = {}
    for hour in range(6, 20):
        az, alt = compute_solar_position(center_lat, center_lon, _make_timestamp(hour), altitude_m=terrain_elev)
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


def _load_town_shp() -> None:
    """
    懶載入：讀取 TOWN_MOI SHP → Shapely Polygon list → STRtree。
    第一次呼叫時執行；之後直接回傳（_town_tree is not None）。
    CRS：GCS_TWD97[2020]（地理座標，度數）≈ WGS84，無需轉換。
    """
    global _town_tree, _town_polys, _town_records
    if _town_tree is not None:
        return
    if not _TOWN_SHP.exists():
        print(f'[Township] SHP not found: {_TOWN_SHP}')
        return
    try:
        import fiona
        from shapely.geometry import shape as shp_shape

        polys: list   = []
        records: list[tuple[str, str]] = []
        with fiona.open(str(_TOWN_SHP)) as src:          # .cpg 指定 UTF-8
            for feat in src:
                geom = feat.get('geometry')
                if not geom:
                    continue
                props = feat.get('properties') or {}
                code   = str(props.get('TOWNCODE', '') or '').strip()
                county = str(props.get('COUNTYNAME', '') or '').strip()
                if not code:
                    continue
                polys.append(shp_shape(geom))
                records.append((code, county))

        _town_polys   = polys
        _town_records = records
        _town_tree    = STRtree(polys)
        print(f'[Township] SHP loaded: {len(polys)} townships')
    except Exception as e:
        print(f'[Township] SHP load error: {type(e).__name__}: {e}')


async def _get_township_info(lat: float, lng: float) -> tuple[str, str] | None:
    """
    查鄉鎮市，回傳 (township_code, county_name)。

    優先順序：
      1. 本地 SHP point-in-polygon（精確，不依賴 DB 連線）
      2. climate_annual 近心 DB 查詢（沿岸/離島 fallback）
    """
    # ── 1. 本地 SHP point-in-polygon（精確）──────────────────────────────────
    _load_town_shp()
    if _town_tree is not None:
        from shapely.geometry import Point
        pt = Point(lng, lat)  # EPSG:4326：Point(longitude, latitude)
        idxs = _town_tree.query(pt, predicate='intersects')
        if len(idxs):
            code, county = _town_records[int(idxs[0])]
            return code, county

    # ── 2. Fallback：DB 近心距離（SHP 無結果：沿岸/海上點）─────────────────
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


_nlsc_bg_in_progress: set[str] = set()
_gba_bg_in_progress: set[str] = set()


async def _bg_fetch_gba(
    gba,
    cache_key: str,
    min_lon: float, min_lat: float, max_lon: float, max_lat: float,
) -> None:
    """後台非同步抓取 GBA WFS 建物並存入 DB cache。"""
    try:
        buildings = await gba.fetch_gba_buildings(min_lon, min_lat, max_lon, max_lat)
        if buildings:
            await set_gba_cache(cache_key, buildings)
            print(f'[GBA-BG] done: {len(buildings)} bldgs cached for {cache_key}')
        else:
            print(f'[GBA-BG] returned 0 buildings for {cache_key}')
    except Exception as e:
        print(f'[GBA-BG] error: {type(e).__name__}: {e}')
    finally:
        _gba_bg_in_progress.discard(cache_key)


async def _bg_fetch_nlsc(
    nlsc, township_code: str, county_name: str,
    min_lon: float, min_lat: float, max_lon: float, max_lat: float,
) -> None:
    """
    後台非同步抓取 NLSC I3S 建物並存入 DB cache。
    第一次請求觸發（cache miss），下次查詢直接命中 cache。
    """
    try:
        buildings = await nlsc.fetch_nlsc_buildings(
            county_name, min_lon, min_lat, max_lon, max_lat
        )
        if buildings:
            await set_lod1_cache(township_code, buildings)
            print(f'[NLSC-BG] done: {len(buildings)} bldgs cached for {township_code}')
        else:
            print(f'[NLSC-BG] returned 0 buildings for {township_code} ({county_name})')
    except Exception as e:
        print(f'[NLSC-BG] error: {type(e).__name__}: {e}')
    finally:
        _nlsc_bg_in_progress.discard(township_code)


def _log_bldg_sample(source: str, buildings: list[dict], n: int = 3) -> None:
    """每次 get_buildings() 回傳時印出來源 + 前 n 棟的 centroid/height，方便 debug 坐標偏移。"""
    if not buildings:
        print(f'  -> [{source}] 0 buildings returned')
        return
    lines = [f'  -> [{source}] {len(buildings)} buildings returned, samples:']
    for b in buildings[:n]:
        fp = b.get('footprint', [])
        h  = b.get('height', 0)
        bid = b.get('build_id', '?')
        if fp:
            cx = round(sum(p[0] for p in fp) / len(fp), 6)
            cy = round(sum(p[1] for p in fp) / len(fp), 6)
            lines.append(f'      {bid}  centroid=({cx}, {cy})  h={h}m  pts={len(fp)}')
        else:
            lines.append(f'      {bid}  NO footprint')
    print('\n'.join(lines))


async def get_buildings(
    min_lon: float, min_lat: float, max_lon: float, max_lat: float,
) -> list[dict]:
    """
    取得 bbox 內建物，回傳 LoD1 格式：
      [{"footprint": [[lng, lat], ...], "height": float, "build_id": str}, ...]

    優先順序：NLSC cache → GBA DB → OSM Overpass fallback。

    NLSC（步驟 1）：政府官方 I3S 3D Tiles，高度精確（實測值）。
    GBA（步驟 2）：GlobalBuildingAtlas，OSM 向量 footprint 形狀準確，高度為 ML 估算。
                   NLSC cache miss 時立即回傳 GBA，同時觸發 NLSC 後台預取；
                   下次同地點請求即可命中 NLSC cache（精確高度）。
    OSM（步驟 3）：最後手段（離島 / GBA 無覆蓋區域）。
    """
    import asyncio, importlib, sys as _sys

    center_lat = (min_lat + max_lat) / 2
    center_lon = (min_lon + max_lon) / 2

    scripts_dir = str(Path(__file__).parent.parent / 'scripts')
    if scripts_dir not in _sys.path:
        _sys.path.insert(0, scripts_dir)

    # ── 1. NLSC cache（精確高度）─────────────────────────────────────────────
    township_info = None
    nlsc = None
    township_code = county_name = ''
    try:
        township_info = await _get_township_info(center_lat, center_lon)
        if township_info:
            township_code, county_name = township_info
            nlsc = importlib.import_module('fetch_nlsc_3dtiles')
            corrected = nlsc._county_from_township(township_code)
            if corrected and corrected != county_name:
                print(f'[NLSC] county corrected: {county_name} → {corrected} ({township_code})')
                county_name = corrected
            nlsc_cached = await get_lod1_cache(township_code)
            if nlsc_cached is not None:
                result = _filter_bbox(nlsc_cached, min_lon, min_lat, max_lon, max_lat)
                print(f'[NLSC] cache hit: {len(nlsc_cached)} stored → {len(result)} in bbox  (township={township_code})')
                _log_bldg_sample('NLSC', result)
                return result
        else:
            print(f'[NLSC] no township for ({center_lat:.4f}, {center_lon:.4f})')
    except Exception as e:
        print(f'[NLSC] cache lookup error: {type(e).__name__}: {e}')
        township_info = None

    # ── 2. NLSC cache miss → 觸發後台預取（不等待）+ GBA 即時回傳 ────────────
    # GBA footprint 形狀準確，適合地圖呈現與面積計算。
    # NLSC 在背景下載中；下次同鄉鎮請求將命中 cache，取得精確建物高度。
    pad = 0.018  # ~2 km，用於背景預取 bbox
    bg_bbox = (center_lon - pad, center_lat - pad, center_lon + pad, center_lat + pad)

    if township_info and nlsc and township_code not in _nlsc_bg_in_progress:
        _nlsc_bg_in_progress.add(township_code)
        print(f'[NLSC] cache miss, starting background fetch for {township_code}')
        asyncio.create_task(_bg_fetch_nlsc(nlsc, township_code, county_name, *bg_bbox))
    elif township_info and township_code in _nlsc_bg_in_progress:
        print(f'[NLSC] background fetch already running for {township_code}')

    try:
        gba_result = await get_gba_buildings_from_db(min_lon, min_lat, max_lon, max_lat)
        if not gba_result:
            gba_result = get_gba_buildings_from_fallback(min_lon, min_lat, max_lon, max_lat)
        if gba_result:
            print(f'[GBA] DB returned {len(gba_result)} buildings for bbox '
                  f'({min_lon:.4f},{min_lat:.4f},{max_lon:.4f},{max_lat:.4f})')
            _log_bldg_sample('GBA', gba_result)
            return gba_result
        print(f'[GBA] DB + fallback: 0 buildings, falling through to OSM')
    except Exception as e:
        print(f'[GBA] DB query error: {type(e).__name__}: {e}')

    # ── 3. OSM Overpass 立即 fallback ─────────────────────────────────────────
    print(f'[OSM] falling back to Overpass for bbox={min_lon:.4f},{min_lat:.4f},{max_lon:.4f},{max_lat:.4f}')
    osm_key = _bbox_key(min_lon, min_lat, max_lon, max_lat)
    cached_osm = await get_osm_cache(osm_key)
    if cached_osm is not None:
        result = _osm_to_lod1(cached_osm)
        print(f'[OSM] cache hit: {len(result)} buildings')
        _log_bldg_sample('OSM-cache', result)
        return result

    query = (
        f'[out:json][timeout:25];'
        f'way["building"]({min_lat},{min_lon},{max_lat},{max_lon});'
        f'out geom tags;'
    )
    _headers = {'User-Agent': 'solar-money/1.0 (rooftop solar assessment; contact: admin@example.com)'}
    async with httpx.AsyncClient(timeout=_OVERPASS_TIMEOUT, headers=_headers) as client:
        for endpoint in OVERPASS_ENDPOINTS:
            try:
                print(f'[OSM] trying {endpoint}...')
                # 使用 POST + form body（比 GET params 相容性更好）
                res = await client.post(
                    endpoint,
                    data={'data': query},
                    headers={**_headers, 'Content-Type': 'application/x-www-form-urlencoded'},
                )
                if res.status_code == 200:
                    elements = res.json().get('elements', [])
                    print(f'[OSM] {endpoint} → {len(elements)} elements')
                    if elements:
                        await set_osm_cache(osm_key, elements)
                    result = _osm_to_lod1(elements)
                    _log_bldg_sample('OSM-live', result)
                    return result
                else:
                    print(f'[OSM] {endpoint} HTTP {res.status_code}')
            except Exception as e:
                print(f'[OSM] {endpoint} error: {type(e).__name__}: {e}')
                continue
    print('[OSM] all endpoints failed, returning []')
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
