"""
GlobalBuildingAtlas 建物資料擷取模組。

先前使用 TU Munich WFS endpoint（tubvsig-so2sat-vm1.srv.mwn.de）
該 API 為 QGIS/ArcGIS 設計，程式化存取不穩定。

現在改為查詢本地 Neon gba_buildings 表：
  - 資料由 scripts/import_gba_to_db.py 一次性匯入
  - 查詢以 bbox 為條件，O(log N) 透過 min/max 索引

供 shadow.py 直接 import，也可獨立執行做測試：
    python scripts/fetch_gba_wfs.py 25.05 121.52
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

# ── 讓 scripts/ 可以 import backend.db ──────────────────────────────────────
_backend_dir = str(Path(__file__).parent.parent / 'backend')
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / 'backend' / '.env')


async def fetch_gba_buildings(
    min_lon: float, min_lat: float,
    max_lon: float, max_lat: float,
) -> list[dict]:
    """
    從 Neon gba_buildings 表（ODbL 來源）取得 bbox 範圍內建物。
    若 DB 回傳空結果，自動 fallback 至本地 taiwan_polygon_fallback.ndjson.gz。

    輸入為 WGS84 (EPSG:4326) bbox。
    回傳格式與 OSM / NLSC 相容：
      [{"footprint": [[lng, lat], ...], "height": float, "build_id": str}, ...]
    """
    from db import get_gba_buildings_from_db, get_gba_buildings_from_fallback

    # 1. 先查 Neon DB（ODbL 326K buildings）
    buildings = await get_gba_buildings_from_db(min_lon, min_lat, max_lon, max_lat)

    if buildings:
        print(
            f'[GBA] DB (ODbL) returned {len(buildings)} buildings for bbox '
            f'({min_lon:.4f},{min_lat:.4f},{max_lon:.4f},{max_lat:.4f})'
        )
        return buildings

    # 2. DB miss → fallback 至本地 Polygon NDJSON.gz
    fallback = get_gba_buildings_from_fallback(min_lon, min_lat, max_lon, max_lat)
    if fallback:
        print(
            f'[GBA] Fallback (Polygon) returned {len(fallback)} buildings for bbox '
            f'({min_lon:.4f},{min_lat:.4f},{max_lon:.4f},{max_lat:.4f})'
        )
        return fallback

    print(
        f'[GBA] No buildings found (DB + fallback both empty) for bbox '
        f'({min_lon:.4f},{min_lat:.4f},{max_lon:.4f},{max_lat:.4f})'
    )
    return []


# ── 獨立測試執行 ──────────────────────────────────────────────────────────────

async def _test(lat: float, lng: float) -> None:
    delta = 0.005  # ~500m 半徑
    print(f'查詢 ({lat}, {lng}) ±{delta}°…')
    buildings = await fetch_gba_buildings(
        lng - delta, lat - delta,
        lng + delta, lat + delta,
    )
    print(f'取得 {len(buildings)} 棟建物')
    for b in buildings[:5]:
        fp = b.get('footprint', [])
        print(
            f'  height={b["height"]}m  '
            f'footprint_pts={len(fp)}  '
            f'id={b["build_id"]}'
        )
        if fp:
            print(f'    first coord: {fp[0]}  (應為 [lng, lat]，例如 [121.x, 25.x])')


if __name__ == '__main__':
    _lat = float(sys.argv[1]) if len(sys.argv) > 1 else 25.05
    _lng = float(sys.argv[2]) if len(sys.argv) > 2 else 121.52
    asyncio.run(_test(_lat, _lng))
