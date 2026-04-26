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
| 補助快查 | 自動對應 22 縣市政府補助金額（含來源與資料更新日期） |
| 評估結果 | 年發電量、能源自給率、回本年限、20 年累計淨收益、月發電量圖表 |
| PDF 報告 | 一鍵下載一頁式 A4 評估報告（`window.print()`，無額外依賴） |
| 歷史紀錄 | 每次評估自動儲存至 PostgreSQL，支援匿名模式與登入帳號 |
| 會員系統 | Email 註冊 / 登入（JWT），登入後可查看歷史紀錄、並排比較兩筆評估 |

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
  ├─ passlib[bcrypt]      密碼雜湊
  ├─ python-jose          JWT 簽發與驗證
  │
  └─ asyncpg
        │
        ▼
PostgreSQL（Neon serverless）
  ├─ osm_cache            OSM 建物資料（7 天 TTL）
  ├─ shadow_cache         陰影預計算結果（月份粒度）
  ├─ accounts             會員帳號
  └─ assessments          使用者評估紀錄（匿名 or 帳號綁定）
```

詳細資料庫架構見 [backend/DATABASE.md](backend/DATABASE.md)。

---

## 專案結構

```
solar_money/
│
├─ src/                          前端（Next.js App Router）
│   ├─ app/
│   │   ├─ page.tsx              主入口，管理 wizard 步驟 + auth modal/drawer 狀態
│   │   ├─ layout.tsx            HTML head、字體載入
│   │   └─ globals.css           全域樣式、CSS 變數、元件 class
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
│   │   ├─ Slider.tsx            可重用滑桿元件
│   │   ├─ TopBar.tsx            頂部導覽列（含登入狀態顯示）
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

| 變數 | 說明 |
|------|------|
| `DATABASE_URL` | `postgresql://user:pass@host/db?sslmode=require` |
| `JWT_SECRET` | 任意隨機字串（建議 `openssl rand -hex 32`）；未設定時後端自動產生臨時 key（重啟後 token 失效） |

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

### 會員 Auth

| Method | Endpoint | 說明 |
|--------|----------|------|
| `POST` | `/api/auth/register` | 註冊（email + password）→ 回傳 JWT token |
| `POST` | `/api/auth/login` | 登入 → 回傳 JWT token |
| `GET` | `/api/me/assessments` | 取得登入帳號的歷史評估（Bearer JWT） |
| `POST` | `/api/me/claim?user_id=<uuid>` | 將匿名評估綁定至登入帳號（Bearer JWT） |

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
- **登入模式**：`POST /api/auth/login` 取得 JWT，儲存在 `localStorage('solar_auth')`；`AuthContext` 全域管理登入狀態
- **帳號綁定**：登入後呼叫 `POST /api/me/claim?user_id=<uuid>` 可將過去的匿名評估綁定至帳號

---

## CSS 設計系統

所有樣式集中在 `src/app/globals.css`，分為以下區段：

| 區段 | 主要 class |
|------|-----------|
| Design Tokens | CSS 變數（`--green-*`, `--ink-*`, `--shadow-*`） |
| App Shell | `.app`, `.topbar`, `.brand` |
| Typography | `.eyebrow`, `.h-title`, `.body`, `.caption` |
| Buttons | `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-outline`, `.btn-outline-sm` |
| Cards | `.card`, `.card.elevated` |
| Form | `.form-field`, `.form-label`, `.form-input`, `.form-error` |
| Modal | `.modal-backdrop`, `.modal`, `.tab-switcher`, `.tab-btn` |
| Drawer | `.drawer`, `.drawer-header`, `.assessment-card`, `.compare-table` |
| Auth / Results | `.login-banner`, `.avatar` |
| Print | `@media print`（隱藏 `.screen-only`，顯示 `.print-report`） |

---

## 關於 `project/` 資料夾

`project/` 裡面是開發初期用 Claude Design 工具產出的 HTML 原型，已全部實作為 React/Next.js。目前保留僅供設計參考，不影響運作。
