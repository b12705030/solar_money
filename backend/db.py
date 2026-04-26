"""PostgreSQL 連線池 + cache 工具函式（相容 Neon serverless）"""
from __future__ import annotations

import json
import os
from datetime import date

import asyncpg

_pool: asyncpg.Pool | None = None


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
