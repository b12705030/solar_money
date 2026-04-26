from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager

from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / '.env')
from typing import List, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from .auth import create_token, decode_token, hash_password, verify_password
from .db import (add_portfolio, add_vendor_review, approve_vendor_application,
                 claim_anonymous_assessments, close_pool, create_account,
                 create_vendor_application, delete_portfolio, get_account_assessments,
                 get_account_by_email, get_account_by_id, get_application_status,
                 get_my_vendor, get_potential_leads, get_shadow_cache, get_user_assessments,
                 get_user_inquiries, get_vendor_detail, get_vendor_inquiries, init_db,
                 list_pending_vendor_applications, list_vendors, reject_vendor_application,
                 reply_to_inquiry, save_assessment, save_inquiry, set_account_role,
                 set_shadow_cache, shadow_cache_key, update_inquiry_status,
                 update_vendor_logo, update_vendor_profile)
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

_ADMIN_SECRET = os.environ.get('ADMIN_SECRET', 'dev-admin-secret')
if _ADMIN_SECRET == 'dev-admin-secret':
    print('[Admin] 警告：ADMIN_SECRET 未設定，使用開發預設值 dev-admin-secret')

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


@app.get('/api/vendors', response_model=List[VendorResponse])
async def vendors(
    county: Optional[str] = Query(None),
    limit: int = Query(3, le=10),
):
    return await list_vendors(county, limit)


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


class PortfolioCreateRequest(BaseModel):
    title: str
    meta: str
    capacityKw: Optional[float] = None
    completedYear: Optional[int] = None
    photoUrl: Optional[str] = None
    description: Optional[str] = None


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


class LogoUploadRequest(BaseModel):
    logo_url: str  # base64 data URL


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


@app.get('/api/me/vendor/inquiries')
async def me_vendor_inquiries(
    account_id: str = Depends(current_user_id),
    limit: int = Query(50, le=100),
):
    vendor = await get_my_vendor(account_id)
    if not vendor:
        raise HTTPException(status_code=404, detail='尚未綁定廠商帳號')
    return await get_vendor_inquiries(vendor['id'], limit)


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
        except ValueError:
            pass
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
    req: LogoUploadRequest,
    account_id: str = Depends(current_user_id),
):
    vendor = await get_my_vendor(account_id)
    if not vendor:
        raise HTTPException(status_code=404, detail='尚未綁定廠商帳號')
    ok = await update_vendor_logo(vendor['id'], req.logo_url)
    if not ok:
        raise HTTPException(status_code=500, detail='上傳失敗')
    return {'ok': True}


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
    return await get_potential_leads(vendor['id'], vendor['counties'], limit)


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
    ok = await reply_to_inquiry(inquiry_id, vendor['id'], req.reply.strip())
    if not ok:
        raise HTTPException(status_code=404, detail='找不到詢價記錄')
    return {'ok': True}


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
    ok = await add_vendor_review(inquiry_id, account_id, req.vendor_id, req.rating, req.comment)
    if not ok:
        raise HTTPException(status_code=404, detail='找不到詢價記錄，或已評價過')
    return {'ok': True}


# ─── Health ───────────────────────────────────────────────────────────────────

@app.get('/healthz')
def health():
    return {'status': 'ok'}
