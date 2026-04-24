'use client';
import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Info } from '@/components/ui';
import { Slider } from '@/components/Slider';
import { getPlaceAutocomplete, getPlaceDetails } from '@/utils/places';
import type { PlacePrediction } from '@/utils/places';
import type { SolarState, AddressOption, Region } from '@/lib/types';

const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });

function detectRegion(address: string): Region {
  if (/台中|臺中|彰化|南投|苗栗|雲林/.test(address)) return '中部';
  if (/台南|臺南|高雄|屏東|嘉義|花蓮|台東|臺東|澎湖|金門/.test(address)) return '南部';
  return '北部'; // 台北、新北、基隆、桃園、新竹、宜蘭、連江
}

export default function StepAddress({
  state, update,
}: {
  state: SolarState;
  update: (patch: Partial<SolarState>) => void;
}) {
  const [query, setQuery] = useState(state.addressQuery ?? '');
  const [selected, setSelected] = useState<AddressOption | null>(state.address ?? null);
  const [suggestions, setSuggestions] = useState<PlacePrediction[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [buildingInfo, setBuildingInfo] = useState<{ height: number; areaPing: number } | null>(null);
  const [sunHour, setSunHour] = useState<number>(() => {
    const h = new Date().getHours(); // local hour
    return h >= 6 && h <= 18 ? h : 12;
  });
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset local state when parent clears address (e.g. user starts a new evaluation)
  useEffect(() => {
    if (!state.address && !state.addressQuery) {
      setQuery('');
      setSelected(null);
      setSuggestions([]);
      setShowSuggestions(false);
      setBuildingInfo(null);
    }
  }, [state.address, state.addressQuery]);

  // Debounced autocomplete
  useEffect(() => {
    if (!query.trim() || query.length < 2 || selected) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSuggestionsLoading(true);
      try {
        const results = await getPlaceAutocomplete(query);
        setSuggestions(results);
        setShowSuggestions(true);
      } catch {
        setSuggestions([]);
      } finally {
        setSuggestionsLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, selected]);

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const pick = async (prediction: PlacePrediction) => {
    setQuery(prediction.description);
    setShowSuggestions(false);
    setSuggestions([]);
    setBuildingInfo(null);
    try {
      const details = await getPlaceDetails(prediction.placeId);
      const addressOption: AddressOption = {
        label: prediction.description,
        meta: prediction.secondaryText,
        area: 50,
        type: '一般住宅',
        floors: 0,
        region: detectRegion(details.formattedAddress),
        lat: details.lat,
        lng: details.lon,
      };
      setSelected(addressOption);
      update({ address: addressOption, addressQuery: prediction.description, roofArea: 50 });
    } catch (err) {
      console.error('Failed to get place details:', err);
    }
  };

  const handleBuildingFound = (info: { height: number; areaPing: number }) => {
    setBuildingInfo(info);
    // Update roofArea with real polygon footprint (only if user hasn't manually adjusted)
    update({ roofArea: info.areaPing });
  };

  const a = state.address;
  const roofArea = state.roofArea ?? (a?.area ?? 0);
  const estFloors = buildingInfo ? Math.round(buildingInfo.height / 3.2) : null;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 36, alignItems: 'start' }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 16 }}>Step 1 · 地址</div>
          <h2 className="h-title" style={{ margin: '0 0 14px' }}>你家在哪裡？</h2>
          <p className="body" style={{ marginBottom: 28, color: 'var(--ink-500)' }}>
            輸入地址，系統會定位到地圖上的位置，並自動偵測建物資訊。
          </p>

          {/* Search */}
          <div ref={containerRef} style={{ position: 'relative' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '14px 18px',
              background: 'var(--white)', border: '1px solid var(--ink-200)',
              borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-sm)',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink-400)" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" /><path d="M20 20 L16 16" />
              </svg>
              <input
                value={query}
                onChange={e => { setQuery(e.target.value); setSelected(null); }}
                onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
                placeholder="輸入地址或地點名稱"
                style={{
                  flex: 1, border: 'none', outline: 'none', background: 'transparent',
                  fontSize: 15, color: 'var(--ink-900)',
                }}
              />
              {suggestionsLoading && (
                <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid var(--ink-200)', borderTopColor: 'var(--green-700)', animation: 'spin 0.6s linear infinite' }} />
              )}
            </div>

            {showSuggestions && suggestions.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6,
                background: 'var(--white)', border: '1px solid var(--ink-200)',
                borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
                overflow: 'hidden', zIndex: 20,
              }}>
                {suggestions.map((s, i) => (
                  <button
                    key={s.placeId}
                    onMouseDown={() => pick(s)}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--green-50)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    style={{
                      display: 'flex', width: '100%', alignItems: 'center', gap: 12,
                      padding: '12px 16px', textAlign: 'left',
                      borderBottom: i < suggestions.length - 1 ? '1px solid var(--ink-100)' : 'none',
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink-400)" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
                      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" />
                    </svg>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.mainText}</div>
                      {s.secondaryText && (
                        <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.secondaryText}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Confirmed info */}
          {a && (
            <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="body-sm" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green-500)' }} />
                已定位{buildingInfo ? '，偵測到建物資訊' : '，正在偵測建物…'}
              </div>

              {/* Building info row */}
              {buildingInfo && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="card" style={{ padding: '14px 18px' }}>
                    <div className="caption" style={{ marginBottom: 4 }}>建物高度</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                      <span className="num" style={{ fontSize: 22, fontWeight: 700, color: 'var(--green-700)' }}>{buildingInfo.height.toFixed(1)}</span>
                      <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>m</span>
                      {estFloors !== null && (
                        <span style={{ fontSize: 12, color: 'var(--ink-400)', marginLeft: 4 }}>≈ {estFloors} 樓</span>
                      )}
                    </div>
                  </div>
                  <div className="card" style={{ padding: '14px 18px' }}>
                    <div className="caption" style={{ marginBottom: 4 }}>建物基地面積</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                      <span className="num" style={{ fontSize: 22, fontWeight: 700, color: 'var(--green-700)' }}>{buildingInfo.areaPing}</span>
                      <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>坪</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Roof area slider */}
              <div className="card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                  <div className="caption">
                    可用屋頂面積<Info tip="扣除水塔、梯間後約可鋪設面積" />
                  </div>
                  <div>
                    <span className="num" style={{ fontSize: 28, fontWeight: 700, color: 'var(--green-700)' }}>{roofArea}</span>
                    <span style={{ fontSize: 13, color: 'var(--ink-500)', marginLeft: 4 }}>坪</span>
                  </div>
                </div>
                <Slider min={10} max={200} value={roofArea} onChange={v => update({ roofArea: v })} />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                  <span className="caption">10 坪</span>
                  <span className="caption">200 坪</span>
                </div>
              </div>

            </div>
          )}
        </div>

        {/* Map + time slider (always visible) */}
        <div style={{ position: 'sticky', top: 100, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{
            height: 400,
            borderRadius: 'var(--radius-lg)', overflow: 'hidden',
            border: '1px solid var(--ink-100)',
          }}>
            <MapView selectedAddress={a} onBuildingFound={handleBuildingFound} sunHour={sunHour} />
          </div>

          {/* Shadow time slider — always visible, below the map */}
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
              <div className="caption">
                陰影預覽<Info tip="依太陽位置即時計算建物陰影" />
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span className="num" style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink-700)' }}>
                  {String(sunHour).padStart(2, '0')}:00
                </span>
                <span style={{ fontSize: 11, color: 'var(--ink-400)', marginLeft: 4 }}>
                  {sunHour < 12 ? '上午' : sunHour === 12 ? '中午' : '下午'}
                </span>
              </div>
            </div>
            <Slider min={5} max={19} value={sunHour} onChange={setSunHour} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              <span className="caption">05:00 日出</span>
              <span className="caption">19:00 日落</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
