from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / '.env')
from typing import List, Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from .auth import create_token, decode_token, hash_password, verify_password
from .db import (claim_anonymous_assessments, close_pool, create_account,
                 get_account_assessments, get_account_by_email, get_shadow_cache,
                 get_user_assessments, init_db, save_assessment, set_shadow_cache,
                 shadow_cache_key)
from .shadow import (compute_bbox_shadows, compute_shadows_from_features,
                     get_buildings, precompute_shadows_all_hours, project_shadow)


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await init_db()
        print('[DB] 連線成功，資料表已就緒')
    except Exception as e:
        print(f'[DB] 警告：{e}，繼續以無 DB 模式運行')
    yield
    await close_pool()


app = FastAPI(title='Solar Money API', version='0.1.0', lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
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

@app.get('/api/shadows')
async def get_all_shadows(
    min_lon: float = Query(...),
    min_lat: float = Query(...),
    max_lon: float = Query(...),
    max_lat: float = Query(...),
    local_hour: int = Query(...),
):
    """
    Fetch OSM buildings inside the bbox, compute their shadow polygons via pvlib,
    and return a GeoJSON FeatureCollection.
    """
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
    lat: float   # viewport center, for solar position
    lng: float
    local_hour: int


@app.post('/api/shadows/precompute')
async def precompute(req: ShadowFromFeaturesRequest):
    """Compute shadows for all daylight hours (6–19). DB cache hit → instant; miss → compute + store."""
    key = shadow_cache_key(req.lat, req.lng)

    cached = await get_shadow_cache(key)
    if cached is not None:
        print(f'[Shadow cache] HIT {key}')
        return cached

    buildings = [{'footprint': b.footprint, 'height': b.height} for b in req.buildings]
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        lambda: precompute_shadows_all_hours(buildings, req.lat, req.lng),
    )

    await set_shadow_cache(key, result)
    print(f'[Shadow cache] MISS → computed + stored {key}')
    return result


@app.post('/api/shadows/from-features')
async def shadows_from_features(req: ShadowFromFeaturesRequest):
    buildings = [{'footprint': b.footprint, 'height': b.height} for b in req.buildings]
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        lambda: compute_shadows_from_features(buildings, req.lat, req.lng, req.local_hour),
    )
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


# ─── 帳號 & Auth ─────────────────────────────────────────────────────────────

_bearer = HTTPBearer()


def current_user_id(creds: HTTPAuthorizationCredentials = Depends(_bearer)) -> str:
    try:
        return decode_token(creds.credentials)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e


class AuthRequest(BaseModel):
    email: str
    password: str


class AuthResponse(BaseModel):
    token: str
    user_id: str
    email: str


@app.post('/api/auth/register', response_model=AuthResponse)
async def register(req: AuthRequest):
    existing = await get_account_by_email(req.email)
    if existing:
        raise HTTPException(status_code=409, detail='此 Email 已被註冊')
    if len(req.password) < 8:
        raise HTTPException(status_code=422, detail='密碼至少需要 8 個字元')
    account_id = await create_account(req.email, hash_password(req.password))
    return AuthResponse(token=create_token(account_id), user_id=account_id, email=req.email)


@app.post('/api/auth/login', response_model=AuthResponse)
async def login(req: AuthRequest):
    account = await get_account_by_email(req.email)
    if not account or not verify_password(req.password, account['password_hash']):
        raise HTTPException(status_code=401, detail='Email 或密碼錯誤')
    return AuthResponse(token=create_token(account['id']), user_id=account['id'], email=account['email'])


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


# ─── Health ───────────────────────────────────────────────────────────────────

@app.get('/healthz')
def health():
    return {'status': 'ok'}
