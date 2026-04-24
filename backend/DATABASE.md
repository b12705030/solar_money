# 資料庫架構說明

## 技術選型

| 功能 | 選擇 | 原因 |
|------|------|------|
| 永久儲存 | PostgreSQL (Neon) | 結構化查詢、JSONB 支援、免費 serverless 方案 |
| 短期快取 | PostgreSQL shadow_cache | 現階段流量低，不需要另外架 Redis；若日後需要水平擴展可再加 |

> **為什麼不用 Redis？** 目前的 `shadow_cache` 以月份為粒度，同一區域一個月只算一次，命中率高且不需要 sub-second 過期精度。PostgreSQL 的查詢延遲（~5ms）對這個場景已足夠。

---

## 資料表

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
| `result` | JSONB | 完整月發電量陣列等彈性資料 |
| `created_at` | TIMESTAMPTZ | 評估時間 |

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
- `CREATE TABLE IF NOT EXISTS` — 首次啟動建表
- `ALTER TABLE ADD COLUMN IF NOT EXISTS` — 相容舊版 schema，補齊新欄位

不需要手動執行 migration。
