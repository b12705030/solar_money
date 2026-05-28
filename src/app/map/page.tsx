'use client';
import React, { useEffect, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import Link from 'next/link';
import { Bot, Sun, Home, Scale, Trophy } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

const WEIGHTS_DEFAULT = { model_score: 0.55, solar: 0.20, fit: 0.15, income: 0.10 };

const WEIGHT_LABELS: Record<string, string> = {
  model_score: '模型潛力',
  solar:       '日照輻射量',
  fit:         '住宅自有率',
  income:      '家戶收入',
};

const WEIGHT_ICONS: Record<string, React.ReactNode> = {
  model_score: <Bot      size={14} strokeWidth={1.8} />,
  solar:       <Sun      size={14} strokeWidth={1.8} />,
  fit:         <Home     size={14} strokeWidth={1.8} />,
  income:      <Home     size={14} strokeWidth={1.8} />,
};

const TIER_COLOR: Record<string, string> = {
  '高潛力': '#E8A53C',
  '中潛力': '#40916C',
  '一般':   '#94A3B8',
};

interface RegionRow {
  towncode: string;
  countyname: string;
  townname: string;
  score: number;
  rank: number;
  centroid_lat: number;
  centroid_lon: number;
  combined_score: number;
  daily_solar_radiation: number;
  occupancy_owner_rate: number;
  median_household_income: number;
}

function tierFromRank(rank: number): string {
  if (rank <= 50)  return '高潛力';
  if (rank <= 150) return '中潛力';
  return '一般';
}

function parseWeightParam(val: string | null, fallback: number): number {
  const n = parseFloat(val ?? '');
  return isFinite(n) && n >= 0 ? n : fallback;
}

// ── 計算各因子 min/max，供 tooltip bar 使用 ─────────────────────────────────
function computeRanges(data: RegionRow[]) {
  const fields = ['combined_score', 'daily_solar_radiation', 'occupancy_owner_rate', 'median_household_income'] as const;
  const ranges: Record<string, { min: number; max: number }> = {};
  for (const f of fields) {
    const vals = data.map(r => r[f]).filter(v => isFinite(v));
    ranges[f] = { min: Math.min(...vals), max: Math.max(...vals) };
  }
  return ranges;
}

function normPct(val: number, range: { min: number; max: number }): number {
  const span = range.max - range.min;
  if (span === 0) return 50;
  return Math.round(((val - range.min) / span) * 100);
}

// ── Tooltip HTML（純字串，給 Mapbox Popup 用）────────────────────────────────
function buildTooltipHTML(props: Record<string, unknown>): string {
  const color = TIER_COLOR[props.tier as string] ?? '#94A3B8';

  const factors = [
    { label: '模型潛力', pct: props.model_pct as number, display: (() => {
        const pct = Number(props.model_pct);
        const top = Math.round(100 - pct);
        const tier = pct >= 70 ? '高' : pct >= 40 ? '中' : '低';
        return `${tier}（全台前 ${Math.max(top, 1)}%）`;
      })() },
    { label: '日照輻射', pct: props.solar_pct as number, display: `${Number(props.solar_val).toFixed(2)} kWh (/m²/day)` },
    { label: '住宅自有率', pct: props.fit_pct as number, display: `${(Number(props.fit_val) * 100).toFixed(1)}%` },
    { label: '家戶收入', pct: props.income_pct as number, display: `${Math.round(Number(props.income_val))} 千元/年` },
  ];

  const factorRows = factors.map(f => `
    <div style="margin-bottom:5px">
      <div style="display:flex;justify-content:space-between;margin-bottom:3px;font-size:11px">
        <span style="color:#64748B">${f.label}</span>
        <span style="font-weight:600;color:#1A202C;font-variant-numeric:tabular-nums">${f.display}</span>
      </div>
      <div style="height:4px;background:#E2E8F0;border-radius:2px;overflow:hidden">
        <div style="height:100%;width:${f.pct}%;background:${color};border-radius:2px"></div>
      </div>
    </div>
  `).join('');

  return `
    <div style="font-size:13px;line-height:1.5;min-width:210px;padding:2px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <b style="font-size:14px">${props.name}</b>
        <span style="margin-left:8px;padding:2px 7px;border-radius:5px;
          background:${color};color:#fff;font-size:11px;font-weight:700;white-space:nowrap">
          #${props.rank} ${props.tier}
        </span>
      </div>
      <div style="font-size:11px;color:#94A3B8;margin-bottom:10px">
        TOPSIS ${Number(props.score).toFixed(3)}
      </div>
      <div style="border-top:1px solid #E2E8F0;padding-top:8px">
        ${factorRows}
      </div>
    </div>
  `;
}

// ════════════════════════════════════════════════════════════════════════════
// 主元件（useSearchParams 需包在 Suspense 裡）
// ════════════════════════════════════════════════════════════════════════════
function MapPageContent() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef          = useRef<mapboxgl.Map | null>(null);
  const timerRef        = useRef<ReturnType<typeof setTimeout>>();
  const popupRef        = useRef<mapboxgl.Popup | null>(null);

  // 從 URL 初始化權重
  const [weights, setWeights] = useState(() => ({
    model_score: parseWeightParam(searchParams.get('model'),  WEIGHTS_DEFAULT.model_score),
    solar:       parseWeightParam(searchParams.get('solar'),  WEIGHTS_DEFAULT.solar),
    fit:         parseWeightParam(searchParams.get('fit'),    WEIGHTS_DEFAULT.fit),
    income:      parseWeightParam(searchParams.get('income'), WEIGHTS_DEFAULT.income),
  }));

  const [ranking, setRanking]       = useState<RegionRow[]>([]);
  const [allRanking, setAllRanking] = useState<RegionRow[]>([]);
  const [loading, setLoading]       = useState(false);
  const [mapReady, setMapReady]     = useState(false);
  const [rankSearch, setRankSearch] = useState('');
  const [showAll, setShowAll]       = useState(false);
  const [panelOpen, setPanelOpen]   = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);

  // ── 更新 URL（不觸發頁面 reload）────────────────────────────────────────
  function pushURL(w: typeof WEIGHTS_DEFAULT) {
    const p = new URLSearchParams({
      model:  w.model_score.toFixed(2),
      solar:  w.solar.toFixed(2),
      fit:    w.fit.toFixed(2),
      income: w.income.toFixed(2),
    });
    router.replace(`/map?${p.toString()}`, { scroll: false });
  }

  // ── 初始化地圖 ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current) return;

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [121.0, 23.6],
      zoom: 7,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.on('load', () => {
      mapRef.current = map;
      setMapReady(true);
    });

    popupRef.current = new mapboxgl.Popup({ closeButton: false, closeOnClick: false });

    return () => {
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ── 地圖就緒後以 URL 初始權重載入 ─────────────────────────────────────────
  useEffect(() => {
    if (mapReady) fetchAndRender(weights);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  // ── 呼叫後端 TOPSIS 並渲染 ────────────────────────────────────────────────
  async function fetchAndRender(w: typeof WEIGHTS_DEFAULT) {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/topsis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(w),
      });
      if (!res.ok) throw new Error('TOPSIS API error');
      const data: RegionRow[] = await res.json();
      setAllRanking(data);
      setRanking(data.slice(0, 20));
      renderOnMap(data);
    } catch (err) {
      console.error('[MapPage] fetchAndRender error:', err);
    } finally {
      setLoading(false);
    }
  }

  function renderOnMap(data: RegionRow[]) {
    const map = mapRef.current;
    if (!map) return;

    const ranges = computeRanges(data);

    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: data.map(r => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.centroid_lon, r.centroid_lat] },
        properties: {
          score:      r.score,
          rank:       r.rank,
          name:       `${r.countyname}${r.townname}`,
          tier:       tierFromRank(r.rank),
          // 各因子原始值
          model_val:  r.combined_score,
          solar_val:  r.daily_solar_radiation,
          fit_val:    r.occupancy_owner_rate,
          income_val: r.median_household_income,
          // 各因子正規化百分比（給 tooltip bar 用）
          model_pct:  normPct(r.combined_score,                ranges.combined_score),
          solar_pct:  normPct(r.daily_solar_radiation,         ranges.daily_solar_radiation),
          fit_pct:    normPct(r.occupancy_owner_rate,          ranges.occupancy_owner_rate),
          income_pct: normPct(r.median_household_income,        ranges.median_household_income),
        },
      })),
    };

    if (map.getSource('regions')) {
      (map.getSource('regions') as mapboxgl.GeoJSONSource).setData(geojson);
    } else {
      map.addSource('regions', { type: 'geojson', data: geojson });

      map.addLayer({
        id: 'region-heat',
        type: 'heatmap',
        source: 'regions',
        maxzoom: 10,
        paint: {
          'heatmap-weight':    ['interpolate', ['linear'], ['get', 'score'], 0.3, 0, 0.9, 1],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 10, 1.5],
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0,   'rgba(0,0,0,0)',
            0.2, '#27AE60',
            0.5, '#F39C12',
            1,   '#E74C3C',
          ],
          'heatmap-radius':  ['interpolate', ['linear'], ['zoom'], 5, 10, 10, 20],
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 8.5, 1, 10, 0],
        },
      });

      map.addLayer({
        id: 'region-circles',
        type: 'circle',
        source: 'regions',
        minzoom: 7.5,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 5, 12, 10],
          'circle-color': [
            'match', ['get', 'tier'],
            '高潛力', '#E8A53C',
            '中潛力', '#40916C',
            '#94A3B8',
          ],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1.5,
          'circle-opacity': 0.85,
        },
      });

      // Hover tooltip（含各因子分數）
      map.on('mouseenter', 'region-circles', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        const props = e.features?.[0]?.properties;
        if (!props) return;
        popupRef.current
          ?.setLngLat(e.lngLat)
          .setHTML(buildTooltipHTML(props))
          .addTo(map);
      });
      map.on('mouseleave', 'region-circles', () => {
        map.getCanvas().style.cursor = '';
        popupRef.current?.remove();
      });
    }
  }

  // ── Slider 更新：同步 URL + debounce API ──────────────────────────────────
  function handleWeight(key: string, val: number) {
    const next = { ...weights, [key]: val };
    setWeights(next);
    pushURL(next);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => fetchAndRender(next), 400);
  }

  function handleReset() {
    setWeights(WEIGHTS_DEFAULT);
    pushURL(WEIGHTS_DEFAULT);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => fetchAndRender(WEIGHTS_DEFAULT), 400);
  }

  // 搜尋過濾後的排名清單
  const filteredRanking = (() => {
    const q = rankSearch.trim();
    const base = (q || showAll) ? allRanking : ranking;
    if (!q) return base;
    return allRanking.filter(r =>
      `${r.countyname}${r.townname}`.includes(q)
    );
  })();

  // ── 渲染 ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'var(--font-base, system-ui)', position: 'relative' }}>
      <style>{`
        @media (max-width: 640px) {
          .map-panel {
            position: absolute !important;
            top: 0; left: 0; bottom: 0;
            width: 88vw !important;
            max-width: 320px;
            z-index: 20;
            transform: translateX(-100%);
            transition: transform 0.28s cubic-bezier(0.4,0,0.2,1);
            box-shadow: 4px 0 20px rgba(0,0,0,0.12);
          }
          .map-panel.open { transform: translateX(0); }
          .map-panel-toggle {
            display: flex !important;
          }
          .map-overlay { display: block !important; }
        }
        .map-panel-toggle { display: none; }
        .map-overlay { display: none; position: absolute; inset: 0; background: rgba(0,0,0,0.3); z-index: 15; }
      `}</style>

      {/* 手機版：點擊遮罩關閉面板 */}
      {panelOpen && (
        <div className="map-overlay" onClick={() => setPanelOpen(false)} />
      )}

      {/* 左側控制面板 */}
      <div className={`map-panel${panelOpen ? ' open' : ''}`} style={{
        width: 300, padding: 24, borderRight: '1px solid #E2E8F0',
        overflowY: 'auto', background: '#FAFAFA', display: 'flex', flexDirection: 'column', gap: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1A202C', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Scale size={16} strokeWidth={1.8} /> 調整分析權重
          </h2>
          <Link href="/" style={{ fontSize: 12, color: '#64748B' }}>← 返回評估</Link>
        </div>

        <p style={{ margin: 0, fontSize: 12, color: '#64748B', lineHeight: 1.6 }}>
          拖曳滑桿調整各因子比重，地圖即時更新排名。
          權重會自動正規化，不須加總為 1。
        </p>

        {/* Sliders */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {Object.keys(WEIGHTS_DEFAULT).map(key => {
            const pct = Math.round(weights[key as keyof typeof weights] * 100);
            return (
              <div key={key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                  <span style={{ color: '#374151', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 5 }}>
                    {WEIGHT_ICONS[key]}
                    {WEIGHT_LABELS[key]}
                  </span>
                  <span style={{ color: '#40916C', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {pct}%
                  </span>
                </div>
                <input
                  type="range" min={0} max={1} step={0.05}
                  value={weights[key as keyof typeof weights]}
                  onChange={e => handleWeight(key, parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: '#40916C' }}
                />
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {loading
            ? <span style={{ fontSize: 12, color: '#94A3B8' }}>更新中⋯</span>
            : <span style={{ fontSize: 12, color: '#94A3B8' }}>&nbsp;</span>
          }
          <button
            onClick={handleReset}
            style={{
              marginLeft: 'auto', padding: '4px 10px', borderRadius: 6,
              border: '1px solid #E2E8F0', background: '#fff',
              fontSize: 11, color: '#64748B', cursor: 'pointer',
            }}
          >
            重設預設值
          </button>
        </div>

        {/* 圖例 */}
        <div style={{ padding: '12px 14px', background: '#F1F5F9', borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 8 }}>圖例</div>
          {Object.entries(TIER_COLOR).map(([tier, color]) => (
            <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: color }} />
              <span style={{ fontSize: 12, color: '#374151' }}>{tier}</span>
              <span style={{ fontSize: 11, color: '#94A3B8' }}>
                {tier === '高潛力' ? '前 50 名' : tier === '中潛力' ? '51–150 名' : '151–368 名'}
              </span>
            </div>
          ))}
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid #E2E8F0', margin: 0 }} />

        {/* 排名清單 */}
        <div>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, color: '#1A202C', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Trophy size={14} strokeWidth={1.8} />
            {rankSearch ? `搜尋結果` : showAll ? '全部排名' : 'Top 20'}
          </h3>

          {/* 搜尋框 */}
          <input
            type="text"
            placeholder="搜尋縣市 / 鄉鎮…"
            value={rankSearch}
            onChange={e => setRankSearch(e.target.value)}
            style={{
              width: '100%', padding: '6px 10px', marginBottom: 10,
              borderRadius: 6, border: '1px solid #E2E8F0',
              fontSize: 12, color: '#374151', background: '#fff',
              boxSizing: 'border-box', outline: 'none',
            }}
          />

          {allRanking.length === 0 && !loading && (
            <div style={{ fontSize: 12, color: '#94A3B8' }}>
              資料載入中，或尚未匯入地區潛力資料。
            </div>
          )}

          {filteredRanking.map((r) => (
            <div key={r.towncode} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '6px 0', borderBottom: '1px solid #F1F5F9', fontSize: 13,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 22, height: 22, borderRadius: '50%', display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700,
                  background: r.rank <= 3 ? '#E8A53C' : '#E2E8F0',
                  color: r.rank <= 3 ? '#fff' : '#64748B',
                }}>
                  {r.rank}
                </span>
                <span style={{ color: '#374151' }}>
                  {r.countyname}{r.townname}
                </span>
              </div>
              <span style={{ color: '#40916C', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {r.score.toFixed(3)}
              </span>
            </div>
          ))}

          {/* 展開 / 收合按鈕（沒在搜尋時才顯示）*/}
          {!rankSearch && allRanking.length > 20 && (
            <button
              onClick={() => setShowAll(v => !v)}
              style={{
                marginTop: 10, width: '100%', padding: '6px 0',
                borderRadius: 6, border: '1px solid #E2E8F0',
                background: '#fff', fontSize: 12, color: '#64748B', cursor: 'pointer',
              }}
            >
              {showAll ? '▲ 收合' : `▼ 顯示全部 ${allRanking.length} 筆`}
            </button>
          )}
        </div>

      </div>

      {/* 地圖區域 */}
      <div ref={mapContainerRef} style={{ flex: 1, position: 'relative' }}>
        {/* 標題浮層 */}
        <div style={{
          position: 'absolute', top: 16, left: 16, zIndex: 1,
          background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(4px)',
          padding: '10px 16px', borderRadius: 10,
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          fontSize: 13, color: '#1A202C',
        }}>
          <b>台灣太陽能推廣潛力地圖</b>
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
            基於 DeepSolar 遷移學習 × TOPSIS 多準則排名
          </div>
        </div>

        {/* 右下角：方法說明卡片（獨立定位，不影響按鈕位置）*/}
        {methodOpen && (
          <div style={{
            position: 'absolute', bottom: 78, right: 16, zIndex: 10,
            width: 300,
            background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(6px)',
            borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            padding: '16px 18px',
            fontSize: 12, color: '#4B5563', lineHeight: 1.7,
            display: 'flex', flexDirection: 'column', gap: 14,
            maxHeight: '70vh', overflowY: 'auto',
          }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#1A202C' }}>
                這個排名怎麼算出來的？
              </div>

              <div>
                <div style={{ fontWeight: 700, color: '#1A202C', marginBottom: 4 }}>資料基礎</div>
                <p style={{ margin: 0 }}>
                  以美國 Stanford DeepSolar 資料集（73,000+ 普查區、169 項特徵）訓練機器學習模型。移除族裔組成、行政代碼等美國特有欄位，保留氣候、電價、社經、住宅類可跨國泛化的 90 項特徵，再與台灣日照、躉購費率、家戶收入資料整合。
                </p>
              </div>

              <div>
                <div style={{ fontWeight: 700, color: '#1A202C', marginBottom: 6 }}>模型</div>
                <p style={{ margin: '0 0 6px' }}>採用兩階段模型，對應原論文 DeepSolar SolarForest：</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 8, borderLeft: '2px solid #E2E8F0' }}>
                  <div><b>Stage 1</b>　預測「一個地區是否具備太陽能部署傾向」</div>
                  <div><b>Stage 2</b>　預測「已具傾向地區的相對部署強度」</div>
                </div>
                <div style={{
                  marginTop: 10, padding: '8px 12px', borderRadius: 8,
                  background: '#F0F9F2', border: '1px solid #86EFAC',
                  fontSize: 12, color: '#166534',
                }}>
                  本模型 R² = <b>0.750</b>，優於原論文 SolarForest（R² = 0.722）
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 700, color: '#1A202C', marginBottom: 4 }}>排名方法</div>
                <p style={{ margin: 0 }}>
                  以 TOPSIS 多準則分析整合四項因子：模型潛力、日照輻射量、躉購費率、家戶收入。左側滑桿可調整各因子相對權重，排名即時更新。
                </p>
              </div>

              <div>
                <div style={{ fontWeight: 700, color: '#1A202C', marginBottom: 4 }}>外部驗證</div>
                <p style={{ margin: '0 0 6px' }}>
                  以台電 114 年縣市太陽能裝置容量統計資料交叉比對（22 個縣市）。
                </p>
                <div style={{
                  padding: '8px 12px', borderRadius: 8,
                  background: '#FFF8EE', border: '1px solid #FCD34D',
                  fontSize: 12, color: '#92400E',
                }}>
                  預測排名與實際裝設分布呈顯著正相關<br />
                  Spearman ρ = <b>+0.60</b>，p &lt; 0.01
                </div>
              </div>
            </div>
          )}

        {/* ℹ 觸發按鈕（固定在右下角，不受卡片影響）*/}
        <button
          onClick={() => setMethodOpen(v => !v)}
          title="方法說明"
          style={{
            position: 'absolute', bottom: 32, right: 16, zIndex: 10,
            width: 36, height: 36, borderRadius: '50%',
            background: methodOpen ? '#1A202C' : 'rgba(255,255,255,0.92)',
            border: '1px solid #E2E8F0',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 15, color: methodOpen ? '#fff' : '#64748B',
            backdropFilter: 'blur(4px)',
          }}
        >
          ℹ
        </button>

        {/* 手機版：開啟面板按鈕 */}
        <button
          className="map-panel-toggle"
          onClick={() => setPanelOpen(v => !v)}
          style={{
            position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
            zIndex: 10, padding: '10px 20px', borderRadius: 24,
            background: '#1A202C', color: '#fff', border: 'none',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
            alignItems: 'center', gap: 6,
          }}
        >
          <Scale size={14} strokeWidth={1.8} />
          調整權重
        </button>
      </div>
    </div>
  );
}

// useSearchParams 需包在 Suspense 內（Next.js App Router 規定）
export default function MapPage() {
  return (
    <Suspense>
      <MapPageContent />
    </Suspense>
  );
}
