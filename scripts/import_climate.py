"""
一次性執行腳本：將本機既有氣候 CSV 匯入 Neon PostgreSQL。

使用方式（在 solar_money 根目錄執行）：
    python scripts/import_climate.py

輸入：
    data/climate/taiwan_climate_annual.csv   — 368 鄉鎮市年均統計
    data/climate/nasa_power_monthly_raw.csv  — 368 × 13年 × 12月原始資料

輸出（DB 寫入）：
    climate_annual  — 368 筆年均統計
    climate_monthly — 368 × 12 = 4,416 筆月典型值（13 年平均）
"""

import asyncio
import os
import sys
from pathlib import Path

import pandas as pd

# 自動載入 backend/.env（與後端相同的 DATABASE_URL 來源）
_env_file = Path(__file__).parent.parent / 'backend' / '.env'
if _env_file.exists():
    from dotenv import load_dotenv
    load_dotenv(_env_file)

ANNUAL_CSV  = Path('data/climate/taiwan_climate_annual.csv')
MONTHLY_CSV = Path('data/climate/nasa_power_monthly_raw.csv')


async def run() -> None:
    try:
        import asyncpg
    except ImportError:
        sys.exit('請先安裝 asyncpg：pip install asyncpg')

    db_url = os.environ.get('DATABASE_URL', '')
    if not db_url:
        sys.exit('請設定環境變數 DATABASE_URL')

    if not ANNUAL_CSV.exists():
        sys.exit(f'找不到：{ANNUAL_CSV}')
    if not MONTHLY_CSV.exists():
        sys.exit(f'找不到：{MONTHLY_CSV}')

    # ── 讀取年均統計 ───────────────────────────────────────────────────────
    annual = pd.read_csv(ANNUAL_CSV, encoding='utf-8-sig')
    # 確認欄位存在
    required_annual = ['TOWNCODE', 'COUNTYNAME', 'TOWNNAME',
                       'centroid_lat', 'centroid_lon',
                       'daily_solar_radiation', 'air_temperature',
                       'wind_speed', 'relative_humidity']
    missing = [c for c in required_annual if c not in annual.columns]
    if missing:
        sys.exit(f'annual CSV 缺少欄位：{missing}')

    annual['TOWNCODE'] = annual['TOWNCODE'].astype(str)
    annual_rows = list(
        annual[required_annual].itertuples(index=False, name=None)
    )

    # ── 讀取月資料並計算 13 年月均值 ──────────────────────────────────────
    monthly_raw = pd.read_csv(MONTHLY_CSV, encoding='utf-8-sig')
    # 欄位：TOWNCODE,COUNTYNAME,TOWNNAME,year,month,T2M,...,ALLSKY_SFC_SW_DWN,RH2M,WS10M,...
    required_monthly = ['TOWNCODE', 'month', 'ALLSKY_SFC_SW_DWN', 'T2M', 'WS10M', 'RH2M']
    missing = [c for c in required_monthly if c not in monthly_raw.columns]
    if missing:
        sys.exit(f'monthly CSV 缺少欄位：{missing}')

    monthly_raw['TOWNCODE'] = monthly_raw['TOWNCODE'].astype(str)
    monthly = (
        monthly_raw
        .groupby(['TOWNCODE', 'month'], as_index=False)
        .agg(
            ghi=('ALLSKY_SFC_SW_DWN', 'mean'),
            temperature=('T2M', 'mean'),
            wind_speed=('WS10M', 'mean'),
            humidity=('RH2M', 'mean'),
        )
    )
    monthly_rows = list(
        monthly[['TOWNCODE', 'month', 'ghi', 'temperature', 'wind_speed', 'humidity']]
        .itertuples(index=False, name=None)
    )

    # ── 寫入 DB ───────────────────────────────────────────────────────────
    pool = await asyncpg.create_pool(db_url, min_size=1, max_size=3)
    async with pool.acquire() as conn:
        # 年均統計
        await conn.executemany(
            '''INSERT INTO climate_annual
               (township_code, county_name, township_name,
                centroid_lat, centroid_lon,
                daily_solar_radiation, air_temperature, wind_speed, relative_humidity)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
               ON CONFLICT (township_code) DO NOTHING''',
            annual_rows,
        )
        print(f'climate_annual：寫入 {len(annual_rows)} 筆')

        # 月典型值
        await conn.executemany(
            '''INSERT INTO climate_monthly
               (township_code, month, ghi, temperature, wind_speed, humidity)
               VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT DO NOTHING''',
            monthly_rows,
        )
        print(f'climate_monthly：寫入 {len(monthly_rows)} 筆')

    await pool.close()
    print('匯入完成。')


if __name__ == '__main__':
    asyncio.run(run())
