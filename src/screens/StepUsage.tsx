'use client';
import { useState } from 'react';
import { Badge, SunIcon } from '@/components/ui';
import { Slider } from '@/components/Slider';
import type { SolarState } from '@/lib/types';
import { TEPCO_MONTHLY_NORM } from '@/lib/compute';

const MONTH_LABELS = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

function tariffLabel(kwh: number): string {
  if (kwh <= 330) return '非夏月 1.63 元/度';
  if (kwh <= 500) return '第二級 2.10 元/度';
  return '第三級 2.89 元/度';
}

function annualCost(kwh: number): number {
  const rate = kwh <= 330 ? 1.63 : kwh <= 500 ? 2.1 : 2.89;
  return Math.round(kwh * 12 * rate);
}

export default function StepUsage({
  state, update,
}: {
  state: SolarState;
  update: (patch: Partial<SolarState>) => void;
}) {
  const kwh = state.monthlyKwh ?? 350;
  const [expanded, setExpanded] = useState(false);

  // 展開時顯示的 12 月數值：優先用使用者已輸入的，否則以台電曲線 × 月均值預填
  const displayMonthly: number[] = state.monthlyUsage?.length === 12
    ? state.monthlyUsage
    : TEPCO_MONTHLY_NORM.map(w => Math.round(kwh * w));

  function handleMonthChange(idx: number, val: number) {
    const next = [...displayMonthly];
    next[idx] = Math.max(0, Math.min(5000, val || 0));
    update({ monthlyUsage: next });
  }

  function handleReset() {
    update({ monthlyUsage: undefined });
  }

  return (
    <div>
      <div style={{ maxWidth: 720 }}>
        <div className="eyebrow" style={{ marginBottom: 16 }}>Step 2 · 用電狀況</div>
        <h2 className="h-title" style={{ margin: '0 0 14px' }}>你家每個月用多少電？</h2>
        <p className="body" style={{ marginBottom: 40, color: 'var(--ink-500)' }}>
          不確定？可以看台電帳單的「本期用電度數」，或直接用台灣家庭平均值繼續。
        </p>
      </div>

      <div className="step-usage-grid">
        {/* Input card */}
        <div className="card elevated" style={{ padding: 36 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 24 }}>
            <div className="body-sm">月均用電度數</div>
            {kwh === 350 && <Badge tone="ink">預設值</Badge>}
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 30 }}>
            <input
              type="number" min="50" max="2000" value={kwh}
              onChange={e => update({ monthlyKwh: Math.max(50, Math.min(2000, +e.target.value || 0)) })}
              className="num"
              style={{
                fontSize: 72, fontWeight: 700, color: 'var(--green-700)',
                border: 'none', outline: 'none', background: 'transparent',
                width: `${String(kwh).length + 0.3}ch`, padding: 0,
              }}
            />
            <span style={{ fontSize: 22, color: 'var(--ink-500)', fontWeight: 500 }}>度 / 月</span>
          </div>

          <Slider min={100} max={1200} value={kwh} onChange={v => { update({ monthlyKwh: v }); if (!state.monthlyUsage) return; }} />
          <div style={{ position: 'relative', height: 36, marginTop: 8 }}>
            {([
              { value: 100,  label: '100',    sub: '小家庭',   align: 'left'   },
              { value: 350,  label: '350',    sub: '平均',     align: 'center' },
              { value: 700,  label: '700',    sub: '多人家庭', align: 'center' },
              { value: 1200, label: '1,200+', sub: '大用電戶', align: 'right'  },
            ] as const).map(({ value, label, sub, align }) => {
              const pct = (value - 100) / (1200 - 100) * 100;
              // Correct for 22px thumb: center at 11px from edges, not 0%/100%
              const left = `calc(${pct}% + ${(11 - pct * 0.22).toFixed(1)}px)`;
              const transform = align === 'left' ? 'none' : align === 'right' ? 'translateX(-100%)' : 'translateX(-50%)';
              return (
                <div key={value} style={{
                  position: 'absolute', left, transform,
                  textAlign: align, whiteSpace: 'nowrap',
                  opacity: value === 350 ? (kwh >= 300 && kwh <= 400 ? 1 : 0.4) : 1,
                }}>
                  <div className="num" style={{ fontSize: 13, fontWeight: 600, color: value === 350 ? 'var(--green-700)' : undefined }}>{label}</div>
                  <div className="caption">{sub}</div>
                </div>
              );
            })}
          </div>
          {/* 12 月展開區塊 */}
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--ink-100)' }}>
            <button
              onClick={() => setExpanded(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                fontSize: 13, fontWeight: 600, color: 'var(--green-700)',
              }}
            >
              <span style={{ display: 'inline-block', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>▶</span>
              展開每月用電量
              {state.monthlyUsage && <Badge tone="green">已自訂</Badge>}
            </button>

            {expanded && (
              <div style={{ marginTop: 16 }}>
                <p className="body-sm" style={{ color: 'var(--ink-500)', marginBottom: 12 }}>
                  輸入每月實際用電量，供「配合用電」目標個人化計算。未輸入時自動套用台電住宅平均用電曲線。
                </p>
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8,
                }}>
                  {MONTH_LABELS.map((label, i) => (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div className="caption" style={{ textAlign: 'center', color: (i >= 5 && i <= 8) ? 'var(--amber)' : 'var(--ink-400)' }}>
                        {label}
                      </div>
                      <input
                        type="number" min="0" max="5000"
                        value={displayMonthly[i]}
                        onChange={e => handleMonthChange(i, +e.target.value)}
                        style={{
                          width: '100%', textAlign: 'center', padding: '6px 4px',
                          border: '1px solid var(--ink-200)', borderRadius: 6,
                          fontSize: 13, fontFamily: 'var(--font-num)',
                          background: (i >= 5 && i <= 8) ? 'var(--amber-50, #fffbeb)' : 'white',
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                  <div className="body-sm" style={{ color: 'var(--ink-400)' }}>
                    年總計：<b>{displayMonthly.reduce((a, b) => a + b, 0).toLocaleString()}</b> kWh
                  </div>
                  {state.monthlyUsage && (
                    <button onClick={handleReset}
                      style={{ fontSize: 12, color: 'var(--ink-400)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                      重設為台電平均曲線
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Context card */}
        <div className="card" style={{ padding: 28, background: 'var(--green-50)', borderColor: 'var(--green-200)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <SunIcon size={18} color="var(--green-700)" />
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--green-700)' }}>依此估算</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <div className="caption">目前電費級距</div>
              <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{tariffLabel(kwh)}</div>
            </div>
            <div>
              <div className="caption">年用電量估計</div>
              <div>
                <span className="num" style={{ fontSize: 28, fontWeight: 700, color: 'var(--green-700)' }}>
                  {(kwh * 12).toLocaleString()}
                </span>
                <span style={{ fontSize: 14, color: 'var(--ink-500)', marginLeft: 6 }}>kWh / 年</span>
              </div>
            </div>
            <div>
              <div className="caption">年電費支出</div>
              <div>
                <span className="num" style={{ fontSize: 28, fontWeight: 700 }}>
                  NT$ {annualCost(kwh).toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--green-200)' }}>
            <div className="body-sm" style={{ color: 'var(--ink-500)' }}>
              ⓘ 級距依 2025 年台電民生用電表估算，實際帳單可能因夏/非夏月、時段而異。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
