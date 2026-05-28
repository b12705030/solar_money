# GBA 建物資料設定說明

本文件說明 GlobalBuildingAtlas (GBA) 建物資料的初始匯入、離島補充，以及 Polygon fallback 更新方式。

---

## 資料架構

```
/api/buildings 查詢順序
  1. gba_buildings (Neon DB)          ← 主要來源（510K 棟，全台主島 + 所有離島）
        ↓ DB miss
  2. taiwan_polygon_fallback.ndjson.gz ← 本地 fallback（2.56M 棟，啟動時載入 RAM）
        ↓ fallback miss
  3. OSM Overpass API                 ← 最終備援
```

---

## 現況（已完成）

| Tile | 地區 | 來源 | DB 建物數 |
|------|------|------|----------|
| e120_n25_e125_n20 | 台灣主島（北，21–25°N） | ODbL + Polygon | ~306K |
| e120_n30_e125_n25 | 台灣主島（北，25–30°N）+ 馬祖東 | ODbL + Polygon | ~144K |
| e115_n25_e120_n20 | 澎湖縣 + 金門縣 | Polygon | ~52K |
| e115_n30_e120_n25 | 馬祖南竿 / 莒光 / 北竿 | ODbL + Polygon | ~4.6K |
| **合計** | | | **510,408** |

> **⚠️ 注意**：`e120_n20_e125_n15`（15–20°N，菲律賓）**不要匯入**，會使 Neon 512 MB 上限溢出。

---

## 初始匯入步驟（全新環境）

### 前提條件

1. 已下載本機 tile 檔案（見下方「本機資料夾結構」）
2. `backend/.env` 有 `DATABASE_URL`
3. venv 已安裝：`pip install -r requirements.txt`

### 本機資料夾結構

```
data/
├── LoD1/
│   ├── e120_n25_e125_n20.json      (98 MB)
│   ├── e120_n30_e125_n25.json      (131 MB)
│   ├── e115_n25_e120_n20.json      (168 MB)   ← 澎湖 / 金門
│   └── e115_n30_e120_n25.json      (465 MB)   ← 馬祖
├── ODbLPolygon/
│   ├── e120_n25_e125_n20.geojson   (185 MB)
│   ├── e120_n30_e125_n25.geojson   (?)
│   ├── e115_n25_e120_n20.geojson   (30 MB)
│   └── e115_n30_e120_n25.geojson   (56 MB)
└── Polygon/
    ├── e120_n25_e125_n20.geojson   (513 MB)
    ├── e120_n30_e125_n25.geojson   (?)
    ├── e115_n25_e120_n20.geojson   (1,157 MB)
    └── e115_n30_e120_n25.geojson   (3,002 MB)
```

e115 tiles 不在 HuggingFace 主要台灣 tile 中，可透過以下腳本下載：
```powershell
.\.venv\Scripts\python.exe scripts/download_gba_tiles.py
# 下載 e115_n25 + e115_n30 並自動以正確 bbox 匯入
```

### Step 1：匯入台灣主島

```powershell
cd solar_money

# e120_n25（台灣本島南部 + 小琉球 / 綠島 / 蘭嶼）
.\.venv\Scripts\python.exe scripts/import_gba_to_db.py `
    --tile e120_n25_e125_n20 --bbox 119.8,21.9,122.1,25.4 --source both

# e120_n30（台灣本島北部 + 馬祖東引 / 東莒）
.\.venv\Scripts\python.exe scripts/import_gba_to_db.py `
    --tile e120_n30_e125_n25 --bbox 119.8,25.8,122.1,26.5 --source both
```

### Step 2：匯入離島（澎湖 / 金門）

e115_n25 tile 涵蓋中國大陸沿海，**必須使用精確 bbox** 避免匯入大量無效建物。

```powershell
# 澎湖縣
.\.venv\Scripts\python.exe scripts/import_gba_to_db.py `
    --tile e115_n25_e120_n20 --bbox 119.25,23.05,119.80,23.90 --source polygon

# 金門縣（含烈嶼）
.\.venv\Scripts\python.exe scripts/import_gba_to_db.py `
    --tile e115_n25_e120_n20 --bbox 118.00,24.25,118.55,24.60 --source polygon

# ODbL 補充（選用）
.\.venv\Scripts\python.exe scripts/import_gba_to_db.py `
    --tile e115_n25_e120_n20 --bbox 119.25,23.05,119.80,23.90 --source odbl
.\.venv\Scripts\python.exe scripts/import_gba_to_db.py `
    --tile e115_n25_e120_n20 --bbox 118.00,24.25,118.55,24.60 --source odbl
```

### Step 3：匯入馬祖西（南竿 / 莒光 / 北竿）

```powershell
.\.venv\Scripts\python.exe scripts/import_gba_to_db.py `
    --tile e115_n30_e120_n25 --bbox 119.8,25.8,120.1,26.5 --source both
```

> 注意：e115_n30 LoD1 JSON 有 465 MB，高程索引載入需 ~70–90 秒。載入期間 Neon serverless 連線可能中斷；腳本已內建自動重連機制（每批次前最多重試 3 次），通常無需手動介入。

### Step 4：產生 Polygon fallback

```powershell
.\.venv\Scripts\python.exe scripts/export_polygon_fallback.py `
    --bbox 118.0,21.0,123.0,26.5
# 輸出：data/taiwan_polygon_fallback.ndjson.gz（~167 MB gz，2.56M 棟）
# 耗時：~40 分鐘（掃描四個 tile 的 Polygon GeoJSON）
```

---

## 驗證

```powershell
.\.venv\Scripts\python.exe scripts/_test_islands.py
```

預期輸出（各地區均應 > 0）：
```
=== GBA DB — 台灣離島建物驗證 ===

  ✓  澎湖 Penghu      (119.30-119.75, 23.10-23.85): ~11,000+
  ✓  金門 Kinmen      (118.10-118.50, 24.30-24.60): ~24,000+
  ✓  馬祖南竿 Nangan  (119.90-120.00, 26.10-26.20): ~600+
  ✓  馬祖莒光 Juguang (119.88-119.99, 25.90-26.00): ~200+
  ✓  馬祖北竿 Beigan  (119.96-120.04, 26.20-26.28): ~160+
  ✓  馬祖東引 Dongyin (120.43-120.52, 26.36-26.40): ~130+
```

API 測試（需後端啟動）：
```powershell
# 澎湖馬公
curl "http://localhost:8000/api/buildings?lat=23.568&lng=119.578&radius_m=500"

# 金門金城
curl "http://localhost:8000/api/buildings?lat=24.432&lng=118.317&radius_m=500"

# 馬祖南竿
curl "http://localhost:8000/api/buildings?lat=26.160&lng=119.940&radius_m=300"
```

---

## Neon 容量

| 項目 | 狀態 |
|------|------|
| gba_buildings（510K 棟） | ~480 MB |
| Neon 免費上限 | 512 MB |
| 剩餘空間 | ~32 MB（不再匯入新 tile） |

> **e115 tile 包含大量中國大陸建物**。未來若需重新匯入，務必使用上方的精確 bbox；使用整個 tile bbox（如 `118,20,120,25`）會匯入福建/廣東沿海數十萬棟建物，立即超出 512 MB 上限。

---

## 注意事項

- `data/ODbLPolygon/`, `data/Polygon/`, `data/LoD1/` 已在 `.gitignore`，原始 tile 不進 repo
- `taiwan_polygon_fallback.ndjson.gz`（167 MB）直接 commit，不用 Git LFS
- `scripts/_test_islands.py`、`scripts/_cleanup_e115.py` 為維護用腳本，不需定期執行
