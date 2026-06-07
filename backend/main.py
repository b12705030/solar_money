from __future__ import annotations

import sys
import asyncio
import hashlib
import json
import os
from contextlib import asynccontextmanager

# Windows CP950 terminal may reject CJK/special Unicode in print() → force UTF-8
try:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / '.env')
from typing import List, Optional

import time
import uuid
import boto3
from botocore.config import Config

from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import re as _re
from pydantic import BaseModel, field_validator

def _r2_client():
    return boto3.client(
        's3',
        endpoint_url=f'https://{os.environ["R2_ACCOUNT_ID"]}.r2.cloudflarestorage.com',
        aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
        config=Config(signature_version='s3v4'),
        region_name='auto',
    )

_MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB
_IMAGE_SIGNATURES: list[tuple[bytes, str]] = [
    (b'\xff\xd8\xff', 'image/jpeg'),
    (b'\x89PNG',      'image/png'),
    (b'RIFF',         'image/webp'),
]


async def _read_and_validate_image(file: UploadFile) -> tuple[bytes, str]:
    """Read upload, enforce size limit and magic-byte check. Returns (data, mime)."""
    data = await file.read()
    if len(data) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail='檔案超過 5 MB 上限')
    for magic, mime in _IMAGE_SIGNATURES:
        if data[:len(magic)] == magic:
            if mime == 'image/webp' and data[8:12] != b'WEBP':
                continue
            return data, mime
    raise HTTPException(status_code=415, detail='僅接受 JPEG、PNG、WebP 圖片')


async def upload_logo_to_r2(data: bytes, mime: str) -> str:
    ext = mime.split('/')[-1].replace('jpeg', 'jpg')
    key = f'logos/{uuid.uuid4().hex}.{ext}'
    bucket = os.environ['R2_BUCKET_NAME']
    loop = __import__('asyncio').get_event_loop()
    await loop.run_in_executor(None, lambda: _r2_client().put_object(
        Bucket=bucket, Key=key, Body=data, ContentType=mime,
    ))
    return f'{os.environ["R2_PUBLIC_URL"].rstrip("/")}/{key}'

import httpx
import numpy as np
import pandas as pd

from .auth import create_token, decode_token, hash_password, verify_password
from .db import (add_portfolio, add_vendor_review, approve_vendor_application,
                 claim_anonymous_assessments, close_pool, create_account,
                 create_vendor_application, delete_gba_cache,
                 delete_portfolio, get_account_assessments,
                 get_account_by_email, get_account_by_id, get_application_status,
                 get_climate, get_climate_monthly, get_my_vendor, get_pool, get_potential_leads,
                 get_places_cache, set_places_cache,
                 get_region_potential, get_all_region_potential,
                 get_shadow_cache, get_tilt_cache, set_tilt_cache,
                 get_uf_cache, set_uf_cache,
                 get_user_assessments, get_user_inquiries,
                 get_vendor_detail, get_vendor_inquiries_by_account, init_db,
                 list_pending_vendor_applications, list_vendors, preload_polygon_fallback,
                 reject_vendor_application,
                 reply_to_inquiry, save_assessment, save_inquiry, set_account_role,
                 set_shadow_cache, shadow_cache_key, update_inquiry_status,
                 update_vendor_logo, update_vendor_profile,
                 add_user_inquiry_message, get_user_inquiry_messages, mark_user_inquiry_read,
                 mark_vendor_inquiry_read,
                 update_portfolio, create_upgrade_request, list_upgrade_requests,
                 approve_upgrade_request, reject_upgrade_request)
from .mada import topsis
from .shadow import (compute_bbox_shadows, compute_optimal_tilt,
                     compute_shadows_from_features,
                     compute_usable_roof_fraction, get_buildings, get_sun_times,
                     load_dem, precompute_shadows_all_hours, project_shadow)
from .dem_tiles import render_dem_tile


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await init_db()
        print('[DB] 連線成功，資料表已就緒')
    except Exception as e:
        print(f'[DB] 警告：{e}，繼續以無 DB 模式運行')
    try:
        await load_dem()
    except Exception as e:
        print(f'[DEM] 警告：{e}，地形高程功能停用')
    # Start GBA polygon fallback loading in a background thread (fire-and-forget).
    # Server accepts requests immediately; fallback merges into /api/buildings ~3–10 s after start.
    # Set GBA_DISABLE_FALLBACK=1 on memory-constrained deployments (e.g., Railway free tier, 512 MB)
    # to skip loading entirely — the 2.56M-building list takes ~800 MB RAM.
    if os.environ.get('GBA_DISABLE_FALLBACK', '0') != '1':
        try:
            loop = asyncio.get_event_loop()
            loop.run_in_executor(None, preload_polygon_fallback)   # not awaited — background load
            print('[GBA] Polygon fallback loading in background...')
        except Exception as e:
            print(f'[GBA] Polygon preload warning: {e}')
    # 預熱 pyproj CRS 定義：避免第一次座標轉換時的 ~500ms 初始化延遲
    try:
        from pyproj import Transformer as _T
        _T.from_crs('EPSG:4326', 'EPSG:3857', always_xy=True)
        print('[Startup] pyproj CRS 預熱完成')
    except Exception:
        pass
    yield
    await close_pool()


app = FastAPI(title='Solar Money API', version='0.1.0', lifespan=lifespan)

_ADMIN_SECRET = os.environ.get('ADMIN_SECRET', '')
if not _ADMIN_SECRET:
    if os.environ.get('ALLOW_DEV_ADMIN_SECRET') == '1':
        _ADMIN_SECRET = 'dev-admin-secret'
        print('[Admin] 警告：ADMIN_SECRET 未設定，使用開發預設值（ALLOW_DEV_ADMIN_SECRET=1）')
    else:
        raise RuntimeError(
            'ADMIN_SECRET 環境變數未設定。'
            '若為本地開發，請設定 ALLOW_DEV_ADMIN_SECRET=1 以使用預設值。'
        )

_CORS_ORIGINS_ENV = os.environ.get('CORS_ORIGINS', '')
_CORS_ORIGINS = (
    [o.strip() for o in _CORS_ORIGINS_ENV.split(',') if o.strip()]
    if _CORS_ORIGINS_ENV
    else ['*']
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=['*'],
    allow_headers=['*'],
)


# ─── Single-building shadow ───────────────────────────────────────────────────

class ShadowRequest(BaseModel):
    lat: float
    lng: float
    local_hour: int               # Taiwan time UTC+8, 0–23
    footprint: List[List[float]]  # [[lng, lat], ...] EPSG:4326
    height: float


class ShadowResponse(BaseModel):
    shadow: Optional[List[List[float]]]  # [[lng, lat], ...] or null


@app.post('/api/shadow', response_model=ShadowResponse)
def compute_shadow(req: ShadowRequest):
    try:
        coords = project_shadow(req.footprint, req.height, req.lat, req.lng, req.local_hour)
        return ShadowResponse(shadow=coords)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ─── All-buildings shadow for a bounding box ─────────────────────────────────

_SHADOW_MAX_BUILDINGS = 500
_SHADOW_MAX_BBOX_DEG = 2000 / 111_320 * 2  # 與 /api/buildings 對齊

@app.get('/api/shadows')
async def get_all_shadows(
    min_lon: float = Query(...),
    min_lat: float = Query(...),
    max_lon: float = Query(...),
    max_lat: float = Query(...),
    local_hour: int = Query(..., ge=0, le=23),
):
    """
    Fetch OSM buildings inside the bbox, compute their shadow polygons via pvlib,
    and return a GeoJSON FeatureCollection.
    """
    if max_lon <= min_lon or max_lat <= min_lat:
        raise HTTPException(status_code=400, detail='bbox 座標順序錯誤')
    if (max_lon - min_lon) > _SHADOW_MAX_BBOX_DEG or (max_lat - min_lat) > _SHADOW_MAX_BBOX_DEG:
        raise HTTPException(status_code=400, detail='bbox 範圍過大')
    center_lat = (min_lat + max_lat) / 2
    center_lon = (min_lon + max_lon) / 2

    elements = await get_buildings(min_lon, min_lat, max_lon, max_lat)

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        lambda: compute_bbox_shadows(elements, center_lat, center_lon, local_hour),
    )
    return result


# ─── Shadow from Mapbox-rendered features (consistent with 3D buildings) ─────

class BuildingFeature(BaseModel):
    footprint: List[List[float]]  # [[lng, lat], ...]
    height: float


class ShadowFromFeaturesRequest(BaseModel):
    buildings: List[BuildingFeature]
    lat: float
    lng: float
    local_hour: int

    @field_validator('buildings')
    @classmethod
    def buildings_limit(cls, v: List[BuildingFeature]) -> List[BuildingFeature]:
        if len(v) > _SHADOW_MAX_BUILDINGS:
            raise ValueError(f'buildings 最多 {_SHADOW_MAX_BUILDINGS} 筆')
        return v

    @field_validator('local_hour')
    @classmethod
    def hour_range(cls, v: int) -> int:
        if not (0 <= v <= 23):
            raise ValueError('local_hour 需在 0–23 之間')
        return v


@app.post('/api/shadows/precompute')
async def precompute(req: ShadowFromFeaturesRequest):
    """Compute shadows for all daylight hours (6–19). DB cache hit → instant; miss → compute + store."""
    key = shadow_cache_key(req.lat, req.lng)

    _t0 = time.perf_counter()
    cached = await get_shadow_cache(key)
    print(f'[TIMER] /api/shadows/precompute cache_lookup: {(time.perf_counter()-_t0)*1000:.0f}ms')
    if cached is not None:
        # 防護：舊空快取（buildings=[] 時遺留）視為 miss 重算
        has_shadows = any(isinstance(d, dict) and d.get('features') for d in cached.values())
        if has_shadows:
            print(f'[Shadow cache] HIT {key}')
            return cached
        print(f'[Shadow cache] STALE-EMPTY {key} — 重新計算')

    buildings = [{'footprint': b.footprint, 'height': b.height} for b in req.buildings]
    loop = asyncio.get_event_loop()
    _t1 = time.perf_counter()
    result = await loop.run_in_executor(
        None,
        lambda: precompute_shadows_all_hours(buildings, req.lat, req.lng),
    )
    print(f'[TIMER] /api/shadows/precompute compute: {(time.perf_counter()-_t1)*1000:.0f}ms')

    # 只有至少一個小時有陰影才寫入快取（避免空結果污染快取）
    has_any = any(isinstance(d, dict) and d.get('features') for d in result.values())
    if has_any:
        await set_shadow_cache(key, result)
        print(f'[Shadow cache] MISS → computed + stored {key}')
    else:
        print(f'[Shadow cache] MISS → computed (empty, not cached) {key}')
    print(f'[TIMER] /api/shadows/precompute total: {(time.perf_counter()-_t0)*1000:.0f}ms')
    return result


class UsableFractionRequest(BaseModel):
    target_footprint: List[List[float]]  # [[lng, lat], ...] EPSG:4326
    lat: float
    lng: float


_sun_times_cache: dict[str, dict] = {}  # keyed by YYYY-MM-DD, at most 1 entry

@app.get('/api/sun-times/taiwan')
async def taiwan_sun_times():
    """Return today's sunrise/sunset for Taiwan (computed once per day, cached in memory)."""
    from datetime import datetime
    from zoneinfo import ZoneInfo
    today = str(datetime.now(ZoneInfo('Asia/Taipei')).date())
    if today not in _sun_times_cache:
        _sun_times_cache.clear()
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, lambda: get_sun_times(23.97, 120.97))
        _sun_times_cache[today] = result
    return _sun_times_cache[today]


def usable_fraction_cache_key(target_footprint: list) -> str:
    fp_str = json.dumps(target_footprint, separators=(',', ':'))
    h = hashlib.md5(fp_str.encode()).hexdigest()[:12]
    return f'v2_uf_{h}'


@app.post('/api/usable-fraction')
async def usable_fraction_endpoint(req: UsableFractionRequest):
    """
    Calculate usable roof fraction for the target building.
    Fetches neighbouring buildings from GBA DB (radius ~200 m) rather than
    relying on whatever the frontend happens to have rendered.
    Returns usable_fraction (0–1) and setback_area_m2.
    """
    # DB 快取查詢（以 footprint hash 為 key，TTL 180 天）
    uf_key = usable_fraction_cache_key(req.target_footprint)
    _tc = time.perf_counter()
    cached_uf = await get_uf_cache(uf_key)
    if cached_uf is not None:
        print(f'[UF cache] HIT {uf_key} ({(time.perf_counter()-_tc)*1000:.0f}ms)')
        return cached_uf

    # cache miss → 正常計算
    _t0 = time.perf_counter()
    D = 0.002  # ~200 m radius in degrees (Taiwan latitude)
    buildings = await get_buildings(req.lng - D, req.lat - D, req.lng + D, req.lat + D)
    print(f'[TIMER] /api/usable-fraction get_buildings: {(time.perf_counter()-_t0)*1000:.0f}ms')
    loop = asyncio.get_event_loop()
    _t1 = time.perf_counter()
    result = await loop.run_in_executor(
        None,
        lambda: compute_usable_roof_fraction(req.target_footprint, buildings, req.lat, req.lng),
    )
    print(f'[TIMER] /api/usable-fraction compute: {(time.perf_counter()-_t1)*1000:.0f}ms')
    print(f'[TIMER] /api/usable-fraction total: {(time.perf_counter()-_t0)*1000:.0f}ms')

    # 寫入 DB 快取
    await set_uf_cache(uf_key, result)
    print(f'[UF cache] MISS → stored {uf_key}')
    return result


@app.post('/api/shadows/from-features')
async def shadows_from_features(req: ShadowFromFeaturesRequest):
    # 嘗試從 precompute DB 快取取出當前小時資料（避免 4–7s 重算）
    _tc = time.perf_counter()
    precomputed = await get_shadow_cache(shadow_cache_key(req.lat, req.lng))
    if precomputed is not None:
        hour_str = str(req.local_hour)
        if hour_str in precomputed and precomputed[hour_str].get('features'):
            print(f'[TIMER] /api/shadows/from-features precompute_cache_hit: {(time.perf_counter()-_tc)*1000:.0f}ms')
            return precomputed[hour_str]

    buildings = [{'footprint': b.footprint, 'height': b.height} for b in req.buildings]
    loop = asyncio.get_event_loop()
    _t0 = time.perf_counter()
    result = await loop.run_in_executor(
        None,
        lambda: compute_shadows_from_features(buildings, req.lat, req.lng, req.local_hour),
    )
    print(f'[TIMER] /api/shadows/from-features total: {(time.perf_counter()-_t0)*1000:.0f}ms')
    return result


# ─── 使用者評估紀錄 ───────────────────────────────────────────────────────────

class AssessmentRequest(BaseModel):
    user_id: str
    address: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    county: Optional[str] = None
    roof_area_ping: Optional[float] = None
    monthly_kwh: Optional[float] = None
    goal: Optional[str] = None
    capacity_kw: Optional[float] = None
    total_cost: Optional[int] = None
    subsidy_amount: Optional[int] = None
    out_of_pocket: Optional[int] = None
    annual_kwh: Optional[float] = None
    self_sufficiency: Optional[float] = None
    payback_years: Optional[float] = None
    total_20yr: Optional[int] = None
    annual_revenue: Optional[int] = None
    best_angle: Optional[int] = None
    result: Optional[dict] = None


@app.post('/api/assessments', status_code=201)
async def create_assessment(req: AssessmentRequest):
    assessment_id = await save_assessment(req.model_dump())
    return {'id': assessment_id}


@app.get('/api/assessments')
async def list_assessments(
    user_id: str = Query(...),
    limit: int = Query(10, le=50),
):
    rows = await get_user_assessments(user_id, limit)
    return rows


# ─── DEM Tile Server ─────────────────────────────────────────────────────────

from fastapi.responses import Response as FastAPIResponse

@app.get('/api/dem/tile/{z}/{x}/{y}.png')
async def dem_tile(z: int, x: int, y: int):
    """Serve Taiwan 20m DEM as Mapbox terrain-rgb PNG tiles."""
    if z < 0 or z > 15 or x < 0 or y < 0:
        raise HTTPException(status_code=400, detail='Invalid tile coordinates')
    loop = asyncio.get_event_loop()
    png_bytes = await loop.run_in_executor(None, render_dem_tile, z, x, y)
    return FastAPIResponse(
        content=png_bytes,
        media_type='image/png',
        headers={
            'Cache-Control': 'public, max-age=86400',
            'Access-Control-Allow-Origin': '*',
        },
    )


# ─── 氣候資料 (TMY) ───────────────────────────────────────────────────────────

@app.get('/api/buildings')
async def api_get_buildings(
    min_lon: Optional[float] = Query(None),
    min_lat: Optional[float] = Query(None),
    max_lon: Optional[float] = Query(None),
    max_lat: Optional[float] = Query(None),
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    radius_m: float = Query(300, le=2000),
):
    """
    回傳指定範圍內的建物清單（GBA DB → OSM Overpass fallback）。
    接受兩種形式：
    - 地圖視口 bbox：?min_lon=...&min_lat=...&max_lon=...&max_lat=...
    - 點+半徑：?lat=...&lng=...&radius_m=...（預設 300m）
    """
    if min_lon is not None and min_lat is not None and max_lon is not None and max_lat is not None:
        if max_lon <= min_lon or max_lat <= min_lat:
            raise HTTPException(status_code=400, detail='bbox 座標順序錯誤（max 必須大於 min）')
        _MAX_BBOX_DEG = 2000 / 111_320 * 2  # 與 radius_m 上限對齊（直徑 ~0.036°）
        if (max_lon - min_lon) > _MAX_BBOX_DEG or (max_lat - min_lat) > _MAX_BBOX_DEG:
            raise HTTPException(status_code=400, detail='bbox 範圍過大，請縮小視口')
        bbox = (min_lon, min_lat, max_lon, max_lat)
    elif lat is not None and lng is not None:
        pad = radius_m / 111_320
        bbox = (lng - pad, lat - pad, lng + pad, lat + pad)
    else:
        raise HTTPException(status_code=400, detail='需提供 (min_lon/min_lat/max_lon/max_lat) 或 (lat/lng[/radius_m])')
    buildings = await get_buildings(*bbox)
    print(f'[Buildings] bbox={bbox[0]:.5f},{bbox[1]:.5f},{bbox[2]:.5f},{bbox[3]:.5f} → {len(buildings)} bldgs returned to client')
    return {'buildings': [{'footprint': b['footprint'], 'height': b['height']} for b in buildings]}


@app.delete('/api/buildings/cache')
async def clear_buildings_cache(
    gba: bool = Query(True, description='清除 gba_cache'),
    admin_secret: str = Header(..., alias='X-Admin-Secret'),
):
    """
    清除 GBA 建物快取，強制下次請求重新從 DB 抓取。
    需要 X-Admin-Secret header（與 ADMIN_SECRET 環境變數一致）。
    """
    if admin_secret != _ADMIN_SECRET:
        raise HTTPException(status_code=403, detail='Invalid admin secret')
    deleted: dict[str, int] = {}
    if gba:
        n = await delete_gba_cache()
        deleted['gba_cache'] = n
        print(f'[Cache] cleared gba_cache: {n} rows')
    return {'deleted': deleted, 'message': '快取已清除，下次請求將重新抓取'}


_bearer = HTTPBearer()
_optional_bearer = HTTPBearer(auto_error=False)
_VALID_ROLES = {'user', 'vendor', 'admin'}


def current_user_id(creds: HTTPAuthorizationCredentials = Depends(_bearer)) -> str:
    try:
        return decode_token(creds.credentials)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e


async def require_admin(
    x_admin_secret: Optional[str] = Header(None),
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_optional_bearer),
) -> None:
    if x_admin_secret == _ADMIN_SECRET:
        return
    if creds:
        try:
            account_id = decode_token(creds.credentials)
            account = await get_account_by_id(account_id)
            if account and account.get('role') == 'admin':
                return
        except ValueError:
            pass
    raise HTTPException(status_code=401, detail='admin credentials required')


@app.post('/api/admin/cache/cleanup')
async def cleanup_stale_caches(admin=Depends(require_admin)):
    """
    清除過期快取與廢棄資料，用於 Neon 免費 512 MB 容量管理。
    - dem_cache：.npy 已 commit 進 git，DB 備份永遠不需要
    - shadow_cache：只保留當前版本 (v4_*)，舊版 v1/v2/v3 已失效
    - osm_cache：刪除超過 7 天（永遠不會再被讀取）
    - gba_cache：刪除超過 30 天（永遠不會再被讀取）
    """
    pool = await get_pool()
    deleted: dict[str, int] = {}
    async with pool.acquire() as conn:
        r = await conn.execute('DELETE FROM dem_cache')
        deleted['dem_cache'] = int(r.split()[-1])

        r = await conn.execute("DELETE FROM shadow_cache WHERE cache_key NOT LIKE 'v4_%'")
        deleted['shadow_cache_old_versions'] = int(r.split()[-1])

        r = await conn.execute("DELETE FROM osm_cache WHERE fetched_at < NOW() - INTERVAL '7 days'")
        deleted['osm_cache_expired'] = int(r.split()[-1])

        r = await conn.execute("DELETE FROM gba_cache WHERE cached_at < NOW() - INTERVAL '30 days'")
        deleted['gba_cache_expired'] = int(r.split()[-1])

        r = await conn.execute("DELETE FROM usable_fraction_cache WHERE computed_at < NOW() - INTERVAL '180 days'")
        deleted['usable_fraction_cache_expired'] = int(r.split()[-1])

    print(f'[Cache cleanup] {deleted}')
    return {
        'deleted': deleted,
        'note': 'VACUUM 需在 Neon Console 手動執行以立即回收空間',
    }


@app.get('/api/township')
async def get_township_climate(
    lat: float = Query(...),
    lng: float = Query(...),
    goal: str = Query('annual'),
    monthly_use: Optional[str] = Query(None),
):
    """
    依座標查詢最近鄉鎮市的 12 個月 NASA POWER 氣候資料，並以 pvlib 計算最佳仰角。
    前端 Results.tsx 用此取代靜態 TW_IRRADIANCE 三區常數與硬編碼 GOAL_ADJ。
    回傳：{
      township_code, county_name,
      monthly_ghi:  [12 floats, kWh/m²/day],
      monthly_temp: [12 floats, °C],
      monthly_wind: [12 floats, m/s],
      best_angle:   int  (pvlib 最佳仰角，南向),
      goal_adj:     [12 floats]  (POA/GHI ratio，乘上 monthly_ghi 得有效輻照)
    }
    """
    _t0 = time.perf_counter()
    from .shadow import _get_township_info
    info = await _get_township_info(lat, lng)
    print(f'[TIMER] /api/township township_lookup: {(time.perf_counter()-_t0)*1000:.0f}ms')
    if not info:
        raise HTTPException(status_code=404, detail='找不到鄉鎮市資料，請確認 climate_annual 已匯入')
    township_code, county_name = info
    _t1 = time.perf_counter()
    monthly = await get_climate_monthly(township_code)
    print(f'[TIMER] /api/township climate_db: {(time.perf_counter()-_t1)*1000:.0f}ms ({len(monthly)} 月份)')
    if len(monthly) != 12:
        raise HTTPException(status_code=404,
                            detail=f'鄉鎮市 {township_code} 氣候資料不完整，請重新執行 import_climate.py')
    rows = sorted(monthly, key=lambda r: r['month'])
    ghi_list = [row['ghi'] for row in rows]

    monthly_use_list: list[float] | None = None
    if monthly_use:
        try:
            vals = [float(x) for x in monthly_use.split(',')]
            if len(vals) == 12:
                monthly_use_list = vals
        except ValueError:
            pass

    # 非個人化請求（無 monthly_use）才使用 DB 快取
    tilt_key = None if monthly_use_list else f'v1_tilt_{lat:.3f}_{lng:.3f}_{goal}'
    if tilt_key:
        _tc = time.perf_counter()
        cached_tilt = await get_tilt_cache(tilt_key)
        if cached_tilt is not None:
            print(f'[Tilt cache] HIT {tilt_key} ({(time.perf_counter()-_tc)*1000:.0f}ms)')
            print(f'[TIMER] /api/township total (tilt_cache_hit): {(time.perf_counter()-_t0)*1000:.0f}ms')
            return {
                'township_code': township_code,
                'county_name':   county_name,
                'monthly_ghi':      ghi_list,
                'monthly_temp':     [row['temperature']  for row in rows],
                'monthly_wind':     [row['wind_speed']   for row in rows],
                'monthly_humidity': [row['humidity']     for row in rows],
                'best_angle': cached_tilt['best_angle'],
                'goal_adj':   cached_tilt['goal_adj'],
            }

    loop = asyncio.get_event_loop()
    _t2 = time.perf_counter()
    tilt = await loop.run_in_executor(
        None,
        lambda: compute_optimal_tilt(lat, lng, ghi_list, goal, monthly_use_list),
    )
    print(f'[TIMER] /api/township optimal_tilt: {(time.perf_counter()-_t2)*1000:.0f}ms')
    print(f'[TIMER] /api/township total: {(time.perf_counter()-_t0)*1000:.0f}ms')

    # 計算完成後存入 DB 快取
    if tilt_key:
        await set_tilt_cache(tilt_key, tilt)
        print(f'[Tilt cache] MISS → stored {tilt_key}')

    return {
        'township_code': township_code,
        'county_name':   county_name,
        'monthly_ghi':      ghi_list,
        'monthly_temp':     [row['temperature']  for row in rows],
        'monthly_wind':     [row['wind_speed']   for row in rows],
        'monthly_humidity': [row['humidity']     for row in rows],
        'best_angle': tilt['best_angle'],
        'goal_adj':   tilt['goal_adj'],
    }


@app.get('/api/climate/{township_code}')
async def get_climate_data(township_code: str):
    """
    回傳指定鄉鎮市的氣候資料：
    - annual：年均統計（GHI、氣溫、風速、濕度、地理中心）
    - monthly：12 個月典型 GHI/溫度/風速/濕度

    township_code 為內政部 7 碼鄉鎮市代碼，例如 6300100（台北市中正區）。
    若資料庫尚未匯入（需先執行 scripts/import_climate.py），回傳 404。
    """
    annual = await get_climate(township_code)
    if annual is None:
        raise HTTPException(status_code=404,
                            detail=f'找不到 {township_code} 的氣候資料，請確認已執行 import_climate.py')
    monthly = await get_climate_monthly(township_code)
    return {'annual': annual, 'monthly': monthly}


# ─── 廠商推薦 ────────────────────────────────────────────────────────────────

class VendorResponse(BaseModel):
    id: str
    name: str
    counties: List[str]
    portfolioTitle: str
    portfolioMeta: str
    capacityKw: float
    rating: float
    reviewCount: int
    phone: str
    email: str
    tags: List[str]
    logoUrl: Optional[str] = None


class VendorPortfolioResponse(BaseModel):
    id: str
    title: str
    meta: str
    capacityKw: float
    completedYear: Optional[int] = None
    isFeatured: bool


class VendorDetailResponse(VendorResponse):
    approved: bool
    subscriptionStatus: str
    portfolios: List[VendorPortfolioResponse]


class VendorApplyRequest(BaseModel):
    company_name: str
    company_tax_id: Optional[str] = None
    contact_name: str
    email: str
    phone: str
    counties: List[str]
    license_note: Optional[str] = None
    logo_url: Optional[str] = None


class VendorApplicationResponse(BaseModel):
    id: str
    name: str
    companyTaxId: Optional[str] = None
    contactName: Optional[str] = None
    counties: List[str]
    phone: str
    email: str
    licenseNote: Optional[str] = None
    applicationStatus: str
    createdAt: str


class VendorRejectRequest(BaseModel):
    reason: Optional[str] = None


class AccountRoleRequest(BaseModel):
    role: str



@app.get('/api/vendors', response_model=List[VendorResponse])
async def vendors(
    county: Optional[str] = Query(None),
    limit: int = Query(3, le=50),
    offset: int = Query(0, ge=0),
):
    return await list_vendors(county, limit, offset)


@app.post('/api/vendors/apply', status_code=201)
async def apply_vendor(
    req: VendorApplyRequest,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_optional_bearer),
):
    if not req.company_name.strip():
        raise HTTPException(status_code=422, detail='請填寫公司名稱')
    if not req.contact_name.strip():
        raise HTTPException(status_code=422, detail='請填寫聯絡人')
    if not req.email.strip():
        raise HTTPException(status_code=422, detail='請填寫 Email')
    if not req.phone.strip():
        raise HTTPException(status_code=422, detail='請填寫電話')
    if len(req.counties) == 0:
        raise HTTPException(status_code=422, detail='請至少選擇一個服務縣市')
    account_id: Optional[str] = None
    if creds:
        try:
            account_id = decode_token(creds.credentials)
        except ValueError:
            pass
    try:
        vendor_id = await create_vendor_application(req.model_dump(), account_id)
    except ValueError as e:
        msg = str(e)
        if msg.startswith('already_applied:'):
            status = msg.split(':')[1]
            raise HTTPException(status_code=409, detail=f'already_applied:{status}')
        raise HTTPException(status_code=422, detail=msg)
    return {'id': vendor_id, 'status': 'pending'}


@app.get('/api/vendors/{vendor_id}', response_model=VendorDetailResponse)
async def vendor_detail(vendor_id: str):
    vendor = await get_vendor_detail(vendor_id)
    if not vendor:
        raise HTTPException(status_code=404, detail='找不到廠商')
    return vendor


# ─── Admin：廠商審核 MVP ─────────────────────────────────────────────────────

@app.get('/api/admin/vendors/pending', response_model=List[VendorApplicationResponse])
async def admin_pending_vendors(
    _: None = Depends(require_admin),
    limit: int = Query(50, le=100),
):
    return await list_pending_vendor_applications(limit)


@app.post('/api/admin/vendors/{vendor_id}/approve')
async def admin_approve_vendor(
    vendor_id: str,
    _: None = Depends(require_admin),
):
    ok = await approve_vendor_application(vendor_id)
    if not ok:
        raise HTTPException(status_code=404, detail='找不到待審核廠商')
    return {'ok': True, 'status': 'approved'}


@app.post('/api/admin/vendors/{vendor_id}/reject')
async def admin_reject_vendor(
    vendor_id: str,
    req: VendorRejectRequest,
    _: None = Depends(require_admin),
):
    ok = await reject_vendor_application(vendor_id, req.reason)
    if not ok:
        raise HTTPException(status_code=404, detail='找不到待審核廠商')
    return {'ok': True, 'status': 'rejected'}


# ─── Admin：升級申請 ─────────────────────────────────────────────────────────

@app.get('/api/admin/upgrade-requests')
async def admin_list_upgrade_requests(
    _: None = Depends(require_admin),
    status: Optional[str] = Query(None),
):
    return await list_upgrade_requests(status)


@app.post('/api/admin/upgrade-requests/{request_id}/approve')
async def admin_approve_upgrade(
    request_id: str,
    _: None = Depends(require_admin),
):
    try:
        ok = await approve_upgrade_request(request_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'核准失敗：{e}')
    if not ok:
        raise HTTPException(status_code=404, detail='找不到待審核的升級申請')
    return {'ok': True}


@app.post('/api/admin/upgrade-requests/{request_id}/reject')
async def admin_reject_upgrade(
    request_id: str,
    req: VendorRejectRequest,
    _: None = Depends(require_admin),
):
    ok = await reject_upgrade_request(request_id, req.reason)
    if not ok:
        raise HTTPException(status_code=404, detail='找不到待審核的升級申請')
    return {'ok': True}


# ─── 帳號 & Auth ─────────────────────────────────────────────────────────────

class AuthRequest(BaseModel):
    email: str
    password: str


class AuthResponse(BaseModel):
    token: str
    user_id: str
    email: str
    role: str


@app.post('/api/auth/register', response_model=AuthResponse)
async def register(req: AuthRequest):
    existing = await get_account_by_email(req.email)
    if existing:
        raise HTTPException(status_code=409, detail='此 Email 已被註冊')
    if len(req.password) < 8:
        raise HTTPException(status_code=422, detail='密碼至少需要 8 個字元')
    account_id = await create_account(req.email, hash_password(req.password))
    return AuthResponse(token=create_token(account_id), user_id=account_id, email=req.email, role='user')


@app.post('/api/auth/login', response_model=AuthResponse)
async def login(req: AuthRequest):
    account = await get_account_by_email(req.email)
    if not account or not verify_password(req.password, account['password_hash']):
        raise HTTPException(status_code=401, detail='Email 或密碼錯誤')
    return AuthResponse(token=create_token(account['id']), user_id=account['id'], email=account['email'], role=account.get('role', 'user'))


@app.get('/api/admin/accounts/search')
async def admin_search_account(
    email: str = Query(...),
    _: None = Depends(require_admin),
):
    account = await get_account_by_email(email)
    if not account:
        raise HTTPException(status_code=404, detail='找不到帳號')
    return {'id': account['id'], 'email': account['email'], 'role': account.get('role', 'user')}


@app.post('/api/admin/accounts/{account_id}/role')
async def admin_set_account_role(
    account_id: str,
    req: AccountRoleRequest,
    _: None = Depends(require_admin),
):
    if req.role not in _VALID_ROLES:
        raise HTTPException(status_code=422, detail='role must be user, vendor, or admin')
    ok = await set_account_role(account_id, req.role)
    if not ok:
        raise HTTPException(status_code=404, detail='找不到帳號')
    return {'ok': True, 'account_id': account_id, 'role': req.role}


@app.get('/api/me/assessments')
async def me_assessments(
    account_id: str = Depends(current_user_id),
    limit: int = Query(20, le=50),
):
    return await get_account_assessments(account_id, limit)


@app.post('/api/me/claim')
async def claim_assessments(
    user_id: str = Query(..., description='匿名 localStorage UUID'),
    account_id: str = Depends(current_user_id),
):
    """登入後將匿名評估綁定到帳號。"""
    await claim_anonymous_assessments(user_id, account_id)
    return {'ok': True}


# ─── 廠商儀表板（廠商本人） ────────────────────────────────────────────────────

class VendorUpdateRequest(BaseModel):
    name: str
    phone: str
    email: str
    counties: List[str]
    tags: List[str]
    remove_logo: bool = False

    @field_validator('name')
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError('公司名稱不可空白')
        return v.strip()

    @field_validator('email')
    @classmethod
    def email_format(cls, v: str) -> str:
        if v and not _re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', v):
            raise ValueError('Email 格式不正確')
        return v

    @field_validator('counties')
    @classmethod
    def at_least_one_county(cls, v: List[str]) -> List[str]:
        if not v:
            raise ValueError('至少需選擇一個服務縣市')
        return v

    @field_validator('tags')
    @classmethod
    def tags_limit(cls, v: List[str]) -> List[str]:
        if len(v) > 10:
            raise ValueError('標籤最多 10 個')
        return [t[:20] for t in v]  # 單標籤最長 20 字


class PortfolioCreateRequest(BaseModel):
    title: str
    meta: str
    capacityKw: Optional[float] = None
    completedYear: Optional[int] = None
    photoUrl: Optional[str] = None
    description: Optional[str] = None

    @field_validator('title', 'meta')
    @classmethod
    def not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError('不可空白')
        return v.strip()

    @field_validator('capacityKw')
    @classmethod
    def capacity_non_negative(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and v < 0:
            raise ValueError('容量不可為負數')
        return v

    @field_validator('completedYear')
    @classmethod
    def year_range(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and not (1990 <= v <= 2035):
            raise ValueError('完工年份需在 1990–2035 之間')
        return v


class PortfolioUpdateRequest(BaseModel):
    title: str
    meta: str
    capacityKw: Optional[float] = None
    completedYear: Optional[int] = None
    description: Optional[str] = None
    photoUrl: Optional[str] = None  # sentinel: include field to update photo

    @field_validator('title', 'meta')
    @classmethod
    def not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError('不可空白')
        return v.strip()

    @field_validator('capacityKw')
    @classmethod
    def capacity_non_negative(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and v < 0:
            raise ValueError('容量不可為負數')
        return v

    @field_validator('completedYear')
    @classmethod
    def year_range(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and not (1990 <= v <= 2035):
            raise ValueError('完工年份需在 1990–2035 之間')
        return v


class InquiryStatusRequest(BaseModel):
    status: str  # new | contacted | quoted | closed


class InquireRequest(BaseModel):
    address: Optional[str] = None
    county: Optional[str] = None
    capacity_kw: Optional[float] = None
    annual_kwh: Optional[float] = None
    payback_years: Optional[float] = None
    message: Optional[str] = None


class VendorReplyRequest(BaseModel):
    reply: str


class ReviewRequest(BaseModel):
    vendor_id: str
    rating: int
    comment: Optional[str] = None



@app.get('/api/me/vendor')
async def me_vendor(account_id: str = Depends(current_user_id)):
    vendor = await get_my_vendor(account_id)
    if not vendor:
        raise HTTPException(status_code=404, detail='尚未綁定廠商帳號')
    return vendor


@app.patch('/api/me/vendor')
async def me_update_vendor(
    req: VendorUpdateRequest,
    account_id: str = Depends(current_user_id),
):
    vendor = await get_my_vendor(account_id)
    if not vendor:
        raise HTTPException(status_code=404, detail='尚未綁定廠商帳號')
    ok = await update_vendor_profile(vendor['id'], req.model_dump())
    if not ok:
        raise HTTPException(status_code=500, detail='更新失敗')
    return {'ok': True}


@app.post('/api/me/vendor/portfolios', status_code=201)
async def me_add_portfolio(
    req: PortfolioCreateRequest,
    account_id: str = Depends(current_user_id),
):
    vendor = await get_my_vendor(account_id)
    if not vendor:
        raise HTTPException(status_code=404, detail='尚未綁定廠商帳號')
    portfolio_id = await add_portfolio(
        vendor['id'], req.title, req.meta, req.capacityKw, req.completedYear,
        req.photoUrl, req.description,
    )
    return {'id': portfolio_id}


@app.delete('/api/me/vendor/portfolios/{portfolio_id}', status_code=204)
async def me_delete_portfolio(
    portfolio_id: str,
    account_id: str = Depends(current_user_id),
):
    vendor = await get_my_vendor(account_id)
    if not vendor:
        raise HTTPException(status_code=404, detail='尚未綁定廠商帳號')
    ok = await delete_portfolio(portfolio_id, vendor['id'])
    if not ok:
        raise HTTPException(status_code=404, detail='找不到作品集項目')


@app.patch('/api/me/vendor/portfolios/{portfolio_id}')
async def me_update_portfolio(
    portfolio_id: str,
    req: PortfolioUpdateRequest,
    account_id: str = Depends(current_user_id),
):
    vendor = await get_my_vendor(account_id)
    if not vendor:
        raise HTTPException(status_code=404, detail='尚未綁定廠商帳號')
    update_photo = 'photoUrl' in req.model_fields_set
    ok = await update_portfolio(
        portfolio_id, vendor['id'],
        req.title, req.meta, req.capacityKw, req.completedYear,
        req.description, req.photoUrl, update_photo,
    )
    if not ok:
        raise HTTPException(status_code=404, detail='找不到作品集項目')
    return {'ok': True}


@app.post('/api/me/vendor/upgrade-request', status_code=201)
async def me_upgrade_request(
    account_id: str = Depends(current_user_id),
):
    vendor = await get_my_vendor(account_id)
    if not vendor:
        raise HTTPException(status_code=404, detail='尚未綁定廠商帳號')
    if vendor.get('applicationStatus') != 'approved':
        raise HTTPException(status_code=403, detail='廠商帳號尚未通過審核，無法申請升級')
    if vendor.get('subscriptionStatus') == 'advanced':
        raise HTTPException(status_code=409, detail='已是進階方案，無需重複申請')
    try:
        request_id = await create_upgrade_request(vendor['id'])
    except RuntimeError:
        raise HTTPException(status_code=409, detail='申請處理中，請稍後再試')
    return {'id': request_id}


@app.get('/api/me/vendor/inquiries')
async def me_vendor_inquiries(
    account_id: str = Depends(current_user_id),
    limit: int = Query(50, le=100),
):
    return await get_vendor_inquiries_by_account(account_id, limit)


@app.post('/api/vendors/{vendor_id}/inquire', status_code=201)
async def vendor_inquire(
    vendor_id: str,
    req: InquireRequest,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_optional_bearer),
):
    account_id: Optional[str] = None
    if creds:
        try:
            account_id = decode_token(creds.credentials)
            account = await get_account_by_id(account_id)
            if account and account.get('role') == 'vendor':
                raise HTTPException(status_code=403, detail='廠商帳號不可對其他廠商送出詢價')
        except HTTPException:
            raise
        except ValueError:
            pass
    vendor = await get_vendor_detail(vendor_id)
    if not vendor:
        raise HTTPException(status_code=404, detail='找不到廠商或廠商尚未通過審核')
    inquiry_id = await save_inquiry(vendor_id, account_id, req.model_dump())
    return {'id': inquiry_id}


@app.get('/api/me/application/status')
async def me_application_status(account_id: str = Depends(current_user_id)):
    """用戶查詢自己的廠商入駐申請狀態。"""
    status = await get_application_status(account_id)
    if not status:
        return {'status': 'none'}
    return status


@app.post('/api/me/vendor/logo')
async def me_upload_logo(
    file: UploadFile = File(...),
    account_id: str = Depends(current_user_id),
):
    if not os.environ.get('R2_ACCOUNT_ID'):
        raise HTTPException(status_code=503, detail='圖片儲存服務未設定')
    vendor = await get_my_vendor(account_id)
    if not vendor:
        raise HTTPException(status_code=404, detail='尚未綁定廠商帳號')
    data, mime = await _read_and_validate_image(file)
    logo_url = await upload_logo_to_r2(data, mime)
    ok = await update_vendor_logo(vendor['id'], logo_url)
    if not ok:
        raise HTTPException(status_code=500, detail='上傳失敗')
    return {'url': logo_url}


@app.post('/api/me/vendor/upload-image')
async def me_upload_image(
    file: UploadFile = File(...),
    account_id: str = Depends(current_user_id),
):
    """通用圖片上傳（logo、作品集照片等），回傳 R2 公開 URL。
    此端點供申請流程使用，申請提交前即需上傳 logo，故不要求已有申請記錄。
    防濫用依賴 file 驗證（5 MB 上限 + magic bytes）。"""
    if not os.environ.get('R2_ACCOUNT_ID'):
        raise HTTPException(status_code=503, detail='圖片儲存服務未設定')
    data, mime = await _read_and_validate_image(file)
    url = await upload_logo_to_r2(data, mime)
    return {'url': url}


@app.patch('/api/me/vendor/inquiries/{inquiry_id}/status')
async def me_vendor_inquiry_status(
    inquiry_id: str,
    req: InquiryStatusRequest,
    account_id: str = Depends(current_user_id),
):
    _VALID_STATUSES = {'new', 'contacted', 'quoted', 'closed'}
    if req.status not in _VALID_STATUSES:
        raise HTTPException(status_code=422, detail='無效的狀態值')
    vendor = await get_my_vendor(account_id)
    if not vendor:
        raise HTTPException(status_code=404, detail='尚未綁定廠商帳號')
    ok = await update_inquiry_status(inquiry_id, vendor['id'], req.status)
    if not ok:
        raise HTTPException(status_code=404, detail='找不到詢價記錄')
    return {'ok': True, 'status': req.status}


_FREE_LEADS_LIMIT = 3  # free 方案最多預覽筆數

@app.get('/api/me/vendor/leads')
async def me_vendor_leads(
    account_id: str = Depends(current_user_id),
    limit: int = Query(30, le=50),
):
    vendor = await get_my_vendor(account_id)
    if not vendor:
        raise HTTPException(status_code=404, detail='尚未綁定廠商帳號')
    if not vendor.get('counties'):
        return []
    is_paid = vendor.get('subscriptionStatus') not in (None, 'free', 'mock')
    fetch_limit = limit if is_paid else _FREE_LEADS_LIMIT
    return await get_potential_leads(vendor['id'], vendor['counties'], fetch_limit)


@app.post('/api/me/vendor/inquiries/{inquiry_id}/reply')
async def me_vendor_reply(
    inquiry_id: str,
    req: VendorReplyRequest,
    account_id: str = Depends(current_user_id),
):
    vendor = await get_my_vendor(account_id)
    if not vendor:
        raise HTTPException(status_code=404, detail='尚未綁定廠商帳號')
    if not req.reply.strip():
        raise HTTPException(status_code=422, detail='回覆內容不可空白')
    msg = await reply_to_inquiry(inquiry_id, vendor['id'], req.reply.strip())
    if not msg:
        raise HTTPException(status_code=404, detail='找不到詢價記錄')
    return msg


@app.get('/api/me/inquiries')
async def me_inquiries(
    account_id: str = Depends(current_user_id),
    limit: int = Query(30, le=50),
):
    """用戶查看自己送出的詢價（含廠商回覆與評價狀態）。"""
    return await get_user_inquiries(account_id, limit)


@app.post('/api/me/inquiries/{inquiry_id}/review', status_code=201)
async def me_add_review(
    inquiry_id: str,
    req: ReviewRequest,
    account_id: str = Depends(current_user_id),
):
    if not (1 <= req.rating <= 5):
        raise HTTPException(status_code=422, detail='評分需介於 1 到 5 之間')
    result = await add_vendor_review(inquiry_id, account_id, req.vendor_id, req.rating, req.comment)
    if result == 'not_found':
        raise HTTPException(status_code=404, detail='找不到詢價記錄')
    if result == 'duplicate':
        raise HTTPException(status_code=409, detail='已評價過此廠商')
    return {'ok': True}


class InquiryMessageRequest(BaseModel):
    content: str


@app.post('/api/me/inquiries/{inquiry_id}/message', status_code=201)
async def me_add_inquiry_message(
    inquiry_id: str,
    req: InquiryMessageRequest,
    account_id: str = Depends(current_user_id),
):
    """用戶對已有詢價追加訊息。"""
    content = req.content.strip()
    if not content:
        raise HTTPException(status_code=422, detail='訊息內容不可為空')
    msg = await add_user_inquiry_message(inquiry_id, account_id, content)
    if msg is None:
        raise HTTPException(status_code=404, detail='找不到詢價或無權限')
    return msg


@app.get('/api/me/inquiries/{inquiry_id}/messages')
async def me_inquiry_messages(
    inquiry_id: str,
    account_id: str = Depends(current_user_id),
):
    messages = await get_user_inquiry_messages(inquiry_id, account_id)
    if messages is None:
        raise HTTPException(status_code=404, detail='找不到詢價或無權限')
    return messages


@app.post('/api/me/inquiries/{inquiry_id}/read', status_code=204)
async def me_mark_inquiry_read(
    inquiry_id: str,
    account_id: str = Depends(current_user_id),
):
    await mark_user_inquiry_read(inquiry_id, account_id)


@app.post('/api/me/vendor/inquiries/{inquiry_id}/read', status_code=204)
async def me_vendor_mark_inquiry_read(
    inquiry_id: str,
    account_id: str = Depends(current_user_id),
):
    await mark_vendor_inquiry_read(inquiry_id, account_id)


# ─── 地區潛力排名（MADA / TOPSIS）────────────────────────────────────────────

_TIER_THRESHOLDS = (50, 150)  # rank ≤ 50 → 高潛力；≤ 150 → 中潛力；其餘 → 一般


def _row_to_tier(rank: int) -> str:
    if rank <= _TIER_THRESHOLDS[0]:
        return '高潛力'
    if rank <= _TIER_THRESHOLDS[1]:
        return '中潛力'
    return '一般'


@app.get('/api/region-potential/{towncode}')
async def get_region_potential_api(towncode: str):
    """
    回傳單一鄉鎮市的潛力資訊，供 Results 頁顯示地區 badge。
    towncode 格式：8 碼帶前導零（例如 06300100）。
    """
    row = await get_region_potential(towncode.zfill(8))
    if not row:
        raise HTTPException(status_code=404, detail=f'找不到 {towncode} 的潛力資料')
    rank = int(row['priority_rank'])
    return {
        'towncode':     row['towncode'],
        'countyname':   row['countyname'],
        'townname':     row['townname'],
        'rank':         rank,
        'total':        368,
        'tier':         _row_to_tier(rank),
        'topsis_score': float(row['topsis_score']),
    }


@app.get('/api/region-all')
async def get_all_regions_api():
    """
    回傳全部 368 鄉鎮的座標 + 分數，供 /map 頁地圖初始載入。
    """
    rows = await get_all_region_potential()
    return rows


class TopsisWeights(BaseModel):
    model_score: float = 0.55
    solar:       float = 0.20
    fit:         float = 0.15
    income:      float = 0.10


@app.post('/api/topsis')
async def recompute_topsis_api(weights: TopsisWeights):
    """
    以用戶自訂權重重新跑 TOPSIS，回傳新排名。
    供 /map 頁 slider 即時更新。
    """
    rows = await get_all_region_potential()
    if not rows:
        raise HTTPException(status_code=503, detail='地區潛力資料尚未匯入，請先執行 import_region_data.py')

    df = pd.DataFrame(rows)
    df['log_median_household_income'] = np.log(df['median_household_income'].clip(lower=1))

    result = topsis(
        df,
        weights={
            'combined_score':               weights.model_score,
            'daily_solar_radiation':        weights.solar,
            'occupancy_owner_rate':         weights.fit,
            'log_median_household_income':  weights.income,
        },
        benefit_criteria=[
            'combined_score', 'daily_solar_radiation',
            'occupancy_owner_rate', 'log_median_household_income',
        ],
        alternative_col='towncode',
        norm_method='minmax',
    )

    # 接回地理資訊與原始因子值
    geo = df[['towncode', 'countyname', 'townname', 'centroid_lat', 'centroid_lon',
              'combined_score', 'daily_solar_radiation', 'occupancy_owner_rate',
              'log_median_household_income', 'median_household_income']]
    result = result.merge(geo, left_on='alternative', right_on='towncode', how='left')

    return result[['towncode', 'countyname', 'townname',
                   'score', 'rank', 'centroid_lat', 'centroid_lon',
                   'combined_score', 'daily_solar_radiation',
                   'occupancy_owner_rate',
                   'log_median_household_income', 'median_household_income']].to_dict('records')


@app.get('/api/address-township')
async def get_address_township(lat: float = Query(...), lng: float = Query(...)):
    """
    根據座標查詢鄉鎮市代碼，供前端取得 townshipCode 後查詢地區潛力。
    優先使用 SHP point-in-polygon 精確判定，沿岸/離島 fallback 至 DB 近心距離。
    """
    from .shadow import _get_township_info
    try:
        info = await _get_township_info(lat, lng)
        if not info:
            raise HTTPException(status_code=404, detail='找不到對應鄉鎮市')
        township_code, county_name = info

        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                'SELECT township_name FROM climate_annual WHERE township_code = $1',
                township_code,
            )
        township_name = str(row['township_name']) if row else ''
        return {
            'townshipCode': township_code,
            'countyName':   county_name,
            'townshipName': township_name,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ─── Google Places Proxy（四層快取：session → localStorage → DB → Google API）────

_GMAPS_KEY = os.environ.get('GOOGLE_MAPS_API_KEY', '')
_PLACES_AC_URL = 'https://places.googleapis.com/v1/places:autocomplete'
_PLACES_DETAIL_URL = 'https://places.googleapis.com/v1/places/{place_id}'


def _normalize_ac_key(q: str) -> str:
    q = q.lower().replace('臺', '台')
    q = _re.sub(r'^(台灣|taiwan)\s*', '', q)
    return q


@app.get('/api/places/autocomplete')
async def places_autocomplete(q: str = ''):
    q = q.strip()
    if not q or len(q) < 2:
        return []
    cache_key = f'ac_{_normalize_ac_key(q)}'

    t0 = time.perf_counter()
    cached = await get_places_cache(cache_key)
    elapsed = int((time.perf_counter() - t0) * 1000)
    if cached is not None:
        print(f'[Places] L3 hit  key={cache_key} ({elapsed}ms)')
        return cached
    print(f'[Places] L3 miss key={cache_key} ({elapsed}ms)')

    if not _GMAPS_KEY:
        raise HTTPException(status_code=503, detail='GOOGLE_MAPS_API_KEY not configured')
    try:
        t0 = time.perf_counter()
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                _PLACES_AC_URL,
                headers={'X-Goog-Api-Key': _GMAPS_KEY, 'Content-Type': 'application/json'},
                json={'input': q, 'languageCode': 'zh-TW', 'includedRegionCodes': ['tw']},
            )
            resp.raise_for_status()
            raw = resp.json()
        elapsed = int((time.perf_counter() - t0) * 1000)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f'Google API error: {e}')

    suggestions = [
        {
            'placeId': s['placePrediction']['placeId'],
            'description': s['placePrediction'].get('text', {}).get('text', ''),
            'mainText': (s['placePrediction'].get('structuredFormat') or {}).get('mainText', {}).get('text', ''),
            'secondaryText': (s['placePrediction'].get('structuredFormat') or {}).get('secondaryText', {}).get('text', ''),
        }
        for s in raw.get('suggestions', [])
        if 'placePrediction' in s
    ]
    print(f'[Places] L4 ac   q={q!r} → {len(suggestions)} results ({elapsed}ms)')

    if suggestions:
        t0 = time.perf_counter()
        await set_places_cache(cache_key, suggestions)
        elapsed = int((time.perf_counter() - t0) * 1000)
        print(f'[Places] L3 write key={cache_key} {len(suggestions)} results ({elapsed}ms)')
    else:
        print(f'[Places] L3 skip  key={cache_key} (empty)')
    return suggestions


@app.get('/api/places/details')
async def places_details(id: str = ''):
    if not id:
        raise HTTPException(status_code=400, detail='id required')
    cache_key = f'detail_{id}'

    t0 = time.perf_counter()
    cached = await get_places_cache(cache_key)
    elapsed = int((time.perf_counter() - t0) * 1000)
    if cached is not None:
        print(f'[Places] L3 hit  key={cache_key} ({elapsed}ms)')
        return cached
    print(f'[Places] L3 miss key={cache_key} ({elapsed}ms)')

    if not _GMAPS_KEY:
        raise HTTPException(status_code=503, detail='GOOGLE_MAPS_API_KEY not configured')
    try:
        t0 = time.perf_counter()
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                _PLACES_DETAIL_URL.format(place_id=id),
                headers={'X-Goog-Api-Key': _GMAPS_KEY, 'X-Goog-FieldMask': 'location,formattedAddress'},
            )
            resp.raise_for_status()
            raw = resp.json()
        elapsed = int((time.perf_counter() - t0) * 1000)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f'Google API error: {e}')

    loc = raw.get('location', {})
    result = {
        'lat': loc.get('latitude', 0),
        'lon': loc.get('longitude', 0),
        'formattedAddress': raw.get('formattedAddress', ''),
    }
    print(f'[Places] L4 detail id={id} ({elapsed}ms)')

    t0 = time.perf_counter()
    await set_places_cache(cache_key, result)
    elapsed = int((time.perf_counter() - t0) * 1000)
    print(f'[Places] L3 write key={cache_key} ({elapsed}ms)')
    return result


# ─── Health ───────────────────────────────────────────────────────────────────

@app.get('/healthz')
def health():
    return {'status': 'ok'}
