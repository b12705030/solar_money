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
                role          TEXT        NOT NULL DEFAULT 'user',
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
                account_id          UUID        UNIQUE REFERENCES accounts(id),
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
                rejection_reason    TEXT,
                logo_url            TEXT,
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
                photo_url      TEXT,
                description    TEXT,
                created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS inquiries (
                id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                vendor_id     TEXT        NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
                account_id    UUID        REFERENCES accounts(id),
                address       TEXT,
                county        TEXT,
                capacity_kw   DOUBLE PRECISION,
                annual_kwh    DOUBLE PRECISION,
                payback_years DOUBLE PRECISION,
                message       TEXT,
                vendor_reply  TEXT,
                replied_at    TIMESTAMPTZ,
                case_status   TEXT        NOT NULL DEFAULT 'new',
                created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS vendor_reviews (
                id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                vendor_id  TEXT        NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
                inquiry_id UUID        UNIQUE REFERENCES inquiries(id) ON DELETE CASCADE,
                account_id UUID        NOT NULL REFERENCES accounts(id),
                rating     INT         NOT NULL CHECK (rating BETWEEN 1 AND 5),
                comment    TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        ''')
        # 相容舊版 schema（補齊新欄位）
        for col, definition in [
            ('role', 'TEXT NOT NULL DEFAULT \'user\''),
        ]:
            await conn.execute(
                f"ALTER TABLE accounts ADD COLUMN IF NOT EXISTS {col} {definition}"
            )
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
            ('account_id',          'UUID UNIQUE REFERENCES accounts(id)'),
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
            ('rejection_reason',    'TEXT'),
            ('logo_url',            'TEXT'),
        ]:
            await conn.execute(
                f"ALTER TABLE vendors ADD COLUMN IF NOT EXISTS {col} {definition}"
            )
        for col, definition in [
            ('message',      'TEXT'),
            ('vendor_reply', 'TEXT'),
            ('replied_at',   'TIMESTAMPTZ'),
            ('case_status',  "TEXT NOT NULL DEFAULT 'new'"),
        ]:
            await conn.execute(
                f"ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS {col} {definition}"
            )
        for col, definition in [
            ('photo_url',   'TEXT'),
            ('description', 'TEXT'),
        ]:
            await conn.execute(
                f"ALTER TABLE vendor_portfolios ADD COLUMN IF NOT EXISTS {col} {definition}"
            )
        await seed_vendors(conn)


async def seed_vendors(conn: asyncpg.Connection) -> None:
    for vendor in _VENDOR_SEED:
        # Insert if not exists; on conflict only update static fields (name, contact, counties, tags).
        # rating and review_count are user-generated data — never overwritten by seed.
        await conn.execute(
            '''INSERT INTO vendors
               (id, name, counties, rating, review_count, phone, email, tags, approved, subscription_status)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,'mock')
               ON CONFLICT (id) DO UPDATE SET
                 name            = EXCLUDED.name,
                 counties        = EXCLUDED.counties,
                 phone           = EXCLUDED.phone,
                 email           = EXCLUDED.email,
                 tags            = EXCLUDED.tags''',
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

async def create_account(email: str, password_hash: str, role: str = 'user') -> str:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            'INSERT INTO accounts (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
            email, password_hash, role,
        )
        return str(row['id'])


async def get_account_by_email(email: str) -> dict | None:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                'SELECT id, email, password_hash, role FROM accounts WHERE email = $1', email,
            )
            return {**dict(row), 'id': str(row['id'])} if row else None
    except Exception:
        return None


async def get_account_by_id(account_id: str) -> dict | None:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                'SELECT id, email, role FROM accounts WHERE id = $1::uuid', account_id,
            )
            return {**dict(row), 'id': str(row['id'])} if row else None
    except Exception:
        return None


async def set_account_role(account_id: str, role: str) -> bool:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            result = await conn.execute(
                'UPDATE accounts SET role = $2 WHERE id = $1::uuid',
                account_id, role,
            )
            return result.endswith('1')
    except Exception:
        return False


async def get_account_assessments(account_id: str, limit: int = 20) -> list[dict]:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                '''SELECT id, address, county, annual_kwh, payback_years,
                          out_of_pocket, capacity_kw, created_at
                   FROM assessments
                   WHERE account_id = $1::uuid
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
                'UPDATE assessments SET account_id = $1::uuid WHERE user_id = $2 AND account_id IS NULL',
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
                          tags, approved, subscription_status, logo_url
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
                'logoUrl': vendor['logo_url'],
                'portfolios': portfolio_list,
            }
    except Exception:
        return None


async def create_vendor_application(data: dict, account_id: str | None = None) -> str:
    pool = await get_pool()
    async with pool.acquire() as conn:
        # If account already has a vendor record, handle re-apply
        if account_id:
            existing = await conn.fetchrow(
                'SELECT id, application_status FROM vendors WHERE account_id = $1::uuid',
                account_id,
            )
            if existing:
                status = existing['application_status']
                if status in ('pending', 'approved'):
                    raise ValueError(f'already_applied:{status}')
                # rejected → allow re-apply by resetting the existing record
                await conn.execute(
                    '''UPDATE vendors SET
                       name = $2, company_tax_id = $3, contact_name = $4,
                       counties = $5, phone = $6, email = $7,
                       license_note = $8, logo_url = $9,
                       application_status = 'pending', approved = FALSE,
                       rejection_reason = NULL
                       WHERE id = $1''',
                    existing['id'],
                    data.get('company_name'),
                    data.get('company_tax_id'),
                    data.get('contact_name'),
                    data.get('counties') or [],
                    data.get('phone'),
                    data.get('email'),
                    data.get('license_note'),
                    data.get('logo_url'),
                )
                return str(existing['id'])

        vendor_id = f"vendor-{uuid.uuid4().hex[:12]}"
        await conn.execute(
            '''INSERT INTO vendors
               (id, account_id, name, company_tax_id, contact_name, counties, rating, review_count,
                phone, email, tags, approved, subscription_status, application_status, license_note, logo_url)
               VALUES ($1,$2::uuid,$3,$4,$5,$6,0,0,$7,$8,'{}',FALSE,'free','pending',$9,$10)''',
            vendor_id,
            account_id,
            data.get('company_name'),
            data.get('company_tax_id'),
            data.get('contact_name'),
            data.get('counties') or [],
            data.get('phone'),
            data.get('email'),
            data.get('license_note'),
            data.get('logo_url'),
        )
    return vendor_id


async def get_application_status(account_id: str) -> dict | None:
    """Returns vendor application status for any account (including non-vendor roles)."""
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                'SELECT id, application_status, rejection_reason FROM vendors WHERE account_id = $1::uuid',
                account_id,
            )
            if not row:
                return None
            return {
                'id': str(row['id']),
                'status': row['application_status'],
                'rejectionReason': row['rejection_reason'],
            }
    except Exception:
        return None


async def list_pending_vendor_applications(limit: int = 50) -> list[dict]:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                '''SELECT id, name, company_tax_id, contact_name, counties, phone, email,
                          license_note, application_status, created_at
                   FROM vendors
                   WHERE application_status = 'pending'
                   ORDER BY created_at DESC
                   LIMIT $1''',
                limit,
            )
            return [
                {
                    'id': str(r['id']),
                    'name': r['name'],
                    'companyTaxId': r['company_tax_id'],
                    'contactName': r['contact_name'],
                    'counties': list(r['counties'] or []),
                    'phone': r['phone'] or '',
                    'email': r['email'] or '',
                    'licenseNote': r['license_note'],
                    'applicationStatus': r['application_status'],
                    'createdAt': r['created_at'].isoformat(),
                }
                for r in rows
            ]
    except Exception:
        return []


async def approve_vendor_application(vendor_id: str) -> bool:
    """核准廠商；自動升級對應帳號角色為 vendor。
    優先用已綁定的 account_id；若 NULL 則以申請 email 比對 accounts 表，找到時
    同時補寫 vendors.account_id，確保匿名申請也能正確連結。
    """
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                result = await conn.execute(
                    '''UPDATE vendors
                       SET approved = TRUE,
                           application_status = 'approved',
                           rejection_reason = NULL,
                           subscription_status = CASE
                               WHEN subscription_status = 'mock' THEN 'mock'
                               ELSE 'free'
                           END
                       WHERE id = $1 AND application_status IN ('pending', 'rejected')''',
                    vendor_id,
                )
                if not result.endswith('1'):
                    return False

                row = await conn.fetchrow(
                    'SELECT account_id, email FROM vendors WHERE id = $1', vendor_id,
                )
                if not row:
                    return True

                account_id = row['account_id']

                # 若尚未綁定帳號，嘗試以申請 email 自動配對
                if not account_id and row['email']:
                    acct = await conn.fetchrow(
                        'SELECT id FROM accounts WHERE email = $1', row['email'],
                    )
                    if acct:
                        account_id = acct['id']
                        await conn.execute(
                            'UPDATE vendors SET account_id = $1 WHERE id = $2',
                            account_id, vendor_id,
                        )

                if account_id:
                    await conn.execute(
                        "UPDATE accounts SET role = 'vendor' WHERE id = $1",
                        account_id,
                    )
                return True
    except Exception:
        return False


async def reject_vendor_application(vendor_id: str, reason: str | None = None) -> bool:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            result = await conn.execute(
                '''UPDATE vendors
                   SET approved = FALSE,
                       application_status = 'rejected',
                       rejection_reason = $2
                   WHERE id = $1 AND application_status = 'pending' ''',
                vendor_id,
                reason,
            )
            return result.endswith('1')
    except Exception:
        return False


# ─── 廠商儀表板 ──────────────────────────────────────────────────────────────

async def get_my_vendor(account_id: str) -> dict | None:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            vendor = await conn.fetchrow(
                '''SELECT id, name, counties, rating, review_count, phone, email, tags,
                          application_status, subscription_status, approved, logo_url
                   FROM vendors WHERE account_id = $1::uuid''',
                account_id,
            )
            if not vendor:
                return None
            portfolios = await conn.fetch(
                '''SELECT id, title, meta, capacity_kw, completed_year, is_featured, photo_url, description
                   FROM vendor_portfolios WHERE vendor_id = $1
                   ORDER BY is_featured DESC, completed_year DESC NULLS LAST, created_at DESC''',
                str(vendor['id']),
            )
            return {
                'id': str(vendor['id']),
                'name': vendor['name'],
                'counties': list(vendor['counties'] or []),
                'rating': float(vendor['rating'] or 0),
                'reviewCount': int(vendor['review_count'] or 0),
                'phone': vendor['phone'] or '',
                'email': vendor['email'] or '',
                'tags': list(vendor['tags'] or []),
                'applicationStatus': vendor['application_status'],
                'subscriptionStatus': vendor['subscription_status'],
                'approved': bool(vendor['approved']),
                'logoUrl': vendor['logo_url'],
                'portfolios': [
                    {
                        'id': str(p['id']),
                        'title': p['title'],
                        'meta': p['meta'],
                        'capacityKw': float(p['capacity_kw'] or 0),
                        'completedYear': p['completed_year'],
                        'isFeatured': bool(p['is_featured']),
                        'photoUrl': p['photo_url'],
                        'description': p['description'],
                    }
                    for p in portfolios
                ],
            }
    except Exception:
        return None


async def update_vendor_profile(vendor_id: str, data: dict) -> bool:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            result = await conn.execute(
                '''UPDATE vendors
                   SET name     = $2,
                       phone    = $3,
                       email    = $4,
                       counties = $5,
                       tags     = $6
                   WHERE id = $1''',
                vendor_id,
                data.get('name'),
                data.get('phone'),
                data.get('email'),
                data.get('counties') or [],
                data.get('tags') or [],
            )
            return result.endswith('1')
    except Exception:
        return False


async def add_portfolio(
    vendor_id: str,
    title: str,
    meta: str,
    capacity_kw: float | None,
    completed_year: int | None,
    photo_url: str | None = None,
    description: str | None = None,
) -> str:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            '''INSERT INTO vendor_portfolios
               (vendor_id, title, meta, capacity_kw, completed_year, is_featured, photo_url, description)
               VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7)
               RETURNING id''',
            vendor_id, title, meta, capacity_kw, completed_year, photo_url, description,
        )
        return str(row['id'])


async def delete_portfolio(portfolio_id: str, vendor_id: str) -> bool:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            result = await conn.execute(
                'DELETE FROM vendor_portfolios WHERE id = $1::uuid AND vendor_id = $2',
                portfolio_id, vendor_id,
            )
            return result.endswith('1')
    except Exception:
        return False


async def save_inquiry(vendor_id: str, account_id: str | None, data: dict) -> str:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            '''INSERT INTO inquiries
               (vendor_id, account_id, address, county, capacity_kw, annual_kwh, payback_years, message)
               VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8)
               RETURNING id''',
            vendor_id,
            account_id,
            data.get('address'),
            data.get('county'),
            data.get('capacity_kw'),
            data.get('annual_kwh'),
            data.get('payback_years'),
            data.get('message'),
        )
        return str(row['id'])


async def get_vendor_inquiries(vendor_id: str, limit: int = 50) -> list[dict]:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                '''SELECT i.id, i.address, i.county, i.capacity_kw, i.annual_kwh,
                          i.payback_years, i.message, i.vendor_reply, i.replied_at,
                          i.case_status, i.created_at, a.email AS inquirer_email
                   FROM inquiries i
                   LEFT JOIN accounts a ON a.id = i.account_id
                   WHERE i.vendor_id = $1
                   ORDER BY i.created_at DESC
                   LIMIT $2''',
                vendor_id, limit,
            )
            return [
                {
                    'id': str(r['id']),
                    'address': r['address'],
                    'county': r['county'],
                    'capacityKw': float(r['capacity_kw'] or 0),
                    'annualKwh': float(r['annual_kwh'] or 0),
                    'paybackYears': float(r['payback_years'] or 0),
                    'message': r['message'],
                    'vendorReply': r['vendor_reply'],
                    'repliedAt': r['replied_at'].isoformat() if r['replied_at'] else None,
                    'caseStatus': r['case_status'] or 'new',
                    'inquirerEmail': r['inquirer_email'],
                    'createdAt': r['created_at'].isoformat(),
                }
                for r in rows
            ]
    except Exception:
        return []


async def reply_to_inquiry(inquiry_id: str, vendor_id: str, reply: str) -> bool:
    """廠商回覆詢價；驗證該詢價確實屬於此廠商。"""
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            result = await conn.execute(
                '''UPDATE inquiries
                   SET vendor_reply = $3, replied_at = NOW()
                   WHERE id = $1::uuid AND vendor_id = $2''',
                inquiry_id, vendor_id, reply,
            )
            return result.endswith('1')
    except Exception:
        return False


async def get_user_inquiries(account_id: str, limit: int = 30) -> list[dict]:
    """用戶查看自己送出的詢價（含廠商回覆與評價狀態）。"""
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                '''SELECT i.id, i.vendor_id, i.address, i.county, i.capacity_kw,
                          i.annual_kwh, i.payback_years, i.message,
                          i.vendor_reply, i.replied_at, i.created_at,
                          v.name AS vendor_name, v.logo_url AS vendor_logo,
                          r.id AS review_id, r.rating AS review_rating
                   FROM inquiries i
                   JOIN vendors v ON v.id = i.vendor_id
                   LEFT JOIN vendor_reviews r ON r.inquiry_id = i.id
                   WHERE i.account_id = $1::uuid
                   ORDER BY i.created_at DESC
                   LIMIT $2''',
                account_id, limit,
            )
            return [
                {
                    'id': str(r['id']),
                    'vendorId': r['vendor_id'],
                    'vendorName': r['vendor_name'],
                    'vendorLogo': r['vendor_logo'],
                    'address': r['address'],
                    'county': r['county'],
                    'capacityKw': float(r['capacity_kw'] or 0),
                    'annualKwh': float(r['annual_kwh'] or 0),
                    'paybackYears': float(r['payback_years'] or 0),
                    'message': r['message'],
                    'vendorReply': r['vendor_reply'],
                    'repliedAt': r['replied_at'].isoformat() if r['replied_at'] else None,
                    'createdAt': r['created_at'].isoformat(),
                    'reviewId': str(r['review_id']) if r['review_id'] else None,
                    'reviewRating': r['review_rating'],
                }
                for r in rows
            ]
    except Exception:
        return []


async def add_vendor_review(
    inquiry_id: str, account_id: str, vendor_id: str, rating: int, comment: str | None
) -> bool:
    """新增評價，同時更新廠商平均評分。"""
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                # Verify the inquiry belongs to this account and vendor
                inq = await conn.fetchrow(
                    'SELECT id FROM inquiries WHERE id = $1::uuid AND account_id = $2::uuid AND vendor_id = $3',
                    inquiry_id, account_id, vendor_id,
                )
                if not inq:
                    return False
                await conn.execute(
                    '''INSERT INTO vendor_reviews (vendor_id, inquiry_id, account_id, rating, comment)
                       VALUES ($1, $2::uuid, $3::uuid, $4, $5)
                       ON CONFLICT (inquiry_id) DO NOTHING''',
                    vendor_id, inquiry_id, account_id, rating, comment,
                )
                # Recalculate vendor average rating
                await conn.execute(
                    '''UPDATE vendors v
                       SET rating       = sub.avg_rating,
                           review_count = sub.cnt
                       FROM (
                           SELECT AVG(rating)::double precision AS avg_rating,
                                  COUNT(*)::int AS cnt
                           FROM vendor_reviews
                           WHERE vendor_id = $1
                       ) sub
                       WHERE v.id = $1''',
                    vendor_id,
                )
        return True
    except Exception:
        return False


async def update_vendor_logo(vendor_id: str, logo_url: str) -> bool:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            result = await conn.execute(
                'UPDATE vendors SET logo_url = $2 WHERE id = $1',
                vendor_id, logo_url,
            )
            return result.endswith('1')
    except Exception:
        return False


async def update_inquiry_status(inquiry_id: str, vendor_id: str, status: str) -> bool:
    """廠商更新案件狀態 (new / contacted / quoted / closed)。"""
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            result = await conn.execute(
                "UPDATE inquiries SET case_status = $3 WHERE id = $1::uuid AND vendor_id = $2",
                inquiry_id, vendor_id, status,
            )
            return result.endswith('1')
    except Exception:
        return False


async def get_potential_leads(
    vendor_id: str, counties: list[str], limit: int = 30
) -> list[dict]:
    """進階方案：廠商服務縣市內已完成評估、但尚未聯繫過本廠商的潛在用戶。"""
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                '''SELECT a.id, a.address, a.county, a.capacity_kw, a.annual_kwh,
                          a.payback_years, a.out_of_pocket, a.created_at,
                          acc.email AS account_email
                   FROM assessments a
                   JOIN accounts acc ON acc.id = a.account_id
                   WHERE a.county = ANY($1)
                   AND a.account_id IS NOT NULL
                   AND NOT EXISTS (
                       SELECT 1 FROM inquiries i
                       WHERE i.account_id = a.account_id
                       AND i.vendor_id = $2
                   )
                   ORDER BY a.created_at DESC
                   LIMIT $3''',
                counties, vendor_id, limit,
            )
            return [
                {
                    'id': str(r['id']),
                    'address': r['address'],
                    'county': r['county'],
                    'capacityKw': float(r['capacity_kw'] or 0),
                    'annualKwh': float(r['annual_kwh'] or 0),
                    'paybackYears': float(r['payback_years'] or 0),
                    'outOfPocket': int(r['out_of_pocket'] or 0),
                    'accountEmail': r['account_email'],
                    'createdAt': r['created_at'].isoformat(),
                }
                for r in rows
            ]
    except Exception:
        return []
