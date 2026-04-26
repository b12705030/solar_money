"""PostgreSQL 連線池 + cache 工具函式（相容 Neon serverless）"""
from __future__ import annotations

import json
import os
import uuid
from datetime import date

import asyncpg

_pool: asyncpg.Pool | None = None

_VENDOR_SEED = [
    {
        'id': 'north-grid',
        'name': '北曜能源工程',
        'counties': ['台北市', '新北市', '基隆市', '桃園市', '宜蘭縣'],
        'portfolio_title': '信義區集合住宅屋頂型案場',
        'portfolio_meta': '住宅大樓 · 22.4 kWp · 2025 完工',
        'capacity_kw': 22.4,
        'completed_year': 2025,
        'rating': 4.8,
        'review_count': 36,
        'phone': '02-2758-6108',
        'email': 'hello@northgrid.example',
        'tags': ['集合住宅', '結構評估', '台電併聯'],
    },
    {
        'id': 'central-sun',
        'name': '中域日光設計',
        'counties': ['台中市', '彰化縣', '南投縣', '苗栗縣', '雲林縣', '新竹市', '新竹縣'],
        'portfolio_title': '西屯透天高效模組自用案',
        'portfolio_meta': '透天住宅 · 8.6 kWp · 2024 完工',
        'capacity_kw': 8.6,
        'completed_year': 2024,
        'rating': 4.7,
        'review_count': 28,
        'phone': '04-2252-3890',
        'email': 'service@centralsun.example',
        'tags': ['透天厝', '自用優化', '補助代辦'],
    },
    {
        'id': 'south-volt',
        'name': '南方伏特綠能',
        'counties': ['台南市', '高雄市', '屏東縣', '嘉義市', '嘉義縣', '台東縣', '澎湖縣'],
        'portfolio_title': '高雄前鎮屋頂售電型系統',
        'portfolio_meta': '透天住宅 · 12.1 kWp · 2025 完工',
        'capacity_kw': 12.1,
        'completed_year': 2025,
        'rating': 4.9,
        'review_count': 42,
        'phone': '07-335-9021',
        'email': 'contact@southvolt.example',
        'tags': ['售電型', '高日照區', '維運合約'],
    },
    {
        'id': 'east-island',
        'name': '東岸島嶼能源',
        'counties': ['花蓮縣', '台東縣', '金門縣', '連江縣', '澎湖縣'],
        'portfolio_title': '花蓮低樓層住宅抗風支架案',
        'portfolio_meta': '透天住宅 · 7.2 kWp · 2024 完工',
        'capacity_kw': 7.2,
        'completed_year': 2024,
        'rating': 4.6,
        'review_count': 19,
        'phone': '03-822-5170',
        'email': 'team@eastisland.example',
        'tags': ['離島服務', '抗風支架', '維運巡檢'],
    },
]


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        url = os.environ.get('DATABASE_URL', '')
        if not url:
            raise RuntimeError('DATABASE_URL 未設定')
        _pool = await asyncpg.create_pool(url, min_size=1, max_size=5)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def init_db() -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS osm_cache (
                bbox_key   TEXT        PRIMARY KEY,
                elements   JSONB       NOT NULL,
                fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS shadow_cache (
                cache_key   TEXT        PRIMARY KEY,
                shadows     JSONB       NOT NULL,
                computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS accounts (
                id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                email         TEXT        UNIQUE NOT NULL,
                password_hash TEXT        NOT NULL,
                created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS assessments (
                id               UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id          TEXT,
                account_id       UUID             REFERENCES accounts(id),
                address          TEXT,
                lat              DOUBLE PRECISION,
                lng              DOUBLE PRECISION,
                county           TEXT,
                roof_area_ping   DOUBLE PRECISION,
                monthly_kwh      DOUBLE PRECISION,
                goal             TEXT,
                capacity_kw      DOUBLE PRECISION,
                total_cost       BIGINT,
                subsidy_amount   BIGINT,
                out_of_pocket    BIGINT,
                annual_kwh       DOUBLE PRECISION,
                self_sufficiency DOUBLE PRECISION,
                payback_years    DOUBLE PRECISION,
                total_20yr       BIGINT,
                annual_revenue   BIGINT,
                best_angle       INT,
                result           JSONB,
                created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS vendors (
                id                  TEXT        PRIMARY KEY,
                name                TEXT        NOT NULL,
                company_tax_id      TEXT,
                contact_name        TEXT,
                counties            TEXT[]      NOT NULL DEFAULT '{}',
                rating              DOUBLE PRECISION NOT NULL DEFAULT 0,
                review_count        INT         NOT NULL DEFAULT 0,
                phone               TEXT,
                email               TEXT,
                tags                TEXT[]      NOT NULL DEFAULT '{}',
                approved            BOOLEAN     NOT NULL DEFAULT TRUE,
                subscription_status TEXT        NOT NULL DEFAULT 'mock',
                application_status  TEXT        NOT NULL DEFAULT 'approved',
                license_note        TEXT,
                created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS vendor_portfolios (
                id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                vendor_id      TEXT        NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
                title          TEXT        NOT NULL,
                meta           TEXT        NOT NULL,
                capacity_kw    DOUBLE PRECISION,
                completed_year INT,
                is_featured    BOOLEAN     NOT NULL DEFAULT TRUE,
                created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        ''')
        # 相容舊版 schema（補齊新欄位）
        for col, definition in [
            ('user_id',          'TEXT'),
            ('account_id',       'UUID'),
            ('county',           'TEXT'),
            ('roof_area_ping',   'DOUBLE PRECISION'),
            ('monthly_kwh',      'DOUBLE PRECISION'),
            ('goal',             'TEXT'),
            ('capacity_kw',      'DOUBLE PRECISION'),
            ('total_cost',       'BIGINT'),
            ('subsidy_amount',   'BIGINT'),
            ('out_of_pocket',    'BIGINT'),
            ('annual_kwh',       'DOUBLE PRECISION'),
            ('self_sufficiency', 'DOUBLE PRECISION'),
            ('payback_years',    'DOUBLE PRECISION'),
            ('total_20yr',       'BIGINT'),
            ('annual_revenue',   'BIGINT'),
            ('best_angle',       'INT'),
        ]:
            await conn.execute(
                f"ALTER TABLE assessments ADD COLUMN IF NOT EXISTS {col} {definition}"
            )
        for col, definition in [
            ('company_tax_id',      'TEXT'),
            ('contact_name',        'TEXT'),
            ('counties',            "TEXT[] NOT NULL DEFAULT '{}'"),
            ('rating',              'DOUBLE PRECISION NOT NULL DEFAULT 0'),
            ('review_count',        'INT NOT NULL DEFAULT 0'),
            ('phone',               'TEXT'),
            ('email',               'TEXT'),
            ('tags',                "TEXT[] NOT NULL DEFAULT '{}'"),
            ('approved',            'BOOLEAN NOT NULL DEFAULT TRUE'),
            ('subscription_status', "TEXT NOT NULL DEFAULT 'mock'"),
            ('application_status',  "TEXT NOT NULL DEFAULT 'approved'"),
            ('license_note',        'TEXT'),
        ]:
            await conn.execute(
                f"ALTER TABLE vendors ADD COLUMN IF NOT EXISTS {col} {definition}"
            )
        await seed_vendors(conn)


async def seed_vendors(conn: asyncpg.Connection) -> None:
    for vendor in _VENDOR_SEED:
        await conn.execute(
            '''INSERT INTO vendors
               (id, name, counties, rating, review_count, phone, email, tags, approved, subscription_status)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,'mock')
               ON CONFLICT (id) DO UPDATE SET
                 name = EXCLUDED.name,
                 counties = EXCLUDED.counties,
                 rating = EXCLUDED.rating,
                 review_count = EXCLUDED.review_count,
                 phone = EXCLUDED.phone,
                 email = EXCLUDED.email,
                 tags = EXCLUDED.tags''',
            vendor['id'],
            vendor['name'],
            vendor['counties'],
            vendor['rating'],
            vendor['review_count'],
            vendor['phone'],
            vendor['email'],
            vendor['tags'],
        )
        await conn.execute(
            '''INSERT INTO vendor_portfolios
               (vendor_id, title, meta, capacity_kw, completed_year, is_featured)
               SELECT $1,$2,$3,$4,$5,TRUE
               WHERE NOT EXISTS (
                   SELECT 1 FROM vendor_portfolios WHERE vendor_id = $1 AND is_featured = TRUE
               )''',
            vendor['id'],
            vendor['portfolio_title'],
            vendor['portfolio_meta'],
            vendor['capacity_kw'],
            vendor['completed_year'],
        )


# ─── OSM 建物 cache（取代 in-memory dict，TTL = 7 天）────────────────────────

async def get_osm_cache(key: str) -> list[dict] | None:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT elements FROM osm_cache "
                "WHERE bbox_key = $1 AND fetched_at > NOW() - INTERVAL '7 days'",
                key,
            )
            return json.loads(row['elements']) if row else None
    except Exception:
        return None


async def set_osm_cache(key: str, elements: list[dict]) -> None:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                '''INSERT INTO osm_cache (bbox_key, elements)
                   VALUES ($1, $2::jsonb)
                   ON CONFLICT (bbox_key) DO UPDATE
                   SET elements = EXCLUDED.elements, fetched_at = NOW()''',
                key, json.dumps(elements),
            )
    except Exception:
        pass


# ─── 陰影預計算 cache（月份粒度，相同區域同月份直接回傳）────────────────────

def shadow_cache_key(lat: float, lng: float) -> str:
    """以 ~1km 網格 × 月份為 key，同月份陰影差異很小可共用。"""
    today = date.today()
    return f'{lat:.2f}_{lng:.2f}_{today.year}_{today.month:02d}'


async def get_shadow_cache(key: str) -> dict | None:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                'SELECT shadows FROM shadow_cache WHERE cache_key = $1', key,
            )
            return json.loads(row['shadows']) if row else None
    except Exception:
        return None


async def set_shadow_cache(key: str, shadows: dict) -> None:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                '''INSERT INTO shadow_cache (cache_key, shadows)
                   VALUES ($1, $2::jsonb)
                   ON CONFLICT (cache_key) DO UPDATE
                   SET shadows = EXCLUDED.shadows, computed_at = NOW()''',
                key, json.dumps(shadows),
            )
    except Exception:
        pass


# ─── 使用者評估紀錄 ──────────────────────────────────────────────────────────

async def save_assessment(data: dict) -> str:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            '''INSERT INTO assessments
               (user_id, address, lat, lng, county, roof_area_ping, monthly_kwh, goal,
                capacity_kw, total_cost, subsidy_amount, out_of_pocket,
                annual_kwh, self_sufficiency, payback_years, total_20yr,
                annual_revenue, best_angle, result)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)
               RETURNING id''',
            data.get('user_id'),
            data.get('address'),
            data.get('lat'),
            data.get('lng'),
            data.get('county'),
            data.get('roof_area_ping'),
            data.get('monthly_kwh'),
            data.get('goal'),
            data.get('capacity_kw'),
            data.get('total_cost'),
            data.get('subsidy_amount'),
            data.get('out_of_pocket'),
            data.get('annual_kwh'),
            data.get('self_sufficiency'),
            data.get('payback_years'),
            data.get('total_20yr'),
            data.get('annual_revenue'),
            data.get('best_angle'),
            json.dumps(data.get('result') or {}),
        )
        return str(row['id'])


# ─── 帳號 ────────────────────────────────────────────────────────────────────

async def create_account(email: str, password_hash: str) -> str:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            'INSERT INTO accounts (email, password_hash) VALUES ($1, $2) RETURNING id',
            email, password_hash,
        )
        return str(row['id'])


async def get_account_by_email(email: str) -> dict | None:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                'SELECT id, email, password_hash FROM accounts WHERE email = $1', email,
            )
            return {**dict(row), 'id': str(row['id'])} if row else None
    except Exception:
        return None


async def get_account_assessments(account_id: str, limit: int = 20) -> list[dict]:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                '''SELECT id, address, county, annual_kwh, payback_years,
                          out_of_pocket, capacity_kw, created_at
                   FROM assessments
                   WHERE account_id = $1
                   ORDER BY created_at DESC LIMIT $2''',
                account_id, limit,
            )
            return [
                {**dict(r), 'id': str(r['id']), 'created_at': r['created_at'].isoformat()}
                for r in rows
            ]
    except Exception:
        return []


async def claim_anonymous_assessments(user_id: str, account_id: str) -> None:
    """登入後將同 user_id 的匿名評估綁定到帳號。"""
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                'UPDATE assessments SET account_id = $1 WHERE user_id = $2 AND account_id IS NULL',
                account_id, user_id,
            )
    except Exception:
        pass


async def get_user_assessments(user_id: str, limit: int = 10) -> list[dict]:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                '''SELECT id, address, county, annual_kwh, payback_years,
                          out_of_pocket, capacity_kw, created_at
                   FROM assessments
                   WHERE user_id = $1
                   ORDER BY created_at DESC
                   LIMIT $2''',
                user_id, limit,
            )
            return [
                {**dict(r), 'id': str(r['id']), 'created_at': r['created_at'].isoformat()}
                for r in rows
            ]
    except Exception:
        return []


# ─── 廠商推薦 ────────────────────────────────────────────────────────────────

async def list_vendors(county: str | None = None, limit: int = 3) -> list[dict]:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            if county:
                rows = await conn.fetch(
                    '''SELECT v.id, v.name, v.counties, v.rating, v.review_count,
                              v.phone, v.email, v.tags,
                              p.title AS portfolio_title,
                              p.meta AS portfolio_meta,
                              p.capacity_kw
                       FROM vendors v
                       LEFT JOIN LATERAL (
                           SELECT title, meta, capacity_kw
                           FROM vendor_portfolios
                           WHERE vendor_id = v.id
                           ORDER BY is_featured DESC, created_at DESC
                           LIMIT 1
                       ) p ON TRUE
                       WHERE v.approved = TRUE AND $1 = ANY(v.counties)
                       ORDER BY v.subscription_status DESC, v.rating DESC, v.review_count DESC
                       LIMIT $2''',
                    county,
                    limit,
                )
            else:
                rows = await conn.fetch(
                    '''SELECT v.id, v.name, v.counties, v.rating, v.review_count,
                              v.phone, v.email, v.tags,
                              p.title AS portfolio_title,
                              p.meta AS portfolio_meta,
                              p.capacity_kw
                       FROM vendors v
                       LEFT JOIN LATERAL (
                           SELECT title, meta, capacity_kw
                           FROM vendor_portfolios
                           WHERE vendor_id = v.id
                           ORDER BY is_featured DESC, created_at DESC
                           LIMIT 1
                       ) p ON TRUE
                       WHERE v.approved = TRUE
                       ORDER BY v.subscription_status DESC, v.rating DESC, v.review_count DESC
                       LIMIT $1''',
                    limit,
                )
            return [
                {
                    'id': str(r['id']),
                    'name': r['name'],
                    'counties': list(r['counties'] or []),
                    'portfolioTitle': r['portfolio_title'] or '精選太陽能案場',
                    'portfolioMeta': r['portfolio_meta'] or '作品集準備中',
                    'capacityKw': float(r['capacity_kw'] or 0),
                    'rating': float(r['rating'] or 0),
                    'reviewCount': int(r['review_count'] or 0),
                    'phone': r['phone'] or '',
                    'email': r['email'] or '',
                    'tags': list(r['tags'] or []),
                }
                for r in rows
            ]
    except Exception:
        return []


async def get_vendor_detail(vendor_id: str) -> dict | None:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            vendor = await conn.fetchrow(
                '''SELECT id, name, counties, rating, review_count, phone, email,
                          tags, approved, subscription_status
                   FROM vendors
                   WHERE id = $1 AND approved = TRUE''',
                vendor_id,
            )
            if not vendor:
                return None

            portfolios = await conn.fetch(
                '''SELECT id, title, meta, capacity_kw, completed_year, is_featured
                   FROM vendor_portfolios
                   WHERE vendor_id = $1
                   ORDER BY is_featured DESC, completed_year DESC NULLS LAST, created_at DESC''',
                vendor_id,
            )
            portfolio_list = [
                {
                    'id': str(p['id']),
                    'title': p['title'],
                    'meta': p['meta'],
                    'capacityKw': float(p['capacity_kw'] or 0),
                    'completedYear': p['completed_year'],
                    'isFeatured': bool(p['is_featured']),
                }
                for p in portfolios
            ]
            featured = portfolio_list[0] if portfolio_list else None
            return {
                'id': str(vendor['id']),
                'name': vendor['name'],
                'counties': list(vendor['counties'] or []),
                'portfolioTitle': featured['title'] if featured else '精選太陽能案場',
                'portfolioMeta': featured['meta'] if featured else '作品集準備中',
                'capacityKw': featured['capacityKw'] if featured else 0,
                'rating': float(vendor['rating'] or 0),
                'reviewCount': int(vendor['review_count'] or 0),
                'phone': vendor['phone'] or '',
                'email': vendor['email'] or '',
                'tags': list(vendor['tags'] or []),
                'approved': bool(vendor['approved']),
                'subscriptionStatus': vendor['subscription_status'],
                'portfolios': portfolio_list,
            }
    except Exception:
        return None


async def create_vendor_application(data: dict) -> str:
    pool = await get_pool()
    vendor_id = f"vendor-{uuid.uuid4().hex[:12]}"
    async with pool.acquire() as conn:
        await conn.execute(
            '''INSERT INTO vendors
               (id, name, company_tax_id, contact_name, counties, rating, review_count,
                phone, email, tags, approved, subscription_status, application_status, license_note)
               VALUES ($1,$2,$3,$4,$5,0,0,$6,$7,'{}',FALSE,'free','pending',$8)''',
            vendor_id,
            data.get('company_name'),
            data.get('company_tax_id'),
            data.get('contact_name'),
            data.get('counties') or [],
            data.get('phone'),
            data.get('email'),
            data.get('license_note'),
        )
    return vendor_id
