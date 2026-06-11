"""
一次性執行腳本：將本機 .npy 上傳至 Neon DB（dem_cache 表）。

使用方式（在 solar_money 根目錄執行）：
    python scripts/upload_dem.py

前提：
    1. 已執行 scripts/build_dem_cache.py，產生 data/taiwan_dem_100m.npy
    2. 已設定 DATABASE_URL（或 backend/.env 存在）

上傳後，其他開發者啟動後端時若本機沒有 .npy，會自動從 DB 下載並寫回本機。
"""

import asyncio
import os
import sys
from pathlib import Path

_env_file = Path(__file__).parent.parent / 'backend' / '.env'
if _env_file.exists():
    from dotenv import load_dotenv
    load_dotenv(_env_file)

NPY_PATH  = Path('data/taiwan_dem_100m.npy')
META_PATH = Path('data/taiwan_dem_meta.npy')


async def run() -> None:
    try:
        import asyncpg
    except ImportError:
        sys.exit('請先安裝 asyncpg：pip install asyncpg')

    db_url = os.environ.get('DATABASE_URL', '')
    if not db_url:
        sys.exit('請設定環境變數 DATABASE_URL')

    if not NPY_PATH.exists():
        sys.exit(f'找不到 {NPY_PATH}，請先執行 scripts/build_dem_cache.py')
    if not META_PATH.exists():
        sys.exit(f'找不到 {META_PATH}，請先執行 scripts/build_dem_cache.py')

    dem_bytes  = NPY_PATH.read_bytes()
    meta_bytes = META_PATH.read_bytes()
    size_mb = len(dem_bytes) / 1_048_576

    print(f'上傳 DEM ({size_mb:.1f} MB) 至 Neon...')
    pool = await asyncpg.create_pool(db_url, min_size=1, max_size=2)
    async with pool.acquire() as conn:
        await conn.execute(
            '''INSERT INTO dem_cache (id, data, meta)
               VALUES ('taiwan_100m', $1, $2)
               ON CONFLICT (id) DO UPDATE
               SET data = EXCLUDED.data, meta = EXCLUDED.meta, created_at = NOW()''',
            dem_bytes, meta_bytes,
        )
    await pool.close()
    print(f'完成。後端啟動時若本機無 .npy，將自動從 DB 下載（{size_mb:.1f} MB）。')


if __name__ == '__main__':
    asyncio.run(run())
