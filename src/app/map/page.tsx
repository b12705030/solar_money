'use client';
import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import Link from 'next/link';
import { Bot, Sun, Banknote, Home, Scale, Trophy } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

const WEIGHTS_DEFAULT = { model_score: 0.40, solar: 0.25, fit: 0.20, income: 0.15 };

const WEIGHT_LABELS: Record<string, string> = {
  model_score: '模型潛力',
  solar:       '日照輻射量',
  fit:         '躉購費率',
  income:      '家戶收入',
};

const WEIGHT_ICONS: Record<string, React.ReactNode> = {
  model_score: <Bot     size={14} strokeWidth={1.8} />,
  solar:       <Sun     size={14} strokeWidth={1.8} />,
  fit:         <Banknote size={14} strokeWidth={1.8} />,
  income:      <Home    size={14} strokeWidth={1.8} />,
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
}

function tierFromRank(rank: number): string {
  if (rank <= 50)  return '高潛力';
  if (rank <= 150) return '中潛力';
  return '一般';
}

export default function MapPage() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef          = useRef<mapboxgl.Map | null>(null);
  const timerRef        = useRef<ReturnType<typeof setTimeout>>();
  const popupRef        = useRef<mapboxgl.Popup | null>(null);

  const [weights, setWeights]   = useState(WEIGHTS_DEFAULT);
  const [ranking, setRanking]   = useState<RegionRow[]>([]);
  const [loading, setLoading]   = useState(false);
  const [mapReady, setMapReady] = useState(false);

  // ── 初始化地圖 ──────────────────────────────────────────────────────────────
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

  // ── 地圖就緒後初始載入 ──────────────────────────────────────────────────────
  useEffect(() => {
    if (mapReady) fetchAndRender(WEIGHTS_DEFAULT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  // ── 呼叫後端 TOPSIS 並渲染圓點 ─────────────────────────────────────────────
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
        maxzoom: 9,
        paint: {
          'heatmap-weight':   ['interpolate', ['linear'], ['get', 'score'], 0.3, 0, 0.9, 1],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 9, 1.5],
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0,   'rgba(0,0,0,0)',
            0.2, '#27AE60',
            0.5, '#F39C12',
            1,   '#E74C3C',
          ],
          'heatmap-radius':  ['interpolate', ['linear'], ['zoom'], 5, 10, 9, 20],
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 7, 1, 9, 0],
        },
      });

      map.addLayer({
        id: 'region-circles',
        type: 'circle',
        source: 'regions',
        minzoom: 7,
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

      // Hover tooltip
      map.on('mouseenter', 'region-circles', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        const props = e.features?.[0]?.properties;
        if (!props) return;
        const color = TIER_COLOR[props.tier as string] ?? '#94A3B8';
        popupRef.current
          ?.setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-size:13px;line-height:1.6">
              <b>${props.name}</b><br/>
              全台排名 <b style="color:${color}">#${props.rank}</b>
              <span style="margin-left:6px;padding:1px 6px;border-radius:4px;
                background:${color};color:#fff;font-size:11px">${props.tier}</span><br/>
              TOPSIS 分數：${Number(props.score).toFixed(3)}
            </div>
          `)
          .addTo(map);
      });
      map.on('mouseleave', 'region-circles', () => {
        map.getCanvas().style.cursor = '';
        popupRef.current?.remove();
      });
    }
  }

  // ── Slider 更新：debounce 400ms ─────────────────────────────────────────────
  function handleWeight(key: string, val: number) {
    const next = { ...weights, [key]: val };
    setWeights(next);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => fetchAndRender(next), 400);
  }

  // ── 渲染 ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'var(--font-base, system-ui)' }}>
      {/* 左側控制面板 */}
      <div style={{
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

        {loading && (
          <div style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center' }}>更新中⋯</div>
        )}

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

        {/* Top 20 排名 */}
        <div>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: '#1A202C', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Trophy size={14} strokeWidth={1.8} /> 目前 Top 20
          </h3>
          {ranking.length === 0 && !loading && (
            <div style={{ fontSize: 12, color: '#94A3B8' }}>
              資料載入中，或尚未匯入地區潛力資料。
            </div>
          )}
          {ranking.map((r, i) => (
            <div key={r.towncode} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '6px 0', borderBottom: '1px solid #F1F5F9', fontSize: 13,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 22, height: 22, borderRadius: '50%', display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700,
                  background: i < 3 ? '#E8A53C' : '#E2E8F0',
                  color: i < 3 ? '#fff' : '#64748B',
                }}>
                  {i + 1}
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
        </div>
      </div>

      {/* 右側地圖 */}
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
      </div>
    </div>
  );
}
