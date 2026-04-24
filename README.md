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
| 目標選擇 | 全年最大、夏季最大、冬季最大、正午峰值、與用電曲線最匹配、投資回收最快 |
| 裝機參數 | 根據屋頂坪數自動估算容量，可調整安裝單價 |
| 補助快查 | 自動對應 22 縣市政府補助金額 |
| 評估結果 | 年發電量、能源自給率、回本年限、20 年累計淨收益、月發電量圖表 |
| 歷史紀錄 | 每次評估自動儲存至 PostgreSQL，用 anonymous UUID 識別使用者 |

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
  │
  └─ asyncpg
        │
        ▼
PostgreSQL（Neon serverless）
  ├─ osm_cache            OSM 建物資料（7 天 TTL）
  ├─ shadow_cache         陰影預計算結果（月份粒度）
  └─ assessments          使用者評估紀錄
```

詳細資料庫架構見 [backend/DATABASE.md](backend/DATABASE.md)。

---

## 專案結構

```
solar_money/
│
├─ src/                          前端（Next.js App Router）
│   ├─ app/
│   │   ├─ page.tsx              主入口，管理 wizard 步驟狀態
│   │   ├─ layout.tsx            HTML head、字體載入
│   │   └─ globals.css           全域樣式、CSS 變數、動畫
│   ├─ screens/
│   │   ├─ Landing.tsx           首頁
│   │   ├─ StepAddress.tsx       Step 1：地址搜尋 + 地圖 + 陰影預覽
│   │   ├─ StepUsage.tsx         Step 2：每月用電量
│   │   ├─ StepGoal.tsx          Step 3：發電目標選擇
│   │   ├─ StepParams.tsx        Step 4：容量、費用、補助確認
│   │   └─ Results.tsx           評估結果頁，自動儲存至 DB
│   ├─ components/
│   │   ├─ MapView.tsx           Mapbox 地圖 + 3D 陰影計算主元件
│   │   ├─ Slider.tsx            可重用滑桿元件
│   │   ├─ TopBar.tsx            頂部導覽列
│   │   ├─ Footer.tsx            頁腳
│   │   ├─ ProgressBar.tsx       步驟進度條
│   │   ├─ WizardFooter.tsx      上一步 / 下一步按鈕
│   │   ├─ TweaksPanel.tsx       主題 / 密度設定面板
│   │   └─ ui.tsx                共用 UI 元件（Info tooltip 等）
│   ├─ lib/
│   │   ├─ compute.ts            核心試算邏輯（發電量、回本年限等）
│   │   ├─ constants.ts          縣市補助、日照資料、步驟定義
│   │   ├─ types.ts              TypeScript 型別
│   │   └─ theme.ts              主題切換工具
│   └─ utils/
│       ├─ places.ts             Google Places API 封裝
│       └─ googleMapsLoader.ts   動態載入 Google Maps JS SDK
│
├─ backend/                      後端（FastAPI / Python）
│   ├─ main.py                   API 路由、FastAPI app 設定
│   ├─ shadow.py                 陰影計算核心（pvlib + Shapely）
│   ├─ db.py                     PostgreSQL 連線池、cache 操作
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
├─ next.config.js                Next.js 設定
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
# 填入 PostgreSQL 連線字串
```

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

| Method | Endpoint | 說明 |
|--------|----------|------|
| `POST` | `/api/shadow` | 單一建物陰影計算 |
| `GET` | `/api/shadows` | bbox 範圍內所有 OSM 建物陰影 |
| `POST` | `/api/shadows/from-features` | 前端送入建物清單，計算**當前時刻**陰影（快速，~300ms） |
| `POST` | `/api/shadows/precompute` | 前端送入建物清單，預計算 **6–19 時全天**陰影並存 DB cache |
| `POST` | `/api/assessments` | 儲存一筆使用者評估紀錄 |
| `GET` | `/api/assessments?user_id=<uuid>` | 查詢某 user 的歷史評估 |
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

### 深度測試 z-fighting 修正

Mapbox fill-extrusion 在完全相同高度的多邊形會有 z-fighting（互相遮蔽）。
屋頂陰影圖層透過 `scalePoly(coords, 1.015)` 和 `height + 0.5` 稍微放大，繞過深度測試問題。

---

## 前端試算邏輯

試算在純前端完成（`src/lib/compute.ts`），不需要後端：

```
容量 (kW) = 屋頂坪數 × 3.3 m²/坪 × 0.6（可用比例）× 0.165 kW/m²
月發電量 = 容量 × 日照強度[地區][月份] × 天數 × 0.78（性能比）× 目標調整係數
年發電量 = Σ 月發電量
年收益 = 自用省電（40% × 2.5元/度）+ 台電躉購（60% × 5.7元/度）
回本年限 = 實際自付 ÷ 年收益
20年總收益 = Σ（年收益 × 0.995^y）  ← 0.5%/年衰退
```

日照資料來源：`TW_IRRADIANCE`（北/中/南部月均 GHI kWh/m²/day）

---

## 使用者識別

不需要登入。前端在 `localStorage` 存一個 `crypto.randomUUID()` 作為匿名 `user_id`，每次評估完成時自動送後端儲存。

---

## 關於 `project/` 資料夾

`project/` 裡面是開發初期用 Claude Design 工具產出的 HTML 原型，已全部實作為 React/Next.js。目前保留僅供設計參考，不影響運作。
