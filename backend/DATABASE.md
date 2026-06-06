# 資料庫架構說明

## 技術選型

| 功能 | 選擇 | 原因 |
|------|------|------|
| 永久儲存 | CockroachDB Serverless | PostgreSQL wire-compatible；10 GiB 免費；asia-southeast1 節點 |
| 短期快取 | PostgreSQL shadow_cache | 現階段流量低，不需要另外架 Redis；若日後需要水平擴展可再加 |

> **為什麼從 Neon 遷移到 CockroachDB？** 本專案最初使用 Neon PostgreSQL；Neon 免費方案上限 0.5 GB，無法容納 1.9M 棟 GBA 建物（~694 MB）。CockroachDB Serverless 提供 10 GiB 免費空間，完整容納建物資料庫。

> **為什麼不用 Redis？** `shadow_cache` 以月份為粒度，同一區域一個月只算一次，命中率高且不需要 sub-second 過期精度。PostgreSQL 的查詢延遲（~5ms）對這個場景已足夠。

### CockroachDB 相容性注意事項

CockroachDB 相容 PostgreSQL wire protocol，但**不是 100% 的 PostgreSQL 替代方案**，已知差異：

| 問題 | 說明 | 解法 |
|------|------|------|
| **多語句單次 `execute()` 較慢** | 一次傳入多個 `;` 分隔 SQL 的批次處理比 PostgreSQL 慢 | 拆分為個別 `execute()` 呼叫；功能相同，只稍增程式碼行數 |
| **同一連線不能有多個 active portal**（asyncpg + CockroachDB） | 在同一個 `conn` 上依序執行多個 `fetchrow` / `execute` 會報錯：`unimplemented: multiple active portals`。在 transaction 內尤其明顯。[CockroachDB issue #40195](https://go.crdb.dev/issue-v/40195/v25.4) | **不要在同一個 `conn` 上串接多個查詢**；需要多步驟原子操作時，改用單一 CTE 語句（`WITH ... AS (...) UPDATE ... RETURNING ...`），把多個 UPDATE 合進一條 SQL |
| **CTE 內 DML 語句必須有 `RETURNING`** | PostgreSQL 允許 CTE UPDATE 不加 `RETURNING`；CockroachDB 不允許，會報 `WITH clause "xxx" does not return any columns` | CTE 裡每一個 `UPDATE` / `INSERT` / `DELETE` 都要加 `RETURNING <欄位>`，即使外層不 SELECT 它 |

> 目前 `init_db()` 仍使用單一多語句 `execute()`，在 CockroachDB 上**功能正常**，只是一次性啟動略慢。若啟動時間成為瓶頸，再考慮拆分。

---

## 資料表總覽

| 表格 | 類型 | 筆數 | 大小 |
|------|------|------|------|
| `gba_buildings` | 永久 | 1,905,108 | ~694 MiB |
| `climate_monthly` | 永久 | 4,416 | ~399 KiB |
| `climate_annual` | 永久 | 368 | ~41 KiB |
| `region_potential` | 永久 | 368 | ~128 KiB |
| `accounts` | 永久 | 依使用者 | — |
| `vendors` | 永久 | 11（含 seed） | — |
| `vendor_portfolios` | 永久 | 12（含 seed） | — |
| `assessments` | 永久 | 依使用者 | — |
| `inquiries` | 永久 | 依使用者 | — |
| `inquiry_messages` | 永久 | 依使用者 | — |
| `vendor_reviews` | 永久 | 依使用者 | — |
| `places_cache` | 快取（90d TTL） | 依查詢量 | — |
| `shadow_cache` | 快取（月份粒度） | 依查詢量 | — |
| `tilt_cache` | 快取（永久） | 依查詢量 | ~360 KiB 上限 |
| `usable_fraction_cache` | 快取（180d TTL） | 依查詢量 | — |
| `osm_cache` | 快取（7d TTL） | 依查詢量 | — |
| `gba_cache` | 快取 | 0（已棄用） | — |
| `dem_cache` | 快取 | 1 | ~29 MiB |

---

## 資料表詳細說明

### `gba_buildings`
GlobalBuildingAtlas (GBA) 離線建物資料，ML 估算高度 + footprint，為建物幾何查詢的主要來源。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | TEXT PK | 建物唯一識別碼 |
| `footprint` | JSONB | `[[lng, lat], ...]` WGS84 外牆多邊形 |
| `height` | REAL | 建物高度 (m)，ML 估算值；無估算時預設 10.0 |
| `source` | TEXT | 資料來源：`odbl` / `polygon` / `fallback` |
| `min_lon` / `max_lon` | REAL | footprint bbox 邊界（索引欄位） |
| `min_lat` / `max_lat` | REAL | footprint bbox 邊界（索引欄位） |

**索引**：`gba_buildings_bbox ON (min_lon, max_lon, min_lat, max_lat)`  
**資料來源**：`data/taiwan_polygon_fallback.ndjson.gz`（1.9M 棟，LoD1 合併 ODbL + GBA ML + 高度）  
**原始資料**：HuggingFace `zhu-xlab/GBA.LoD1`（ODbLPolygon + Polygon GeoJSON + LoD1 高度 JSON）  
**匯入方式**：`python scripts/import_fallback_to_db.py`  
**CockroachDB 佔用**：~694 MiB（1,905,108 棟；全台含澎湖 / 金門 / 馬祖）  
**查詢邏輯**：`WHERE min_lon < $max_lon AND max_lon > $min_lon AND min_lat < $max_lat AND max_lat > $min_lat`

---

### `climate_monthly`
NASA POWER API 月均氣候典型值，368 鄉鎮市 × 12 月 = 4,416 筆（2013–2025 年月均值）。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `township_code` | TEXT | 鄉鎮市代碼（複合 PK 1/2） |
| `month` | INT | 月份 1–12（複合 PK 2/2） |
| `ghi` | DOUBLE | 月均日射量 kWh/m²/day（`ALLSKY_SFC_SW_DWN` 13 年平均） |
| `temperature` | DOUBLE | 月均氣溫 °C（`T2M`） |
| `wind_speed` | DOUBLE | 月均風速 m/s（`WS10M`） |
| `humidity` | DOUBLE | 月均相對濕度 %（`RH2M`） |

**資料來源**：`data/climate/nasa_power_monthly_raw.csv`  
**匯入方式**：`python scripts/import_climate.py`

---

### `climate_annual`
368 鄉鎮市年均統計，含 centroid 座標，供附近鄉鎮市查詢與 fallback 使用。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `township_code` | TEXT PK | 內政部 7 碼鄉鎮市代碼 |
| `county_name` | TEXT | 縣市名稱 |
| `township_name` | TEXT | 鄉鎮市名稱 |
| `centroid_lat` | DOUBLE | 鄉鎮市幾何中心緯度 |
| `centroid_lon` | DOUBLE | 鄉鎮市幾何中心經度 |
| `daily_solar_radiation` | DOUBLE | 年均日輻射量 kWh/m²/day |
| `air_temperature` | DOUBLE | 年均氣溫 °C |
| `wind_speed` | DOUBLE | 年均風速 m/s |
| `relative_humidity` | DOUBLE | 年均相對濕度 % |

---

### `region_potential`
368 鄉鎮市太陽能裝設潛力排名，由 TOPSIS 多準則分析計算（韓仁毓教授方法）。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `towncode` | TEXT PK | 鄉鎮市代碼 |
| `countyname` / `townname` | TEXT | 縣市 / 鄉鎮市名稱 |
| `priority_rank` | INT | 全台排名（1 = 最佳） |
| `topsis_score` | DOUBLE | TOPSIS 綜合得分 |
| `combined_score` | DOUBLE | 加權綜合分數 |
| `stage1_prob` | DOUBLE | 第一階段預測概率 |
| `stage2_pred` | DOUBLE | 第二階段預測值 |
| `daily_solar_radiation` | DOUBLE | 年均日射量 kWh/m²/day |
| `occupancy_owner_rate` | DOUBLE | 自有住宅比率 |
| `median_household_income` | DOUBLE | 中位數家戶所得 |
| `centroid_lat` / `centroid_lon` | DOUBLE | 地理中心座標 |

---

### `dem_cache`
全台 100m DEM numpy array，以 `bytea` 存入 DB，後端啟動時載入 RAM。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | TEXT PK | 固定為 `taiwan_100m` |
| `data` | BYTEA | `taiwan_dem_100m.npy` 原始位元組（float32 2D，shape 3770×2007） |
| `meta` | BYTEA | `taiwan_dem_meta.npy` 原始位元組（`[origin_x, origin_y, px_x, px_y]` float64） |
| `created_at` | TIMESTAMPTZ | 最後上傳時間 |

**載入邏輯**（`shadow.py load_dem()`）：本機 `.npy` → DB bytea → 警告停用

---

### `osm_cache`
Overpass API 抓到的 OSM 建物原始資料（GeoJSON elements），TTL = 7 天。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `bbox_key` | TEXT PK | `{min_lon:.2f},{min_lat:.2f},{max_lon:.2f},{max_lat:.2f}` |
| `elements` | JSONB | Overpass 回傳的 way elements 陣列 |
| `fetched_at` | TIMESTAMPTZ | 寫入時間 |

---

### `shadow_cache`
每個 ~100m 格子的 6–19 時陰影預計算結果，以月份為粒度。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `cache_key` | TEXT PK | `v4_{lat:.3f}_{lng:.3f}_{year}_{month:02d}` |
| `shadows` | JSONB | `{"6": FeatureCollection, "7": ..., "19": ...}` |
| `computed_at` | TIMESTAMPTZ | 寫入時間 |

**Cache key 版本**：目前 v4（精度從 2 位升至 3 位，~100m 格子）。舊版 v1/v2/v3 key 不被讀取，可透過 `/api/admin/cache/cleanup` 清除。  
**複用邏輯**：`/api/shadows/from-features` 優先查此表，命中時直接回傳對應小時資料，無需重新計算。

---

### `tilt_cache`
pvlib 最佳安裝傾角計算結果，以地點 + 目標為 key，永久有效。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `cache_key` | TEXT PK | `v1_tilt_{lat:.3f}_{lng:.3f}_{goal}` |
| `result` | JSONB | `{"best_angle": int, "goal_adj": [12 floats]}` |
| `computed_at` | TIMESTAMPTZ | 寫入時間 |

**為何不設 TTL**：結果只依賴地理位置（pvlib 天文計算）與 NASA POWER 長期平均氣候，兩者極少變動，永久有效。  
**演算法改版**：bump key 前綴（`v1_` → `v2_`），舊快取自動失效，不需要手動清除。  
**個人化請求**（帶 `monthly_use` 參數）不寫入此表，每次實時計算。  
**容量估算**：368 鄉鎮 × 6 種 goal ≤ 2,208 筆 × ~200 bytes = ~430 KB。

---

### `usable_fraction_cache`
可用屋頂比例計算結果（Shapely 多邊形運算），以目標建物 footprint hash 為 key，TTL = 180 天。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `cache_key` | TEXT PK | `v1_uf_{md5(footprint)[:12]}` |
| `result` | JSONB | `{"usable_fraction": float, "setback_area_m2": float}` |
| `computed_at` | TIMESTAMPTZ | 寫入時間 |

**為何設 180 天 TTL**：結果依賴鄰近建物（周圍新建/拆除會使結果偏差），但台灣都市建物變動緩慢，180 天合理。  
**Cache key 設計**：以 footprint JSON 字串的 MD5 前 12 碼為 key（衝突機率 1/2⁴⁸），不受 lat/lng 精度影響，同一棟建物永遠命中同一個 key。  
**清除**：`/api/admin/cache/cleanup` 刪除超過 180 天的項目。

---

### `places_cache`
Google Places API（Autocomplete + Place Details）後端代理快取，TTL = 90 天。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `cache_key` | TEXT PK | `ac_{query}` 或 `detail_{placeId}` |
| `data` | JSONB | Autocomplete: `PlacePrediction[]`；Details: `{lat, lon, formattedAddress}` |
| `cached_at` | TIMESTAMPTZ | 寫入時間 |

**設計目標**：省 Google Maps API 費用（Autocomplete ~$0.00283/次，Place Details ~$0.017/次）。

**四層快取架構**：
```
L1 session memory (~0ms)  → L2 localStorage/90d (~1ms)
→ L3 places_cache DB/90d (~50ms)  → L4 Google Places REST API
```

**讀取邏輯**：`WHERE cache_key = $1 AND cached_at > NOW() - INTERVAL '90 days'`；miss 時懶清除過期資料。  
**需要環境變數**：`GOOGLE_MAPS_API_KEY`（後端，不暴露於瀏覽器）

---

### `accounts`
會員帳號，Email + bcrypt 密碼雜湊。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | UUID PK | auto gen |
| `email` | TEXT UNIQUE | — |
| `password_hash` | TEXT | bcrypt hash |
| `role` | TEXT | `user` / `vendor` / `admin`，預設 `user` |
| `created_at` | TIMESTAMPTZ | — |

---

### `assessments`
使用者完成評估流程後自動儲存。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | UUID PK | auto gen |
| `user_id` | TEXT | 前端 localStorage 匿名 UUID |
| `account_id` | UUID FK | 登入後綁定（nullable） |
| `address` / `lat` / `lng` / `county` | — | 地址資訊 |
| `roof_area_ping` | DOUBLE | 屋頂坪數 |
| `monthly_kwh` | DOUBLE | 每月用電量 |
| `goal` | TEXT | `annual` / `summer` / `winter` / `peak` / `match` / `roi` |
| `capacity_kw` | DOUBLE | 裝機容量 (kWp) |
| `total_cost` / `subsidy_amount` / `out_of_pocket` | BIGINT | 費用明細 (NT$) |
| `annual_kwh` / `self_sufficiency` / `payback_years` | DOUBLE | 效益指標 |
| `total_20yr` / `annual_revenue` | BIGINT | 收益 (NT$) |
| `best_angle` | INT | 最佳安裝角度 (°) |
| `result` | JSONB | 月發電量陣列等彈性資料 |
| `created_at` | TIMESTAMPTZ | — |

---

### `vendors`
廠商資料，啟動時 seed 4 筆 mock 廠商。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | TEXT PK | 穩定識別碼 |
| `account_id` | UUID FK UNIQUE | 對應廠商登入帳號（nullable） |
| `name` | TEXT | 廠商名稱 |
| `company_tax_id` / `contact_name` | TEXT | 申請資料 |
| `counties` | TEXT[] | 服務縣市 |
| `rating` / `review_count` | DOUBLE / INT | 平均評分 / 評價數 |
| `phone` / `email` | TEXT | 聯絡資訊 |
| `tags` | TEXT[] | 標籤 |
| `approved` | BOOLEAN | 是否公開顯示 |
| `subscription_status` | TEXT | `mock` / `free` / `pro` 等 |
| `application_status` | TEXT | `pending` / `approved` / `rejected` |
| `license_note` / `rejection_reason` | TEXT | 申請備註 / 退回原因 |
| `logo_url` | TEXT | Cloudflare R2 公開 URL |
| `created_at` | TIMESTAMPTZ | — |

---

### `vendor_portfolios`
廠商作品集案例。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | UUID PK | auto gen |
| `vendor_id` | TEXT FK | 對應 `vendors.id` |
| `title` / `meta` | TEXT | 案例標題 / 摘要 |
| `capacity_kw` | DOUBLE | 系統容量 |
| `completed_year` | INT | 完工年份 |
| `is_featured` | BOOLEAN | 是否為推薦案例 |
| `photo_url` | TEXT | Cloudflare R2 公開 URL（nullable） |
| `description` | TEXT | 案例詳細說明（nullable） |
| `created_at` | TIMESTAMPTZ | — |

---

### `inquiries`
民眾點擊「聯絡廠商」時寫入一筆詢價紀錄。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | UUID PK | auto gen |
| `vendor_id` | TEXT NOT NULL FK | 對應 `vendors.id` |
| `account_id` | UUID FK | 詢問者帳號（nullable） |
| `address` / `county` | TEXT | 評估地址 |
| `capacity_kw` / `annual_kwh` / `payback_years` | DOUBLE | 評估結果摘要 |
| `case_status` | TEXT | `new` / `contacted` / `quoted` / `closed` |
| `user_last_read_at` | TIMESTAMPTZ | 用戶最後已讀時間（nullable） |
| `vendor_last_read_at` | TIMESTAMPTZ | 廠商最後已讀時間（nullable） |
| `created_at` | TIMESTAMPTZ | 詢價時間 |

---

### `inquiry_messages`
詢價對話訊息，廠商與用戶雙向留言。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | UUID PK | auto gen |
| `inquiry_id` | UUID NOT NULL FK | 對應 `inquiries.id` |
| `sender` | TEXT | `user` / `vendor` |
| `content` | TEXT | 訊息內容 |
| `created_at` | TIMESTAMPTZ | 發送時間 |

**索引**：`idx_inquiry_messages_inquiry_id ON (inquiry_id, created_at)`

---

### `vendor_reviews`
民眾對廠商的評價（每個詢價只能評一次）。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | UUID PK | auto gen |
| `vendor_id` | TEXT NOT NULL FK | 對應 `vendors.id` |
| `inquiry_id` | UUID UNIQUE FK | 對應 `inquiries.id`（一詢價一評價） |
| `account_id` | UUID NOT NULL FK | 評價者帳號 |
| `rating` | INT | 1–5 分 |
| `comment` | TEXT | 評價文字（nullable） |
| `created_at` | TIMESTAMPTZ | — |

---

## API Endpoints

### Google Places 代理

#### `GET /api/places/autocomplete?q={input}`
地址自動完成，後端代理 Google Places REST API，結果快取 90 天。

**Response**：`[{ placeId, description, mainText, secondaryText }, ...]`

#### `GET /api/places/details?id={placeId}`
取得地點詳細資訊（座標 + 格式化地址），快取 90 天。

**Response**：`{ lat, lon, formattedAddress }`

---

### 評估

#### `POST /api/assessments`
儲存一筆評估紀錄。前端在 Results 頁 mount 時自動呼叫。

#### `GET /api/assessments?user_id=<uuid>&limit=10`
查詢同一 `user_id` 的歷史評估紀錄。

---

### 鑑別資訊

#### `POST /api/auth/register` / `POST /api/auth/login`
Email + 密碼 → 建立帳號 / 登入 → 回傳 JWT token。

#### `GET /api/me/assessments`、`POST /api/me/claim`
登入用戶的評估紀錄查詢與匿名紀錄綁定。

---

### 廠商

#### `GET /api/vendors?county=<縣市>&limit=3`
依服務縣市取得推薦廠商。

#### `GET /api/vendors/{id}`
取得廠商詳細資料 + 作品集列表。

#### `POST /api/vendors/apply`
廠商入駐申請。

#### 廠商儀表板（Bearer JWT）
`GET/PATCH /api/me/vendor`、作品集 CRUD、詢價列表、訊息回覆

---

### Admin（Bearer JWT role=admin 或 `X-Admin-Secret`）
廠商審核、帳號管理。開發預設：`ALLOW_DEV_ADMIN_SECRET=1`。

---

## 陰影載入流程（兩階段）

```
移動地圖
  │
  ├─ Phase 1 → POST /api/shadows/from-features  (只算當前 1 小時，~300 ms)
  │             → 立刻顯示陰影，隱藏 spinner
  │
  └─ Phase 2 → POST /api/shadows/precompute     (算全天 14 小時，2–5 s 或 DB cache 秒回)
                → 完成後填入 cacheRef；拉滑桿從此瞬間回應
```

---

## 連線設定

```
# backend/.env
DATABASE_URL=postgresql://<user>:<password>@<host>:26257/defaultdb?sslmode=require
GOOGLE_MAPS_API_KEY=AIzaSy...   # 後端專用，不暴露於瀏覽器
```

放在 `backend/.env`，由 `load_dotenv(Path(__file__).parent / '.env')` 在啟動時載入。

連線池：`min_size=1, max_size=5`。  
時區：`server_settings={'timezone': 'Asia/Taipei'}`。

> **Graceful fallback**：DB 無法連線時會印出警告並繼續以無 DB 模式運行（陰影仍可計算，只是不快取）。

---

## 初始化

後端啟動時 `lifespan` 自動執行 `init_db()`：
- `CREATE TABLE IF NOT EXISTS` — 建立所有表（含 `places_cache`）
- `ALTER TABLE ADD COLUMN IF NOT EXISTS` — 相容舊版 schema，補齊新欄位
- seed mock 廠商資料至 `vendors` / `vendor_portfolios`

不需要手動執行 migration。

---

## 一次性前置作業（本機執行）

### 1. GBA 建物匯入（1.9M 棟，約 20–40 分鐘）
```powershell
cd solar_money
$env:DATABASE_URL="postgresql://solar:...@...cockroachlabs.cloud:26257/defaultdb?sslmode=require"
.venv/Scripts/python scripts/import_fallback_to_db.py
```
輸入：`data/taiwan_polygon_fallback.ndjson.gz`（108 MB gz）  
輸出：CockroachDB `gba_buildings` 1,905,108 筆

### 2. Neon → CockroachDB 業務資料遷移（一次性，約 2 分鐘）
```powershell
$env:NEON_URL="postgresql://neondb_owner:...@...neon.tech/neondb?sslmode=require"
.venv/Scripts/python scripts/migrate_neon_to_cockroachdb.py
```
遷移 10 張表：climate、region_potential、accounts、vendors、assessments、inquiries 等。

### 3. DEM 降采樣
```powershell
python scripts/build_dem_cache.py
```
輸入：`data/不分幅_全台20MDEM(2025)/DEM_tawiwan_V2025.tif`（721.8 MB）  
輸出：`data/taiwan_dem_100m.npy`

### 4. 氣候資料匯入
```powershell
python scripts/import_climate.py
```

### 5. GBA 建物查詢流程（3 層 fallback）
`shadow.py` 的 `get_buildings()` 依序嘗試：
1. **GBA DB**（`gba_buildings`）— bbox 查詢，全台覆蓋
2. **Polygon fallback**（`data/taiwan_polygon_fallback.ndjson.gz`）— 後端啟動時背景預載 RAM
3. **OSM Overpass API** — 兩者均無結果時的最終備援

> Railway 部署：設 `GBA_DISABLE_FALLBACK=1` 跳過 fallback 預載（節省 RAM）；DB 已有完整資料。
