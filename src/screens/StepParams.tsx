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
  // ~0.165 kW per m², 1 坪 ≈ 3.3 m², usable ratio 0.6
  const maxCapacity = parseFloat((area * 3.3 * 0.6 * 0.165).toFixed(1));
  const county = guessCounty(state.address?.label);
  const subsidy = SUBSIDIES[county] ?? SUBSIDIES['台北市'];

  const grade = state.panelGrade ?? 'standard';
  const gradeInfo = PANEL_GRADES.find(g => g.id === grade) ?? PANEL_GRADES[1];

  // Default budget: standard grade × full roof, capped at slider max
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
      <div className="card" style={{ padding: 26, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
          <div className="caption">
            預算上限（補助後自付）
            <Info tip="扣除政府補助後，你願意支付的最高金額" />
          </div>
          <div>
            <span className="num" style={{ fontSize: 28, fontWeight: 700, color: 'var(--green-700)' }}>
              NT$ {budgetCeiling.toLocaleString()}
            </span>
          </div>
        </div>
        <Slider
          min={50000} max={800000} step={10000}
          value={budgetCeiling}
          onChange={v => update({ budgetCeiling: v })}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
          <span className="caption">5 萬</span>
          <span className="caption">80 萬</span>
        </div>
      </div>

      {/* ── 面板等級卡片 ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 20 }}>
        {PANEL_GRADES.map(g => {
          const active = grade === g.id;
          const gNet = g.costPerKw - subsidy.amount;
          const gCap = parseFloat(Math.min(maxCapacity, gNet > 0 ? budgetCeiling / gNet : maxCapacity).toFixed(1));
          const isFull = gCap >= maxCapacity - 0.05;
          return (
            <button
              key={g.id}
              onClick={() => update({ panelGrade: g.id })}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.borderColor = 'var(--green-500)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.borderColor = 'var(--ink-200)'; e.currentTarget.style.transform = 'translateY(0)'; }}}
              style={{
                position: 'relative', textAlign: 'left', padding: 20,
                background: active ? 'var(--green-700)' : 'var(--white)',
                color: active ? 'var(--white)' : 'var(--ink-900)',
                border: `1.5px solid ${active ? 'var(--green-700)' : 'var(--ink-200)'}`,
                borderRadius: 'var(--radius-lg)',
                transition: 'all 0.2s var(--ease-out)',
                boxShadow: active ? 'var(--shadow-md)' : 'var(--shadow-sm)',
                cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10,
              }}
            >
              {/* 右上角 badge 區（推薦 + 屋頂全裝 垂直堆疊） */}
              <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                {'recommended' in g && g.recommended && (
                  <span style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 999, fontWeight: 600,
                    background: active ? 'rgba(255,255,255,0.2)' : 'var(--amber-soft)',
                    color: active ? 'var(--white)' : '#8B5A10',
                  }}>★ 推薦</span>
                )}
                {isFull && (
                  <span style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 999, fontWeight: 600,
                    background: active ? 'rgba(255,255,255,0.15)' : '#EEF2FF',
                    color: active ? 'var(--white)' : '#3730A3',
                  }}>屋頂全裝</span>
                )}
              </div>

              <div style={{ fontSize: 15, fontWeight: 600, paddingRight: 64 }}>{g.label}</div>

              <div>
                <div className="num" style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{gCap}</div>
                <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>kWp 可裝容量</div>
              </div>

              <div style={{ fontSize: 11, lineHeight: 1.5, opacity: active ? 0.85 : 0.55 }}>
                {g.efficiency} 轉換效率<br />
                NT$ {g.costPerKw.toLocaleString()} / kW
              </div>
            </button>
          );
        })}
      </div>

      {/* ── 規格 + 費用摘要 ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* 裝機規格 */}
        <div className="card" style={{ padding: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-400)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            裝機規格
          </div>
          {[
            { label: '裝機容量', value: `${capacity} kWp` },
            { label: '面板等級', value: gradeInfo.label },
            { label: '安裝單價', value: `NT$ ${gradeInfo.costPerKw.toLocaleString()} / kW` },
            { label: '約需面板', value: `${Math.round(capacity / 0.45)} 片` },
          ].map(r => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--ink-100)' }}>
              <span style={{ fontSize: 13, color: 'var(--ink-500)' }}>{r.label}</span>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{r.value}</span>
            </div>
          ))}
        </div>

        {/* 費用試算 */}
        <div className="card" style={{ padding: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-400)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            費用試算
          </div>
          {[
            { label: '總安裝費用',          value: `NT$ ${totalCost.toLocaleString()}`,                       green: false },
            { label: `${county} 政府補助`,  value: `− NT$ ${Math.round(subsidyAmount).toLocaleString()}`,     green: true  },
          ].map(r => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--ink-100)' }}>
              <span style={{ fontSize: 13, color: 'var(--ink-500)' }}>{r.label}</span>
              <span style={{ fontSize: 13, fontWeight: 500, color: r.green ? 'var(--green-700)' : undefined }}>{r.value}</span>
            </div>
          ))}
          <div style={{ marginTop: 16, padding: '14px 16px', background: 'var(--green-50)', borderRadius: 'var(--radius-md)', borderLeft: '3px solid var(--green-700)' }}>
            <div className="caption">實際自付金額</div>
            <div className="num" style={{ fontSize: 30, fontWeight: 700, color: 'var(--green-900)', marginTop: 4 }}>
              NT$ {Math.round(outOfPocket).toLocaleString()}
            </div>
            <div style={{ fontSize: 10, color: 'var(--ink-400)', marginTop: 4 }}>
              {subsidy.source} · {subsidy.amount.toLocaleString()} 元/kW · 資料更新：{subsidy.updatedAt}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
