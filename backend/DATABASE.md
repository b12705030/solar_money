# 資料庫架構說明

## 技術選型

| 功能 | 選擇 | 原因 |
|------|------|------|
| 永久儲存 | PostgreSQL (Neon) | 結構化查詢、JSONB 支援、免費 serverless 方案 |
| 短期快取 | PostgreSQL shadow_cache | 現階段流量低，不需要另外架 Redis；若日後需要水平擴展可再加 |

> **為什麼不用 Redis？** 目前的 `shadow_cache` 以月份為粒度，同一區域一個月只算一次，命中率高且不需要 sub-second 過期精度。PostgreSQL 的查詢延遲（~5ms）對這個場景已足夠。

---

## 資料表

### `nlsc_lod1_cache`
內政部國土測繪局 LoD1 建物資料快取，以鄉鎮市為單元，永不過期（地籍資料異動頻率極低）。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `township_code` | TEXT PK | 內政部 7 碼鄉鎮市代碼（對應 `climate_annual.township_code`） |
| `buildings` | JSONB | `[{"footprint":[[lng,lat],...], "height": float, "build_id": str}, ...]` |
| `cached_at` | TIMESTAMPTZ | 最後更新時間 |

**資料來源**：NLSC I3S v1.8 REST API（`https://i3s.nlsc.gov.tw/building/i3s/SceneServer`）  
**Neon 佔用**：~210 MB（30 熱門鄉鎮市全快取後）  
**查詢邏輯**：以 footprint centroid 落在 bbox 內為過濾條件，cache miss 時即時從 NLSC 擷取。

---

### `climate_monthly`
NASA POWER API 月均氣候典型值，368 鄉鎮市 × 12 月 = 4,416 筆（13 年月均值）。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `township_code` | TEXT | 鄉鎮市代碼（複合 PK 1/2） |
| `month` | INT | 月份 1–12（複合 PK 2/2） |
| `ghi` | DOUBLE | 月均日射量 kWh/m²/day（`ALLSKY_SFC_SW_DWN` 欄位 13 年平均） |
| `temperature` | DOUBLE | 月均氣溫 °C（`T2M`） |
| `wind_speed` | DOUBLE | 月均風速 m/s（`WS10M`） |
| `humidity` | DOUBLE | 月均相對濕度 %（`RH2M`） |

**資料來源**：`data/climate/nasa_power_monthly_raw.csv`（本機既有，4.6 MB，368 × 13 年 × 12 月）  
**匯入方式**：執行 `python scripts/import_climate.py`  
**Neon 佔用**：~300 KB

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

**資料來源**：`data/climate/taiwan_climate_annual.csv`（本機既有，~50 KB）  
**匯入方式**：執行 `python scripts/import_climate.py`  
**Neon 佔用**：~50 KB

---

### `dem_cache`
全台 100m DEM numpy array，以 `bytea` 存入 DB（28.9 MB），後端啟動時載入 RAM。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | TEXT PK | 固定為 `taiwan_100m` |
| `data` | BYTEA | `taiwan_dem_100m.npy` 的原始位元組（float32 2D array，shape 3770×2007） |
| `meta` | BYTEA | `taiwan_dem_meta.npy` 的原始位元組（`[origin_x, origin_y, px_x, px_y]` float64） |
| `created_at` | TIMESTAMPTZ | 最後上傳時間 |

**載入邏輯**（`shadow.py load_dem()`）：
1. 本機 `data/taiwan_dem_100m.npy` 存在 → 直接從本機載入（最快）
2. 否則 → 從 DB 下載 → 寫回本機快取 → 載入
3. 兩者皆無 → 警告停用，提示執行 `scripts/build_dem_cache.py`

**上傳方式**：執行 `python scripts/upload_dem.py`  
**Neon 佔用**：~28.9 MB

---

### `osm_cache`
存 Overpass API 抓到的 OSM 建物原始資料（GeoJSON elements），避免重複打 Overpass。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `bbox_key` | TEXT PK | `{min_lon:.2f},{min_lat:.2f},{max_lon:.2f},{max_lat:.2f}` |
| `elements` | JSONB | Overpass 回傳的 way elements 陣列 |
| `fetched_at` | TIMESTAMPTZ | 寫入時間，TTL = 7 天 |

**TTL 邏輯**：查詢時過濾 `fetched_at > NOW() - INTERVAL '7 days'`，舊資料自動不被讀取（不做實際刪除）。

---

### `shadow_cache`
存每個 ~1km 格子的 6–19 時陰影預計算結果，以月份為粒度（同月份太陽角度差異 < 1°）。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `cache_key` | TEXT PK | `{lat:.2f}_{lng:.2f}_{year}_{month:02d}` |
| `shadows` | JSONB | `{"6": FeatureCollection, "7": ..., "19": ...}` |
| `computed_at` | TIMESTAMPTZ | 寫入時間 |

**Cache key 範例**：`25.05_121.52_2026_04`（台北信義區，2026 年 4 月）

**效果**：同月份內任何人造訪同一 ~1km 格子，直接從 DB 拿結果，省去 2–5 秒的 pvlib 計算。

---

### `accounts`
會員帳號，Email + bcrypt 密碼雜湊。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | UUID PK | auto gen |
| `email` | TEXT UNIQUE | 不區分大小寫（資料庫層級保持原始大小寫） |
| `password_hash` | TEXT | bcrypt hash，不儲存明文 |
| `role` | TEXT | 帳號角色：`user` / `vendor` / `admin`，預設 `user` |
| `created_at` | TIMESTAMPTZ | 建立時間 |

---

### `assessments`
每次使用者完成評估流程後，自動儲存一筆紀錄。使用 `localStorage` 匿名 UUID 作為 `user_id`，不需要登入。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | UUID PK | auto gen |
| `user_id` | TEXT | 前端 `localStorage` 匿名 UUID |
| `address` | TEXT | 地址文字 |
| `lat` / `lng` | DOUBLE | 地址座標 |
| `county` | TEXT | 縣市（補助計算用） |
| `roof_area_ping` | DOUBLE | 屋頂坪數 |
| `monthly_kwh` | DOUBLE | 每月用電量 (kWh) |
| `goal` | TEXT | `annual` / `summer` / `winter` / `peak` / `match` / `roi` |
| `capacity_kw` | DOUBLE | 裝機容量 (kWp) |
| `total_cost` | BIGINT | 安裝費用 (NT$) |
| `subsidy_amount` | BIGINT | 補助金額 (NT$) |
| `out_of_pocket` | BIGINT | 實際自付 (NT$) |
| `annual_kwh` | DOUBLE | 預估年發電量 |
| `self_sufficiency` | DOUBLE | 能源自給率 (%) |
| `payback_years` | DOUBLE | 回本年限 |
| `total_20yr` | BIGINT | 20 年累計淨收益 (NT$) |
| `annual_revenue` | BIGINT | 年均收益 (NT$) |
| `best_angle` | INT | 最佳安裝角度 (°) |
| `account_id` | UUID FK | 登入後綁定的帳號（nullable，匿名評估為 NULL） |
| `result` | JSONB | 完整月發電量陣列等彈性資料 |
| `created_at` | TIMESTAMPTZ | 評估時間 |

---

### `vendors`
廠商推薦基礎資料。現階段啟動時會 seed 一批 mock 廠商，之後可接廠商註冊與後台審核流程。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | TEXT PK | 穩定識別碼 |
| `account_id` | UUID FK UNIQUE | 對應廠商登入帳號（nullable；目前申請 MVP 尚未綁定） |
| `name` | TEXT | 廠商名稱 |
| `company_tax_id` | TEXT | 統一編號 |
| `contact_name` | TEXT | 聯絡人 |
| `counties` | TEXT[] | 服務縣市 |
| `rating` | DOUBLE | 平均評分 |
| `review_count` | INT | 評價數 |
| `phone` | TEXT | 聯絡電話 |
| `email` | TEXT | 聯絡 Email |
| `tags` | TEXT[] | 標籤 |
| `approved` | BOOLEAN | 是否公開顯示 |
| `subscription_status` | TEXT | 方案狀態；目前 seed 資料為 `mock` |
| `application_status` | TEXT | 申請狀態（`pending` / `approved` 等） |
| `license_note` | TEXT | 相關執照或備註 |
| `rejection_reason` | TEXT | 退回原因 |
| `created_at` | TIMESTAMPTZ | 建立時間 |

---

### `vendor_portfolios`
廠商作品集案例。Results 頁目前取每家廠商一筆 featured case 顯示。廠商可於後台新增或刪除。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | UUID PK | auto gen |
| `vendor_id` | TEXT FK | 對應 `vendors.id` |
| `title` | TEXT | 案例標題 |
| `meta` | TEXT | 案例摘要 |
| `capacity_kw` | DOUBLE | 案例系統容量 |
| `completed_year` | INT | 完工年份 |
| `is_featured` | BOOLEAN | 是否為推薦顯示案例 |
| `created_at` | TIMESTAMPTZ | 建立時間 |

---

### `inquiries`
民眾從 Results 頁點擊「聯絡廠商」時自動寫入一筆詢價紀錄，廠商可於後台儀表板查看。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | UUID PK | auto gen |
| `vendor_id` | TEXT NOT NULL FK | 對應 `vendors.id` |
| `account_id` | UUID FK | 詢問者帳號（nullable；未登入為 NULL） |
| `address` | TEXT | 評估地址 |
| `county` | TEXT | 縣市 |
| `capacity_kw` | DOUBLE | 預估裝機容量 (kWp) |
| `annual_kwh` | DOUBLE | 預估年發電量 |
| `payback_years` | DOUBLE | 預估回本年限 |
| `created_at` | TIMESTAMPTZ | 詢價時間 |

---

## API Endpoints

### `POST /api/assessments`
儲存一筆評估紀錄。前端在 Results 頁面 mount 時自動呼叫。

**Request body**：`AssessmentRequest`（所有欄位皆 optional，除了 `user_id`）

**Response**：`{ "id": "<uuid>" }`

---

### `GET /api/assessments?user_id=<uuid>&limit=10`
查詢同一 `user_id` 的歷史評估紀錄（最新 10 筆）。

**Response**：`[{ id, address, county, annual_kwh, payback_years, out_of_pocket, capacity_kw, created_at }, ...]`

---

### `POST /api/auth/register`
Email + 密碼 → 建立帳號 → 回傳 JWT token。

**Request body**：`{ email: string, password: string }`（密碼至少 8 字元）

**Response**：`{ token, user_id, email, role }`

**錯誤**：`409` Email 已存在、`422` 密碼太短

---

### `POST /api/auth/login`
Email + 密碼驗證 → 回傳 JWT token。

**Request body**：`{ email: string, password: string }`

**Response**：`{ token, user_id, email, role }`

**錯誤**：`401` Email 或密碼錯誤

---

### `GET /api/me/assessments`
取得登入帳號的歷史評估紀錄（最新 20 筆）。

**Header**：`Authorization: Bearer <token>`

**Response**：同 `GET /api/assessments` 格式

---

### `POST /api/me/claim?user_id=<uuid>`
將匿名 UUID 的評估紀錄綁定至登入帳號（`account_id` 填入）。

**Header**：`Authorization: Bearer <token>`

**Response**：`{ ok: true }`

---

### `GET /api/climate/{township_code}`
取得指定鄉鎮市的氣候資料。需先執行 `scripts/import_climate.py` 匯入資料。

**路徑參數**：`township_code` — 內政部 7 碼鄉鎮市代碼（例如 `6300100`）

**Response**：
```json
{
  "annual": {
    "township_code": "6300100",
    "county_name": "臺北市",
    "township_name": "中正區",
    "centroid_lat": 25.033,
    "centroid_lon": 121.514,
    "daily_solar_radiation": 3.8,
    "air_temperature": 23.2,
    "wind_speed": 2.1,
    "relative_humidity": 77.5
  },
  "monthly": [
    { "month": 1, "ghi": 2.1, "temperature": 16.5, "wind_speed": 2.3, "humidity": 80.1 },
    ...
    { "month": 12, "ghi": 2.4, "temperature": 17.8, "wind_speed": 2.2, "humidity": 79.5 }
  ]
}
```

**錯誤**：`404` 資料庫無此鄉鎮市資料（未匯入或代碼錯誤）

---

### `GET /api/vendors?county=<縣市>&limit=3`
依服務縣市取得推薦廠商。未帶 `county` 時回傳預設推薦；Results 頁會依 API 狀態顯示 loading / empty / error。

**Response**：

```json
[
  {
    "id": "north-grid",
    "name": "北曜能源工程",
    "counties": ["台北市", "新北市"],
    "portfolioTitle": "信義區集合住宅屋頂型案場",
    "portfolioMeta": "住宅大樓 · 22.4 kWp · 2025 完工",
    "capacityKw": 22.4,
    "rating": 4.8,
    "reviewCount": 36,
    "phone": "02-2758-6108",
    "email": "hello@northgrid.example",
    "tags": ["集合住宅", "結構評估", "台電併聯"]
  }
]
```

---

### `GET /api/vendors/{id}`
取得單一廠商詳細資料，包含基本資料與作品集列表。Results 頁的廠商詳細 Modal 使用此 endpoint。

**Response**：同 `GET /api/vendors` 單筆資料，並額外包含：

```json
{
  "approved": true,
  "subscriptionStatus": "mock",
  "portfolios": [
    {
      "id": "<uuid>",
      "title": "信義區集合住宅屋頂型案場",
      "meta": "住宅大樓 · 22.4 kWp · 2025 完工",
      "capacityKw": 22.4,
      "completedYear": 2025,
      "isFeatured": true
    }
  ]
}
```

---

### `POST /api/vendors/apply`
廠商入駐申請。申請送出後寫入 `vendors`，預設 `approved = false`、`application_status = pending`，不會公開出現在推薦列表。

**Request body**：

```json
{
  "company_name": "範例能源工程",
  "company_tax_id": "12345678",
  "contact_name": "王小明",
  "email": "vendor@example.com",
  "phone": "02-1234-5678",
  "counties": ["台北市", "新北市"],
  "license_note": "電業相關執照與備註"
}
```

**Response**：`{ "id": "vendor-...", "status": "pending" }`

---

### 廠商儀表板（Bearer JWT，廠商本人）

#### `GET /api/me/vendor`
取得自己的廠商資料與作品集。帳號未綁定廠商時回傳 `404`。

#### `PATCH /api/me/vendor`
更新廠商資料（名稱、電話、email、服務縣市、標籤）。

#### `POST /api/me/vendor/portfolios`
新增作品集項目。request body：`{ title, meta, capacityKw?, completedYear? }`

#### `DELETE /api/me/vendor/portfolios/{portfolio_id}`
刪除作品集項目（含 vendor_id 安全檢查，只能刪自己的）。

#### `GET /api/me/vendor/inquiries?limit=50`
取得收到的詢價紀錄，LEFT JOIN accounts 取得詢問者 email。

#### `POST /api/vendors/{id}/inquire`
民眾聯絡廠商時呼叫，fire-and-forget 儲存詢價紀錄。可選 Bearer JWT（登入時附帶 account_id）。

---

### Admin（Bearer JWT role=admin，或 `X-Admin-Secret` header）

開發測試預設 `ADMIN_SECRET = dev-admin-secret`。

#### `GET /api/admin/vendors/pending`
取得待審核廠商申請列表（`application_status = pending`）。

#### `POST /api/admin/vendors/{id}/approve`
核准廠商：`approved = true`、`application_status = approved`。
若廠商已綁定帳號，**同一 transaction** 自動將帳號 role 升為 `vendor`。

#### `POST /api/admin/vendors/{id}/reject`
退回廠商申請，可附退回原因：`{ "reason": "資料不完整" }`

#### `GET /api/admin/accounts/search?email=`
依 Email 查詢帳號，回傳 `{ id, email, role }`。用於管理後台帳號管理。

#### `POST /api/admin/accounts/{id}/role`
調整帳號角色。可設 `user`、`vendor`、`admin`；帳號需重新登入才會生效。

```json
{ "role": "admin" }
```

---

## 陰影載入流程（兩階段）

移動地圖後，前端用兩個並行 fetch 分擔等待時間：

```
移動地圖
  │
  ├─ Phase 1 → POST /api/shadows/from-features  (只算當前 1 小時，~300 ms)
  │             → 立刻顯示陰影，隱藏 spinner
  │
  └─ Phase 2 → POST /api/shadows/precompute     (算全天 14 小時，2–5 s 或 DB cache 秒回)
                → 完成後填入 cacheRef，更新顯示；拉滑桿從此瞬間回應
```

**`phase2Done` 旗標**：若 Phase 2（DB cache hit 時 ~5 ms）比 Phase 1 先回來，旗標會阻止 Phase 1 用舊資料覆蓋已顯示的正確結果。

---

## 連線設定

```
DATABASE_URL=postgresql://<user>:<password>@<host>/neondb?sslmode=require&channel_binding=require
```

放在 `backend/.env`，由 `load_dotenv(Path(__file__).parent / '.env')` 在啟動時載入。

連線池：`min_size=1, max_size=5`（相容 Neon serverless 免費方案的連線數限制）。

> **Neon 免費方案 cold start**：Neon 在無流量時會自動暫停資料庫，第一次請求需要 1–2 秒喚醒。之後維持活躍狀態不受影響。後端已做 graceful fallback：DB 無法連線時會印出警告並繼續以無 DB 模式運行（陰影仍可計算，只是不快取）。

---

## 初始化

後端啟動時 `lifespan` 自動執行 `init_db()`：
- `CREATE TABLE IF NOT EXISTS` — 首次啟動建表（含 3 張新表）
- `ALTER TABLE ADD COLUMN IF NOT EXISTS` — 相容舊版 schema，補齊新欄位
- seed mock 廠商資料至 `vendors` / `vendor_portfolios`

不需要手動執行 migration。

---

## 一次性前置作業（本機執行）

### 1. DEM 降采樣
```bash
cd solar_money
python scripts/build_dem_cache.py
```
輸入：`data/不分幅_全台20MDEM(2025)/DEM_tawiwan_V2025.tif`（721.8 MB GeoTIFF）  
輸出：`data/taiwan_dem_100m.npy`（~14–34 MB）+ `data/taiwan_dem_meta.npy`  
後端啟動時自動 `load_dem()` 載入 RAM，不存 DB。  
依賴：`pip install rasterio`

### 2. 氣候資料匯入
```bash
cd solar_money
python scripts/import_climate.py
```
輸入：既有兩份 CSV（`data/climate/`）  
輸出：寫入 `climate_annual`（368 筆）+ `climate_monthly`（4,416 筆）至 Neon  
依賴：`DATABASE_URL` 環境變數

### 3. NLSC LoD1（自動 on-demand）
`shadow.py` 的 `get_buildings()` 會在 bbox 查詢時自動：
1. 查 `climate_annual` 找最近鄉鎮市（centroid 最短距離）
2. 查 `nlsc_lod1_cache`（cache hit → 直接返回）
3. cache miss → 呼叫 NLSC I3S API → 寫入 cache
4. NLSC 連線失敗 → fallback to OSM Overpass API
