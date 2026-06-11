"""
apply_solar_idw.py — 以 IDW 插值細化日照資料

問題：NASA POWER 解析度為 0.5°（約 50 km），368 個鄉鎮市區只有 15 種唯一日照值，
     同一 0.5° 格點內的所有鄉鎮共用同一數值，日照因子實際上失去了區分能力。

解法：
  1. 從各鄉鎮的幾何中心座標推算其落在哪個 0.5° NASA POWER 格點
  2. 對每個格點取均值（部分格點包含多個鄉鎮，但值相同，取均值不影響結果）
  3. 對每個鄉鎮中心做 IDW（Inverse Distance Weighting，p=2）插值：
     各格點按距離平方倒數加權平均 → 368 個各不相同的日照估計值
  4. 更新 DB 的 region_potential.daily_solar_radiation

使用方式：
    python scripts/apply_solar_idw.py

需要環境變數：
    DATABASE_URL  （或在 backend/.env 設定）
"""

import asyncio
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd

_HERE   = Path(__file__).parent
_ROOT   = _HERE.parent
_ENV    = _ROOT / 'backend' / '.env'

if _ENV.exists():
    from dotenv import load_dotenv
    load_dotenv(_ENV)

CLIMATE_CSV = _ROOT / 'data' / 'climate' / 'taiwan_climate_annual.csv'
IDW_POWER   = 2      # 距離衰減指數（標準值）
GRID_RES    = 0.5    # NASA POWER 格點解析度（度）


# ── IDW 核心 ─────────────────────────────────────────────────────────────────

def compute_idw(df: pd.DataFrame) -> pd.Series:
    """
    輸入：含 centroid_lat, centroid_lon, daily_solar_radiation 的 DataFrame
    輸出：每個鄉鎮的 IDW 插值日照值（Series，與 df 對齊）

    做法：
      1. 將各鄉鎮中心座標對齊到最近 0.5° 格點
      2. 以格點為基準，用 IDW 反算各鄉鎮的插值值
    """
    df = df.copy()

    # Step 1：推算各鄉鎮所對應的 NASA POWER 格點中心
    df['grid_lat'] = (df['centroid_lat'] / GRID_RES).round() * GRID_RES
    df['grid_lon'] = (df['centroid_lon'] / GRID_RES).round() * GRID_RES

    # Step 2：每個格點的日照值（同格點內的鄉鎮值相同，mean 無影響）
    grid = (
        df.groupby(['grid_lat', 'grid_lon'])['daily_solar_radiation']
        .mean()
        .reset_index()
        .rename(columns={'daily_solar_radiation': 'solar'})
    )
    print(f'  格點數量：{len(grid)}（NASA POWER 覆蓋台灣的 0.5° 格點）')
    print(f'  日照範圍：{grid["solar"].min():.3f} – {grid["solar"].max():.3f} kWh/m²/day')

    grid_lats = grid['grid_lat'].to_numpy()
    grid_lons = grid['grid_lon'].to_numpy()
    grid_vals = grid['solar'].to_numpy()

    # Step 3：對每個鄉鎮中心做 IDW
    interpolated = np.empty(len(df))
    for i, (_, row) in enumerate(df.iterrows()):
        lat, lon = row['centroid_lat'], row['centroid_lon']
        dists = np.sqrt((grid_lats - lat) ** 2 + (grid_lons - lon) ** 2)

        # 若正好在格點上（距離極小），直接取格點值
        exact = np.where(dists < 1e-6)[0]
        if len(exact) > 0:
            interpolated[i] = grid_vals[exact[0]]
        else:
            weights = 1.0 / (dists ** IDW_POWER)
            interpolated[i] = np.dot(weights, grid_vals) / weights.sum()

    return pd.Series(interpolated, index=df.index)


# ── 主流程 ────────────────────────────────────────────────────────────────────

async def run() -> None:
    try:
        import asyncpg
    except ImportError:
        sys.exit('請先安裝 asyncpg：pip install asyncpg')

    db_url = os.environ.get('DATABASE_URL', '')
    if not db_url:
        sys.exit('請設定環境變數 DATABASE_URL')

    if not CLIMATE_CSV.exists():
        sys.exit(f'找不到氣候 CSV：{CLIMATE_CSV}')

    # ── 讀取資料 ─────────────────────────────────────────────────────────────
    print('讀取氣候資料…')
    climate = pd.read_csv(CLIMATE_CSV, encoding='utf-8-sig')
    climate['TOWNCODE'] = climate['TOWNCODE'].astype(str).str.zfill(8)

    need = ['centroid_lat', 'centroid_lon', 'daily_solar_radiation']
    missing = [c for c in need if c not in climate.columns]
    if missing:
        sys.exit(f'氣候 CSV 缺少欄位：{missing}')

    print(f'  載入 {len(climate)} 筆鄉鎮資料')
    print(f'  原始唯一日照值：{climate["daily_solar_radiation"].nunique()} 種')

    # ── IDW 插值 ──────────────────────────────────────────────────────────────
    print('\n執行 IDW 插值…')
    climate['solar_idw'] = compute_idw(climate)
    print(f'  插值後唯一日照值：{climate["solar_idw"].nunique()} 種')
    print(f'  插值前均值：{climate["daily_solar_radiation"].mean():.4f}')
    print(f'  插值後均值：{climate["solar_idw"].mean():.4f}（應接近）')

    # ── 寫入 DB ───────────────────────────────────────────────────────────────
    print('\n更新資料庫…')
    pool = await asyncpg.create_pool(db_url, min_size=1, max_size=3)
    updated = 0
    async with pool.acquire() as conn:
        for _, r in climate.iterrows():
            result = await conn.execute(
                '''UPDATE region_potential
                   SET daily_solar_radiation = $1
                   WHERE towncode = $2''',
                float(r['solar_idw']),
                str(r['TOWNCODE']),
            )
            if result.split()[-1] != '0':
                updated += 1

    await pool.close()
    print(f'\n✅ 完成：更新 {updated} 筆鄉鎮日照值')
    if updated < len(climate):
        print(f'   （{len(climate) - updated} 筆在 DB 中找不到對應 towncode，可能尚未匯入）')


if __name__ == '__main__':
    asyncio.run(run())
