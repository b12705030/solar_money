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

  const premiumGrade = PANEL_GRADES[PANEL_GRADES.length - 1];
  const maxBudget = Math.round(area * 3.3 * premiumGrade.kWpPerM2 * (premiumGrade.costPerKw - subsidy.amount) / 10000) * 10000;

  const defaultBudget = Math.min(
    maxBudget,
    Math.round(maxCapacity * (PANEL_GRADES[1].costPerKw - subsidy.amount) / 10000) * 10000,
  );
  const budgetCeiling = state.budgetCeiling ?? defaultBudget;
  const [budgetRaw, setBudgetRaw] = useState(String(budgetCeiling));
  const [budgetError, setBudgetError] = useState(false);
  useEffect(() => { setBudgetRaw(String(budgetCeiling)); setBudgetError(false); }, [budgetCeiling]);

  const costPerKw = gradeInfo.costPerKw;
  const netCostPerKw = costPerKw - subsidy.amount;
  // Floor to 1 decimal (not round) so capacity × netCostPerKw never exceeds budgetCeiling
  const budgetCapacity = netCostPerKw > 0 ? Math.floor((budgetCeiling / netCostPerKw) * 10) / 10 : maxCapacity;
  const capacity = parseFloat(Math.min(maxCapacity, budgetCapacity).toFixed(1));
  const totalCost = Math.round(capacity * costPerKw);
  const subsidyAmount = subsidy.amount * capacity;
  const outOfPocket = totalCost - subsidyAmount;

  useEffect(() => {
    update({ capacity, costPerKw, totalCost, subsidyAmount, outOfPocket, county, panelGrade: grade });
  }, [capacity, costPerKw, county, grade]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div style={{ maxWidth: 720, marginBottom: 36 }}>
        <div className="eyebrow" style={{ marginBottom: 16 }}>Step 4 · 基本參數</div>
        <h2 className="h-title" style={{ margin: '0 0 14px' }}>設定面板等級與預算</h2>
        <p className="body" style={{ color: 'var(--ink-500)' }}>
          設定你能接受的最高自付金額，再選擇面板等級，系統自動計算可裝容量。
          已帶入 <b style={{ color: 'var(--green-700)' }}>{county}</b> 的政府補助。
        </p>
        <p className="body-sm" style={{ color: 'var(--ink-400)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
          不同等級的面板太陽能轉換效率不同，效率越高的面板單位價格也越高。
          <Info tip="轉換效率：面板將太陽光轉為電能的比例。效率越高，同樣屋頂面積能產生更多電力。" />
        </p>
      </div>

      {/* ── 面板等級卡片 ── */}
      <div className="grade-grid">
        {PANEL_GRADES.map(g => {
          const active = grade === g.id;
          const gNet = g.costPerKw - subsidy.amount;
          const gMaxCap = parseFloat((area * 3.3 * g.kWpPerM2).toFixed(1));
          const gCap = parseFloat(Math.min(gMaxCap, gNet > 0 ? Math.floor((budgetCeiling / gNet) * 10) / 10 : gMaxCap).toFixed(1));
          const isFull = gCap >= gMaxCap - 0.05;
          const { annualKwh: gAnnualKwh } = computeResults({ ...state, capacity: gCap, panelGrade: g.id });
          const gAnnualSavings = Math.round(gAnnualKwh * getFitRateForCapacity(gCap));
          const totalPanels = Math.round(gMaxCap / 0.45);
          const budgetPanels = Math.round(gCap / 0.45);
          const DOTS = 10;
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
                <div className="num" style={{ fontSize: 36, fontWeight: 700, lineHeight: 1 }}>{g.efficiency}</div>
                <div className="grade-cap-label">轉換效率</div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 3, margin: '6px 0 2px' }}>
                {Array.from({ length: DOTS }, (_, i) => (
                  <span key={i} style={{
                    display: 'inline-block', width: 9, height: 9, borderRadius: 2, flexShrink: 0,
                    background: i < filledDots
                      ? (active ? 'rgba(255,255,255,0.9)' : 'var(--green-600)')
                      : (active ? 'rgba(255,255,255,0.2)' : 'var(--ink-150,#e5e7eb)'),
                  }} />
                ))}
                <span style={{ fontSize: 10, marginLeft: 4, color: active ? 'rgba(255,255,255,0.7)' : 'var(--ink-400)', whiteSpace: 'nowrap' }}>
                  {budgetPanels} / {totalPanels} 片
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

      {/* ── 預算滑桿 ── */}
      <div className="card budget-card">
        <div className="budget-row">
          <div className="caption">
            預算上限（補助後自付）
            <Info tip="扣除政府補助後，你願意支付的最高金額" />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span className="num" style={{ fontSize: 15, color: 'var(--ink-500)' }}>NT$</span>
            <input
              type="number" min="50000" max={maxBudget}
              value={budgetRaw}
              onChange={e => { setBudgetRaw(e.target.value); setBudgetError(false); }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              onBlur={e => {
                const v = +e.target.value;
                if (!v || v < 50000) { setBudgetError(true); return; }
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
          min={50000} max={maxBudget} step={10000}
          value={budgetCeiling}
          onChange={v => update({ budgetCeiling: v })}
        />
        <div className="slider-labels">
          <span className="caption">5 萬</span>
          <span className="caption">{Math.round(maxBudget / 10000)} 萬（全裝高效款）</span>
        </div>
      </div>

      {/* ── 規格 + 費用摘要 ── */}
      <div className="param-summary-grid">
        {/* 裝機規格 */}
        <div className="card" style={{ padding: 24 }}>
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
        <div className="card" style={{ padding: 24 }}>
          <div className="card-section-heading">費用試算</div>
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
            <div className="caption">實際自付金額</div>
            <div className="num cost-highlight-amount">NT$ {Math.round(outOfPocket).toLocaleString()}</div>
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
