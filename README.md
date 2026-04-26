# 屋頂太陽能可行性評估工具

台灣屋頂太陽能自助評估系統，整合 3D 地圖陰影分析、各縣市政府補助資料、台電躉購費率，讓使用者在 5 分鐘內完成評估。

---

## 功能總覽

| 功能 | 說明 |
|------|------|
| 地址搜尋 | Google Places API 自動完成，限台灣地區 |
| 建物偵測 | 點選地址後自動從 Mapbox 3D 圖層或 OSM 取得建物高度與基地面積 |
| 3D 陰影預覽 | 依太陽位置即時計算周圍建物陰影（pvlib NREL SPA），可拖曳時間軸 6–19 時 |
| 用電量輸入 | 輸入每月平均用電 kWh |
| 目標選擇 | 全年最大、夏季最大、冬季最大、正午峰值、與用電曲線最匹配、投資回收最快；依地區自動推薦 |
| 裝機參數 | 預算上限倒推可裝容量；三種面板等級（入門 / 標準 / 高效）即時試算 |
| 補助快查 | 自動對應 22 縣市政府補助金額（含來源、資料更新日期、補助公告連結） |
| 評估結果 | 年發電量、能源自給率、回本年限、20 年累計淨收益、月發電量圖表 |
| PDF 報告 | 一鍵下載一頁式 A4 評估報告（`window.print()`，無額外依賴） |
| 推薦廠商 | Results 頁依縣市從 API 顯示最多 3 家廠商（進階方案優先排序）；含 loading / empty / error 狀態 |
| 廠商入駐 | TopBar 提供廠商申請表單（含 Logo 上傳），送出後進入待審核；被拒可查看原因並重新申請 |
| 廠商儀表板 | 廠商後台：編輯資料（含 Logo）、管理作品集（施工照 + 規格 + 客戶描述） |
| 站內詢價 Modal | 已登入用戶點擊「聯絡廠商」後開啟含評估摘要的詢價表單（取代 mailto） |
| 廠商聊天收件箱 | 1 對 1 聊天室：左側聯絡人列表（含狀態徽章），右側顯示評估資料 + 訊息氣泡 + 回覆輸入框 |
| 案件狀態追蹤 | 新詢價 → 已聯繫 → 已報價 → 已成交；廠商回覆後自動推進；可手動調整 |
| 廠商評價機制 | 廠商回覆後用戶可給予 1–5 星評價；廠商頁即時更新平均評分 |
| 潛在客戶名單 | 廠商後台進階功能：顯示服務縣市內完成評估但未詢價的用戶；免費方案顯示前 3 筆 |
| 我的詢價紀錄 | 用戶端歷史抽屜「我的詢價」tab：查看廠商回覆、送出星級評價 |
| Admin 管理面板 | Admin 後台：廠商審核（核准／駁回 + 原因）、帳號管理與角色切換 |
| 歷史紀錄 | 每次評估自動儲存至 PostgreSQL，支援匿名模式與登入帳號 |
| 會員系統 | Email 註冊 / 登入（JWT + role），登入後可查看歷史紀錄、並排比較兩筆評估 |

---

## 技術架構

```
瀏覽器（React / Next.js）
  │
  ├─ Mapbox GL JS         3D 建物渲染、陰影圖層
  ├─ Google Places API    地址自動完成
  │
  └─ HTTP（fetch）
        │
        ▼
後端（FastAPI / Python）
  │
  ├─ pvlib NREL SPA       太陽方位角、仰角計算
  ├─ Shapely + pyproj     陰影多邊形幾何計算（EPSG:4326 ↔ 3857）
  ├─ httpx → Overpass API OSM 建物資料（備援用）
  ├─ bcrypt               密碼雜湊（直接使用，不透過 passlib）
  ├─ python-jose          JWT 簽發與驗證
  │
  └─ asyncpg
        │
        ▼
PostgreSQL（Neon serverless）
  ├─ osm_cache            OSM 建物資料（7 天 TTL）
  ├─ shadow_cache         陰影預計算結果（月份粒度）
  ├─ accounts             會員帳號與角色（user / vendor / admin）
  ├─ assessments          使用者評估紀錄（匿名 or 帳號綁定）
  ├─ vendors              廠商基本資料、服務縣市、評分、訂閱狀態
  ├─ vendor_portfolios    廠商作品集案例（含施工照 photo_url、客戶描述）
  ├─ inquiries            民眾詢價紀錄（含 case_status 案件狀態機）
  └─ vendor_reviews       廠商評價（inquiry_id UNIQUE，評完不可重複）
```

詳細資料庫架構見 [backend/DATABASE.md](backend/DATABASE.md)。

產品功能規格見 [SPEC.md](SPEC.md)，開發排程與優先順序見 [ROADMAP.md](ROADMAP.md)。

---

## 專案結構

```
solar_money/
│
├─ src/                          前端（Next.js App Router）
│   ├─ app/
│   │   ├─ page.tsx              主入口，管理 wizard 步驟 + auth modal/drawer 狀態
│   │   ├─ layout.tsx            HTML head、字體載入、全域 Providers 包層
│   │   ├─ providers.tsx         client-side 全域 providers（AuthProvider）
│   │   ├─ globals.css           全域樣式、CSS 變數、元件 class
│   │   ├─ vendor/page.tsx       廠商後台頁面 /vendor（role=vendor 限定）
│   │   └─ admin/page.tsx        管理後台頁面 /admin（role=admin 限定）
│   ├─ contexts/
│   │   └─ AuthContext.tsx       React Context：login / register / logout + localStorage JWT
│   ├─ screens/
│   │   ├─ Landing.tsx           首頁
│   │   ├─ StepAddress.tsx       Step 1：地址搜尋 + 地圖 + 陰影預覽
│   │   ├─ StepUsage.tsx         Step 2：每月用電量
│   │   ├─ StepGoal.tsx          Step 3：發電目標選擇（含地區推薦）
│   │   ├─ StepParams.tsx        Step 4：預算滑桿 + 面板等級 + 費用試算
│   │   └─ Results.tsx           評估結果頁，自動儲存至 DB，含 PDF 觸發 + 登入提示
│   ├─ components/
│   │   ├─ MapView.tsx           Mapbox 地圖 + 3D 陰影計算主元件
│   │   ├─ PrintReport.tsx       PDF 列印版面（僅 @media print 顯示，獨立於網頁 UI）
│   │   ├─ AuthModal.tsx         登入 / 註冊 Modal
│   │   ├─ HistoryDrawer.tsx     歷史評估 Drawer，含並排比較
│   │   ├─ VendorApplyModal.tsx  廠商入駐申請 Modal（已登入者自動帶入 email，未登入者引導登入）
│   │   ├─ DashLayout.tsx        廠商/管理後台共用佈局（可收折側欄 + monochrome SVG icon）
│   │   ├─ Slider.tsx            可重用滑桿元件
│   │   ├─ TopBar.tsx            頂部導覽列（登入狀態、角色對應按鈕）
│   │   ├─ Footer.tsx            頁腳
│   │   ├─ ProgressBar.tsx       步驟進度條
│   │   ├─ WizardFooter.tsx      上一步 / 下一步按鈕
│   │   ├─ TweaksPanel.tsx       主題 / 密度設定面板
│   │   └─ ui.tsx                共用 UI 元件（Info tooltip 等）
│   └─ lib/
│       ├─ auth.ts               AuthUser 型別 + localStorage 讀寫工具
│       ├─ compute.ts            核心試算邏輯（發電量、回本年限等）
│       ├─ constants.ts          縣市補助、面板等級、日照資料、步驟定義
│       ├─ types.ts              TypeScript 型別
│       └─ theme.ts              主題切換工具
│
├─ backend/                      後端（FastAPI / Python）
│   ├─ main.py                   API 路由、FastAPI app 設定
│   ├─ auth.py                   JWT 工具 + bcrypt 密碼雜湊
│   ├─ shadow.py                 陰影計算核心（pvlib + Shapely）
│   ├─ db.py                     PostgreSQL 連線池、cache 操作、帳號與評估查詢
│   ├─ __init__.py               Python package 宣告
│   ├─ .env                      後端環境變數（不 commit，見 .env.example）
│   ├─ .env.example              後端環境變數範本
│   └─ DATABASE.md               資料庫架構詳細說明
│
├─ project/                      設計原型（已完成實作，僅供參考）
│   └─ *.html / *.jsx / *.css   Claude Design 匯出的 HTML 原型
│
├─ .env.local                    前端環境變數（不 commit，見 .env.local.example）
├─ .env.local.example            前端環境變數範本
├─ requirements.txt              Python 依賴
├─ package.json                  Node.js 依賴
├─ ROADMAP.md                    功能路線圖（P1–P6 branch 狀態與待辦）
└─ tsconfig.json                 TypeScript 設定
```

---

## 本地開發環境設定

### 前置需求

- Node.js 18+
- Python 3.11+
- PostgreSQL（建議使用 [Neon](https://neon.tech/) 免費方案）

### 1. Clone & 安裝前端依賴

```bash
git clone <repo-url>
cd solar_money
npm install
```

### 2. 設定前端環境變數

```bash
cp .env.local.example .env.local
# 填入你的 Mapbox token 和 Google Maps API key
```

| 變數 | 用途 | 取得方式 |
|------|------|----------|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | 地圖渲染、3D 建物 | [account.mapbox.com](https://account.mapbox.com/) |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | 地址自動完成 | [Google Cloud Console](https://console.cloud.google.com/)，需開啟 **Places API (New)** |
| `NEXT_PUBLIC_API_URL` | 後端位址 | 本地開發保持 `http://localhost:8000` |

### 3. 設定 Python 虛擬環境

```bash
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

### 4. 設定後端環境變數

```bash
cp backend/.env.example backend/.env
# 填入 PostgreSQL 連線字串與 JWT secret
```

| 變數 | 說明 | 本地未設定時的行為 |
|------|------|-------------------|
| `DATABASE_URL` | `postgresql://user:pass@host/db?sslmode=require` | 必填，無預設 |
| `JWT_SECRET` | 任意隨機字串（建議 `openssl rand -hex 32`） | 自動產生臨時 key，重啟後 token 失效（本地開發可接受） |
| `ADMIN_SECRET` | 管理員 API secret | 預設 `dev-admin-secret`（本地開發可接受，部署前必改） |

### 5. 啟動服務

兩個終端分別執行：

```bash
# 終端 1：前端
npm run dev
# → http://localhost:3000

# 終端 2：後端
uvicorn backend.main:app --reload
# → http://localhost:8000
# 啟動時會看到：[DB] 連線成功，資料表已就緒
```

---

## 後端 API

### 陰影計算

| Method | Endpoint | 說明 |
|--------|----------|------|
| `POST` | `/api/shadow` | 單一建物陰影計算 |
| `GET` | `/api/shadows` | bbox 範圍內所有 OSM 建物陰影 |
| `POST` | `/api/shadows/from-features` | 前端送入建物清單，計算**當前時刻**陰影（快速，~300ms） |
| `POST` | `/api/shadows/precompute` | 前端送入建物清單，預計算 **6–19 時全天**陰影並存 DB cache |

### 評估紀錄

| Method | Endpoint | 說明 |
|--------|----------|------|
| `POST` | `/api/assessments` | 儲存一筆匿名評估紀錄 |
| `GET` | `/api/assessments?user_id=<uuid>` | 查詢匿名 user 的歷史評估 |

### 廠商推薦

| Method | Endpoint | 說明 |
|--------|----------|------|
| `GET` | `/api/vendors?county=<縣市>&limit=3` | 依服務縣市取得推薦廠商；未帶 county 時回傳預設推薦 |
| `GET` | `/api/vendors/{id}` | 取得單一廠商詳細資料與作品集 |
| `POST` | `/api/vendors/apply` | 廠商入駐申請，預設為待審核且不公開 |
| `POST` | `/api/vendors/{id}/inquire` | 民眾聯絡廠商時儲存詢價紀錄（可選 Bearer JWT） |

### 廠商儀表板（Bearer JWT，role = vendor）

| Method | Endpoint | 說明 |
|--------|----------|------|
| `GET` | `/api/me/vendor` | 取得自己的廠商資料、作品集、訂閱狀態 |
| `PATCH` | `/api/me/vendor` | 更新廠商資料（名稱、電話、email、縣市、標籤） |
| `POST` | `/api/me/vendor/logo` | 更新廠商 Logo（base64 DataURL） |
| `POST` | `/api/me/vendor/portfolios` | 新增作品集項目（含施工照、規格、客戶描述） |
| `DELETE` | `/api/me/vendor/portfolios/{id}` | 刪除作品集項目 |
| `GET` | `/api/me/vendor/inquiries` | 取得收到的詢價紀錄（含 case_status） |
| `POST` | `/api/me/vendor/inquiries/{id}/reply` | 回覆詢價 |
| `PATCH` | `/api/me/vendor/inquiries/{id}/status` | 更新案件狀態（new/contacted/quoted/closed） |
| `GET` | `/api/me/vendor/leads` | 取得潛在客戶名單（進階方案顯示全部，免費前3） |
| `GET` | `/api/me/application/status` | 查詢自己的廠商申請狀態（含拒絕原因） |

### 管理員（Bearer JWT，role = admin 或 X-Admin-Secret header）

| Method | Endpoint | 說明 |
|--------|----------|------|
| `GET` | `/api/admin/vendors/pending` | 取得待審核廠商申請 |
| `POST` | `/api/admin/vendors/{id}/approve` | 核准廠商，公開顯示於推薦列表；自動升級廠商帳號 role 為 vendor |
| `POST` | `/api/admin/vendors/{id}/reject` | 退回廠商申請，可附退回原因 |
| `GET` | `/api/admin/accounts/search?email=` | 依 Email 查詢帳號（id + 目前角色） |
| `POST` | `/api/admin/accounts/{id}/role` | 調整帳號角色（`user` / `vendor` / `admin`） |

### 用戶（Bearer JWT，role = user）

| Method | Endpoint | 說明 |
|--------|----------|------|
| `GET` | `/api/me/assessments` | 取得登入帳號的歷史評估 |
| `POST` | `/api/me/claim?user_id=<uuid>` | 將匿名評估綁定至登入帳號 |
| `GET` | `/api/me/inquiries` | 取得自己送出的詢價紀錄（含廠商回覆） |
| `POST` | `/api/me/inquiries/{id}/review` | 對廠商送出星級評價（1–5 星，每筆詢價限一次） |

### 會員 Auth

| Method | Endpoint | 說明 |
|--------|----------|------|
| `POST` | `/api/auth/register` | 註冊（email + password）→ 回傳 JWT token |
| `POST` | `/api/auth/login` | 登入 → 回傳 JWT token |

### 其他

| Method | Endpoint | 說明 |
|--------|----------|------|
| `GET` | `/healthz` | 健康檢查 |

---

## 陰影計算流程

### 地圖移動時（兩階段並行）

```
moveend + 600ms debounce
  │
  ├─ Phase 1 → /api/shadows/from-features（當前 1 小時）
  │              ~300ms → 立刻顯示陰影，隱藏 spinner
  │
  └─ Phase 2 → /api/shadows/precompute（全天 14 小時）
                 DB cache hit → ~5ms，miss → 2–5s
                 完成後填入前端 cacheRef → 拖曳時間軸瞬間回應
```

### 拖曳時間軸

直接從前端 `cacheRef`（`Map<hour, FeatureCollection>`）讀取，不發 API request。

### 陰影幾何計算（Python）

```python
# 1. 太陽位置：pvlib NREL SPA → (azimuth, altitude)
# 2. 建物 footprint: EPSG:4326 → 3857（公尺）
# 3. 陰影長度 = height / tan(altitude)
# 4. 位移向量 = shadow_len × (sin(azimuth+180°), cos(azimuth+180°))
# 5. 陰影多邊形 = convex_hull(building ∪ translated_building)
# 6. 屋頂遮蔽 = STRtree 空間索引 O(n log n)，找出被其他建物陰影覆蓋的屋頂區域
# 7. 結果: EPSG:3857 → 4326 回傳 GeoJSON
```

---

## 前端試算邏輯

試算在純前端完成（`src/lib/compute.ts`），不需要後端：

```
容量 (kW) = min(屋頂面積上限, 預算上限 ÷ (單價 - 補助/kW))
月發電量 = 容量 × 日照強度[地區][月份] × 天數 × 0.78（性能比）× 目標調整係數
年發電量 = Σ 月發電量
年收益 = 自用省電（40% × 2.5元/度）+ 台電躉購（60% × 5.7元/度）
回本年限 = 實際自付 ÷ 年收益
20年總收益 = Σ（年收益 × 0.995^y）  ← 0.5%/年衰退
```

日照資料來源：`TW_IRRADIANCE`（北/中/南部月均 GHI kWh/m²/day）

---

## 使用者識別

- **匿名模式**：前端 `localStorage` 存 `crypto.randomUUID()` 作為 `user_id`，評估完成自動送後端儲存
- **登入模式**：`POST /api/auth/login` 取得 JWT 與角色，儲存在 `localStorage('solar_auth')`；`AuthContext` 全域管理登入狀態
- **帳號綁定**：登入後呼叫 `POST /api/me/claim?user_id=<uuid>` 可將過去的匿名評估綁定至帳號
- **角色區分**：帳號角色目前支援 `user`、`vendor`、`admin`。TopBar 會顯示目前角色，方便本地測試。

---

## 歷史紀錄與並排比較

登入後可從右上角「歷史紀錄」開啟 Drawer，查看已綁定帳號的評估結果。

手動測試流程：

1. 登入或註冊帳號。
2. 完成至少兩次評估，進入結果頁後系統會自動儲存並綁定帳號。
3. 點擊右上角「歷史紀錄」。
4. 在 Drawer 中點選兩筆評估卡片。
5. 點擊「並排比較」，查看地址、縣市、裝機容量、年發電量、回本年限與實際自付金額。

---

## CSS 設計系統

所有樣式集中在 `src/app/globals.css`，分為以下區段：

| 區段 | 主要 class |
|------|-----------|
| Design Tokens | CSS 變數（`--green-*`, `--ink-*`, `--shadow-*`, `--amber`, `--ease-out`）；語義別名 `--text`, `--surface`, `--border`, `--accent`, `--bg` |
| App Shell | `.app`, `.topbar`, `.brand` |
| Typography | `.eyebrow`, `.h-title`, `.body`, `.caption`, `.body-sm`, `.num` |
| Buttons | `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-outline`, `.btn-outline-sm` |
| Cards | `.card`, `.card.elevated` |
| Form | `.form-field`, `.form-label`, `.form-input`, `.form-error` |
| Modal | `.modal-backdrop`, `.modal`, `.tab-switcher`, `.tab-btn` |
| Drawer | `.drawer`, `.drawer-header`, `.assessment-card`, `.assessment-card--selected`, `.compare-table` |
| Auth / TopBar | `.avatar`, `.modal-*`, `.tab-switcher` |
| StepParams | `.budget-card`, `.grade-grid`, `.grade-card`, `.grade-card--active`, `.grade-badges`, `.grade-badge`, `.grade-badge--rec`, `.grade-badge--full` |
| StepParams 摘要 | `.param-summary-grid`, `.card-section-heading`, `.summary-row`, `.summary-row__label`, `.summary-row__value--green`, `.cost-highlight` |
| Results KPI | `.results-kpi-grid`, `.results-kpi-item--divided`, `.results-kpi-progress` |
| Results 標籤 | `.results-tab-nav`, `.results-tab-btn`, `.results-tab-btn--active` |
| Results 廠商推薦 | `.vendor-section`, `.vendor-grid`, `.vendor-card`, `.vendor-contact-btn`, `.vendor-detail-modal`, `.vendor-portfolio-list` |
| Results CTA | `.results-cta`, `.results-cta-decoration`, `.results-cta-title`, `.results-cta-actions`, `.results-save-btn`, `.results-download-btn`, `.results-save-toast` |
| Dashboard 共用佈局 | `.dash-page`, `.dash-topbar`, `.dash-topbar-wordmark`, `.dash-topbar-sep`, `.dash-topbar-section`, `.dash-back-btn`, `.dash-body`, `.dash-sidebar`, `.dash-sidebar--collapsed`, `.dash-collapse-btn`, `.dash-nav-list`, `.dash-nav-btn`, `.dash-nav-btn--active`, `.dash-nav-btn-icon`, `.dash-nav-btn-label`, `.dash-nav-badge`, `.dash-nav-badge--dot`, `.dash-content` |
| Dashboard 內容 | `.dash-content-header`, `.dash-stats`, `.dash-stat`, `.dash-vendor-hero`, `.dash-portfolio-grid`, `.dash-portfolio-card`, `.dash-inquiry-table`, `.dash-application-card`, `.dash-account-search`, `.dash-account-result`, `.dash-save-row`, `.dash-hint`, `.dash-empty`, `.dash-loading` |
| 廠商入駐 | `.vendor-apply-modal`, `.vendor-apply-login-required`, `.vendor-apply-email-display`, `.vendor-apply-rejected-notice` |
| 廠商狀態標籤 | `.vd-status-badge`, `.vd-status-badge--pending`, `.vd-status-badge--approved`, `.vd-status-badge--rejected` |
| 作品集施工照 | `.dash-portfolio-photo`, `.dash-portfolio-desc`, `.portfolio-photo-upload-row`, `.portfolio-photo-upload`, `.portfolio-photo-preview` |
| 站內詢價 Modal | `.inquiry-modal`, `.inquiry-modal-body`, `.inquiry-summary`, `.inquiry-actions` |
| 廠商聊天收件箱 | `.inq-shell`, `.inq-contacts-col`, `.inq-contact-item`, `.inq-contact-item--active`, `.inq-contact-avatar`, `.inq-cs-badge`, `.inq-chat-col`, `.inq-chat-header`, `.inq-house-chips`, `.inq-messages`, `.inq-system-card`, `.inq-msg-row`, `.inq-msg`, `.inq-msg--user`, `.inq-msg--vendor`, `.inq-input-area`, `.inq-anon-notice` |
| 案件狀態顏色 | `.cs-new`, `.cs-contacted`, `.cs-quoted`, `.cs-closed`, `.case-stat-new`, `.case-stat-contacted`, `.case-stat-quoted`, `.case-stat-closed` |
| 潛在客戶名單 | `.leads-grid`, `.lead-card`, `.lead-card--locked`, `.lead-locked-count`, `.lead-locked-label`, `.leads-plan-banner` |
| 我的詢價（用戶端） | `.user-inquiry-card`, `.user-inquiry-vendor-row`, `.user-inquiry-msg`, `.user-inquiry-reply` |
| 廠商評價 | `.star-rating`, `.star-btn`, `.star-btn--active` |
| HistoryDrawer tabs | `.drawer-tabs`, `.drawer-tab`, `.drawer-tab--active`, `.drawer-tab-badge` |
| Print | `@media print`（隱藏 `.no-print` / `.screen-only`，顯示 `.print-report`） |

---

## 部署

前端（Next.js）和後端（FastAPI）分開部署，資料庫使用現有的 Neon serverless PostgreSQL。

### 前端 — Vercel

1. 到 [vercel.com](https://vercel.com) 連結 GitHub repo，框架自動偵測為 Next.js
2. 在 Vercel 後台 → Settings → Environment Variables 填入：

| 變數 | 說明 |
|------|------|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Mapbox token |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Places API key（需開啟 Places API New） |
| `NEXT_PUBLIC_API_URL` | 後端完整 URL，例如 `https://your-backend.railway.app` |

### 後端 — Railway

1. 到 [railway.app](https://railway.app) 新建專案，從 GitHub 部署
2. Settings → Start Command：`uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
3. 在 Railway 後台 Variables 填入：

| 變數 | 說明 | 本地未設定時的行為 |
|------|------|-------------------|
| `DATABASE_URL` | `postgresql://user:pass@host/db?sslmode=require` | 必填，無預設 |
| `JWT_SECRET` | `openssl rand -hex 32` 產生的隨機字串 | **自動產生臨時 key，重啟後所有用戶 token 失效** |
| `ADMIN_SECRET` | 自訂管理員 API secret | **預設為 `dev-admin-secret`，生產環境必須改掉** |

> **注意：** `JWT_SECRET` 和 `ADMIN_SECRET` 本地開發可不設，但部署前務必填入。前者未設定每次重啟都會讓用戶登出；後者預設值是公開資訊，任何人都能呼叫管理員 API。

4. CORS：後端目前 `allow_origins=['*']`，正式上線建議改為只允許 Vercel domain：
   ```python
   allow_origins=['https://your-app.vercel.app', 'http://localhost:3000']
   ```

### 注意事項

- **base64 圖片儲存**：廠商 Logo 和作品集施工照都是以 base64 DataURL 存在 PostgreSQL TEXT 欄位，小張圖沒問題，但大量高解析照片會讓 DB 快速膨脹。規模化前建議改用 [Cloudinary](https://cloudinary.com) 免費方案（每月 25 GB）。
- **Neon cold start**：Neon serverless 免費方案有連線數限制，後端已用 asyncpg connection pool 處理，應對短暫高峰沒問題。
- **Railway free tier**：每月 $5 額度，睡眠機制會讓第一個請求慢幾秒；如需避免可升級 Hobby 方案（$5/月）。

---

## 關於 `project/` 資料夾

`project/` 裡面是開發初期用 Claude Design 工具產出的 HTML 原型，已全部實作為 React/Next.js。目前保留僅供設計參考，不影響運作。
