"""
Import taiwan_polygon_fallback.ndjson.gz into CockroachDB gba_buildings.

Streaming (memory-safe), batch 500 rows, ON CONFLICT (id) DO NOTHING.

Usage:
  cd solar_money
  $env:DATABASE_URL="postgresql://solar:...@solar-money-27240...cockroachlabs.cloud:26257/defaultdb?sslmode=require"
  .venv/Scripts/python scripts/import_fallback_to_db.py

DATABASE_URL must point to CockroachDB (target).
If backend/.env has a different DATABASE_URL, override it via environment variable.
"""
from __future__ import annotations

import asyncio
import gzip
import json
import os
import time
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

BATCH_SIZE = 500
PROGRESS_EVERY = 50_000
FALLBACK_GZ = Path(__file__).parent.parent / 'data' / 'taiwan_polygon_fallback.ndjson.gz'

_INSERT = """
    INSERT INTO gba_buildings (id, footprint, height, source, min_lon, max_lon, min_lat, max_lat)
    VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (id) DO NOTHING
"""


async def main() -> None:
    # Environment variable takes precedence over .env file
    env_db = os.environ.get('DATABASE_URL')
    if not env_db:
        load_dotenv(Path(__file__).parent.parent / 'backend' / '.env')

    db_url = os.environ.get('DATABASE_URL', '')
    if not db_url:
        print('[ERROR] DATABASE_URL not set.')
        print('  Set $env:DATABASE_URL to CockroachDB connection string.')
        return

    if 'neon.tech' in db_url:
        print('[ERROR] DATABASE_URL points to Neon, not CockroachDB.')
        print('  Set $env:DATABASE_URL to the CockroachDB URL:')
        print('  $env:DATABASE_URL="postgresql://solar:...@solar-money-27240...cockroachlabs.cloud:26257/defaultdb?sslmode=require"')
        return

    if not FALLBACK_GZ.exists():
        print(f'[ERROR] Not found: {FALLBACK_GZ}')
        return

    print('[DB] Connecting to CockroachDB...', flush=True)
    conn = await asyncpg.connect(db_url)

    # Ensure table exists (idempotent)
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS gba_buildings (
            id        TEXT   PRIMARY KEY,
            footprint JSONB  NOT NULL,
            height    REAL,
            source    TEXT,
            min_lon   REAL,
            max_lon   REAL,
            min_lat   REAL,
            max_lat   REAL
        )
    """)
    try:
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS gba_buildings_bbox
                ON gba_buildings (min_lon, max_lon, min_lat, max_lat)
        """)
    except Exception as e:
        print(f'[INFO] Index: {e}', flush=True)

    existing = await conn.fetchval('SELECT COUNT(*) FROM gba_buildings')
    print(f'[DB] gba_buildings existing rows: {existing:,}', flush=True)

    size_mb = FALLBACK_GZ.stat().st_size // 1024 // 1024
    print(f'[GZ] Streaming {FALLBACK_GZ.name} ({size_mb} MB)...', flush=True)

    batch: list = []
    total = 0
    skipped = 0
    t0 = time.time()

    async def flush(b: list) -> None:
        nonlocal conn
        for attempt in range(3):
            try:
                await conn.executemany(_INSERT, b)
                return
            except (asyncpg.ConnectionDoesNotExistError, asyncpg.InterfaceError, OSError):
                try:
                    await conn.close()
                except Exception:
                    pass
                conn = await asyncpg.connect(db_url)
        await conn.executemany(_INSERT, b)

    with gzip.open(FALLBACK_GZ, 'rt', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except Exception:
                skipped += 1
                continue

            bid = r.get('id')
            fp  = r.get('footprint')
            if not bid or fp is None:
                skipped += 1
                continue

            batch.append((
                bid,
                json.dumps(fp),
                float(r.get('height') or 10.0),
                'fallback',
                float(r.get('min_lon') or 0),
                float(r.get('max_lon') or 0),
                float(r.get('min_lat') or 0),
                float(r.get('max_lat') or 0),
            ))

            if len(batch) >= BATCH_SIZE:
                await flush(batch)
                total += len(batch)
                batch.clear()
                if total % PROGRESS_EVERY == 0:
                    elapsed = time.time() - t0
                    rate = total / elapsed if elapsed > 0 else 0
                    eta_s = (1_905_108 - total) / rate if rate > 0 else 0
                    print(
                        f'[PROGRESS] {total:,} rows  '
                        f'({rate:,.0f} rows/s  ETA {eta_s/60:.0f} min)',
                        flush=True,
                    )

    if batch:
        await flush(batch)
        total += len(batch)

    elapsed = time.time() - t0
    print(f'\n[DONE] {total:,} rows inserted in {elapsed:.0f}s  ({skipped} skipped)', flush=True)

    count = await conn.fetchval('SELECT COUNT(*) FROM gba_buildings')
    print(f'[VERIFY] gba_buildings total: {count:,}  (target ~1,905,108)')
    await conn.close()


if __name__ == '__main__':
    asyncio.run(main())
