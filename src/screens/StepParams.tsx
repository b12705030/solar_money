'use client';
import { useEffect } from 'react';
import { Info } from '@/components/ui';
import { Slider } from '@/components/Slider';
import { SUBSIDIES } from '@/lib/constants';
import { guessCounty } from '@/lib/compute';
import type { SolarState } from '@/lib/types';

export default function StepParams({
  state, update,
}: {
  state: SolarState;
  update: (patch: Partial<SolarState>) => void;
}) {
  const area = state.roofArea ?? 78;
  // ~0.165 kW per m², 1 坪 ≈ 3.3 m², usable ratio 0.6
  const capacity = parseFloat((area * 3.3 * 0.6 * 0.165).toFixed(1));
  const costPerKw = state.costPerKw ?? 55000;
  const totalCost = Math.round(capacity * costPerKw);
  const county = guessCounty(state.address?.label);
  const subsidy = SUBSIDIES[county] ?? SUBSIDIES['台北市'];
  const subsidyAmount = subsidy.amount * capacity;
  const outOfPocket = totalCost - subsidyAmount;

  useEffect(() => {
    update({ capacity, totalCost, subsidyAmount, outOfPocket, county });
  }, [capacity, costPerKw, county]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div style={{ maxWidth: 720, marginBottom: 36 }}>
        <div className="eyebrow" style={{ marginBottom: 16 }}>Step 4 · 基本參數</div>
        <h2 className="h-title" style={{ margin: '0 0 14px' }}>確認安裝參數</h2>
        <p className="body" style={{ color: 'var(--ink-500)' }}>
          系統根據你的屋頂面積估算可裝容量，並帶入 <b style={{ color: 'var(--green-700)' }}>{county}</b> 的政府補助金額。你可以調整安裝單價。
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Capacity card */}
          <div className="card" style={{
            padding: 26,
            background: 'var(--green-900)', color: 'var(--white)',
            borderColor: 'transparent', position: 'relative', overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute', top: -40, right: -40, width: 180, height: 180, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(232,165,60,0.25), transparent 70%)',
            }} />
            <div style={{ fontSize: 12, opacity: 0.7, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
              預估安裝容量
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span className="num" style={{ fontSize: 64, fontWeight: 700, lineHeight: 1 }}>{capacity}</span>
              <span style={{ fontSize: 20, opacity: 0.8 }}>kW</span>
              <Info tip="根據屋頂面積、可用比例與板效率估算" />
            </div>
            <div style={{ marginTop: 14, display: 'flex', gap: 20, fontSize: 13, opacity: 0.8, position: 'relative' }}>
              <div>約需板子 <b className="num" style={{ color: 'var(--amber)' }}>{Math.round(capacity / 0.45)}</b> 片</div>
              <div>占用屋頂 <b className="num" style={{ color: 'var(--amber)' }}>{area}</b> 坪</div>
            </div>
          </div>

          {/* Cost slider */}
          <div className="card" style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
              <div className="caption">
                安裝單價<Info tip="台灣市場 2025 年均價約 NT$ 50,000 – 60,000 / kW" />
              </div>
              <div>
                <span className="num" style={{ fontSize: 24, fontWeight: 700, color: 'var(--green-700)' }}>
                  NT$ {costPerKw.toLocaleString()}
                </span>
                <span style={{ fontSize: 12, color: 'var(--ink-500)', marginLeft: 4 }}>/ kW</span>
              </div>
            </div>
            <Slider min={40000} max={75000} step={1000} value={costPerKw} onChange={v => update({ costPerKw: v })} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              <span className="caption">40,000（競爭價）</span>
              <span className="caption">75,000（高規）</span>
            </div>
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--ink-100)', display: 'flex', justifyContent: 'space-between' }}>
              <span className="body-sm">總安裝費用</span>
              <span className="num" style={{ fontSize: 20, fontWeight: 700 }}>NT$ {totalCost.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Subsidy card */}
        <div className="card" style={{ padding: 26 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--amber-soft)', display: 'grid', placeItems: 'center' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#8B5A10" strokeWidth="1.6">
                <path d="M8 2 L8 14 M4 5 Q 4 3 6 3 L10 3 Q 12 3 12 5 Q 12 7 10 7 L6 7 Q 4 7 4 9 Q 4 11 6 11 L10 11 Q 12 11 12 13" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)' }}>政府補助快查</div>
              <div className="caption">{county} · {subsidy.source}</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="body-sm">補助標準</span>
              <span className="num" style={{ fontSize: 14, fontWeight: 500 }}>NT$ {subsidy.amount.toLocaleString()} / kW</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="body-sm">適用容量</span>
              <span className="num" style={{ fontSize: 14, fontWeight: 500 }}>{capacity} kW</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, borderTop: '1px dashed var(--ink-200)' }}>
              <span className="body-sm" style={{ color: 'var(--green-700)', fontWeight: 500 }}>可領補助</span>
              <span className="num" style={{ fontSize: 18, fontWeight: 700, color: 'var(--green-700)' }}>
                − NT$ {Math.round(subsidyAmount).toLocaleString()}
              </span>
            </div>
          </div>

          <a href="#" style={{ fontSize: 12, color: 'var(--green-700)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
            查看 {county} 補助申請辦法 →
          </a>

          <div style={{
            marginTop: 22, padding: '20px 18px',
            background: 'var(--green-50)', borderRadius: 'var(--radius-md)',
            borderLeft: '3px solid var(--green-700)',
          }}>
            <div className="caption">實際自付金額</div>
            <div className="num" style={{ fontSize: 36, fontWeight: 700, color: 'var(--green-900)', marginTop: 4 }}>
              NT$ {Math.round(outOfPocket).toLocaleString()}
            </div>
            <div className="body-sm" style={{ marginTop: 6 }}>
              = 總費用 {totalCost.toLocaleString()} − 補助 {Math.round(subsidyAmount).toLocaleString()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
