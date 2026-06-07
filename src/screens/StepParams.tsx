'use client';
import { useEffect, useState } from 'react';
import { Info } from '@/components/ui';
import { Slider } from '@/components/Slider';
import { SUBSIDIES, PANEL_GRADES } from '@/lib/constants';
import { guessCounty, computeResults, getFitRateForCapacity } from '@/lib/compute';
import type { SolarState } from '@/lib/types';

export default function StepParams({
  state, update,
}: {
  state: SolarState;
  update: (patch: Partial<SolarState>) => void;
}) {
  const area = state.roofArea ?? 78;
  const grade = state.panelGrade ?? 'standard';
  const gradeInfo = PANEL_GRADES.find(g => g.id === grade) ?? PANEL_GRADES[1];
  const maxCapacity = parseFloat((area * 3.3 * gradeInfo.kWpPerM2).toFixed(1));
  const county = state.county ?? guessCounty(state.address?.label);
  const subsidy = SUBSIDIES[county] ?? SUBSIDIES['台北市'];
  const unitCount = state.unitCount ?? 1;
  const isApartment = (state.buildingType ?? 'single') === 'apartment';
  const budgetMin = isApartment ? 5000 : 50000;

  const premiumGrade = PANEL_GRADES[PANEL_GRADES.length - 1];
  const maxBudget = Math.max(50000, Math.round(area * 3.3 * premiumGrade.kWpPerM2 * (premiumGrade.costPerKw - subsidy.amount) / 10000) * 10000);

  const netCostPerKwForDefault = PANEL_GRADES[1].costPerKw - subsidy.amount;
  const totalBudgetForMax = Math.round(maxCapacity * netCostPerKwForDefault / 10000) * 10000;
  const defaultBudget = Math.min(
    maxBudget,
    isApartment ? Math.ceil(totalBudgetForMax / unitCount / 10000) * 10000 : totalBudgetForMax,
  );
  const budgetCeiling = state.budgetCeiling ?? defaultBudget;
  const [budgetRaw, setBudgetRaw] = useState(String(budgetCeiling));
  const [budgetError, setBudgetError] = useState(false);
  useEffect(() => { setBudgetRaw(String(budgetCeiling)); setBudgetError(false); }, [budgetCeiling]);

  const costPerKw = gradeInfo.costPerKw;
  const netCostPerKw = costPerKw - subsidy.amount;
  // Total budget = per-unit budget × unitCount; floor to 1 decimal so capacity × netCostPerKw never exceeds total budget
  const totalBudget = budgetCeiling * unitCount;
  const budgetCapacity = netCostPerKw > 0 ? Math.floor((totalBudget / netCostPerKw) * 10) / 10 : maxCapacity;
  const capacity = parseFloat(Math.min(maxCapacity, budgetCapacity).toFixed(1));
  const totalCost = Math.round(capacity * costPerKw);
  const subsidyAmount = subsidy.amount * capacity;
  const outOfPocket = totalCost - subsidyAmount;
  const perUnitOutOfPocket = Math.round(outOfPocket / unitCount);

  useEffect(() => {
    update({ capacity, costPerKw, totalCost, subsidyAmount, outOfPocket, county, panelGrade: grade });
  }, [capacity, costPerKw, county, grade]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="params-header" style={{ maxWidth: 720 }}>
        <div className="eyebrow" style={{ marginBottom: 16 }}>Step 4 · 基本參數</div>
        <h2 className="h-title" style={{ margin: '0 0 14px' }}>設定面板等級與預算</h2>
        <p className="body" style={{ color: 'var(--ink-500)' }}>
          設定{isApartment ? '每戶' : ''}能接受的最高自付金額，再選擇面板等級，系統自動計算可裝容量。
          已帶入 <b style={{ color: 'var(--green-700)' }}>{county}</b> 的政府補助。
        </p>
        {isApartment && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 8,
            padding: '6px 12px', background: 'var(--green-50)',
            border: '1px solid var(--green-200)', borderRadius: 'var(--radius-md)',
            fontSize: 13, color: 'var(--ink-600)',
          }}>
            <span>大樓／社區</span>
            <span style={{ fontWeight: 700, color: 'var(--green-700)' }}>{unitCount} 戶</span>
            <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>（戶數請在上一步修改）</span>
          </div>
        )}
      </div>

      {/* ── 預算滑桿 ── */}
      <div className="card budget-card">
        <div className="budget-row">
          <div className="caption">
            {isApartment ? '每戶預算上限（補助後自付）' : '預算上限（補助後自付）'}
            <Info tip={isApartment ? `每戶願意支付的最高金額；總預算 = 每戶預算 × ${unitCount} 戶` : '扣除政府補助後，你願意支付的最高金額'} />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span className="num" style={{ fontSize: 15, color: 'var(--ink-500)' }}>NT$</span>
            <input
              type="number" min={budgetMin} max={maxBudget}
              value={budgetRaw}
              onChange={e => { setBudgetRaw(e.target.value); setBudgetError(false); }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              onBlur={e => {
                const v = +e.target.value;
                if (!v || v < budgetMin) { setBudgetError(true); return; }
                setBudgetError(false);
                update({ budgetCeiling: Math.min(maxBudget, Math.round(v)) });
              }}
              className="num budget-amount"
              style={{
                color: budgetError ? 'var(--red-600, #dc2626)' : undefined,
                border: 'none', outline: 'none', background: 'transparent', padding: 0,
                width: `${Math.max(6, budgetRaw.length) + 1}ch`,
              }}
            />
          </div>
        </div>
        <Slider
          min={budgetMin} max={maxBudget} step={isApartment ? 1000 : 10000}
          value={budgetCeiling}
          onChange={v => update({ budgetCeiling: v })}
        />
        <div className="slider-labels">
          <span className="caption">{isApartment ? '5 千' : '5 萬'}</span>
          <span className="caption">{Math.round(maxBudget / 10000)} 萬（全裝高效款）</span>
        </div>
      </div>

      {/* ── 面板等級卡片 ── */}
      <p className="body-sm grade-efficiency-desc" style={{ color: 'var(--ink-400)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
        不同等級的面板太陽能轉換效率不同，效率越高的面板單位價格也越高。
        <Info tip="轉換效率：面板將太陽光轉為電能的比例。效率越高，同樣屋頂面積能產生更多電力。" />
      </p>
      <div className="grade-grid">
        {PANEL_GRADES.map(g => {
          const active = grade === g.id;
          const gNet = g.costPerKw - subsidy.amount;
          const gMaxCap = parseFloat((area * 3.3 * g.kWpPerM2).toFixed(1));
          const gCap = parseFloat(Math.min(gMaxCap, gNet > 0 ? Math.floor((budgetCeiling * unitCount / gNet) * 10) / 10 : gMaxCap).toFixed(1));
          const isFull = gCap >= gMaxCap - 0.05;
          const { annualKwh: gAnnualKwh } = computeResults({ ...state, capacity: gCap, panelGrade: g.id });
          const gAnnualSavings = Math.round(gAnnualKwh * getFitRateForCapacity(gCap));
          const gPing = parseFloat((gCap / gMaxCap * area).toFixed(1));
          const DOTS = 20;
          const filledDots = isFull ? DOTS : Math.max(1, Math.round(gCap / gMaxCap * DOTS));
          return (
            <button
              key={g.id}
              className={`grade-card${active ? ' grade-card--active' : ''}`}
              onClick={() => update({ panelGrade: g.id })}
            >
              <div className="grade-badges">
                {'recommended' in g && g.recommended && (
                  <span className="grade-badge grade-badge--rec">★ 推薦</span>
                )}
                {isFull && (
                  <span className="grade-badge grade-badge--full">屋頂全裝</span>
                )}
              </div>

              <div className="grade-card-title">{g.label}</div>

              <div>
                <div className="num grade-efficiency-num" style={{ fontWeight: 700, lineHeight: 1 }}>{g.efficiency}</div>
                <div className="grade-cap-label">轉換效率</div>
              </div>

              <div style={{ margin: '6px 0 2px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 12px)', gap: 2, marginBottom: 3 }}>
                  {Array.from({ length: DOTS }, (_, i) => (
                    <span key={i} style={{
                      display: 'inline-block', width: 9, height: 9, borderRadius: 2,
                      background: i < filledDots
                        ? (active ? 'rgba(255,255,255,0.9)' : 'var(--green-700)')
                        : (active ? 'rgba(255,255,255,0.2)' : 'var(--ink-150,#e5e7eb)'),
                    }} />
                  ))}
                </div>
                <span style={{ fontSize: 12, color: active ? 'rgba(255,255,255,0.85)' : 'var(--ink-600)' }}>
                  {gPing} 坪 / {area} 坪
                  <span style={{ fontSize: 10, color: active ? 'rgba(255,255,255,0.6)' : 'var(--ink-400)', marginLeft: 3 }}>
                    （預算能裝 / 可安裝）
                  </span>
                </span>
              </div>

              <div className="grade-desc">
                可裝 {gCap} kWp・預估年售電 NT$ {gAnnualSavings.toLocaleString()}<br />
                NT$ {g.costPerKw.toLocaleString()} / kW
              </div>
            </button>
          );
        })}
      </div>

      {/* ── 規格 + 費用摘要 ── */}
      <div className="param-summary-grid">
        {/* 裝機規格 */}
        <div className="card param-summary-card">
          <div className="card-section-heading">裝機規格</div>
          {[
            { label: '裝機容量', value: `${capacity} kWp` },
            { label: '面板等級', value: gradeInfo.label },
            { label: '安裝單價', value: `NT$ ${gradeInfo.costPerKw.toLocaleString()} / kW` },
            { label: '約需面板', value: `${Math.round(capacity / 0.45)} 片` },
          ].map(r => (
            <div key={r.label} className="summary-row">
              <span className="summary-row__label">{r.label}</span>
              <span className="summary-row__value">{r.value}</span>
            </div>
          ))}
        </div>

        {/* 費用試算 */}
        <div className="card param-summary-card">
          <div className="card-section-heading">費用試算</div>
          {isApartment && (
            <div style={{
              marginBottom: 12, padding: '8px 12px',
              background: 'var(--green-50)', borderRadius: 'var(--radius-sm)',
              fontSize: 12, color: 'var(--ink-500)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span>社區 {unitCount} 戶</span>
              <span style={{ color: 'var(--ink-300)' }}>·</span>
              <span>總預算 NT$ {totalBudget.toLocaleString()}</span>
            </div>
          )}
          {[
            { label: '總安裝費用',         value: `NT$ ${totalCost.toLocaleString()}`,                   green: false },
            { label: `${county} 政府補助`, value: `− NT$ ${Math.round(subsidyAmount).toLocaleString()}`, green: true  },
          ].map(r => (
            <div key={r.label} className="summary-row">
              <span className="summary-row__label">{r.label}</span>
              <span className={`summary-row__value${r.green ? ' summary-row__value--green' : ''}`}>{r.value}</span>
            </div>
          ))}
          <div className="cost-highlight">
            <div className="caption">{isApartment ? '總自付金額' : '實際自付金額'}</div>
            <div className="num cost-highlight-amount">NT$ {Math.round(outOfPocket).toLocaleString()}</div>
            {isApartment && (
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--green-700)', marginTop: 4 }}>
                每戶自付 NT$ {perUnitOutOfPocket.toLocaleString()}
              </div>
            )}
            <div className="cost-highlight-note">
              {subsidy.source} · {subsidy.amount.toLocaleString()} 元/kW · 資料更新：{subsidy.updatedAt}
              {' '}·{' '}
              <a href={subsidy.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green-700)', textDecoration: 'underline' }}>
                查看補助公告
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
