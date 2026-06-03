'use client';
import { useState, useEffect } from 'react';
import { Badge, SunIcon } from '@/components/ui';
import { Slider } from '@/components/Slider';
import type { SolarState } from '@/lib/types';
import { TEPCO_MONTHLY_NORM, SELF_USE_CAP, computeMonthlyBill, convertBillToMonthlyKwh } from '@/lib/compute';

const MONTH_LABELS = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

const HABITS = [
  { id: 'home'   as const, label: '白天在家',  desc: 'WFH・退休・長時在宅' },
  { id: 'normal' as const, label: '一般作息',  desc: '早出晚歸・預設值'     },
  { id: 'away'   as const, label: '白天外出',  desc: '夜間用電為主'         },
];

function tierLabel(kwh: number, isSummer: boolean): string {
  if (kwh <= 120)  return '第一段 1.78 元/度';
  if (kwh <= 330)  return isSummer ? '第二段 2.55 元/度' : '第二段 2.26 元/度';
  if (kwh <= 500)  return isSummer ? '第三段 3.80 元/度' : '第三段 3.13 元/度';
  if (kwh <= 700)  return isSummer ? '第四段 5.14 元/度' : '第四段 4.24 元/度';
  if (kwh <= 1000) return isSummer ? '第五段 6.44 元/度' : '第五段 5.27 元/度';
  return isSummer ? '第六段 8.86 元/度' : '第六段 7.03 元/度';
}

export default function StepUsage({
  state, update,
}: {
  state: SolarState;
  update: (patch: Partial<SolarState>) => void;
}) {
  const inputMethod = state.inputMethod ?? 'bill';
  const billSeason  = state.billSeason  ?? 'nonSummer';
  const isSummer    = billSeason === 'summer';
  const kwh         = state.monthlyKwh ?? 350;
  const habit       = state.selfUseHabit ?? 'normal';
  const [expanded, setExpanded] = useState(false);

  const defaultBill = computeMonthlyBill(kwh, isSummer) * 2;
  const billAmount  = state.billAmount ?? defaultBill;

  // Seed billAmount on first mount so season-change always has a value to invert
  useEffect(() => {
    if (inputMethod === 'bill' && state.billAmount == null) {
      update({ billAmount: computeMonthlyBill(state.monthlyKwh ?? 350, isSummer) * 2 });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Annual cost with correct season split: 4 summer + 8 non-summer months
  const annualElectricityCost =
    computeMonthlyBill(kwh, true) * 4 + computeMonthlyBill(kwh, false) * 8;

  // 12-month display values for the kWh expandable grid
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

  function onBillChange(value: number) {
    const safe    = Math.max(50, value || 0);
    const derived = convertBillToMonthlyKwh(safe, isSummer);
    update({ billAmount: safe, monthlyKwh: derived });
  }

  function onSeasonChange(season: 'summer' | 'nonSummer') {
    const currentBill = state.billAmount ?? defaultBill;
    const derived     = convertBillToMonthlyKwh(currentBill, season === 'summer');
    update({ billSeason: season, billAmount: currentBill, monthlyKwh: derived });
  }

  function onMethodChange(method: 'bill' | 'kwh') {
    if (method === 'bill') {
      const seedBill = computeMonthlyBill(kwh, isSummer) * 2;
      update({ inputMethod: method, billAmount: seedBill });
    } else {
      update({ inputMethod: method });
    }
  }

  return (
    <div>
      <div style={{ maxWidth: 720 }}>
        <div className="eyebrow" style={{ marginBottom: 16 }}>Step 2 · 用電狀況</div>
        <h2 className="h-title" style={{ margin: '0 0 14px' }}>你家每個月用多少電？</h2>
        <p className="body" style={{ marginBottom: 40, color: 'var(--ink-500)' }}>
          直接輸入台電帳單金額即可，系統會自動換算月均度數；或切換至度數模式手動輸入。
        </p>
      </div>

      <div className="step-usage-grid">
        {/* ── Input card ── */}
        <div className="card elevated" style={{ padding: 36 }}>

          {/* Method toggle */}
          <div style={{
            display: 'flex', marginBottom: 28,
            border: '1px solid var(--ink-200)', borderRadius: 'var(--radius-md)',
            overflow: 'hidden', fontSize: 13,
          }}>
            {(['bill', 'kwh'] as const).map(m => (
              <button key={m} onClick={() => onMethodChange(m)} style={{
                flex: 1, padding: '9px 0', fontWeight: 500, cursor: 'pointer',
                border: 'none', transition: 'all 0.15s',
                background: inputMethod === m ? 'var(--green-700)' : 'transparent',
                color:      inputMethod === m ? 'var(--white)'    : 'var(--ink-500)',
              }}>
                {m === 'bill' ? '帳單金額 NT$' : '用電度數 kWh'}
              </button>
            ))}
          </div>

          {inputMethod === 'bill' ? (
            <>
              {/* Season selector */}
              <div style={{ marginBottom: 22 }}>
                <div className="caption" style={{ marginBottom: 10 }}>帳單所在月份</div>
                <div style={{ display: 'flex', gap: 10 }}>
                  {([
                    { value: 'nonSummer' as const, label: '非夏月', sub: '10月 – 隔年5月' },
                    { value: 'summer'    as const, label: '夏月',   sub: '6月 – 9月（費率較高）' },
                  ]).map(opt => {
                    const sel = billSeason === opt.value;
                    return (
                      <button key={opt.value} onClick={() => onSeasonChange(opt.value)} style={{
                        flex: 1, padding: '10px 14px', cursor: 'pointer', textAlign: 'left',
                        borderRadius: 'var(--radius-md)', transition: 'all 0.15s',
                        border:     `2px solid ${sel ? 'var(--green-700)' : 'var(--ink-200)'}`,
                        background: sel ? 'var(--green-50)' : 'transparent',
                      }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: sel ? 'var(--green-900)' : 'var(--ink-700)' }}>
                          {opt.label}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 2 }}>{opt.sub}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Bill amount input */}
              <div style={{ marginBottom: 16 }}>
                <div className="body-sm" style={{ marginBottom: 8 }}>雙月帳單金額</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 24, color: 'var(--ink-500)', fontWeight: 500 }}>NT$</span>
                  <input
                    type="number" min="50" max="50000"
                    value={billAmount}
                    onChange={e => onBillChange(+e.target.value)}
                    className="num"
                    style={{
                      fontSize: 60, fontWeight: 700, color: 'var(--green-700)',
                      border: 'none', outline: 'none', background: 'transparent',
                      width: 210, padding: 0,
                    }}
                  />
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-400)', marginTop: 4 }}>
                  每兩個月一張（台電雙月計費）
                </div>
              </div>

              {/* Derived kWh */}
              <div style={{
                padding: '12px 16px', borderRadius: 'var(--radius-md)',
                background: 'var(--green-50)', border: '1px solid var(--green-200)',
                fontSize: 13, color: 'var(--ink-600)',
              }}>
                換算約&ensp;
                <span className="num" style={{ fontSize: 20, fontWeight: 700, color: 'var(--green-700)' }}>
                  {kwh.toLocaleString()}
                </span>
                &ensp;度 / 月
              </div>
            </>
          ) : (
            <>
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

              {/* 12-month expandable grid */}
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
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
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
            </>
          )}
        </div>

        {/* ── Context card ── */}
        <div className="card" style={{ padding: 28, background: 'var(--green-50)', borderColor: 'var(--green-200)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <SunIcon size={18} color="var(--green-700)" />
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--green-700)' }}>依此估算</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <div className="caption">目前邊際費率</div>
              <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{tierLabel(kwh, isSummer)}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 3 }}>
                {isSummer ? '夏月費率 (6–9月)' : '非夏月費率 (10–5月)'}
              </div>
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
              <div className="caption">年電費支出估計</div>
              <div>
                <span className="num" style={{ fontSize: 28, fontWeight: 700 }}>
                  NT$ {annualElectricityCost.toLocaleString()}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 3 }}>
                含 4 個夏月 + 8 個非夏月累進費率
              </div>
            </div>
          </div>

          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--green-200)' }}>
            <div className="body-sm" style={{ color: 'var(--ink-500)' }}>
              ⓘ 依 2025 年台電民生用電累進費率計算，實際帳單以台電 APP 查詢為準。
            </div>
          </div>
        </div>
      </div>

      {/* ── 日間用電習慣 ── */}
      <div style={{ maxWidth: 720, marginTop: 36 }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>日間用電習慣</div>
        <p className="body-sm" style={{ color: 'var(--ink-500)', marginBottom: 12 }}>
          未加裝儲能設備時，太陽能只能在發電當下即時使用；白天越常在家，能直接消費的發電比例越高
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          {HABITS.map(h => {
            const active = habit === h.id;
            return (
              <button key={h.id} onClick={() => update({ selfUseHabit: h.id })}
                style={{
                  flex: 1, textAlign: 'left', padding: '14px 16px',
                  background: active ? 'var(--green-700)' : 'var(--white)',
                  color: active ? 'var(--white)' : 'var(--ink-900)',
                  border: `1.5px solid ${active ? 'var(--green-700)' : 'var(--ink-200)'}`,
                  borderRadius: 'var(--radius-lg)',
                  cursor: 'pointer', transition: 'all 0.2s var(--ease-out)',
                  boxShadow: active ? 'var(--shadow-md)' : 'var(--shadow-sm)',
                }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{h.label}</div>
                <div style={{ fontSize: 12, color: active ? 'rgba(255,255,255,0.75)' : 'var(--ink-500)', marginBottom: 8 }}>{h.desc}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: active ? 'rgba(255,255,255,0.6)' : 'var(--ink-400)', fontFamily: 'var(--font-num)' }}>
                  自用上限 {Math.round(SELF_USE_CAP[h.id] * 100)}%
                </div>
              </button>
            );
          })}
        </div>
        <p className="caption" style={{ marginTop: 8, color: 'var(--ink-400)' }}>
          以上估算均假設未安裝電池儲能；加裝後自用比例可提升至 80–95%
        </p>
      </div>
    </div>
  );
}
