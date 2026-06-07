'use client';
import { useState, useEffect } from 'react';
import { Badge, SunIcon } from '@/components/ui';
import { Slider } from '@/components/Slider';
import type { SolarState } from '@/lib/types';
import { TEPCO_MONTHLY_NORM, SELF_USE_CAP, computeMonthlyBill, convertBillToMonthlyKwh, disaggregateBills, BILL_PAIR_META } from '@/lib/compute';

const MONTH_LABELS = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

const HABITS = [
  { id: 'home'   as const, label: '白天在家',  desc: 'WFH・退休・長時在宅' },
  { id: 'normal' as const, label: '一般作息',  desc: '早出晚歸・預設值'     },
  { id: 'away'   as const, label: '白天外出',  desc: '夜間用電為主'         },
];

const BUILDING_TYPES = [
  { id: 'single'     as const, label: '獨棟住宅',   desc: '透天厝・獨立建物' },
  { id: 'apartment'  as const, label: '大樓／社區', desc: '公寓・集合住宅・社區' },
  { id: 'commercial' as const, label: '營業用建物', desc: '工廠廠房・商業大樓・公共建設' },
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
  const inputMethod   = state.inputMethod   ?? 'bill';
  const billSeason    = state.billSeason    ?? 'nonSummer';
  const isSummer      = billSeason === 'summer';
  const kwh           = state.monthlyKwh   ?? 350;
  const habit         = state.selfUseHabit ?? 'normal';
  const buildingType  = state.buildingType ?? 'single';
  const unitCount     = state.unitCount    ?? 20;
  const isApartment   = buildingType === 'apartment';
  const [unitCountRaw, setUnitCountRaw] = useState(String(unitCount));
  const [expanded, setExpanded] = useState(false);
  const [billExpanded, setBillExpanded] = useState(false);
  const [billInfoOpen, setBillInfoOpen] = useState(false);

  const defaultBill = computeMonthlyBill(kwh, isSummer) * 2;
  const billAmount  = state.billAmount ?? defaultBill;
  const billAmounts: (number | null)[] = state.billAmounts ?? Array(6).fill(null);
  const hasBillAmounts = billAmounts.some(v => v !== null && (v ?? 0) >= 50);
  // Per-bill season: user can override; default from BILL_PAIR_META
  const billSeasons: ('summer' | 'nonSummer')[] =
    state.billSeasons ?? BILL_PAIR_META.map(p => p.isSummer ? 'summer' : 'nonSummer');

  // Dynamic placeholders: run disaggregateBills once so filled cells influence empty cell estimates.
  // When nothing is filled, globalScale = kwh (fallback), result is identical to kwh × TEPCO norm.
  const disaggregatedEstimate = disaggregateBills(billAmounts, kwh, billSeasons);
  const dynamicPlaceholders: number[] = BILL_PAIR_META.map(({ months: [m1, m2] }, k) =>
    Math.round(computeMonthlyBill(
      (disaggregatedEstimate[m1] + disaggregatedEstimate[m2]) / 2,
      billSeasons[k] === 'summer',
    ) * 2),
  );

  // Local raw string states so the user can clear/type without being snapped to min
  const [billRaw,   setBillRaw]   = useState(String(Math.round(billAmount)));
  const [kwhRaw,    setKwhRaw]    = useState(String(kwh));
  const [billError, setBillError] = useState(false);
  const [kwhError,  setKwhError]  = useState(false);

  // Keep raw values in sync when external changes happen (season toggle, slider, etc.)
  useEffect(() => { setBillRaw(String(Math.round(billAmount))); setBillError(false); }, [billAmount]);
  useEffect(() => { setKwhRaw(String(kwh)); setKwhError(false); }, [kwh]);

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

  function handleBillAmountChange(k: number, raw: string) {
    const next = [...billAmounts] as (number | null)[];
    next[k] = raw === '' ? null : +raw;
    const anyFilled = next.some(v => v !== null && (v ?? 0) >= 50);
    update({
      billAmounts: next,
      monthlyUsage: anyFilled ? disaggregateBills(next, kwh, billSeasons) : undefined,
    });
  }

  function handleBillSeasonChange(k: number, season: 'summer' | 'nonSummer') {
    const next = [...billSeasons] as ('summer' | 'nonSummer')[];
    next[k] = season;
    update({
      billSeasons: next,
      monthlyUsage: hasBillAmounts ? disaggregateBills(billAmounts, kwh, next) : undefined,
    });
  }

  function handleResetBills() {
    update({ billAmounts: undefined, billSeasons: undefined, monthlyUsage: undefined });
  }

  function onBillBlur(value: number) {
    if (!value || value < 50) { setBillError(true); return; }
    setBillError(false);
    update({ billAmount: value, monthlyKwh: convertBillToMonthlyKwh(value, isSummer) });
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
      {/* ── 建物類型 ── */}
      <div style={{ marginBottom: 32 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>前置條件 · 建物類型</div>
        <div style={{ display: 'flex', gap: 10 }}>
          {BUILDING_TYPES.map(bt => {
            const active = buildingType === bt.id;
            return (
              <button key={bt.id} onClick={() => update({
                buildingType: bt.id,
                unitCount: bt.id === 'apartment' ? (state.unitCount ?? 20) : undefined,
              })} style={{
                flex: 1, textAlign: 'left', padding: '12px 14px',
                background: active ? 'var(--green-700)' : 'var(--white)',
                color: active ? 'var(--white)' : 'var(--ink-900)',
                border: `1.5px solid ${active ? 'var(--green-700)' : 'var(--ink-200)'}`,
                borderRadius: 'var(--radius-lg)',
                cursor: 'pointer', transition: 'all 0.2s var(--ease-out)',
                boxShadow: active ? 'var(--shadow-md)' : 'var(--shadow-sm)',
              }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3 }}>{bt.label}</div>
                <div style={{ fontSize: 11, color: active ? 'rgba(255,255,255,0.75)' : 'var(--ink-500)' }}>{bt.desc}</div>
              </button>
            );
          })}
        </div>

        {isApartment && (
          <div style={{
            marginTop: 16, padding: '14px 16px',
            background: 'var(--green-50)', border: '1px solid var(--green-200)',
            borderRadius: 'var(--radius-md)',
            display: 'flex', alignItems: 'center', gap: 16,
          }}>
            <div style={{ fontSize: 13, color: 'var(--ink-600)', flexShrink: 0 }}>住宅戶數</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <input
                type="number" min="2" max="2000"
                value={unitCountRaw}
                onChange={e => setUnitCountRaw(e.target.value)}
                onBlur={e => {
                  const v = Math.round(+e.target.value);
                  if (!v || v < 2) { setUnitCountRaw('2'); update({ unitCount: 2 }); return; }
                  const clamped = Math.min(2000, v);
                  setUnitCountRaw(String(clamped));
                  update({ unitCount: clamped });
                }}
                className="num"
                style={{
                  fontSize: 32, fontWeight: 700, color: 'var(--green-700)',
                  border: 'none', outline: 'none', background: 'transparent', padding: 0,
                  textAlign: 'right',
                  width: `${Math.max(4, unitCountRaw.length + 1)}ch`,
                }}
              />
              <span style={{ fontSize: 16, color: 'var(--ink-500)' }}>戶</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-400)', marginLeft: 'auto' }}>
              總用電量 = 單戶用電 × {unitCount} 戶
            </div>
          </div>
        )}
      </div>

      <div style={{ maxWidth: 720 }}>
        <div className="eyebrow" style={{ marginBottom: 16 }}>Step 2 · 用電狀況</div>
        <h2 className="h-title" style={{ margin: '0 0 14px' }}>
          {isApartment ? '社區每戶用電量' : '你家每個月用多少電？'}
        </h2>
        <p className="body step-usage-desc" style={{ color: 'var(--ink-500)' }}>
          {isApartment
            ? `輸入單戶每月用電量，系統會乘以 ${unitCount} 戶計算社區總用電。`
            : '直接輸入台電帳單金額即可，系統會自動換算月均度數；或切換至度數模式手動輸入。'}
        </p>
      </div>

      <div className="step-usage-grid">
        {/* ── Input card ── */}
        <div className="card elevated usage-input-card">

          {/* Method toggle */}
          <div className="usage-method-toggle" style={{
            display: 'flex',
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
                <div className="body-sm" style={{ marginBottom: 10 }}>帳單所在月份</div>
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
                    value={billRaw}
                    onChange={e => { setBillRaw(e.target.value); setBillError(false); }}
                    onBlur={e => onBillBlur(+e.target.value)}
                    className="num usage-bill-input"
                    style={{
                      fontWeight: 700,
                      color: billError ? 'var(--red-600, #dc2626)' : 'var(--green-700)',
                      border: 'none', outline: 'none', background: 'transparent',
                      width: 210, padding: 0,
                    }}
                  />
                </div>
                {billError && (
                  <div style={{ fontSize: 12, color: 'var(--red-600, #dc2626)', marginTop: 4 }}>
                    最低金額為 NT$50
                  </div>
                )}
                {!billError && (
                  <div style={{ fontSize: 12, color: 'var(--ink-400)', marginTop: 4 }}>
                    每兩個月一張（台電雙月計費）
                  </div>
                )}
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

              {/* 六份帳單展開（bill mode 專屬） */}
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--ink-100)' }}>
                <button
                  onClick={() => setBillExpanded(v => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    fontSize: 13, fontWeight: 600, color: 'var(--green-700)',
                  }}
                >
                  <span style={{ display: 'inline-block', transform: billExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>▶</span>
                  展開輸入六份帳單
                  {hasBillAmounts && <Badge tone="green">已自訂</Badge>}
                </button>

                {billExpanded && (
                  <div style={{ marginTop: 14 }}>
                    {/* Hint row with ⓘ toggle */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 12 }}>
                      <p className="body-sm" style={{ color: 'var(--ink-500)', margin: 0, flex: 1 }}>
                        建議填入過去連續六份帳單，留空欄位由台電用電曲線補估。
                      </p>
                      <button
                        onClick={() => setBillInfoOpen(v => !v)}
                        style={{
                          flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
                          fontSize: 14, color: billInfoOpen ? 'var(--green-700)' : 'var(--ink-400)',
                          padding: '0 2px', lineHeight: 1,
                        }}
                        title="說明"
                      >ⓘ</button>
                    </div>
                    {billInfoOpen && (
                      <div style={{
                        marginBottom: 12, padding: '10px 12px',
                        background: 'var(--ink-50, #f8f9fa)', borderRadius: 'var(--radius-md)',
                        fontSize: 12, color: 'var(--ink-500)', lineHeight: 1.6,
                      }}>
                        台電住宅用戶每兩個月計費一次。請依帳單上標示的「用電期間」選擇夏月（6–9月）或非夏月；不確定可先選非夏月，誤差約 5% 以內。六份帳單恰好涵蓋一整年，系統以台電住宅用電曲線進行時序分解（Denton 1971），推算各月用電量。
                      </div>
                    )}

                    {/* 6-bill grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                      {BILL_PAIR_META.map((pair, k) => {
                        const val = billAmounts[k];
                        const hasVal = val !== null;
                        const isValidBill = hasVal && val! >= 50;
                        const season = billSeasons[k];
                        const isSummerCell = season === 'summer';
                        const billForHint = isValidBill ? val! : dynamicPlaceholders[k];
                        const derivedMonthly = convertBillToMonthlyKwh(billForHint, isSummerCell);
                        return (
                          <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                            {/* Bill number label */}
                            <div className="caption" style={{ color: 'var(--ink-400)', textAlign: 'center' }}>
                              帳單 {k + 1}
                            </div>
                            {/* Season toggle */}
                            <div style={{ display: 'flex', gap: 3 }}>
                              {(['nonSummer', 'summer'] as const).map(s => (
                                <button key={s} onClick={() => handleBillSeasonChange(k, s)} style={{
                                  flex: 1, fontSize: 10, padding: '3px 0', cursor: 'pointer',
                                  borderRadius: 4, fontWeight: 500,
                                  border: `1px solid ${season === s ? 'var(--green-600)' : 'var(--ink-200)'}`,
                                  background: season === s ? 'var(--green-700)' : 'transparent',
                                  color: season === s ? 'white' : 'var(--ink-400)',
                                  transition: 'all 0.15s',
                                }}>
                                  {s === 'nonSummer' ? '非夏' : '夏月'}
                                </button>
                              ))}
                            </div>
                            {/* NT$ input */}
                            <input
                              type="number" min="50" max="100000"
                              value={hasVal ? val! : ''}
                              placeholder={String(dynamicPlaceholders[k])}
                              onChange={e => handleBillAmountChange(k, e.target.value)}
                              style={{
                                width: '100%', textAlign: 'center', padding: '6px 4px',
                                border: `1px solid ${isValidBill ? 'var(--green-400)' : 'var(--ink-200)'}`,
                                borderRadius: 6,
                                fontSize: 13, fontFamily: 'var(--font-num)',
                                background: isSummerCell ? 'var(--amber-50, #fffbeb)' : 'white',
                              }}
                            />
                            {/* kWh hint */}
                            <div style={{ fontSize: 11, color: isValidBill ? 'var(--green-700)' : 'var(--ink-300)', textAlign: 'center', minHeight: 16 }}>
                              ≈ {derivedMonthly.toLocaleString()} 度/月
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Footer: annual total + reset */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                      <div className="body-sm" style={{ color: 'var(--ink-400)' }}>
                        估計年用電：<b>{disaggregatedEstimate.reduce((a, b) => a + b, 0).toLocaleString()}</b> kWh
                      </div>
                      {hasBillAmounts && (
                        <button onClick={handleResetBills}
                          style={{ fontSize: 12, color: 'var(--ink-400)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                          重設
                        </button>
                      )}
                    </div>
                  </div>
                )}
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
                  type="number" min="14" max="2000" value={kwhRaw}
                  onChange={e => { setKwhRaw(e.target.value); setKwhError(false); }}
                  onBlur={e => {
                    const v = +e.target.value;
                    if (!v || v < 14) { setKwhError(true); return; }
                    setKwhError(false);
                    update({ monthlyKwh: Math.min(2000, v) });
                  }}
                  className="num usage-kwh-input"
                  style={{
                    fontWeight: 700,
                    color: kwhError ? 'var(--red-600, #dc2626)' : 'var(--green-700)',
                    border: 'none', outline: 'none', background: 'transparent',
                    width: `${String(kwh).length + 0.3}ch`, padding: 0,
                  }}
                />
                <span style={{ fontSize: 22, color: 'var(--ink-500)', fontWeight: 500 }}>度 / 月</span>
              </div>
              {kwhError && (
                <div style={{ fontSize: 12, color: 'var(--red-600, #dc2626)', marginBottom: 8 }}>
                  最低度數為 14 度
                </div>
              )}

              <Slider min={14} max={1200} value={kwh} onChange={v => { update({ monthlyKwh: v }); if (!state.monthlyUsage) return; }} />
              <div style={{ position: 'relative', height: 36, marginTop: 8 }}>
                {([
                  { value: 100,  label: '100',    sub: '小家庭',   align: 'left'   },
                  { value: 350,  label: '350',    sub: '平均',     align: 'center' },
                  { value: 700,  label: '700',    sub: '多人家庭', align: 'center' },
                  { value: 1200, label: '1,200+', sub: '大用電戶', align: 'right'  },
                ] as const).map(({ value, label, sub, align }) => {
                  const pct = (value - 14) / (1200 - 14) * 100;
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
        <div className="card usage-context-card" style={{ background: 'var(--green-50)', borderColor: 'var(--green-200)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <SunIcon size={18} color="var(--green-700)" />
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--green-700)' }}>依此估算</div>
          </div>
          <div className="usage-stats-list" style={{ flexDirection: 'column' }}>
            <div>
              <div className="caption">目前邊際費率</div>
              <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{tierLabel(kwh, isSummer)}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 3 }}>
                {isSummer ? '夏月費率 (6–9月)' : '非夏月費率 (10–5月)'}
              </div>
            </div>
            <div>
              <div className="caption">{isApartment ? `社區年用電量（${unitCount} 戶）` : '年用電量估計'}</div>
              <div>
                <span className="num" style={{ fontSize: 28, fontWeight: 700, color: 'var(--green-700)' }}>
                  {(kwh * 12 * (isApartment ? unitCount : 1)).toLocaleString()}
                </span>
                <span style={{ fontSize: 14, color: 'var(--ink-500)', marginLeft: 6 }}>kWh / 年</span>
              </div>
              {isApartment && (
                <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 3 }}>
                  單戶 {(kwh * 12).toLocaleString()} kWh × {unitCount} 戶
                </div>
              )}
            </div>
            <div>
              <div className="caption">{isApartment ? `社區年電費估計（${unitCount} 戶）` : '年電費支出估計'}</div>
              <div>
                <span className="num" style={{ fontSize: 28, fontWeight: 700 }}>
                  NT$ {(annualElectricityCost * (isApartment ? unitCount : 1)).toLocaleString()}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 3 }}>
                {isApartment ? `單戶 NT$ ${annualElectricityCost.toLocaleString()} × ${unitCount} 戶` : '含 4 個夏月 + 8 個非夏月累進費率'}
              </div>
            </div>
          </div>

          <div className="usage-context-footer" style={{ paddingTop: 16, borderTop: '1px solid var(--green-200)' }}>
            <div className="body-sm usage-context-note" style={{ color: 'var(--ink-500)' }}>
              ⓘ 依 2025 年台電民生用電累進費率計算，實際帳單以台電 APP 查詢為準。
            </div>
          </div>
        </div>
      </div>

      {/* ── 日間用電習慣 ── */}
      <div className="usage-habit-section" style={{ maxWidth: 720 }}>
        <div className="eyebrow usage-habit-eyebrow">日間用電習慣</div>
        <p className="body-sm" style={{ color: 'var(--ink-500)', marginBottom: 12 }}>
          未加裝儲能設備時，太陽能只能在發電當下即時使用；白天越常在家，能直接消費的發電比例越高
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          {HABITS.map(h => {
            const active = habit === h.id;
            return (
              <button key={h.id} onClick={() => update({ selfUseHabit: h.id })}
                className="usage-habit-btn"
                style={{
                  flex: 1, textAlign: 'left',
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
