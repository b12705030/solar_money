'use client';
import { useState } from 'react';
import { Info, ChevronIcon, SunIcon } from '@/components/ui';
import { SUGGESTIONS } from '@/lib/constants';
import type { SolarState, AddressOption } from '@/lib/types';

function MapPreview({ address }: { address?: AddressOption }) {
  const highlighted = !!address;
  return (
    <div style={{
      position: 'relative', width: '100%', height: '100%',
      background: 'linear-gradient(135deg, #E8EEE7 0%, #DCE5DA 100%)',
    }}>
      <svg viewBox="0 0 400 400" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        {/* Roads */}
        <path d="M -20 120 Q 100 110 220 140 T 420 180" stroke="#FFFFFF" strokeWidth="14" fill="none" opacity="0.9" />
        <path d="M 80 -20 Q 90 150 120 280 T 160 420" stroke="#FFFFFF" strokeWidth="10" fill="none" opacity="0.9" />
        <path d="M 260 -20 Q 280 200 300 420" stroke="#FFFFFF" strokeWidth="10" fill="none" opacity="0.9" />
        <path d="M -20 320 Q 200 310 420 340" stroke="#FFFFFF" strokeWidth="8" fill="none" opacity="0.9" />
        <path d="M -20 120 Q 100 110 220 140 T 420 180" stroke="#DDE8DB" strokeWidth="2" strokeDasharray="8 8" fill="none" />

        {/* Building blocks */}
        {([
          [40, 40, 30, 50], [140, 40, 60, 45], [220, 50, 30, 40], [320, 40, 50, 50],
          [40, 180, 40, 60], [170, 200, 40, 60], [330, 220, 40, 50],
          [40, 340, 50, 40], [190, 350, 40, 40], [340, 360, 50, 40],
        ] as [number, number, number, number][]).map(([x, y, w, h], i) => (
          <rect key={i} x={x} y={y} width={w} height={h} fill="#FFFFFF" stroke="#C9D4C7" strokeWidth="1" rx="2" opacity="0.85" />
        ))}

        {/* Greenery */}
        <circle cx="60"  cy="260" r="18" fill="#B7E4C7" opacity="0.6" />
        <circle cx="110" cy="280" r="12" fill="#B7E4C7" opacity="0.6" />
        <circle cx="370" cy="140" r="16" fill="#B7E4C7" opacity="0.6" />

        {/* Target building */}
        {highlighted && (
          <g style={{ transformOrigin: '200px 200px', animation: 'pulse-building 0.6s var(--ease-out)' }}>
            <rect x="170" y="165" width="70" height="75" fill="#2D6A4F" stroke="#1B4332" strokeWidth="2" rx="3" />
            {[0, 1, 2].map(r => [0, 1, 2].map(c => (
              <rect key={`${r}-${c}`} x={177 + c * 19} y={172 + r * 22} width="15" height="18" fill="#40916C" stroke="#1B4332" strokeWidth="0.6" />
            )))}
            <circle cx="205" cy="202" r="60" fill="none" stroke="#2D6A4F" strokeWidth="2" strokeDasharray="4 6" opacity="0.5" />
            <circle cx="205" cy="202" r="80" fill="none" stroke="#2D6A4F" strokeWidth="1" strokeDasharray="2 4" opacity="0.3" />
          </g>
        )}
      </svg>

      {!highlighted && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--ink-400)', fontSize: 13 }}>
          輸入地址以顯示建物位置
        </div>
      )}

      {highlighted && (
        <>
          <div style={{
            position: 'absolute', top: 16, left: 16,
            padding: '8px 14px', background: 'rgba(255,255,255,0.95)',
            backdropFilter: 'blur(4px)', borderRadius: 999,
            fontSize: 12, color: 'var(--ink-700)',
            display: 'flex', alignItems: 'center', gap: 8,
            boxShadow: 'var(--shadow-sm)',
          }}>
            <SunIcon size={14} color="#E8A53C" /> 年均日照 1,580 kWh/m²
          </div>
          <div style={{
            position: 'absolute', bottom: 16, right: 16,
            padding: '8px 14px', background: 'var(--green-700)', color: 'var(--white)',
            borderRadius: 999, fontSize: 12,
            display: 'flex', alignItems: 'center', gap: 8,
            boxShadow: 'var(--shadow-md)', fontWeight: 500,
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--amber)' }} />
            已定位建物
          </div>
          {/* Compass */}
          <div style={{
            position: 'absolute', top: 16, right: 16,
            width: 44, height: 44, borderRadius: '50%',
            background: 'rgba(255,255,255,0.95)',
            display: 'grid', placeItems: 'center',
            boxShadow: 'var(--shadow-sm)',
            fontSize: 11, color: 'var(--ink-500)', fontWeight: 600,
          }}>
            <div style={{ position: 'absolute', top: 4, color: 'var(--danger)' }}>N</div>
            <div style={{ width: 2, height: 22, background: 'linear-gradient(var(--danger) 50%, var(--ink-400) 50%)' }} />
          </div>
        </>
      )}
    </div>
  );
}

export default function StepAddress({
  state, update,
}: {
  state: SolarState;
  update: (patch: Partial<SolarState>) => void;
}) {
  const [query, setQuery] = useState(state.addressQuery ?? '');
  const [selected, setSelected] = useState<AddressOption | null>(state.address ?? null);

  const filtered = query
    ? SUGGESTIONS.filter(s => s.label.includes(query) || query.length < 2)
    : SUGGESTIONS;

  const pick = (s: AddressOption) => {
    setSelected(s);
    setQuery(s.label);
    update({ address: s, addressQuery: s.label, roofArea: s.area });
  };

  const a = state.address;
  const roofArea = state.roofArea ?? (a?.area ?? 0);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.15fr', gap: 44, alignItems: 'start' }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 16 }}>Step 1 · 地址</div>
          <h2 className="h-title" style={{ margin: '0 0 14px' }}>你家在哪裡？</h2>
          <p className="body" style={{ marginBottom: 28, color: 'var(--ink-500)' }}>
            輸入地址後，系統會從建物資料庫帶入屋頂面積、樓層等資訊。你可以手動調整。
          </p>

          {/* Search */}
          <div style={{ position: 'relative' }}>
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
                placeholder="輸入地址或地段（例：台北市信義區松仁路）"
                style={{
                  flex: 1, border: 'none', outline: 'none', background: 'transparent',
                  fontSize: 15, color: 'var(--ink-900)',
                }}
              />
            </div>

            {query && !selected && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6,
                background: 'var(--white)', border: '1px solid var(--ink-200)',
                borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
                overflow: 'hidden', zIndex: 20,
              }}>
                {filtered.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => pick(s)}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--green-50)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    style={{
                      display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px 16px', textAlign: 'left',
                      borderBottom: i < filtered.length - 1 ? '1px solid var(--ink-100)' : 'none',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-900)' }}>{s.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 2 }}>{s.meta}</div>
                    </div>
                    <ChevronIcon dir="right" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Detected info */}
          {a && (
            <div style={{ marginTop: 28 }}>
              <div className="body-sm" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green-500)' }} />
                系統自動帶入（可調整）
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                <div className="card" style={{ padding: 16 }}>
                  <div className="caption">建物類型</div>
                  <div style={{ fontSize: 16, fontWeight: 500, marginTop: 4 }}>{a.type}</div>
                </div>
                <div className="card" style={{ padding: 16 }}>
                  <div className="caption">樓層數</div>
                  <div className="num" style={{ fontSize: 16, fontWeight: 500, marginTop: 4 }}>{a.floors} 層</div>
                </div>
              </div>

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
                <input
                  type="range" min="10" max="200" value={roofArea}
                  onChange={e => update({ roofArea: +e.target.value })}
                  style={{ width: '100%' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                  <span className="caption">10 坪</span>
                  <span className="caption">200 坪</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Map preview */}
        <div style={{
          position: 'sticky', top: 100,
          aspectRatio: '1 / 1',
          borderRadius: 'var(--radius-lg)', overflow: 'hidden',
          border: '1px solid var(--ink-100)', background: 'var(--paper-2)',
        }}>
          <MapPreview address={a} />
        </div>
      </div>
    </div>
  );
}
