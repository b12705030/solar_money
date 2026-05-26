# Solar Money — 功能路線圖

> 更新：2026-05-27  
> 新 branch 一律從 `main` 建立：`git checkout main && git pull && git checkout -b feature/X`

---

## 狀態總覽

| 優先 | 功能 | Branch | 狀態 |
|------|------|--------|------|
| P1 | PDF 下載 | `feature/pdf-export` | ✅ 已完成 |
| P2 | 預算流程調整 | `feature/budget-flow` | ✅ 已完成 |
| P2 | 地區自動建議目標 | `feature/budget-flow` | ✅ 已完成 |
| P2 | 補助資訊來源 + 更新日期 + 公告連結 | `feature/budget-flow` | ✅ 已完成 |
| P3 | 會員系統（登入/註冊） | `feature/auth` | ✅ 已完成 |
| P3 | 帳號角色基礎 | `feature/auth` | ✅ 已完成 |
| P3 | 歷史評估 UI + 帳號綁定 | `feature/auth` | ✅ 已完成 |
| P3 | 並排比較 | `feature/auth` | ✅ 已完成 |
| P3 | 分享連結 | — | ⬜ 未開始 |
| P4 | 廠商系統基礎版 | `feature/vendor-system` | ✅ 已完成 |
| P4 | 廠商 Logo 上傳 | `feature/vendor-system` | ✅ 已完成 |
| P4 | 廠商重新申請（被拒後） | `feature/vendor-system` | ✅ 已完成 |
| P4 | 作品集 CRUD（施工照 + 規格 + 客戶描述） | `feature/vendor-system` | ✅ 已完成 |
| P4 | 廠商訂閱方案（UI 架構） | `feature/vendor-system` | 🔧 部分（DB 欄位完成，付款未接） |
| P4 | 評估結果廠商推薦 | `feature/vendor-system` | ✅ 已完成 |
| P5 | 站內詢價 Modal（取代 mailto） | `feature/messaging` | ✅ 已完成 |
| P5 | 廠商端 1 對 1 聊天收件箱 | `feature/messaging` | ✅ 已完成 |
| P5 | 案件狀態機（新詢價/已聯繫/已報價/已成交） | `feature/messaging` | ✅ 已完成 |
| P5 | 廠商端自動推進狀態（回覆後 → 已聯繫） | `feature/messaging` | ✅ 已完成 |
| P5 | 用戶端「我的詢價」抽屜 | `feature/messaging` | ✅ 已完成 |
| P5 | 用戶端廠商評價（1–5 星） | `feature/messaging` | ✅ 已完成 |
| P5 | 進階方案 — 潛在客戶名單 | `feature/messaging` | ✅ 已完成 |
| P6 | 平台後台 — 廠商審核 UI | `feature/admin` | ✅ 核准/拒絕 API 完成 |
| P6 | 平台後台 — 數據儀表板 | — | ⬜ 未開始 |
| P6 | 補助資料後台管理 | — | ⬜ 未開始 |
| P7 | NLSC LoD1 官方建物資料整合 | `feature/lod1-tmy-dem` | ✅ 已完成 |
| P7 | DEM 數值地形模型（100m，RAM 常駐） | `feature/lod1-tmy-dem` | ✅ 已完成 |
| P7 | NASA POWER 13 年氣候月典型值（TMY） | `feature/lod1-tmy-dem` | ✅ 已完成（匯入 DB） |
| P7 | 前端整合月均 GHI 取代靜態 TW_IRRADIANCE | `feature/lod1-tmy-dem` | ⬜ 未開始 |

---

## P1 · feature/pdf-export　✅ 已完成

**目標：** 不需 auth、高轉換率，替代分享連結，一鍵下載一頁式 A4 評估報告

- [x] `src/components/PrintReport.tsx` — 獨立列印版面，與網頁 UI 完全分離
- [x] `@media print` CSS：隱藏 `.screen-only`，顯示 `.print-report`
- [x] `@page { size: A4; margin: 6mm 10mm }` 窄邊界，報告塞進一頁
- [x] `MetricBox` 加 `prefix` prop，修正 NT$ 換行問題
- [x] Results.tsx：「下載評估報告」按鈕觸發 `window.print()`
- [x] tab-panel 改 CSS show/hide，保證兩個 tab 都渲染在 DOM

---

## P2 · feature/budget-flow　✅ 已完成

**目標：** 預算上限倒推容量比單價滑桿更直覺；補全補助顯示資訊

- [x] **預算流程調整** — `StepParams` 改為預算滑桿（5萬–80萬）+ 三張等級卡片（入門/標準/高效），每張即時顯示該預算可裝容量
- [x] **地區自動建議目標** — `StepGoal` 依地區（北部→夏季 / 南部→全年 / 中部→匹配）自動預選，並標示「推薦」
- [x] **補助資訊來源 + 更新日期** — `SUBSIDIES` 加 `updatedAt` 欄位，費用摘要卡片顯示「來源 · 金額 · 資料更新日期」
- [x] **補助公告連結** — `SUBSIDIES` 加 `url` 欄位，`StepParams` 費用摘要顯示「查看補助公告」外連結（22 縣市全部補全）

---

## P3 · feature/auth　✅ 已完成

**目標：** 會員系統是後續廠商媒合、歷史紀錄的基礎

### 會員系統（登入/註冊）
- [x] 登入 / 註冊 Modal（Email + 密碼）
- [x] TopBar 顯示登入狀態（頭像 / 登出）
- [x] 後端：`POST /api/auth/register`、`POST /api/auth/login`（JWT + role）
- [x] 資料庫：`accounts` 表（id, email, password_hash, role, created_at）
- [x] 角色基礎：`user` / `vendor` / `admin`
- [x] TopBar 顯示目前角色，方便測試三種身份
- [x] 管理測試 API：`POST /api/admin/accounts/{id}/role`
- [ ] Google OAuth（可選，尚未排入）

### 歷史評估 UI + 帳號綁定
- [x] 歷史評估列表 Drawer（日期 / 地址 / 回本年限 / 容量）
- [x] Results CTA：「儲存評估結果」未登入時顯示右下角提示並開啟登入 Modal
- [x] 匿名 UUID 評估綁定至帳號（assessments 加 `account_id` FK，nullable）
- [x] 登入後自動 claim 匿名評估：`POST /api/me/claim?user_id=<uuid>`
- [x] 後端：`GET /api/me/assessments`

### 並排比較
- [x] 最多選 2 筆評估，左右欄對照關鍵指標（地址 / 縣市 / 容量 / 年發電量 / 回本 / 自付）

### 分享連結
- [ ] 產生可分享連結，方便傳給家人討論

---

## P4 · feature/vendor-system　✅ 核心功能已完成

**目標：** 廠商入駐與媒合，讓完成評估的用戶能直接找到廠商

### 廠商系統基礎版
- [x] TopBar「廠商入駐」入口
- [x] 廠商申請 Modal（公司名、統編、聯絡人、Email、電話、服務縣市、執照備註）
- [x] **Logo 上傳**：申請時可上傳 Logo（base64 DataURL，存 `logo_url` TEXT 欄位）
- [x] **廠商後台 – 修改資料**：申請後可編輯公司資料 + 重新上傳 Logo
- [x] **被拒後可重新申請**：申請 Modal 偵測 `rejected` 狀態，顯示拒絕原因並允許修改後重送
- [x] 後端：`POST /api/vendors/apply`（建立 `pending` 廠商）；`PATCH /api/me/vendor`（更新資料）
- [x] 後端：`GET /api/me/application/status`（給 modal 判斷目前狀態）
- [x] 後端：`POST /api/me/vendor/logo`（獨立更新 logo）
- [x] 管理員審核 API（核准 / 拒絕 + `rejection_reason` 欄位）
- [ ] 完整後台人工審核 UI（目前靠 API 手動操作）

### 作品集
- [x] `vendor_portfolios` 表（id, vendor_id, title, meta, capacity_kw, completed_year, is_featured, photo_url, description）
- [x] 後端：`POST /api/me/vendor/portfolios`、`DELETE /api/me/vendor/portfolios/{id}`
- [x] **施工照上傳**：base64 DataURL，儲存至 `photo_url`；卡片展示縮圖
- [x] **規格欄位**：容量 (kWp)、完工年份
- [x] **客戶描述**：自由文字，說明建築類型、挑戰與解法
- [x] 廠商詳細 Modal 顯示作品集（含縮圖、規格、完工年）
- [x] 進階方案廠商排序優先（`subscription_status` 欄位，`mock`/`advanced` 優先展示）

### 廠商訂閱方案
- [x] `subscription_status` 欄位（`free` / `mock` / `advanced`）已加入 DB
- [ ] 付款串接（ECPay / Stripe）— 尚未排入
- [ ] 方案說明頁面

### 評估結果廠商推薦
- [x] Results 頁底部「推薦廠商」區塊（依縣市篩選，最多 3 家，進階方案優先）
- [x] 資料庫：`vendors`、`vendor_portfolios`
- [x] 後端：`GET /api/vendors?county=xx`、`GET /api/vendors/{id}`
- [x] 廠商詳細 Modal（基本資料、服務縣市、聯絡資訊、作品集含施工照）
- [x] 未登入點擊「聯絡廠商」觸發登入提示
- [x] 已登入點擊「聯絡廠商」→ 開啟站內詢價 Modal（已取代 mailto）

---

## P5 · feature/messaging　✅ 核心功能已完成

**目標：** 站內詢價與溝通，閉合用戶→廠商的轉換迴路

### 站內詢價 Modal
- [x] Results 廠商推薦「聯絡廠商」開啟 `InquiryModal`（取代 mailto 流程）
- [x] Modal 顯示廠商資訊 + 評估摘要（容量 / 年發電量 / 回本 / 自付）+ 訊息輸入框
- [x] 後端：`POST /api/vendors/{id}/inquire`（建立 inquiry，帶入 assessment 資料）
- [x] 資料庫：`inquiries` 表（含 `message`, `vendor_reply`, `replied_at`, `case_status`, `inquirer_email`）
- [x] 送出後顯示 toast 確認訊息

### 廠商端收件箱（1 對 1 聊天室）
- [x] **兩欄式佈局**：左側聯絡人列表（280px，含狀態徽章 + 訊息預覽），右側聊天窗口
- [x] 聊天窗口：標題顯示聯絡人 Email + 房屋資訊 chips（地址/縣市/kWp/kWh/回本）
- [x] 聊天窗口：「評估資料」系統卡、用戶訊息氣泡（左側）、廠商回覆氣泡（右側）
- [x] 聊天窗口：回覆輸入框（Ctrl+Enter 送出）
- [x] 後端：`POST /api/me/vendor/inquiries/{id}/reply`（寫入 `vendor_reply` + `replied_at`）

### 案件狀態機
- [x] 狀態：`new`（新詢價）→ `contacted`（已聯繫）→ `quoted`（已報價）→ `closed`（已成交）
- [x] 廠商回覆後自動從 `new` 推進至 `contacted`
- [x] 廠商可手動透過 dropdown 更改狀態
- [x] 後端：`PATCH /api/me/vendor/inquiries/{id}/status`
- [x] 收件箱頂部統計看板（各狀態件數）
- [x] 聯絡人列表顯示彩色狀態徽章

### 用戶端「我的詢價」
- [x] HistoryDrawer 新增「我的詢價」tab
- [x] 顯示每筆詢價：廠商 Logo/名稱、評估摘要 chips、我的訊息、廠商回覆（綠色卡）
- [x] 後端：`GET /api/me/inquiries`

### 廠商評價
- [x] 廠商回覆後，用戶端顯示 1–5 星評分 UI（星形按鈕 + hover 效果）
- [x] 送出評價後廠商平均評分即時更新
- [x] 後端：`POST /api/me/inquiries/{id}/review`
- [x] 資料庫：`vendor_reviews` 表（id, vendor_id, inquiry_id, rating, created_at，UNIQUE on inquiry_id）
- [x] 已評價顯示目前給星數

### 潛在客戶名單（進階方案功能）
- [x] 廠商後台「潛在客戶」tab：服務縣市內完成評估但未向本廠商詢價的用戶
- [x] 後端：`GET /api/me/vendor/leads`（JOIN assessments + accounts，排除已詢價用戶）
- [x] 免費方案：顯示前 3 筆，其餘加鎖 + 升級橫幅
- [x] 進階方案（`mock`/`advanced`）：顯示全部
- [x] Lead 卡片：Email、縣市、容量、年發電量、回本年數、自付金額

---

## P6 · feature/admin　⬜ 部分完成

**目標：** 前面功能穩定後才有管理需求

- [x] Admin JWT middleware（角色驗證；亦保留 `X-Admin-Secret` 供開發測試）
- [x] 後端：廠商核准/拒絕 API（`POST /api/admin/vendors/{id}/approve`、`/reject`）
- [ ] 前台廠商審核 UI（pending 列表、核准/拒絕按鈕、填寫拒絕原因）
- [ ] 補助資料管理（各縣市金額從 DB 讀取，可線上編輯，取代 hardcode）
- [ ] 數據儀表板：日/週/月評估次數、縣市分布、廠商詢價轉換率、MRR
- [ ] 後端：`GET /api/admin/stats`、`GET/PUT /api/admin/subsidies`

---

---

## P7 · feature/lod1-tmy-dem　✅ 後端已完成，前端待整合

**目標：** 以官方資料取代估算值，提升太陽能預測精度（教授建議項目）

### NLSC LoD1 官方建物資料
- [x] `scripts/fetch_nlsc_lod1.py` — NLSC I3S v1.8 REST API 擷取模組
  - nodepages 遍歷找 leaf node（OBB 與 bbox 相交篩選）
  - binary geometry 解碼（footprint = 地板面 convex hull）
  - attribute f_9 解碼（BUILD_H = 官方建物高度）
- [x] `backend/shadow.py` — `get_buildings()` 改為 NLSC I3S 優先，OSM 備援
  - `_get_township_info()` 查 `climate_annual` centroid 找最近鄉鎮市
  - NLSC cache miss → 呼叫 I3S API → 寫入 `nlsc_lod1_cache`
  - NLSC 連線失敗 → fallback to OSM Overpass
- [x] `backend/db.py` — `nlsc_lod1_cache` 表（township 為單元，永不過期）

### DEM 數值地形模型
- [x] `scripts/build_dem_cache.py` — 20m GeoTIFF rasterio average 降采樣至 100m `.npy`
- [x] `scripts/upload_dem.py` — 上傳 `.npy` 至 Neon `dem_cache`（bytea 28.9 MB）
- [x] `backend/shadow.py` — `load_dem()` 非同步載入（本機 .npy → DB fallback，自動寫回）
- [x] `backend/shadow.py` — `get_elevation(lat, lng)` TWD97 索引查詢，O(1) numpy
- [x] `data/taiwan_dem_100m.npy` 進 repo（28.9 MB，clone 即用）

### TMY 長期氣象年資料（NASA POWER 13 年月均值）
- [x] `scripts/import_climate.py` — 匯入 `taiwan_climate_annual.csv`（368 筆）+ `nasa_power_monthly_raw.csv`（groupby 13 年月均）
- [x] `backend/db.py` — `climate_annual`（368 筆）、`climate_monthly`（4,416 筆）
- [x] `backend/main.py` — `GET /api/climate/{township_code}` 提供年均 + 12 月典型值
- [ ] `src/lib/compute.ts` — 改用 API 鄉鎮月均 GHI 取代靜態 `TW_IRRADIANCE` 常數
- [ ] 前端快取 `/api/climate` 回應，避免每次 Step 3 重複請求

---

## 未來小改動（無專屬 branch）

| 項目 | 說明 |
|------|------|
| Email 通知 | 廠商收到新詢價 / 用戶收到回覆時發 Email |
| 分享連結 | 產生可分享連結，方便傳給家人討論 |
| 碳減排計算 | 年發電量 × 0.495 kgCO₂/度，顯示在 Results |
| FIT 費率對照表 | 各容量級距費率 tooltip，取代 hardcode 5.7 元 |
| 年衰退率 UI | 目前 hardcode 0.5%，開放用戶調整 |
| 推薦廠商入 PDF | 評估報告末頁附推薦廠商聯絡資訊 |
| Google OAuth | 降低用戶註冊門檻 |
| 付款串接 | ECPay / Stripe 廠商訂閱付款 |
