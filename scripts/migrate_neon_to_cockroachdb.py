"""
Migrate 10 business tables from Neon to CockroachDB.

Tables migrated in FK order (skips cache tables):
  climate_annual, climate_monthly, region_potential,
  accounts, vendors, vendor_portfolios, assessments,
  inquiries, inquiry_messages, vendor_reviews

Usage:
  cd solar_money
  $env:NEON_URL="postgresql://neondb_owner:...@...neon.tech/neondb?sslmode=require"
  $env:DATABASE_URL="postgresql://solar:...@...cockroachlabs.cloud:26257/defaultdb?sslmode=require"
  .venv/Scripts/python scripts/migrate_neon_to_cockroachdb.py

NEON_URL    = Neon (source)
DATABASE_URL = CockroachDB (target)
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from pathlib import Path
from typing import Any

import asyncpg
from dotenv import load_dotenv


def clean_dsn(url: str) -> str:
    """Remove unsupported asyncpg parameters (channel_binding) from DSN."""
    return re.sub(r'[&?]channel_binding=[^&]*', '', url)


async def get_neon_columns(conn: asyncpg.Connection, table: str) -> list[str]:
    rows = await conn.fetch(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = 'public' AND table_name = $1 "
        "ORDER BY ordinal_position",
        table,
    )
    return [r['column_name'] for r in rows]


def _j(v: Any) -> str | None:
    """Serialize JSONB value to string, or None if null."""
    if v is None:
        return None
    if isinstance(v, str):
        return v
    return json.dumps(v, ensure_ascii=False)


# ─── Table migrations ────────────────────────────────────────────────────────

async def migrate_climate_annual(src: asyncpg.Connection, dst: asyncpg.Connection) -> int:
    rows = await src.fetch('SELECT * FROM climate_annual')
    if not rows:
        print('[climate_annual] 0 rows', flush=True); return 0
    await dst.executemany(
        """INSERT INTO climate_annual
           (township_code, county_name, township_name, centroid_lat, centroid_lon,
            daily_solar_radiation, air_temperature, wind_speed, relative_humidity)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (township_code) DO UPDATE SET
             county_name=EXCLUDED.county_name, township_name=EXCLUDED.township_name,
             centroid_lat=EXCLUDED.centroid_lat, centroid_lon=EXCLUDED.centroid_lon,
             daily_solar_radiation=EXCLUDED.daily_solar_radiation,
             air_temperature=EXCLUDED.air_temperature,
             wind_speed=EXCLUDED.wind_speed,
             relative_humidity=EXCLUDED.relative_humidity""",
        [(r['township_code'], r['county_name'], r['township_name'],
          r['centroid_lat'], r['centroid_lon'], r['daily_solar_radiation'],
          r['air_temperature'], r['wind_speed'], r['relative_humidity'])
         for r in rows],
    )
    print(f'[climate_annual] {len(rows)} rows', flush=True)
    return len(rows)


async def migrate_climate_monthly(src: asyncpg.Connection, dst: asyncpg.Connection) -> int:
    rows = await src.fetch('SELECT * FROM climate_monthly ORDER BY township_code, month')
    if not rows:
        print('[climate_monthly] 0 rows', flush=True); return 0
    await dst.executemany(
        """INSERT INTO climate_monthly (township_code, month, ghi, temperature, wind_speed, humidity)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (township_code, month) DO UPDATE SET
             ghi=EXCLUDED.ghi, temperature=EXCLUDED.temperature,
             wind_speed=EXCLUDED.wind_speed, humidity=EXCLUDED.humidity""",
        [(r['township_code'], r['month'], r['ghi'],
          r['temperature'], r['wind_speed'], r['humidity'])
         for r in rows],
    )
    print(f'[climate_monthly] {len(rows)} rows', flush=True)
    return len(rows)


async def migrate_region_potential(src: asyncpg.Connection, dst: asyncpg.Connection) -> int:
    rows = await src.fetch('SELECT * FROM region_potential')
    if not rows:
        print('[region_potential] 0 rows', flush=True); return 0
    await dst.executemany(
        """INSERT INTO region_potential
           (towncode, countyname, townname, priority_rank, topsis_score,
            combined_score, stage1_prob, stage2_pred, daily_solar_radiation,
            occupancy_owner_rate, median_household_income, centroid_lat, centroid_lon)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (towncode) DO UPDATE SET
             priority_rank=EXCLUDED.priority_rank,
             topsis_score=EXCLUDED.topsis_score,
             combined_score=EXCLUDED.combined_score,
             stage1_prob=EXCLUDED.stage1_prob,
             stage2_pred=EXCLUDED.stage2_pred""",
        [(r['towncode'], r['countyname'], r['townname'],
          r['priority_rank'], r['topsis_score'], r['combined_score'],
          r['stage1_prob'], r['stage2_pred'], r['daily_solar_radiation'],
          r['occupancy_owner_rate'], r['median_household_income'],
          r['centroid_lat'], r['centroid_lon'])
         for r in rows],
    )
    print(f'[region_potential] {len(rows)} rows', flush=True)
    return len(rows)


async def migrate_accounts(src: asyncpg.Connection, dst: asyncpg.Connection) -> int:
    rows = await src.fetch('SELECT id, email, password_hash, role, created_at FROM accounts')
    if not rows:
        print('[accounts] 0 rows', flush=True); return 0
    await dst.executemany(
        """INSERT INTO accounts (id, email, password_hash, role, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET
             email=EXCLUDED.email, password_hash=EXCLUDED.password_hash,
             role=EXCLUDED.role""",
        [(r['id'], r['email'], r['password_hash'],
          r['role'] or 'user', r['created_at'])
         for r in rows],
    )
    print(f'[accounts] {len(rows)} rows', flush=True)
    return len(rows)


async def migrate_vendors(src: asyncpg.Connection, dst: asyncpg.Connection) -> int:
    src_cols = await get_neon_columns(src, 'vendors')
    logo_col = 'logo_url' if 'logo_url' in src_cols else 'NULL::TEXT AS logo_url'
    rejection_col = 'rejection_reason' if 'rejection_reason' in src_cols else 'NULL::TEXT AS rejection_reason'

    rows = await src.fetch(f"""
        SELECT id, account_id, name, company_tax_id, contact_name,
               counties, rating, review_count, phone, email, tags,
               approved, subscription_status, application_status,
               license_note, {rejection_col}, {logo_col}, created_at
        FROM vendors
    """)
    if not rows:
        print('[vendors] 0 rows', flush=True); return 0
    await dst.executemany(
        """INSERT INTO vendors
           (id, account_id, name, company_tax_id, contact_name,
            counties, rating, review_count, phone, email, tags,
            approved, subscription_status, application_status,
            license_note, rejection_reason, logo_url, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
           ON CONFLICT (id) DO UPDATE SET
             name=EXCLUDED.name, counties=EXCLUDED.counties,
             rating=EXCLUDED.rating, review_count=EXCLUDED.review_count,
             phone=EXCLUDED.phone, email=EXCLUDED.email, tags=EXCLUDED.tags,
             approved=EXCLUDED.approved, subscription_status=EXCLUDED.subscription_status,
             application_status=EXCLUDED.application_status,
             license_note=EXCLUDED.license_note,
             rejection_reason=EXCLUDED.rejection_reason,
             logo_url=EXCLUDED.logo_url""",
        [(r['id'], r['account_id'], r['name'], r['company_tax_id'], r['contact_name'],
          list(r['counties'] or []), float(r['rating'] or 0), int(r['review_count'] or 0),
          r['phone'], r['email'], list(r['tags'] or []),
          bool(r['approved']), r['subscription_status'] or 'mock',
          r['application_status'] or 'approved',
          r['license_note'], r['rejection_reason'], r['logo_url'], r['created_at'])
         for r in rows],
    )
    print(f'[vendors] {len(rows)} rows', flush=True)
    return len(rows)


async def migrate_vendor_portfolios(src: asyncpg.Connection, dst: asyncpg.Connection) -> int:
    src_cols = await get_neon_columns(src, 'vendor_portfolios')
    photo_col = 'photo_url' if 'photo_url' in src_cols else 'NULL::TEXT AS photo_url'
    desc_col = 'description' if 'description' in src_cols else 'NULL::TEXT AS description'

    rows = await src.fetch(f"""
        SELECT id, vendor_id, title, meta, capacity_kw, completed_year,
               is_featured, {photo_col}, {desc_col}, created_at
        FROM vendor_portfolios
    """)
    if not rows:
        print('[vendor_portfolios] 0 rows', flush=True); return 0
    await dst.executemany(
        """INSERT INTO vendor_portfolios
           (id, vendor_id, title, meta, capacity_kw, completed_year,
            is_featured, photo_url, description, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (id) DO UPDATE SET
             title=EXCLUDED.title, meta=EXCLUDED.meta,
             capacity_kw=EXCLUDED.capacity_kw, completed_year=EXCLUDED.completed_year,
             is_featured=EXCLUDED.is_featured, photo_url=EXCLUDED.photo_url,
             description=EXCLUDED.description""",
        [(r['id'], r['vendor_id'], r['title'], r['meta'],
          r['capacity_kw'], r['completed_year'], bool(r['is_featured']),
          r['photo_url'], r['description'], r['created_at'])
         for r in rows],
    )
    print(f'[vendor_portfolios] {len(rows)} rows', flush=True)
    return len(rows)


async def migrate_assessments(src: asyncpg.Connection, dst: asyncpg.Connection) -> int:
    src_cols = await get_neon_columns(src, 'assessments')
    # Handle roof_ping (old name) → roof_area_ping (new name)
    if 'roof_area_ping' in src_cols:
        area_col = 'roof_area_ping'
    elif 'roof_ping' in src_cols:
        area_col = 'roof_ping AS roof_area_ping'
    else:
        area_col = 'NULL::DOUBLE PRECISION AS roof_area_ping'

    rows = await src.fetch(f"""
        SELECT id, user_id, account_id, address, lat, lng, county,
               {area_col}, monthly_kwh, goal, capacity_kw,
               total_cost, subsidy_amount, out_of_pocket,
               annual_kwh, self_sufficiency, payback_years,
               total_20yr, annual_revenue, best_angle, result, created_at
        FROM assessments
    """)
    if not rows:
        print('[assessments] 0 rows', flush=True); return 0
    await dst.executemany(
        """INSERT INTO assessments
           (id, user_id, account_id, address, lat, lng, county,
            roof_area_ping, monthly_kwh, goal, capacity_kw,
            total_cost, subsidy_amount, out_of_pocket,
            annual_kwh, self_sufficiency, payback_years,
            total_20yr, annual_revenue, best_angle, result, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22)
           ON CONFLICT (id) DO NOTHING""",
        [(r['id'], r['user_id'], r['account_id'],
          r['address'], r['lat'], r['lng'], r['county'],
          r['roof_area_ping'], r['monthly_kwh'], r['goal'], r['capacity_kw'],
          r['total_cost'], r['subsidy_amount'], r['out_of_pocket'],
          r['annual_kwh'], r['self_sufficiency'], r['payback_years'],
          r['total_20yr'], r['annual_revenue'], r['best_angle'],
          _j(r['result']), r['created_at'])
         for r in rows],
    )
    print(f'[assessments] {len(rows)} rows', flush=True)
    return len(rows)


async def migrate_inquiries(src: asyncpg.Connection, dst: asyncpg.Connection) -> int:
    src_cols = await get_neon_columns(src, 'inquiries')
    user_read_col = 'user_last_read_at' if 'user_last_read_at' in src_cols else 'NULL::TIMESTAMPTZ AS user_last_read_at'
    vendor_read_col = 'vendor_last_read_at' if 'vendor_last_read_at' in src_cols else 'NULL::TIMESTAMPTZ AS vendor_last_read_at'
    case_col = 'case_status' if 'case_status' in src_cols else "'new'::TEXT AS case_status"

    rows = await src.fetch(f"""
        SELECT id, vendor_id, account_id, address, county,
               capacity_kw, annual_kwh, payback_years,
               {case_col}, {user_read_col}, {vendor_read_col}, created_at
        FROM inquiries
    """)
    if not rows:
        print('[inquiries] 0 rows', flush=True); return 0
    await dst.executemany(
        """INSERT INTO inquiries
           (id, vendor_id, account_id, address, county,
            capacity_kw, annual_kwh, payback_years,
            case_status, user_last_read_at, vendor_last_read_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (id) DO NOTHING""",
        [(r['id'], r['vendor_id'], r['account_id'],
          r['address'], r['county'], r['capacity_kw'],
          r['annual_kwh'], r['payback_years'],
          r['case_status'] or 'new',
          r['user_last_read_at'], r['vendor_last_read_at'], r['created_at'])
         for r in rows],
    )
    print(f'[inquiries] {len(rows)} rows', flush=True)
    return len(rows)


async def migrate_inquiry_messages(src: asyncpg.Connection, dst: asyncpg.Connection) -> int:
    # Check table exists in source
    exists = await src.fetchval(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema='public' AND table_name='inquiry_messages'"
    )
    if not exists:
        print('[inquiry_messages] table not in source DB, skipping', flush=True)
        return 0

    rows = await src.fetch(
        'SELECT id, inquiry_id, sender, content, created_at FROM inquiry_messages ORDER BY created_at'
    )
    if not rows:
        print('[inquiry_messages] 0 rows', flush=True); return 0
    await dst.executemany(
        """INSERT INTO inquiry_messages (id, inquiry_id, sender, content, created_at)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (id) DO NOTHING""",
        [(r['id'], r['inquiry_id'], r['sender'], r['content'], r['created_at'])
         for r in rows],
    )
    print(f'[inquiry_messages] {len(rows)} rows', flush=True)
    return len(rows)


async def migrate_vendor_reviews(src: asyncpg.Connection, dst: asyncpg.Connection) -> int:
    rows = await src.fetch(
        'SELECT id, vendor_id, inquiry_id, account_id, rating, comment, created_at FROM vendor_reviews'
    )
    if not rows:
        print('[vendor_reviews] 0 rows', flush=True); return 0
    await dst.executemany(
        """INSERT INTO vendor_reviews (id, vendor_id, inquiry_id, account_id, rating, comment, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (id) DO NOTHING""",
        [(r['id'], r['vendor_id'], r['inquiry_id'],
          r['account_id'], r['rating'], r['comment'], r['created_at'])
         for r in rows],
    )
    print(f'[vendor_reviews] {len(rows)} rows', flush=True)
    return len(rows)


# ─── Main ────────────────────────────────────────────────────────────────────

async def main() -> None:
    # Load .env only if env vars not already set
    if not os.environ.get('NEON_URL') or not os.environ.get('DATABASE_URL'):
        load_dotenv(Path(__file__).parent.parent / 'backend' / '.env')

    neon_url = os.environ.get('NEON_URL', '')
    crdb_url = os.environ.get('DATABASE_URL', '')

    if not neon_url:
        print('[ERROR] NEON_URL not set (Neon source)')
        print('  $env:NEON_URL="postgresql://neondb_owner:...@...neon.tech/neondb?sslmode=require"')
        return
    if not crdb_url:
        print('[ERROR] DATABASE_URL not set (CockroachDB target)')
        return
    if 'neon.tech' in crdb_url:
        print('[ERROR] DATABASE_URL points to Neon — set it to CockroachDB URL')
        return

    neon_url_clean = clean_dsn(neon_url)

    print('[DB] Connecting to Neon (source)...', flush=True)
    neon = await asyncpg.connect(neon_url_clean)
    print('[DB] Connecting to CockroachDB (target)...', flush=True)
    crdb = await asyncpg.connect(crdb_url)
    print('[DB] Both connections established', flush=True)

    # Ensure CockroachDB schema has all columns (in case init_db ran an older version)
    print('[DB] Patching CockroachDB schema (ADD COLUMN IF NOT EXISTS)...', flush=True)
    schema_patches = [
        # Missing table
        """CREATE TABLE IF NOT EXISTS inquiry_messages (
               id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
               inquiry_id   UUID        NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
               sender       TEXT        NOT NULL,
               content      TEXT        NOT NULL,
               created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
           )""",
        "CREATE INDEX IF NOT EXISTS idx_inquiry_messages_inquiry_id ON inquiry_messages (inquiry_id, created_at)",
        # Missing columns on existing tables
        "ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS case_status TEXT NOT NULL DEFAULT 'new'",
        "ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS user_last_read_at TIMESTAMPTZ",
        "ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS vendor_last_read_at TIMESTAMPTZ",
        "ALTER TABLE vendor_portfolios ADD COLUMN IF NOT EXISTS photo_url TEXT",
        "ALTER TABLE vendor_portfolios ADD COLUMN IF NOT EXISTS description TEXT",
        "ALTER TABLE vendors ADD COLUMN IF NOT EXISTS logo_url TEXT",
        "ALTER TABLE vendors ADD COLUMN IF NOT EXISTS rejection_reason TEXT",
        "ALTER TABLE vendors ADD COLUMN IF NOT EXISTS license_note TEXT",
    ]
    for sql in schema_patches:
        try:
            await crdb.execute(sql)
        except Exception as e:
            print(f'  [SKIP] {e}', flush=True)
    print('[DB] Schema up to date\n', flush=True)

    t0 = time.time()
    total = 0

    try:
        # Run all migrations (each function uses ON CONFLICT to be idempotent)
        total += await migrate_climate_annual(neon, crdb)
        total += await migrate_climate_monthly(neon, crdb)
        total += await migrate_region_potential(neon, crdb)
        total += await migrate_accounts(neon, crdb)
        total += await migrate_vendors(neon, crdb)
        total += await migrate_vendor_portfolios(neon, crdb)
        total += await migrate_assessments(neon, crdb)
        total += await migrate_inquiries(neon, crdb)
        total += await migrate_inquiry_messages(neon, crdb)
        total += await migrate_vendor_reviews(neon, crdb)
    finally:
        await neon.close()
        await crdb.close()

    elapsed = time.time() - t0
    print(f'\n[DONE] {total} rows migrated in {elapsed:.1f}s')
    print('\n[VERIFY] Row counts in CockroachDB:')

    # Verification counts
    verify = await asyncpg.connect(crdb_url)
    tables = [
        'climate_annual', 'climate_monthly', 'region_potential',
        'accounts', 'vendors', 'vendor_portfolios', 'assessments',
        'inquiries', 'inquiry_messages', 'vendor_reviews',
    ]
    for t in tables:
        try:
            cnt = await verify.fetchval(f'SELECT COUNT(*) FROM {t}')
            print(f'  {t}: {cnt}')
        except Exception as e:
            print(f'  {t}: ERROR ({e})')
    await verify.close()


if __name__ == '__main__':
    asyncio.run(main())
