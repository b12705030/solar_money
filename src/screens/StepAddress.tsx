'use client';
import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Info } from '@/components/ui';
import { Slider } from '@/components/Slider';
import { getPlaceAutocomplete, getPlaceDetails, warmAutocompleteCache } from '@/utils/places';
import type { PlacePrediction } from '@/utils/places';
import type { SolarState, AddressOption, Region } from '@/lib/types';

const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  if (!MAPBOX_TOKEN) return null;
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&language=zh-TW&types=address&limit=1`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const name: string | undefined = data.features?.[0]?.place_name;
    return name ? name.replace(/台湾/g, '台灣') : null;
  } catch {
    return null;
  }
}

async function fetchTownshipCode(
  lat: number,
  lng: number,
): Promise<{ townshipCode: string; townshipName: string; countyName: string } | null> {
  try {
    const res = await fetch(`${API_URL}/api/address-township?lat=${lat}&lng=${lng}`);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      townshipCode: data.townshipCode,
      townshipName: data.townshipName,
      countyName:   data.countyName ?? '',
    };
  } catch {
    return null;
  }
}

type SunTimes = { firstHour: number; lastHour: number; sunrise: string; sunset: string };

async function fetchTaiwanSunTimes(): Promise<SunTimes | null> {
  try {
    const res = await fetch(`${API_URL}/api/sun-times/taiwan`);
    if (!res.ok) return null;
    const data = await res.json();
    return { firstHour: data.first_shadow_hour, lastHour: data.last_shadow_hour, sunrise: data.sunrise, sunset: data.sunset };
  } catch {
    return null;
  }
}

function detectRegion(address: string): Region {
  if (/台中|臺中|彰化|南投|苗栗|雲林/.test(address)) return '中部';
  if (/花蓮|台東|臺東/.test(address)) return '東部';  // 含蘭嶼鄉、綠島鄉（臺東縣）
  if (/台南|臺南|高雄|屏東|嘉義|澎湖|金門/.test(address)) return '南部';
  return '北部'; // 台北、新北、基隆、桃園、新竹、宜蘭、連江、馬祖
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
  const [buildingInfo, setBuildingInfo] = useState<{ height: number; areaPing: number; usableFraction?: number } | null>(null);
  const [buildingLoading, setBuildingLoading] = useState(false);
  type LoadingStage = 'idle' | 'buildings' | 'shadows' | 'done';
  const [loadingStage, setLoadingStage] = useState<LoadingStage>('idle');
  const [loadingElapsed, setLoadingElapsed] = useState(0);
  const loadingStartRef = useRef<number>(0);
  const geocodingStartedRef = useRef(false);
  const mapClickDetectionRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [sunHour, setSunHour] = useState<number>(() => {
    const h = new Date().getHours(); // local hour
    return h >= 6 && h <= 18 ? h : 8;
  });
  const [sunTimes, setSunTimes] = useState<SunTimes | null>(null);
  const [buildingNotFoundError, setBuildingNotFoundError] = useState(false);
  const [addressPickError, setAddressPickError] = useState<string | null>(null);
  const [addressResolving, setAddressResolving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);

  // Fetch Taiwan sunrise/sunset once on mount — backend caches by date, costs one compute per day
  useEffect(() => {
    fetchTaiwanSunTimes().then(data => {
      if (!data) return;
      setSunTimes(data);
      setSunHour(h => Math.min(Math.max(h, data.firstHour), data.lastHour));
    });
  }, []);

  // Reset local state when parent clears address (e.g. user starts a new evaluation)
  useEffect(() => {
    if (!state.address && !state.addressQuery) {
      setQuery('');
      setSelected(null);
      setSuggestions([]);
      setShowSuggestions(false);
      setBuildingInfo(null);
      setBuildingLoading(false);
      setLoadingStage('idle');
      setBuildingNotFoundError(false);
      setAddressPickError(null);
      setAddressResolving(false);
    }
  }, [state.address, state.addressQuery]);

  // Debounced autocomplete
  useEffect(() => {
    if (!query.trim() || query.length < 2 || selected) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      if (isComposingRef.current) return;
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

  // 手機鍵盤彈出時，確保輸入框不被遮住
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const handler = () => {
      if (document.activeElement === inputRef.current) {
        inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
    viewport.addEventListener('resize', handler);
    return () => viewport.removeEventListener('resize', handler);
  }, []);

  // loading 計時器：顯示等待秒數
  useEffect(() => {
    if (loadingStage === 'idle' || loadingStage === 'done') {
      setLoadingElapsed(0);
      return;
    }
    loadingStartRef.current = Date.now();
    const interval = setInterval(() => {
      setLoadingElapsed(Math.floor((Date.now() - loadingStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [loadingStage]);

  const pick = async (prediction: PlacePrediction) => {
    warmAutocompleteCache(prediction.description, prediction);
    setQuery(prediction.description);
    setShowSuggestions(false);
    setSuggestions([]);
    setBuildingInfo(null);
    setBuildingNotFoundError(false);
    setAddressPickError(null);
    setAddressResolving(true);
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

      // 立刻觸發地圖偵測，不等 township API
      update({
        address: addressOption,
        addressQuery: prediction.description,
        roofArea: 50,
        roofAreaError: false,
      });
      setAddressResolving(false);

      // Township 在背景執行，只影響費率計算欄位
      fetchTownshipCode(details.lat, details.lon).then(township => {
        if (!township) return;
        const region = detectRegion(township.countyName + (township.townshipName ?? ''));
        update({
          address: { ...addressOption, region },
          townshipCode: township.townshipCode,
          townshipName: township.townshipName,
          county: township.countyName,
        });
      }).catch(() => {});

      // 預熱後端最佳傾角快取，讓 Results 頁面載入更快
      fetch(`${API_URL}/api/township?lat=${details.lat}&lng=${details.lon}&goal=annual`).catch(() => {});
    } catch (err) {
      console.error('Failed to get place details:', err);
      setAddressResolving(false);
      setAddressPickError('地址查詢失敗，請重試');
    }
  };

  const handleDetectionStart = (early?: { lat: number; lng: number; height: number; areaPing: number }) => {
    setBuildingLoading(true);
    setLoadingStage('buildings');
    setBuildingInfo(null);
    setBuildingNotFoundError(false);
    geocodingStartedRef.current = false;
    mapClickDetectionRef.current = !!early;

    if (early && !selected) {
      geocodingStartedRef.current = true;
      // 完全無地址時才顯示佔位符並行 geocoding；有搜尋地址（含 meta='' 的情況）由 handleBuildingFound else 分支處理
      const placeholder: AddressOption = {
        label: '取得地址中…', meta: '', area: early.areaPing,
        type: '一般住宅', floors: 0, region: '北部',
        lat: early.lat, lng: early.lng,
      };
      setSelected(placeholder);
      setQuery('');
      update({ address: placeholder, addressQuery: '' });

      Promise.all([
        fetchTownshipCode(early.lat, early.lng),
        reverseGeocode(early.lat, early.lng),
      ]).then(([township, geocoded]) => {
        const label = geocoded ?? (township
          ? `${township.townshipName}（地圖點選）`
          : `${early.lat.toFixed(5)}, ${early.lng.toFixed(5)}（地圖點選）`);
        const synthetic: AddressOption = {
          label, meta: '', area: early.areaPing, type: '一般住宅', floors: 0,
          region: detectRegion((township?.countyName ?? '') + (township?.townshipName ?? '') || label),
          lat: early.lat, lng: early.lng,
        };
        setSelected(synthetic);
        setQuery(label);
        update({ address: synthetic, addressQuery: label, townshipCode: township?.townshipCode, townshipName: township?.townshipName, county: township?.countyName });
      });
    }
  };

  const handleBuildingNotFound = () => {
    setBuildingLoading(false);
    setLoadingStage('done');
    setBuildingNotFoundError(true);
  };

  const handleBuildingFound = async (info: { height: number; areaPing: number; usableFraction?: number; lat: number; lng: number }) => {
    setLoadingStage('shadows');
    setBuildingInfo({ height: info.height, areaPing: info.areaPing, usableFraction: info.usableFraction });
    const usableAreaVal = Math.round(info.areaPing * (info.usableFraction ?? 0.6));
    update({ roofArea: usableAreaVal, roofAreaMax: usableAreaVal, roofAreaError: false, ...(info.usableFraction !== undefined && { usableFraction: info.usableFraction }) });

    if (geocodingStartedRef.current) {
      // 地圖點選路徑：geocoding 已在 handleDetectionStart 並行跑，address 會自行更新
    } else if (!selected || selected.meta === '') {
      // 無提前 geocoding（理論上不常發生）→ 同步補做
      const [township, geocoded] = await Promise.all([
        fetchTownshipCode(info.lat, info.lng),
        reverseGeocode(info.lat, info.lng),
      ]);
      const label = geocoded ?? (township
        ? `${township.townshipName}（地圖點選）`
        : `${info.lat.toFixed(5)}, ${info.lng.toFixed(5)}（地圖點選）`);
      const synthetic: AddressOption = {
        label, meta: '', area: info.areaPing, type: '一般住宅', floors: 0,
        region: detectRegion((township?.countyName ?? '') + (township?.townshipName ?? '') || label), lat: info.lat, lng: info.lng,
      };
      setSelected(synthetic);
      setQuery(label);
      update({ address: synthetic, addressQuery: label, townshipCode: township?.townshipCode, townshipName: township?.townshipName, county: township?.countyName });
    } else if (mapClickDetectionRef.current) {
      // 使用者在地圖上點選建物（已有自動完成地址）→ 更新為點選位置的地址
      const [township, geocoded] = await Promise.all([
        fetchTownshipCode(info.lat, info.lng),
        reverseGeocode(info.lat, info.lng),
      ]);
      const label = geocoded ?? (township
        ? `${township.townshipName}（地圖點選）`
        : `${info.lat.toFixed(5)}, ${info.lng.toFixed(5)}（地圖點選）`);
      const synthetic: AddressOption = {
        label, meta: '', area: info.areaPing, type: '一般住宅', floors: 0,
        region: detectRegion((township?.countyName ?? '') + (township?.townshipName ?? '') || label),
        lat: info.lat, lng: info.lng,
      };
      setSelected(synthetic);
      setQuery(label);
      update({
        address: synthetic,
        addressQuery: label,
        ...(township && { townshipCode: township.townshipCode, townshipName: township.townshipName, county: township.countyName }),
      });
    } else {
      // 自動完成選擇後的自動偵測 — 保留原始地址文字不變，
      // 只更新費率計算所需的行政區代碼
      const township = await fetchTownshipCode(info.lat, info.lng);
      if (township) {
        update({
          townshipCode: township.townshipCode,
          townshipName: township.townshipName,
          county: township.countyName,
        });
      }
    }
    setBuildingLoading(false);
    setLoadingStage('done');
  };

  const a = state.address;
  const roofArea = state.roofArea ?? (a?.area ?? 0);
  const [areaRaw, setAreaRaw] = useState(String(roofArea));
  const [areaError, setAreaError] = useState(false);
  useEffect(() => { setAreaRaw(String(roofArea)); setAreaError(false); }, [roofArea]);
  const estFloors = buildingInfo ? Math.round(buildingInfo.height / 3.2) : null;
  const usableArea = buildingInfo ? Math.round(buildingInfo.areaPing * (state.usableFraction ?? 0.6)) : null;

  return (
    <div>
      <div className="step-address-grid">
        <div>
          <div className="eyebrow" style={{ marginBottom: 16 }}>Step 1 · 地址</div>
          <h2 className="h-title" style={{ margin: '0 0 14px' }}>你家在哪裡？</h2>
          <p className="body step-address-desc" style={{ color: 'var(--ink-500)' }}>
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
                ref={inputRef}
                inputMode="search"
                autoComplete="street-address"
                value={query}
                onChange={e => { setQuery(e.target.value); setSelected(null); setAddressPickError(null); }}
                onCompositionStart={() => { isComposingRef.current = true; }}
                onCompositionEnd={() => { isComposingRef.current = false; }}
                onFocus={() => {
                  if (suggestions.length > 0) setShowSuggestions(true);
                  setTimeout(() => {
                    inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }, 300);
                }}
                placeholder="例：台北市信義區信義路五段7號"
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
                maxHeight: '40vh', overflowY: 'auto',
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

          {/* 解析地址中 */}
          {addressResolving && (
            <p style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-400)' }}>正在解析地址…</p>
          )}

          {/* 地址查詢錯誤 / 無結果提示 */}
          {!addressResolving && (addressPickError || (query.length > 3 && !showSuggestions && suggestions.length === 0 && !buildingLoading && !selected)) && (
            <div style={{ marginTop: 6, fontSize: 12 }}>
              {addressPickError
                ? <span style={{ color: 'var(--red-600, #dc2626)' }}>{addressPickError}</span>
                : <span style={{ color: 'var(--ink-500)' }}>找不到符合地址，請輸入更完整的地址，例如：<strong>台北市信義區信義路五段7號</strong></span>
              }
            </div>
          )}

          {!selected && !addressPickError && !addressResolving && (
            <p style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-400)' }}>
              或直接在地圖上點選建物
            </p>
          )}

          {/* Confirmed info */}
          {(a || buildingLoading) && (
            <div className="address-confirmed-section" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="body-sm" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {buildingLoading ? (
                  <>
                    <div style={{
                      width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                      border: '2px solid var(--ink-200)', borderTopColor: 'var(--green-600)',
                      animation: 'spin 0.6s linear infinite',
                    }} />
                    <span>
                      {loadingStage === 'buildings' ? '1/3 取得建物資料' : '2/3 計算遮蔽分析'}
                      {loadingElapsed >= 4 && (
                        <span style={{ color: 'var(--ink-400)', marginLeft: 6 }}>（已等待 {loadingElapsed}s…）</span>
                      )}
                    </span>
                  </>
                ) : (
                  <>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: buildingInfo ? 'var(--green-500)' : 'var(--ink-300)' }} />
                    {buildingInfo ? '已定位，偵測到建物資訊' : '已定位，正在偵測建物…'}
                  </>
                )}
              </div>

              {/* Building info row + roof area slider */}
              {buildingLoading ? (
                <>
                  <div className="building-info-grid">
                    {[0, 1, 2].map(i => (
                      <div key={i} className="card" style={{ minHeight: 66 }}>
                        <div style={{ height: 10, width: '45%', borderRadius: 4, background: 'var(--ink-100)', marginBottom: 10 }} />
                        <div style={{ height: 22, width: '60%', borderRadius: 4, background: 'var(--ink-100)' }} />
                      </div>
                    ))}
                  </div>
                  <div className="card slider-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                      <div style={{ height: 10, width: '38%', borderRadius: 4, background: 'var(--ink-100)' }} />
                      <div style={{ height: 28, width: '15%', borderRadius: 4, background: 'var(--ink-100)' }} />
                    </div>
                    <div style={{ height: 6, borderRadius: 4, background: 'var(--ink-100)' }} />
                  </div>
                </>
              ) : (
                <>
                  {/* 問題一：查無建物資料錯誤提示 */}
                  {buildingNotFoundError && (
                    <div className="card" style={{ color: 'var(--red-600, #dc2626)', fontSize: 13, lineHeight: 1.5 }}>
                      查無此地址的建物資料。請嘗試在地圖上直接點選建物，或輸入更精確的地址（例如加上縣市、區域）。
                    </div>
                  )}

                  {!buildingNotFoundError && (
                    <>
                      {buildingInfo && (
                        <>
                          <div className="building-info-grid">
                            <div className="card">
                              <div className="caption" style={{ marginBottom: 4 }}>建物高度</div>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                                <span className="num building-info-num" style={{ fontWeight: 700, color: 'var(--green-700)' }}>{buildingInfo.height.toFixed(1)}</span>
                                <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>m</span>
                              </div>
                              {estFloors !== null && (
                                <span style={{ fontSize: 12, color: 'var(--ink-400)', display: 'block', marginTop: 1 }}>≈ {estFloors} 樓</span>
                              )}
                            </div>
                            <div className="card">
                              <div className="caption" style={{ marginBottom: 4 }}>建物基地面積</div>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                                <span className="num building-info-num" style={{ fontWeight: 700, color: 'var(--green-700)' }}>{buildingInfo.areaPing}</span>
                                <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>坪</span>
                              </div>
                            </div>
                            <div className="card">
                              <div className="caption" style={{ marginBottom: 4 }}>
                                可受光屋頂面積
                                <Info tip={`取樣 08/10/12/14/16 時的周邊建物陰影遮蔽比例平均，加上屋頂邊緣退縮 1m（欄杆安全距離），結果限縮於 10%–95%。\n鄰棟有效高度含 DEM 地形修正（考量地面高低差）。`} />
                              </div>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                                <span className="num building-info-num" style={{ fontWeight: 700, color: 'var(--green-700)' }}>{usableArea}</span>
                                <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>坪</span>
                              </div>
                              <span style={{ fontSize: 11, color: 'var(--ink-400)', display: 'block', marginTop: 2 }}>
                                {buildingInfo.areaPing} 坪 × {Math.round((state.usableFraction ?? 0.6) * 100)}%（陰影遮蔽＋邊緣退縮）
                              </span>
                            </div>
                          </div>
                        </>
                      )}

                      {/* 問題四：面積拉霸 */}
                      <div className="card slider-card">
                        <div className="slider-card-header" style={{ display: 'flex', alignItems: 'baseline' }}>
                          <div className="caption">
                            {/* 問題四：改為更直觀的標題 */}
                            可安裝面積（扣除屋頂設施後）<Info tip="上限為系統依陰影模擬估算的可鋪設面積。向左拖曳可扣除水塔、機房等屋頂設施佔用的面積。" />
                          </div>
                          <div style={{ flex: 1, textAlign: 'right', paddingRight: 8, minWidth: 0 }}>
                            {areaError && (
                              <span style={{ fontSize: 12, color: 'var(--red-600, #dc2626)', whiteSpace: 'nowrap' }}>
                                {Number(areaRaw) > (state.roofAreaMax ?? 500)
                                  ? `不可超過可用面積 ${state.roofAreaMax} 坪`
                                  : '請輸入有效坪數'}
                              </span>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                            <input
                              type="number" min="1" max="500"
                              value={areaRaw}
                              onChange={e => { setAreaRaw(e.target.value); setAreaError(false); }}
                              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                              onBlur={e => {
                                const v = Math.round(+e.target.value);
                                const max = state.roofAreaMax ?? 500;
                                if (!v || v < 1 || v > max) { setAreaError(true); update({ roofAreaError: true }); return; }
                                setAreaError(false);
                                update({ roofArea: v, roofAreaError: false });
                              }}
                              className="num roof-area-input"
                              style={{
                                fontWeight: 700, width: `${Math.max(2, areaRaw.length) + 1}ch`,
                                color: areaError ? 'var(--red-600, #dc2626)' : 'var(--green-700)',
                                border: 'none', outline: 'none', background: 'transparent', padding: 0,
                                textAlign: 'right',
                              }}
                            />
                            <span style={{ fontSize: 13, color: 'var(--ink-500)' }}>坪</span>
                          </div>
                        </div>
                        {/* 問題四：公式列 */}
                        {usableArea && (
                          <div style={{ fontSize: 12, color: 'var(--ink-500)', margin: '6px 0 4px', display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'baseline' }}>
                            <span>預估可用 <strong>{usableArea}</strong> 坪</span>
                            <span style={{ color: 'var(--ink-300)' }}>−</span>
                            <span>屋頂設施 <strong>{usableArea - roofArea}</strong> 坪</span>
                            <span style={{ color: 'var(--ink-300)' }}>=</span>
                            <span style={{ color: 'var(--green-700)', fontWeight: 700 }}>{roofArea} 坪</span>
                          </div>
                        )}
                        <Slider
                          min={1} max={usableArea ?? 200}
                          value={roofArea}
                          onChange={v => { update({ roofArea: v, roofAreaError: false }); setAreaError(false); }}
                        />
                        <div className="slider-card-labels" style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span className="caption">1 坪</span>
                          <span className="caption">{usableArea ?? 200} 坪（系統估算上限）</span>
                        </div>
                        {usableArea && (
                          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-400)' }}>
                            向左拖曳以扣除水塔、機房等屋頂設施的佔用面積
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}

            </div>
          )}
        </div>

        {/* Map + time slider (always visible) */}
        <div className="step-address-map-col">
          <div className="step-address-map-view">
            <MapView
              selectedAddress={a}
              onBuildingFound={handleBuildingFound}
              onBuildingNotFound={handleBuildingNotFound}
              onDetectionStart={handleDetectionStart}
              sunHour={sunHour}
            />
          </div>

          {/* Shadow time slider — always visible, below the map */}
          <div className="card slider-card">
            <div className="slider-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div className="caption">
                陰影預覽<Info tip="拖曳時間軸可預覽不同時段的陰影遮蔽範圍。深色區域表示屋頂被周邊建物遮蔽、發電效率較低；淺色（無陰影）區域為有效發電面積。可受光屋頂面積已將全日平均遮蔽比例納入計算。" />
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
            <Slider min={sunTimes?.firstHour ?? 6} max={sunTimes?.lastHour ?? 18} value={sunHour} onChange={setSunHour} />
            <div className="slider-card-labels" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="caption">日出 {sunTimes?.sunrise ?? '—'}</span>
              <span className="caption">日落 {sunTimes?.sunset ?? '—'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* GBA data source disclaimer — always visible, above footer nav */}
      <div style={{
        marginTop: 24, padding: '10px 14px', borderRadius: 10,
        background: 'var(--ink-50)', border: '1px solid var(--ink-150)',
        fontSize: 11, color: 'var(--ink-500)', lineHeight: 1.6,
      }}>
        <span style={{ fontWeight: 600, color: 'var(--ink-600)' }}>
          建物資料來源：GlobalBuildingAtlas（機器學習衍生產品）
        </span>
        　建物形狀、高度與面積為機器學習模型推估值，可能存在誤差；部分建築物可能未收錄。
        This is a machine-learning–derived product — errors may occur. Please refer to the{' '}
        <a
          href="https://github.com/zhu-xlab/GlobalBuildingAtlas"
          target="_blank" rel="noopener noreferrer"
          style={{ color: 'var(--green-700)', textDecoration: 'underline' }}
        >
          publication
        </a>
        {' '}for validation results and further details.
      </div>
    </div>
  );
}
