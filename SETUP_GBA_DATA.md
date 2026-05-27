# GBA 建物資料設定說明

本文件說明 GlobalBuildingAtlas (GBA) 建物資料的初始匯入與 Polygon fallback 設定。

---

## 資料架構

```
gba_buildings (Neon DB)        ← 主要資料源（ODbL, ~326K buildings）
        ↓ DB miss
taiwan_polygon_fallback.ndjson.gz  ← Fallback（Polygon, 透過 Git LFS 存放）
```

---

## 一次性初始化步驟

### 前提條件

1. 從 HuggingFace `zhu-xlab/GBA.LoD1` 下載台灣 tiles（已在本機 data/ 下）
2. 確認 `backend/.env` 有 `DATABASE_URL`
3. 確認 venv 已安裝：`fiona`, `ijson`, `pyproj`, `asyncpg`, `python-dotenv`

### Step 1：整理資料夾（已完成）

```
data/
├── ODbLPolygon/e120_n25_e125_n20.geojson   (185 MB)
├── ODbLPolygon/e120_n20_e125_n15.geojson   (1.4 GB)
├── Polygon/e120_n25_e125_n20.geojson       (513 MB)
├── Polygon/e120_n20_e125_n15.geojson       (2.1 GB)
├── LoD1/e120_n25_e125_n20.json             (103 MB)
└── LoD1/e120_n20_e125_n15.json             (660 MB)
```

### Step 2：匯入 Neon DB（ODbL 來源）

```powershell
cd solar_money
.\.venv\Scripts\python.exe scripts/import_gba_to_db.py --tile e120_n25_e125_n20 --source odbl
# 預計耗時：7-8 分鐘，匯入 ~326K buildings
```

驗證：
```sql
-- 在 Neon console 執行
SELECT COUNT(*) FROM gba_buildings;         -- 應 ~326,721
SELECT source, COUNT(*) FROM gba_buildings GROUP BY source;  -- 應全為 odbl
SELECT id, height, footprint->0->0 AS first_lng FROM gba_buildings LIMIT 5;
-- first_lng 應在 120~122 之間（EPSG:4326）
```

### Step 3：產生 Polygon fallback 檔

```powershell
cd solar_money
.\.venv\Scripts\python.exe scripts/export_polygon_fallback.py --tile e120_n25_e125_n20
# 輸出：data/taiwan_polygon_fallback.ndjson.gz
# 預計耗時：10-15 分鐘，輸出 ~20-50 MB gz
```

### Step 4：設定 Git LFS 追蹤 fallback 檔

```bash
# 在 solar_money/ 目錄執行
git lfs install
git lfs track "data/taiwan_polygon_fallback.ndjson.gz"
git add .gitattributes
git add data/taiwan_polygon_fallback.ndjson.gz
git commit -m "feat: add GBA Polygon fallback via Git LFS"
```

---

## 驗證

### DB 驗證

```bash
python scripts/fetch_gba_wfs.py 25.05 121.52
# 應印出：[GBA] DB (ODbL) returned N buildings
# footprint 第一點應為 [121.xxx, 25.xxx]
```

### Fallback 驗證（找一個沒有 ODbL 建物的偏遠位置）

```bash
python scripts/fetch_gba_wfs.py 24.0 121.6
# 若 ODbL 無資料，應印出：[GBA] Fallback (Polygon) returned N buildings
```

### API 驗證

```
GET /api/buildings?lat=25.05&lng=121.52
# buildings[0].footprint[0] 應 ≈ [121.5, 25.0]（WGS84）
```

---

## Neon 儲存用量估計

| 項目 | 大小 |
|---|---|
| 現有資料 | 102 MB |
| ODbL 匯入 (~326K rows) | ~261 MB |
| **合計** | **~363 MB** |
| Neon 免費上限 | 512 MB |
| **剩餘空間** | **~149 MB** |

---

## 注意事項

- `data/ODbLPolygon/`, `data/Polygon/`, `data/LoD1/` 已在 `.gitignore` — 原始 tile 不進 repo
- `taiwan_polygon_fallback.ndjson.gz` 透過 Git LFS 追蹤（需先執行 Step 3-4）
- Vercel 部署時需在 Build Settings 啟用 LFS：`Settings > Git > Git LFS: Enable`
