'use client';
/**
 * PrintReport.tsx — 評估報告的 PDF/列印版面
 *
 * 這個檔案專門控制報告的排版與內容。
 * 修改這裡不會影響網頁畫面；網頁畫面的修改也不影響報告。
 *
 * 觸發方式：Results.tsx 的「下載評估報告」按鈕 → window.print()
 * CSS：globals.css @media print — .print-report 正常隱藏，列印時顯示
 */

import type { SolarState, ComputedResults } from '@/lib/types';
import { SUBSIDIES } from '@/lib/constants';

const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

const GOAL_LABELS: Record<string, string> = {
  annual: '全年總發電量最高',
  summer: '夏季發電量最高',
  winter: '冬季發電量最高',
  peak:   '正午峰值最高',
  match:  '與用電曲線最匹配',
  roi:    '投資回收最快',
};

// ─── 小元件 ───────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 11, fontWeight: 600, color: '#2D6A4F',
        textTransform: 'uppercase', letterSpacing: '0.08em',
        borderBottom: '2px solid #B7E4C7', paddingBottom: 4, marginBottom: 10,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function MetricBox({
  label, value, unit, prefix, sub,
}: {
  label: string; value: string; unit?: string; prefix?: string; sub?: string;
}) {
  return (
    <div style={{
      flex: 1, border: '1px solid #D8F3DC', borderRadius: 8,
      padding: '10px 12px', background: '#F0F9F2',
    }}>
      <div style={{ fontSize: 10, color: '#5A6B61', marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, flexWrap: 'nowrap' }}>
        {prefix && <span style={{ fontSize: 11, color: '#5A6B61', flexShrink: 0 }}>{prefix}</span>}
        <span style={{ fontSize: 24, fontWeight: 700, color: '#1B4332', lineHeight: 1 }}>{value}</span>
        {unit && <span style={{ fontSize: 11, color: '#5A6B61', flexShrink: 0 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 10, color: '#5A6B61', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function MonthBar({ kwh, max, highlight }: { kwh: number; max: number; highlight: boolean }) {
  const pct = Math.round((kwh / max) * 100);
  return (
    <div style={{ height: 6, background: '#EEF2EF', borderRadius: 3, overflow: 'hidden', marginTop: 2 }}>
      <div style={{
        height: '100%', width: `${pct}%`,
        background: highlight ? '#E8A53C' : '#40916C',
        borderRadius: 3,
      }} />
    </div>
  );
}

function DataRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '5px 0', borderBottom: '1px solid #EEF2EF',
    }}>
      <span style={{ fontSize: 12, color: '#5A6B61' }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: highlight ? 700 : 500, color: highlight ? '#1B4332' : '#2B3A32' }}>
        {value}
      </span>
    </div>
  );
}

// ─── 主元件 ───────────────────────────────────────────────────────────────────

export default function PrintReport({ state, r }: { state: SolarState; r: ComputedResults }) {
  const county = state.county ?? '台北市';
  const subsidy = SUBSIDIES[county] ?? SUBSIDIES['台北市'];
  const maxMonthlyKwh = Math.max(...r.monthlyKwh);
  const goalLabel = GOAL_LABELS[state.goal ?? 'annual'] ?? '全年總發電量最高';
  const today = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="print-report" style={{ fontFamily: '"Noto Sans TC", "PingFang TC", sans-serif', color: '#2B3A32' }}>

      {/* ── 報告 Header ── */}
      <div style={{
        background: '#1B4332', color: 'white',
        padding: '14px 20px', borderRadius: '8px 8px 0 0',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
        marginBottom: 16,
      }}>
        <div>
          <div style={{ fontSize: 10, opacity: 0.7, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 3 }}>
            Solar Money
          </div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>屋頂太陽能可行性評估報告</div>
        </div>
        <div style={{ fontSize: 10, opacity: 0.75, textAlign: 'right' }}>
          <div>{state.address?.label ?? '—'}</div>
          <div style={{ marginTop: 2 }}>列印日期：{today}</div>
        </div>
      </div>

      {/* ── 評估概要 ── */}
      <Section title="評估概要">
        <div style={{ display: 'flex', gap: 8 }}>
          <MetricBox
            label="預估年發電量"
            value={r.annualKwh.toLocaleString()} unit="kWh"
            sub={`相當於 ${(r.annualKwh / (state.monthlyKwh || 350)).toFixed(1)} 個月用電`}
          />
          <MetricBox
            label="能源自給率"
            value={`${r.selfSufficiency}`} unit="%"
            sub={`每月用電 ${state.monthlyKwh} kWh`}
          />
          <MetricBox
            label="預估回本年限"
            value={`${r.paybackYears}`} unit="年"
            sub={`保固 25 年 · 剩餘收益 ${(25 - r.paybackYears).toFixed(1)} 年`}
          />
          <MetricBox
            label="20 年累計淨收益"
            prefix="NT$"
            value={`${Math.round(r.total20yr / 10000)}`} unit="萬"
            sub="含 0.5%/年 衰退率"
          />
        </div>
      </Section>

      {/* ── 系統規格 ── */}
      <Section title="系統規格">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
          <DataRow label="屋頂面積" value={`${state.roofArea ?? '—'} 坪`} />
          <DataRow label="發電目標" value={goalLabel} />
          <DataRow label="裝機容量" value={`${state.capacity ?? '—'} kWp`} />
          <DataRow label="最佳安裝角度" value={`${r.bestAngle}° · ${r.recommendedAngle}`} />
          <DataRow label="氣候分區" value={`${r.region}（台灣）`} />
          <DataRow label="年均發電效率" value="PR 78%（含損耗）" />
        </div>
      </Section>

      {/* ── 月發電量 ── */}
      <Section title="月發電量估算">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '6px 12px' }}>
          {r.monthlyKwh.map((kwh, i) => {
            const isSummer = [5, 6, 7].includes(i);
            const isWinter = [11, 0, 1].includes(i);
            const hl = state.goal === 'summer' ? isSummer : state.goal === 'winter' ? isWinter : false;
            return (
              <div key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                  <span style={{ color: '#5A6B61' }}>{MONTHS[i]}</span>
                  <span style={{ fontWeight: 600, color: hl ? '#C8861E' : '#1B4332' }}>{kwh.toLocaleString()}</span>
                </div>
                <MonthBar kwh={kwh} max={maxMonthlyKwh} highlight={hl} />
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 6, fontSize: 10, color: '#5A6B61' }}>
          單位：kWh　橘色為目標優化月份
        </div>
      </Section>

      {/* ── 費用與補助 ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 16 }}>
        <Section title="安裝費用">
          <DataRow label="安裝單價" value={`NT$ ${(state.costPerKw ?? 55000).toLocaleString()} / kW`} />
          <DataRow label="裝機容量" value={`${state.capacity ?? '—'} kWp`} />
          <DataRow label="總安裝費用" value={`NT$ ${state.totalCost?.toLocaleString() ?? '—'}`} />
          <DataRow label={`${county} 政府補助`} value={`−NT$ ${Math.round(state.subsidyAmount ?? 0).toLocaleString()}`} />
          <DataRow label="實際自付金額" value={`NT$ ${Math.round(state.outOfPocket ?? 0).toLocaleString()}`} highlight />
          <div style={{ marginTop: 6, fontSize: 10, color: '#5A6B61' }}>
            補助來源：{subsidy.source}（{subsidy.amount.toLocaleString()} 元/kW）
          </div>
        </Section>

        <Section title="年度收益分析">
          <DataRow label="年發電量" value={`${r.annualKwh.toLocaleString()} kWh`} />
          <DataRow label="自用省電費（2.5 元/度）" value={`NT$ ${Math.round(r.selfUsedKwh * 2.5).toLocaleString()}`} />
          <DataRow label="台電躉購 FIT（5.7 元/度）" value={`NT$ ${Math.round(r.soldKwh * 5.7).toLocaleString()}`} />
          <DataRow label="年均總收益" value={`NT$ ${r.annualRevenue.toLocaleString()}`} highlight />
          <DataRow label="回本年限" value={`${r.paybackYears} 年`} />
          <DataRow label="20 年累計淨收益" value={`NT$ ${r.total20yr.toLocaleString()}`} highlight />
        </Section>
      </div>

      {/* ── 免責聲明 ── */}
      <div style={{
        fontSize: 9, color: '#7D8B82', lineHeight: 1.5,
        borderTop: '1px solid #D9DFDB', paddingTop: 8,
      }}>
        本報告為估算結果，僅供參考。實際發電量受建物結構、屋頂遮蔭、設備品質、安裝工法及氣候變化等因素影響，可能與估算有所差異。
        補助金額依據公開資料整理，建議向當地政府確認最新方案。FIT 躉購費率依台電現行公告計算，保障期限 20 年。
      </div>
    </div>
  );
}
