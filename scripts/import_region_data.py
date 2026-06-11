"""
一次性執行腳本：將 SolarPotentialMapping 輸出的鄉鎮潛力排名匯入 Neon PostgreSQL。

使用方式（在 solar_money 根目錄執行）：
    python scripts/import_region_data.py

可透過環境變數 SPM_ROOT 指定 SolarPotentialMapping 的根目錄，
預設為 ../SolarPotentialMapping（與 solar_money 同層）。

輸入（從 SolarPotentialMapping）：
    outputs/results/transfer/taiwan_priority_ranking.csv  — 368 筆排名 + 分數
    data/taiwan/climate/taiwan_climate_annual.csv         — centroid 座標

輸出（DB 寫入）：
    region_potential — 368 筆（ON CONFLICT DO UPDATE）
"""

import asyncio
import os
import sys
from pathlib import Path

import pandas as pd

# ── 路徑設定 ──────────────────────────────────────────────────────────────────

_HERE = Path(__file__).parent
_SOLAR_ROOT = Path(_HERE).parent

# 自動載入 backend/.env
_env_file = _SOLAR_ROOT / 'backend' / '.env'
if _env_file.exists():
    from dotenv import load_dotenv
    load_dotenv(_env_file)

# SolarPotentialMapping 根目錄（可用環境變數覆蓋）
SPM_ROOT = Path(os.environ.get('SPM_ROOT', _SOLAR_ROOT.parent / 'SolarPotentialMapping'))

RANKING_CSV = SPM_ROOT / 'outputs' / 'results' / 'transfer' / 'taiwan_priority_ranking.csv'
CLIMATE_CSV = SPM_ROOT / 'data' / 'taiwan' / 'climate' / 'taiwan_climate_annual.csv'


def _normalize_towncode(code) -> str:
    """統一格式為 8 碼字串（補前導零），與 solar_money climate_annual 一致。"""
    return str(code).strip().zfill(8)


async def run() -> None:
    try:
        import asyncpg
    except ImportError:
        sys.exit('請先安裝 asyncpg：pip install asyncpg')

    db_url = os.environ.get('DATABASE_URL', '')
    if not db_url:
        sys.exit('請設定環境變數 DATABASE_URL（或在 backend/.env 中配置）')

    if not RANKING_CSV.exists():
        sys.exit(f'找不到排名 CSV：{RANKING_CSV}\n'
                 f'請確認 SolarPotentialMapping 路徑，或設定環境變數 SPM_ROOT')
    if not CLIMATE_CSV.exists():
        sys.exit(f'找不到氣候 CSV：{CLIMATE_CSV}')

    # ── 讀取並合併 ─────────────────────────────────────────────────────────────
    ranking = pd.read_csv(RANKING_CSV, encoding='utf-8-sig')
    climate = pd.read_csv(CLIMATE_CSV, encoding='utf-8-sig')

    ranking['TOWNCODE'] = ranking['TOWNCODE'].apply(_normalize_towncode)
    climate['TOWNCODE'] = climate['TOWNCODE'].apply(_normalize_towncode)

    # 確認欄位存在
    required_ranking = [
        'TOWNCODE', 'COUNTYNAME', 'TOWNNAME',
        'priority_rank', 'topsis_score', 'combined_score',
        'stage1_prob', 'stage2_density_pred',
        'daily_solar_radiation', 'occupancy_owner_rate', 'median_household_income',
    ]
    missing = [c for c in required_ranking if c not in ranking.columns]
    if missing:
        sys.exit(f'ranking CSV 缺少欄位：{missing}')

    # 從氣候資料取 centroid 座標
    df = ranking.merge(
        climate[['TOWNCODE', 'centroid_lat', 'centroid_lon']],
        on='TOWNCODE',
        how='left',
    )

    missing_coords = df['centroid_lat'].isna().sum()
    if missing_coords > 0:
        print(f'警告：{missing_coords} 筆缺少 centroid 座標，將以 0 填充')
        df['centroid_lat'] = df['centroid_lat'].fillna(0.0)
        df['centroid_lon'] = df['centroid_lon'].fillna(0.0)

    print(f'準備匯入 {len(df)} 筆鄉鎮潛力資料...')

    # ── 寫入 DB ────────────────────────────────────────────────────────────────
    pool = await asyncpg.create_pool(db_url, min_size=1, max_size=3)
    async with pool.acquire() as conn:
        inserted = 0
        for _, r in df.iterrows():
            await conn.execute(
                '''INSERT INTO region_potential
                   (towncode, countyname, townname,
                    priority_rank, topsis_score, combined_score,
                    stage1_prob, stage2_pred,
                    daily_solar_radiation, occupancy_owner_rate, median_household_income,
                    centroid_lat, centroid_lon)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                   ON CONFLICT (towncode) DO UPDATE SET
                       priority_rank           = EXCLUDED.priority_rank,
                       topsis_score            = EXCLUDED.topsis_score,
                       combined_score          = EXCLUDED.combined_score,
                       stage1_prob             = EXCLUDED.stage1_prob,
                       stage2_pred             = EXCLUDED.stage2_pred,
                       daily_solar_radiation   = EXCLUDED.daily_solar_radiation,
                       occupancy_owner_rate    = EXCLUDED.occupancy_owner_rate,
                       median_household_income = EXCLUDED.median_household_income,
                       centroid_lat            = EXCLUDED.centroid_lat,
                       centroid_lon            = EXCLUDED.centroid_lon
                ''',
                str(r['TOWNCODE']),
                str(r['COUNTYNAME']),
                str(r['TOWNNAME']),
                int(r['priority_rank']),
                float(r['topsis_score']),
                float(r['combined_score']) if pd.notna(r.get('combined_score')) else None,
                float(r['stage1_prob']) if pd.notna(r.get('stage1_prob')) else None,
                float(r['stage2_density_pred']) if pd.notna(r.get('stage2_density_pred')) else None,
                float(r['daily_solar_radiation']) if pd.notna(r.get('daily_solar_radiation')) else None,
                float(r['occupancy_owner_rate']) if pd.notna(r.get('occupancy_owner_rate')) else None,
                float(r['median_household_income']) if pd.notna(r.get('median_household_income')) else None,
                float(r['centroid_lat']),
                float(r['centroid_lon']),
            )
            inserted += 1

    await pool.close()
    print(f'✅ 匯入完成：{inserted} 筆')


if __name__ == '__main__':
    asyncio.run(run())
