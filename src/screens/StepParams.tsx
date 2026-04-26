'use client';
import { useEffect } from 'react';
import { Info } from '@/components/ui';
import { Slider } from '@/components/Slider';
import { SUBSIDIES, PANEL_GRADES } from '@/lib/constants';
import { guessCounty } from '@/lib/compute';
import type { SolarState } from '@/lib/types';

export default function StepParams({
  state, update,
}: {
  state: SolarState;
  update: (patch: Partial<SolarState>) => void;
}) {
  const area = state.roofArea ?? 78;
  const maxCapacity = parseFloat((area * 3.3 * 0.6 * 0.165).toFixed(1));
  const county = guessCounty(state.address?.label);
  const subsidy = SUBSIDIES[county] ?? SUBSIDIES['台北市'];

  const grade = state.panelGrade ?? 'standard';
  const gradeInfo = PANEL_GRADES.find(g => g.id === grade) ?? PANEL_GRADES[1];

  const defaultBudget = Math.min(
    800000,
    Math.round(maxCapacity * (PANEL_GRADES[1].costPerKw - subsidy.amount) / 10000) * 10000,
  );
  const budgetCeiling = state.budgetCeiling ?? defaultBudget;

  const costPerKw = gradeInfo.costPerKw;
  const netCostPerKw = costPerKw - subsidy.amount;
  const budgetCapacity = netCostPerKw > 0 ? budgetCeiling / netCostPerKw : maxCapacity;
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
        <h2 className="h-title" style={{ margin: '0 0 14px' }}>設定預算與面板等級</h2>
        <p className="body" style={{ color: 'var(--ink-500)' }}>
          設定你能接受的最高自付金額，再選擇面板等級，系統自動計算可裝容量。
          已帶入 <b style={{ color: 'var(--green-700)' }}>{county}</b> 的政府補助。
        </p>
      </div>

      {/* ── 預算滑桿 ── */}
      <div className="card budget-card">
        <div className="budget-row">
          <div className="caption">
            預算上限（補助後自付）
            <Info tip="扣除政府補助後，你願意支付的最高金額" />
          </div>
          <span className="num budget-amount">NT$ {budgetCeiling.toLocaleString()}</span>
        </div>
        <Slider
          min={50000} max={800000} step={10000}
          value={budgetCeiling}
          onChange={v => update({ budgetCeiling: v })}
        />
        <div className="slider-labels">
          <span className="caption">5 萬</span>
          <span className="caption">80 萬</span>
        </div>
      </div>

      {/* ── 面板等級卡片 ── */}
      <div className="grade-grid">
        {PANEL_GRADES.map(g => {
          const active = grade === g.id;
          const gNet = g.costPerKw - subsidy.amount;
          const gCap = parseFloat(Math.min(maxCapacity, gNet > 0 ? budgetCeiling / gNet : maxCapacity).toFixed(1));
          const isFull = gCap >= maxCapacity - 0.05;
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
                <div className="num" style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{gCap}</div>
                <div className="grade-cap-label">kWp 可裝容量</div>
              </div>

              <div className="grade-desc">
                {g.efficiency} 轉換效率<br />
                NT$ {g.costPerKw.toLocaleString()} / kW
              </div>
            </button>
          );
        })}
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
            { label: '總安裝費用',         value: `NT$ ${totalCost.toLocaleString()}`,                      green: false },
            { label: `${county} 政府補助`, value: `− NT$ ${Math.round(subsidyAmount).toLocaleString()}`,    green: true  },
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
