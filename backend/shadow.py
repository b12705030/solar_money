"""Shadow computation using pvlib + shapely, ported from ntu-cool."""
from __future__ import annotations

import sys
from datetime import date
from functools import lru_cache
from pathlib import Path

import httpx
import numpy as np
import pandas as pd
import pvlib
from pyproj import Transformer
from shapely.geometry import Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree

from .db import (get_dem_bytes, get_gba_buildings_from_db,
                 get_gba_buildings_from_fallback,
                 get_osm_cache, set_osm_cache)

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


# ─── Optimal tilt calculation ────────────────────────────────────────────────

@lru_cache(maxsize=512)
def _compute_poa_ratio(lat: float, lon: float, tilt: int) -> tuple:
    """
    Monthly POA/GHI ratio for a south-facing panel at integer tilt (degrees).
    Uses Ineichen clearsky model — ratio depends only on solar geometry, not
    actual cloud cover, so it can be safely cached per (lat, lon, tilt).
    Returns a 12-tuple (Jan→Dec).
    """
    loc = pvlib.location.Location(lat, lon, tz='Asia/Taipei')
    ratios = []
    for month in range(1, 13):
        times = pd.date_range(f'2024-{month:02d}-15', periods=24, freq='1h', tz='Asia/Taipei')
        solpos = loc.get_solarposition(times)
        cs = loc.get_clearsky(times)
        mask = (solpos['apparent_elevation'] > 2) & (cs['ghi'] > 0)
        if not mask.any():
            ratios.append(1.0)
            continue
        poa = pvlib.irradiance.get_total_irradiance(
            surface_tilt=float(tilt),
            surface_azimuth=180.0,
            solar_zenith=solpos.loc[mask, 'apparent_zenith'],
            solar_azimuth=solpos.loc[mask, 'azimuth'],
            dni=cs.loc[mask, 'dni'],
            ghi=cs.loc[mask, 'ghi'],
            dhi=cs.loc[mask, 'dhi'],
        )
        ghi_sum = float(cs.loc[mask, 'ghi'].sum())
        ratios.append(float(poa['poa_global'].sum()) / ghi_sum if ghi_sum > 0 else 1.0)
    return tuple(ratios)


# Monthly weights per goal: which months matter most for optimisation
_GOAL_WEIGHTS: dict[str, list[float]] = {
    'annual': [1.0] * 12,
    'summer': [0.0, 0.0, 0.2, 0.5, 1.0, 1.0, 1.0, 1.0, 0.5, 0.2, 0.0, 0.0],
    'winter': [1.0, 1.0, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.5, 1.0, 1.0],
    'peak':   [0.5, 0.5, 1.0, 1.0, 1.0, 0.5, 0.5, 0.5, 1.0, 1.0, 0.5, 0.5],
    'match':  [1.1, 1.0, 0.9, 0.9, 1.0, 1.3, 1.4, 1.3, 1.0, 0.9, 0.9, 1.1],
    'roi':    [1.0] * 12,
}


def compute_optimal_tilt(
    lat: float,
    lon: float,
    monthly_ghi: list[float],
    goal: str,
) -> dict:
    """
    Find the south-facing tilt (0–60°) that maximises goal-weighted annual POA.

    POA/GHI ratios are computed from clearsky geometry (lru_cache'd), then
    scored against actual monthly GHI so the result reflects real local
    irradiance distribution.

    Returns {'best_angle': int, 'goal_adj': [12 floats]}
    where goal_adj[i] = POA/GHI ratio at best_angle for month i.
    In compute.ts: monthlyKwh = capacity × ghi[i] × goal_adj[i] × days × PR
    """
    lat_r = round(lat, 3)
    lon_r = round(lon, 3)
    weights = _GOAL_WEIGHTS.get(goal, _GOAL_WEIGHTS['annual'])

    best_score = -1.0
    best_tilt = 20
    best_ratios: tuple = (1.0,) * 12

    for tilt in range(0, 61, 2):  # coarse: every 2°
        ratios = _compute_poa_ratio(lat_r, lon_r, tilt)
        score = sum(monthly_ghi[i] * ratios[i] * weights[i] for i in range(12))
        if score > best_score:
            best_score, best_tilt, best_ratios = score, tilt, ratios

    for tilt in [best_tilt - 1, best_tilt + 1]:  # fine: ±1° refinement
        if 0 <= tilt <= 60:
            ratios = _compute_poa_ratio(lat_r, lon_r, tilt)
            score = sum(monthly_ghi[i] * ratios[i] * weights[i] for i in range(12))
            if score > best_score:
                best_score, best_tilt, best_ratios = score, tilt, ratios

    return {'best_angle': best_tilt, 'goal_adj': [round(r, 4) for r in best_ratios]}


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

def _compute_building_elevations(buildings: list[dict]) -> list[float]:
    """Per-building terrain elevation by DEM lookup at each footprint centroid."""
    elevations = []
    for bldg in buildings:
        fp = bldg.get('footprint', [])
        if fp:
            cx = sum(p[0] for p in fp) / len(fp)
            cy = sum(p[1] for p in fp) / len(fp)
            elevations.append(get_elevation(cy, cx))
        else:
            elevations.append(0.0)
    return elevations


def _project_buildings(
    buildings: list[dict],
    to_3857,
    elevations: list[float] | None = None,
) -> list[tuple]:
    """Project footprints to EPSG:3857. Returns [(Polygon|None, height, terrain_elev), ...]."""
    result = []
    for i, bldg in enumerate(buildings):
        try:
            height = float(bldg.get('height') or 10)
            terrain_elev = elevations[i] if elevations is not None else 0.0
            coords = [to_3857.transform(lng, lt) for lng, lt in bldg['footprint']]
            if len(coords) < 3:
                result.append((None, height, terrain_elev))
                continue
            poly = Polygon(coords)
            result.append((poly.buffer(0) if not poly.is_valid else poly, height, terrain_elev))
        except Exception:
            result.append((None, float(bldg.get('height') or 10), 0.0))
    return result


def _shadows_for_sun(
    bldg_polys: list[tuple],   # [(Polygon|None, height, terrain_elev), ...]
    azimuth: float,
    altitude: float,
    to_4326,
    center_terrain_elev: float = 0.0,
) -> tuple[list, list]:
    """Return (ground_features, roof_shadow_features) for a given sun position."""
    angle = np.radians(azimuth + 180)
    max_shadow_len = 500.0 * (altitude / 10.0) * 0.5 if altitude < 10 else 500.0

    # ── Phase 1: per-building shadow polygons ─────────────────────────────────
    shadow_data: list[tuple] = []   # (bldg_poly, shadow_poly | None, height)
    shadow_polys_3857: list = []    # 收集所有陰影多邊形（EPSG:3857），最後 union

    for bldg_poly, height, terrain_elev in bldg_polys:
        if bldg_poly is None:
            shadow_data.append((None, None, height))
            continue
        try:
            # 地形修正：坡地上的建物實際有效高度 = 建物高 + 與中心點的地形高差
            effective_height = max(1.0, height + (terrain_elev - center_terrain_elev))
            shadow_len = min(effective_height / np.tan(np.radians(altitude)), max_shadow_len)
            dx, dy = shadow_len * np.sin(angle), shadow_len * np.cos(angle)
            tip = Polygon([(x + dx, y + dy) for x, y in bldg_poly.exterior.coords])
            sp = unary_union([bldg_poly, tip]).convex_hull
            shadow_data.append((bldg_poly, sp if not sp.is_empty else None, height))
            if not sp.is_empty:
                shadow_polys_3857.append(sp)
        except Exception:
            shadow_data.append((bldg_poly, None, height))

    # 將所有陰影 union 成一或多個多邊形後轉回 4326
    # 避免多邊形重疊處顏色因 fill-opacity 疊加而過深
    features = []
    if shadow_polys_3857:
        try:
            merged = unary_union(shadow_polys_3857)
            polys = list(merged.geoms) if merged.geom_type == 'MultiPolygon' else [merged]
            for poly in polys:
                if poly.is_empty or poly.geom_type != 'Polygon':
                    continue
                coords_out = [list(to_4326.transform(x, y)) for x, y in poly.exterior.coords]
                features.append({'type': 'Feature',
                                  'geometry': {'type': 'Polygon', 'coordinates': [coords_out]},
                                  'properties': {}})
        except Exception as e:
            print(f'[shadow] union error: {e}')

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
    center_terrain_elev = get_elevation(center_lat, center_lon)
    azimuth, altitude = compute_solar_position(center_lat, center_lon, _make_timestamp(local_hour), altitude_m=center_terrain_elev)
    if altitude <= 0:
        return {'type': 'FeatureCollection', 'features': [], 'roofShadows': []}
    to_3857 = Transformer.from_crs('EPSG:4326', 'EPSG:3857', always_xy=True)
    to_4326 = Transformer.from_crs('EPSG:3857', 'EPSG:4326', always_xy=True)
    bldg_elevations = _compute_building_elevations(buildings)
    bldg_polys = _project_buildings(buildings, to_3857, bldg_elevations)
    features, roof_features = _shadows_for_sun(bldg_polys, azimuth, altitude, to_4326, center_terrain_elev)
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
    center_terrain_elev = get_elevation(center_lat, center_lon)
    bldg_elevations = _compute_building_elevations(buildings)
    bldg_polys = _project_buildings(buildings, to_3857, bldg_elevations)
    result = {}
    for hour in range(6, 20):
        az, alt = compute_solar_position(center_lat, center_lon, _make_timestamp(hour), altitude_m=center_terrain_elev)
        if alt <= 0:
            result[str(hour)] = empty
            continue
        features, roof_features = _shadows_for_sun(bldg_polys, az, alt, to_4326, center_terrain_elev)
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
    """將 OSM Overpass way 元素轉換為建物格式。"""
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

    優先順序：GBA DB → OSM Overpass fallback。

    GBA：GlobalBuildingAtlas，Neon DB 直接查詢，450,497 棟，覆蓋全台灣。
          footprint 來自 OSM 向量資料（精確），高度為 ML 估算值。
    OSM：最後手段（離島 / GBA 無覆蓋區域）。
    """
    # ── 1. GBA DB（直接查詢，footprint 準確）────────────────────────────────
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

    # ── 2. OSM Overpass 立即 fallback ─────────────────────────────────────────
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
    target_elev = get_elevation(lat, lng)
    neighbour_polys: list[tuple] = []
    for b in buildings:
        try:
            fp = b.get('footprint', [])
            poly = Polygon([to_3857.transform(p[0], p[1]) for p in fp])
            if not poly.is_valid:
                poly = poly.buffer(0)
            if poly.area < 1:
                continue
            # Skip if this polygon overlaps the target by > 50% (= it IS the target)
            if target_3857.area > 0 and poly.intersection(target_3857).area / target_3857.area > 0.5:
                continue
            # DEM 地形修正：鄰棟比目標屋頂低時，有效遮蔽高度縮短
            if fp:
                cx = sum(p[0] for p in fp) / len(fp)
                cy = sum(p[1] for p in fp) / len(fp)
                n_elev = get_elevation(cy, cx)
            else:
                n_elev = 0.0
            eff_h = float(b.get('height') or 10) + (n_elev - target_elev)
            if eff_h <= 0:
                continue  # 鄰棟地面比目標屋頂低，遮不到
            neighbour_polys.append((poly, eff_h))
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
