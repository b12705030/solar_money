# 04a Taiwan Climate Data — 交接說明文件

**產出負責人**：氣候資料收集階段  
**下一步負責人**：`04_transfer_taiwan.ipynb` 整合推論階段  
**資料時間範圍**：2013–2025 年（13 年年均值）  
**地理單位**：台灣 368 個鄉鎮市區（TOWNCODE）

---

## 1. 產出檔案位置

```
data/taiwan/climate/
├── taiwan_climate_annual.csv      ← 主要輸出，直接使用這個
├── taiwan_climate_by_year.csv     ← 逐年版本（2013–2025 各年，供時序分析）
└── nasa_power_monthly_raw.parquet ← 月資料備份（368鄉鎮 × 12月 × 13年）
```

---

## 2. 主要輸出：`taiwan_climate_annual.csv`

**Shape：368 行 × 17 欄**（每個鄉鎮市區一行，無缺值）

### 識別欄位

| 欄位 | 說明 | 範例 |
|---|---|---|
| `TOWNCODE` | 內政部鄉鎮市區代碼（唯一鍵） | `6300300` |
| `COUNTYNAME` | 縣市名稱 | `臺北市` |
| `TOWNNAME` | 鄉鎮市區名稱 | `大安區` |
| `centroid_lat` | 鄉鎮幾何中心緯度（WGS84）| `25.026` |
| `centroid_lon` | 鄉鎮幾何中心經度（WGS84）| `121.543` |

### 氣候特徵欄位（直接對應 DeepSolar 欄位名稱）

| 欄位名稱 | 單位 | 說明 | DeepSolar 對應欄位 | 全台均值 |
|---|---|---|---|---|
| `daily_solar_radiation` | kWh/m²/day | 年均日太陽輻射量 | 同名 | 4.30 |
| `relative_humidity` | % | 年均相對濕度 | 同名 | 80.2 |
| `air_temperature` | °C | 年均氣溫（2m高） | 同名 | 23.1 |
| `earth_temperature` | °C | 年均地表溫度 | 同名 | 23.8 |
| `earth_temperature_amplitude` | °C | 最熱月 − 最冷月地表溫差 | 同名 | 10.1 |
| `wind_speed` | m/s | 年均風速（10m高） | 同名 | 4.1 |
| `atmospheric_pressure` | kPa | 年均地面大氣壓 | 同名 | 97.8 |
| `heating_degree_days` | °C·day | 暖氣度日數（base 18.3°C）| 同名 | 137.2 |
| `cooling_degree_days` | °C·day | 冷氣度日數（base 18.3°C）| 同名 | 1881.1 |
| `heating_design_temperature` | °C | 最冷3個月的月均最低溫均值 | 同名 | 10.6 |
| `cooling_design_temperature` | °C | 最熱3個月的月均最高溫均值 | 同名 | 32.3 |
| `frost_days` | days/year | 月均最低溫 < 2°C 的月份天數加總 | 同名 | 3.0 |

---

## 3. 如何載入資料

```python
import pandas as pd

taiwan_climate = pd.read_csv(
    'data/taiwan/climate/taiwan_climate_annual.csv',
    encoding='utf-8-sig'   # 中文縣市名稱需指定 encoding
)

print(taiwan_climate.shape)      # (368, 17)
print(taiwan_climate.columns.tolist())
taiwan_climate.head()
```

---

## 4. 如何與其他台灣資料合併

`TOWNCODE` 是唯一鍵，與其他台灣資料整合時以此欄位 join：

```python
# 假設你已有社經資料 taiwan_socioeconomic（含 TOWNCODE）
taiwan_full = taiwan_climate.merge(
    taiwan_socioeconomic,
    on='TOWNCODE',
    how='left'
)
```

空間視覺化時可用 `centroid_lat` / `centroid_lon` 作為座標，
或讀取原始 SHP 文件以鄉鎮多邊形畫地圖：

```python
import geopandas as gpd
gdf = gpd.read_file('data/鄉(鎮、市、區)界線1140318/TOWN_MOI_1140318.shp')
gdf = gdf.merge(taiwan_climate, on='TOWNCODE', how='left')
gdf.plot(column='daily_solar_radiation', cmap='YlOrRd', legend=True)
```

---

## 5. 如何對應 DeepSolar 模型輸入

本研究使用 `voted` 特徵集（90 個特徵），其中氣候欄位共 7 個，
對應 `outputs/results/transfer/selected_features_voted.csv` 排名如下：

| 欄位 | 在 voted 集的排名 | 與目標的相關係數 |
|---|---|---|
| `relative_humidity` | 2 | −0.353 |
| `daily_solar_radiation` | 4 | +0.325 |
| `frost_days` | 14 | −0.230 |
| `cooling_design_temperature` | 27 | +0.138 |
| `atmospheric_pressure` | 32 | −0.106 |
| `earth_temperature_amplitude` | 90 | −0.001 |
| `wind_speed` | 91 | −0.001 |

其餘氣候欄位（`air_temperature`, `earth_temperature`, `heating_degree_days`,
`cooling_degree_days`, `heating_design_temperature`）不在 voted 特徵集，
但仍保留在 CSV 中備用。

---

## 6. 資料來源與計算方式

**原始資料來源**：NASA POWER API（monthly endpoint）  
參數：`T2M, T2M_MIN, T2M_MAX, ALLSKY_SFC_SW_DWN, RH2M, TS, WS10M, PS`

**計算流程**：
1. 對每個鄉鎮的幾何中心座標呼叫 API，取 2013–2025 年月資料
2. 將月資料（days-weighted）計算成年統計值
3. 將 2013–2025 年共 13 年的年統計值取平均

**各欄位的計算方式**：

| 欄位 | NASA POWER 參數 | 計算方式 |
|---|---|---|
| `daily_solar_radiation` | `ALLSKY_SFC_SW_DWN` | 各月值 × 月天數，加權年均 |
| `relative_humidity` | `RH2M` | 各月值 × 月天數，加權年均 |
| `air_temperature` | `T2M` | 各月值 × 月天數，加權年均 |
| `earth_temperature` | `TS` | 各月值 × 月天數，加權年均 |
| `earth_temperature_amplitude` | `TS` | max(月TS) − min(月TS) |
| `wind_speed` | `WS10M` | 各月值 × 月天數，加權年均 |
| `atmospheric_pressure` | `PS` | 各月值 × 月天數，加權年均 |
| `heating_degree_days` | `T2M` | Σ max(0, 18.3 − T月) × 月天數 |
| `cooling_degree_days` | `T2M` | Σ max(0, T月 − 18.3) × 月天數 |
| `heating_design_temperature` | `T2M_MIN` | 最冷3個月的 T2M_MIN 均值 |
| `cooling_design_temperature` | `T2M_MAX` | 最熱3個月的 T2M_MAX 均值 |
| `frost_days` | `T2M_MIN` | T2M_MIN < 2°C 之月份的天數加總（台灣調整值） |

**注意事項**：
- `frost_days` 採用 2°C 門檻（非原版 0°C），因台灣平地近乎無霜，0°C 門檻會導致幾乎全為零
- 2025 年 12 月的 `ALLSKY_SFC_SW_DWN` 全台皆為缺值（NASA POWER CERES 資料尚未釋出），年均值以 1–11 月計算，對 13 年均值影響可忽略（< 0.7%）
- DeepSolar 原始氣候資料來源為 NASA SSE 22 年平均（1983–2005）；本資料為 NASA POWER 13 年平均（2013–2025），資料來源一脈相承，概念等同

---

## 7. 收集程式

收集流程完整記錄於：`notebooks/04a_taiwan_climate_collection.ipynb`

若需更新資料（例如未來納入 2026 年），步驟：
1. 修改 notebook 中 `END_YEAR` 變數
2. 刪除 `data/taiwan/climate/nasa_power_monthly_raw.parquet`
3. 重新 Run All Cells（約 4 分鐘）

---

## 8. 驗證結果摘要

| 驗證項目 | 結果 |
|---|---|
| 收集覆蓋率 | 368 / 368 鄉鎮（100%） |
| 缺值 | 0（最終 annual CSV 無任何缺值） |
| 日照最高鄉鎮 | 屏東縣恆春鎮（4.75 kWh/m²/day）✓ 符合預期 |
| 日照最低鄉鎮 | 連江縣南竿鄉（3.77 kWh/m²/day）✓ 符合預期 |
| 霜凍日最多鄉鎮 | 宜蘭縣大同鄉（65 days）✓ 山地高海拔符合預期 |
| 冷氣度日 >> 暖氣度日 | 全台均值 CDD 1881 vs HDD 137 ✓ 亞熱帶氣候符合預期 |
