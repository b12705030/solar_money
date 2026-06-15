# 屋頂日光

台灣屋頂太陽能自助評估平台：整合 3D 陰影分析、各縣市補助與台電躉購費率，讓使用者在約 5 分鐘內完成屋頂投資試算，並媒合太陽能廠商。

## 文件

完整說明以 [Mintlify 文件](https://solarium-1f74f072.mintlify.app/) 為準，包含使用指南、開發者指南與互動式 API 參考。

```bash
cd docs && npx mintlify dev
```

| 對象 | 入口 |
|------|------|
| 一般使用者 | [使用指南](docs/index.mdx) |
| 開發者 | [資料管線](docs/developer-guide/data-pipeline.mdx) → [本機安裝](docs/developer-guide/installation.mdx) |
| API 整合 | [API 參考](docs/developer-guide/api-reference.mdx) |

## 快速開始

```bash
git clone https://github.com/b12705030/solar_money.git
cd solar_money
npm install
cp .env.local.example .env.local   # 填入 Mapbox、Google Places API key
cp backend/.env.example backend/.env   # 填入 CockroachDB DATABASE_URL

# 終端 1
npm run dev

# 終端 2（Python 3.11+）
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

前端：`http://localhost:3000` · 後端：`http://localhost:8000`

環境變數與部署細節見 [本機安裝](docs/developer-guide/installation.mdx)。

## 專案結構（摘要）

```
solar_money/
├── src/          Next.js 前端
├── backend/      FastAPI 後端
├── docs/         Mintlify 文件
├── scripts/      資料匯入與維護腳本
└── data/         DEM、氣候等資料集
```

## 延伸閱讀

| 文件 | 內容 |
|------|------|
| [SPEC.md](SPEC.md) | 產品功能規格 |
| [ROADMAP.md](ROADMAP.md) | 開發路線圖 |
| [backend/DATABASE.md](backend/DATABASE.md) | 資料庫架構 |

## 技術摘要

- **前端**：Next.js、Mapbox GL JS、Google Places
- **後端**：FastAPI、pvlib、Shapely、asyncpg
- **資料庫**：CockroachDB（建物、陰影快取、評估與廠商資料）
