# Solar Money — 功能路線圖

> 更新：2026-04-26  
> 新 branch 一律從 `main` 建立：`git checkout main && git pull && git checkout -b feature/X`

---

## 狀態總覽

| 優先 | 功能 | Branch | 狀態 |
|------|------|--------|------|
| P1 | PDF 下載 | `feature/pdf-export` | ✅ 待 merge |
| P2 | 預算流程調整 | `feature/budget-flow` | ✅ 待 commit |
| P2 | 地區自動建議目標 | `feature/budget-flow` | ✅ 已完成 |
| P2 | 補助資訊來源 + 更新日期 | `feature/budget-flow` | ✅ 待 commit |
| P3 | 會員系統（登入/註冊） | `feature/auth` | ✅ 已完成 |
| P3 | 歷史評估 UI + 帳號綁定 | `feature/auth` | ✅ 已完成 |
| P3 | 並排比較 | `feature/auth` | ✅ 已完成 |
| P3 | 分享連結 | `feature/auth` | ⬜ 未開始 |
| P4 | 廠商系統基礎版 | `feature/vendor-system` | ✅ 申請 MVP 完成 |
| P4 | 廠商訂閱方案 | `feature/vendor-system` | ⬜ 未開始 |
| P4 | 評估結果廠商推薦 | `feature/vendor-system` | ✅ 詳細頁基礎版完成 |
| P5 | 站內訊息 | `feature/messaging` | ⬜ 未開始 |
| P5 | 廠商評價機制 | `feature/messaging` | ⬜ 未開始 |
| P6 | 平台後台 | `feature/admin` | ⬜ 未開始 |

---

## P1 · feature/pdf-export　✅ 待 merge

**目標：** 不需 auth、高轉換率，替代分享連結，一鍵下載一頁式 A4 評估報告

- [x] `src/components/PrintReport.tsx` — 獨立列印版面，與網頁 UI 完全分離
- [x] `@media print` CSS：隱藏 `.screen-only`，顯示 `.print-report`
- [x] `@page { size: A4; margin: 6mm 10mm }` 窄邊界，報告塞進一頁
- [x] `MetricBox` 加 `prefix` prop，修正 NT$ 換行問題
- [x] Results.tsx：「下載評估報告」按鈕觸發 `window.print()`
- [x] tab-panel 改 CSS show/hide，保證兩個 tab 都渲染在 DOM

---

## P2 · feature/budget-flow　✅ 待 commit

**目標：** 預算上限倒推容量比單價滑桿更直覺；補全補助顯示資訊

- [x] **預算流程調整** — `StepParams` 改為預算滑桿（5萬–80萬）+ 三張等級卡片（入門/標準/高效），每張即時顯示該預算可裝容量
- [x] **地區自動建議目標** — `StepGoal` 依地區（北部→夏季 / 南部→全年 / 中部→匹配）自動預選，並標示「推薦」
- [x] **補助資訊來源 + 更新日期** — `SUBSIDIES` 加 `updatedAt` 欄位，費用摘要卡片顯示「來源 · 金額 · 資料更新日期」

---

## P3 · feature/auth　✅ 部分完成

**目標：** 會員系統是後續廠商媒合、歷史紀錄的基礎

### 會員系統（登入/註冊）
- [x] 登入 / 註冊 Modal（Email + 密碼）
- [x] TopBar 顯示登入狀態（頭像 / 登出）
- [x] 後端：`POST /api/auth/register`、`POST /api/auth/login`（JWT）
- [x] 資料庫：`accounts` 表（id, email, password_hash, created_at）
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

## P4 · feature/vendor-system　⬜ 未開始

**目標：** 廠商入駐與媒合，讓完成評估的用戶能直接找到廠商

### 廠商系統基礎版
- [x] TopBar「廠商入駐」入口
- [x] 廠商註冊申請表單（公司名、統編、聯絡人、Email、電話、服務縣市、執照備註）
- [x] 後端：`POST /api/vendors/apply`，建立 `approved = false` / `application_status = pending` 廠商
- [ ] 作品集 CRUD（照片 / 容量 / 地點 / 完工年份）
- [ ] 後台人工審核（admin approve 後才公開）
- [ ] 後端：`POST /api/vendors`、`GET/PUT /api/vendors/:id`
- [ ] 資料庫：`vendors` 表、`vendor_portfolios` 表

### 廠商訂閱方案
- [ ] 三種方案：免費（基本曝光）/ 基本（聯繫解鎖）/ 進階（首位推薦 + 數據報表）
- [ ] 廠商 Dashboard：帳號管理、方案狀態、收到的案件列表

### 評估結果廠商推薦
- [x] Results 頁底部「推薦廠商」區塊（依縣市篩選，最多 3 家）
- [x] 資料庫：`vendors`、`vendor_portfolios`
- [x] 後端：`GET /api/vendors?county=xx`
- [x] 後端：`GET /api/vendors/{id}`
- [x] 前端：Results 從 API 讀取廠商，含 loading / empty / error 狀態
- [x] 移除前端廠商 mock fallback；本地測試資料由後端 seed
- [x] 廠商詳細 Modal（基本資料、服務縣市、聯絡資訊、作品集）
- [x] 未登入點擊「聯絡廠商」會觸發登入提示
- [x] 已登入點擊「聯絡廠商」先以 mailto 帶入評估摘要
- [ ] 廠商頁面與站內訊息完成後，移除 mailto 暫代流程，改為站內詢價 Modal / 訊息流程

---

## P5 · feature/messaging　⬜ 未開始

**目標：** 站內詢價與溝通，閉合用戶→廠商的轉換迴路

### 站內訊息
- [ ] Results 頁「向廠商詢價」按鈕（附帶評估摘要）
- [ ] 取代 Results 推薦廠商 mock 版的 mailto 流程，送出站內詢價單
- [ ] 詢價表單（描述 + 聯絡偏好）＋送出後顯示案件編號
- [ ] 廠商端：收件箱 + 回覆輸入框
- [ ] 用戶端：查看廠商回覆（需登入）
- [ ] 案件狀態機：`new → replied → quoted → closed`
- [ ] Email 通知（廠商收到新詢價 / 用戶收到回覆）
- [ ] 後端：`POST /api/inquiries`、`POST /api/inquiries/:id/reply`
- [ ] 資料庫：`inquiries` 表、`inquiry_replies` 表

### 廠商評價機制
- [ ] 案件 `closed` 後開放用戶評分（1–5 星 + 文字）
- [ ] 廠商頁顯示平均評分與評論列表
- [ ] 後端：`POST /api/inquiries/:id/review`
- [ ] 資料庫：`vendor_reviews` 表（id, vendor_id, inquiry_id, rating, comment, created_at）

---

## P6 · feature/admin　⬜ 未開始

**目標：** 前面功能穩定後才有管理需求

- [ ] 廠商審核介面（pending / approved / rejected + 備註）
- [ ] 補助資料管理（各縣市金額從 DB 讀取，可線上編輯，取代 hardcode）
- [ ] 數據儀表板：日/週/月評估次數、縣市分布、廠商詢價轉換率、MRR
- [ ] Admin JWT middleware（角色驗證）
- [ ] 後端：`GET /api/admin/stats`、`GET/PUT /api/admin/subsidies`

---

## 未來小改動（無專屬 branch）

| 項目 | 說明 |
|------|------|
| 碳減排計算 | 年發電量 × 0.495 kgCO₂/度，顯示在 Results |
| FIT 費率對照表 | 各容量級距費率 tooltip，取代 hardcode 5.7 元 |
| 年衰退率 UI | 目前 hardcode 0.5%，開放用戶調整 |
| 推薦廠商入 PDF | 評估報告末頁附推薦廠商聯絡資訊 |
