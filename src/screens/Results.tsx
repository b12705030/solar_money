'use client';
import { useState, useMemo } from 'react';
import { Info } from '@/components/ui';
import { computeResults } from '@/lib/compute';
import type { SolarState, ComputedResults } from '@/lib/types';

const MONTHS = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

function MonthlyChart({ data, highlight }: { data: number[]; highlight?: string }) {
  const max = Math.max(...data);
  const highlightIdx = highlight === 'summer' ? [5, 6, 7] : highlight === 'winter' ? [11, 0, 1] : [];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 240, padding: '0 8px' }}>
        {data.map((v, i) => {
          const h = (v / max) * 100;
          const hl = highlightIdx.includes(i);
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%' }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', width: '100%' }}>
                <div style={{
                  width: '100%', height: `${h}%`,
                  background: hl
                    ? 'linear-gradient(180deg, #E8A53C 0%, #C8861E 100%)'
                    : 'linear-gradient(180deg, var(--green-500) 0%, var(--green-700) 100%)',
                  borderRadius: '6px 6px 0 0',
                  position: 'relative', transition: 'height 0.8s var(--ease-out)',
                  boxShadow: hl ? '0 2px 8px rgba(232,165,60,0.3)' : 'none',
                }}>
                  {v === max && (
                    <div className="num" style={{
                      position: 'absolute', top: -22, left: '50%', transform: 'translateX(-50%)',
                      fontSize: 11, fontWeight: 700,
                      color: hl ? '#8B5A10' : 'var(--green-900)', whiteSpace: 'nowrap',
                    }}>{v.toLocaleString()}</div>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-500)', fontFamily: 'var(--font-num)' }}>{MONTHS[i]}</div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--ink-100)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-500)' }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--green-700)' }} />
          月發電量 (kWh)
        </div>
        {highlightIdx.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-500)' }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: '#E8A53C' }} />
            優化目標月份
          </div>
        )}
      </div>
    </div>
  );
}

function RevenueChart({ annualRevenue, outOfPocket, paybackYears }: { annualRevenue: number; outOfPocket: number; paybackYears: number }) {
  const years = 20;
  const points = Array.from({ length: years + 1 }, (_, y) => {
    const revenue = Array.from({ length: y }, (_, i) => annualRevenue * Math.pow(0.995, i)).reduce((a, b) => a + b, 0);
    return { y, net: revenue - outOfPocket };
  });
  const maxNet = points[points.length - 1].net;
  const minNet = -outOfPocket;
  const range = maxNet - minNet;

  const W = 600, H = 200, PAD = 20;
  const px = (y: number) => PAD + (y / years) * (W - PAD * 2);
  const py = (net: number) => H - PAD - ((net - minNet) / range) * (H - PAD * 2);
  const zeroY = py(0);

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(p.y)} ${py(p.net)}`).join(' ');
  const areaD = `${pathD} L ${px(years)} ${zeroY} L ${px(0)} ${zeroY} Z`;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 220 }}>
        <defs>
          <linearGradient id="revGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#40916C" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#40916C" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="var(--ink-200)" strokeDasharray="4 4" />
        <text x={PAD} y={zeroY - 4} fontSize="10" fill="var(--ink-400)" fontFamily="var(--font-num)">收支平衡</text>
        <path d={areaD} fill="url(#revGrad)" />
        <path d={pathD} stroke="var(--green-700)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <line x1={px(paybackYears)} y1={PAD} x2={px(paybackYears)} y2={H - PAD} stroke="#E8A53C" strokeWidth="1.5" strokeDasharray="2 3" />
        <circle cx={px(paybackYears)} cy={zeroY} r="6" fill="#E8A53C" stroke="white" strokeWidth="2" />
        <text x={px(paybackYears)} y={PAD - 4} fontSize="11" fill="#8B5A10" fontFamily="var(--font-num)" fontWeight="600" textAnchor="middle">
          ▼ {paybackYears} 年回本
        </text>
        <circle cx={px(years)} cy={py(maxNet)} r="5" fill="var(--green-700)" stroke="white" strokeWidth="2" />
        <text x={px(years) - 6} y={py(maxNet) - 10} fontSize="11" fill="var(--green-900)" fontFamily="var(--font-num)" fontWeight="600" textAnchor="end">
          +NT$ {Math.round(maxNet / 1000)}K
        </text>
        {[0, 5, 10, 15, 20].map(y => (
          <text key={y} x={px(y)} y={H - 4} fontSize="10" fill="var(--ink-400)" textAnchor="middle" fontFamily="var(--font-num)">{y} 年</text>
        ))}
      </svg>
    </div>
  );
}

function BreakdownRow({ label, value, color, max }: { label: string; value: number; color: string; max: number }) {
  const pct = Math.abs(value) / max * 100;
  const isNegative = value < 0;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="body-sm" style={{ color: 'var(--ink-700)' }}>{label}</span>
        <span className="num" style={{ fontSize: 15, fontWeight: 600, color: isNegative ? 'var(--green-700)' : 'var(--ink-900)' }}>
          {isNegative ? '−' : ''}NT$ {Math.abs(value).toLocaleString()}
        </span>
      </div>
      <div style={{ height: 6, background: 'var(--ink-100)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, transition: 'width 0.8s' }} />
      </div>
    </div>
  );
}

export default function Results({ state, onRestart }: { state: SolarState; onRestart: () => void }) {
  const r: ComputedResults = useMemo(() => computeResults(state), [state]);
  const [tab, setTab] = useState<'generation' | 'investment'>('generation');

  const goalLabel = state.goal === 'summer' ? '夏季發電量最高' : state.goal === 'winter' ? '冬季發電量最高' : '全年總發電量最高';

  return (
    <div style={{ paddingBottom: 40 }}>
      {/* Summary header */}
      <div style={{ marginBottom: 28 }}>
        <div className="eyebrow" style={{ marginBottom: 16, color: 'var(--amber)' }}>
          <span style={{ background: 'var(--amber)' }}></span>評估結果
        </div>
        <h2 className="h-title" style={{ margin: '0 0 8px' }}>你家屋頂很適合裝太陽能</h2>
        <p className="body" style={{ color: 'var(--ink-500)' }}>
          基於 {state.address?.label ?? '你輸入的地址'} 的日照資料、{r.region}氣候模型與 {state.county ?? '台北市'} 政府補助計算。
        </p>
      </div>

      {/* Headline numbers */}
      <div className="card elevated" style={{ padding: 36, marginBottom: 28, background: 'linear-gradient(135deg, #FFFFFF 0%, #F0F9F2 100%)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24 }}>
          <div>
            <div className="caption" style={{ marginBottom: 10 }}>年發電量</div>
            <div>
              <span className="num" style={{ fontSize: 48, fontWeight: 700, color: 'var(--green-900)', lineHeight: 1 }}>
                {r.annualKwh.toLocaleString()}
              </span>
              <span style={{ fontSize: 16, color: 'var(--ink-500)', marginLeft: 6 }}>kWh</span>
            </div>
            <div className="body-sm" style={{ marginTop: 8 }}>相當於 {Math.round(r.annualKwh / r.monthlyKwh.reduce((a, b) => a + b, 0) * 12)} 個月用電</div>
          </div>

          <div style={{ borderLeft: '1px solid var(--ink-100)', paddingLeft: 24 }}>
            <div className="caption" style={{ marginBottom: 10 }}>
              能源自給率<Info tip="自發電量 ÷ 總用電量" />
            </div>
            <div>
              <span className="num" style={{ fontSize: 48, fontWeight: 700, color: 'var(--green-900)', lineHeight: 1 }}>{r.selfSufficiency}</span>
              <span style={{ fontSize: 16, color: 'var(--ink-500)', marginLeft: 6 }}>%</span>
            </div>
            <div style={{ marginTop: 10, height: 6, background: 'var(--ink-100)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${r.selfSufficiency}%`, background: 'linear-gradient(90deg, var(--green-500), var(--green-700))', transition: 'width 1s var(--ease-out)' }} />
            </div>
          </div>

          <div style={{ borderLeft: '1px solid var(--ink-100)', paddingLeft: 24 }}>
            <div className="caption" style={{ marginBottom: 10 }}>預估回本年限</div>
            <div>
              <span className="num" style={{ fontSize: 48, fontWeight: 700, color: '#C8861E', lineHeight: 1 }}>{r.paybackYears}</span>
              <span style={{ fontSize: 16, color: 'var(--ink-500)', marginLeft: 6 }}>年</span>
            </div>
            <div className="body-sm" style={{ marginTop: 8 }}>保固 25 年 · 剩餘純收益 {(25 - r.paybackYears).toFixed(1)} 年</div>
          </div>

          <div style={{ borderLeft: '1px solid var(--ink-100)', paddingLeft: 24 }}>
            <div className="caption" style={{ marginBottom: 10 }}>20 年總收益</div>
            <div>
              <span className="num" style={{ fontSize: 34, fontWeight: 700, color: 'var(--green-900)', lineHeight: 1 }}>
                NT$ {Math.round(r.total20yr / 10000)}
              </span>
              <span style={{ fontSize: 16, color: 'var(--ink-500)', marginLeft: 4 }}>萬</span>
            </div>
            <div className="body-sm" style={{ marginTop: 8, fontFamily: 'var(--font-num)' }}>NT$ {r.total20yr.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--ink-200)' }}>
        {([
          { id: 'generation' as const, label: '發電潛力' },
          { id: 'investment' as const, label: '投資試算' },
        ]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '14px 22px', fontSize: 15, fontWeight: 500,
            color: tab === t.id ? 'var(--green-700)' : 'var(--ink-500)',
            borderBottom: `2px solid ${tab === t.id ? 'var(--green-700)' : 'transparent'}`,
            marginBottom: -1, transition: 'all 0.2s',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'generation' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20 }}>
          <div className="card" style={{ padding: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 24 }}>
              <h3 className="h-section" style={{ margin: 0 }}>月發電量</h3>
              <span className="body-sm">單位：kWh</span>
            </div>
            <MonthlyChart data={r.monthlyKwh} highlight={state.goal} />
            <div style={{ marginTop: 20, padding: 14, background: 'var(--green-50)', borderRadius: 10, fontSize: 13, color: 'var(--ink-700)' }}>
              ★ 根據你選的目標「<b>{goalLabel}</b>」，夏季（6–8 月）月平均發電量較台灣平均高約 8%。
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Best angle */}
            <div className="card" style={{ padding: 24 }}>
              <div className="caption" style={{ marginBottom: 10 }}>最佳安裝角度</div>
              <div className="num" style={{ fontSize: 34, fontWeight: 700, color: 'var(--green-900)' }}>{r.bestAngle}°</div>
              <div className="body-sm" style={{ marginTop: 6 }}>{r.recommendedAngle}</div>
              <svg viewBox="0 0 160 80" style={{ width: '100%', marginTop: 16 }}>
                <line x1="10" y1="68" x2="150" y2="68" stroke="var(--ink-300)" strokeWidth="1.5" />
                <polygon
                  points={`20,68 ${20 + 80 * Math.cos(r.bestAngle * Math.PI / 180)},${68 - 80 * Math.sin(r.bestAngle * Math.PI / 180)} ${40 + 80 * Math.cos(r.bestAngle * Math.PI / 180)},${68 - 80 * Math.sin(r.bestAngle * Math.PI / 180)} 40,68`}
                  fill="var(--green-700)" opacity="0.85"
                />
                <path
                  d={`M 45 68 A 25 25 0 0 0 ${45 + 25 * Math.cos((180 - r.bestAngle) * Math.PI / 180)} ${68 + 25 * Math.sin((180 - r.bestAngle) * Math.PI / 180)}`}
                  fill="none" stroke="var(--amber)" strokeWidth="1.5"
                />
                <text x={55} y={60} fontSize="11" fontFamily="var(--font-num)" fill="#8B5A10" fontWeight="600">{r.bestAngle}°</text>
              </svg>
            </div>

            {/* Comparison */}
            <div className="card" style={{ padding: 24 }}>
              <div className="caption" style={{ marginBottom: 12 }}>與台灣平均比較</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                  { label: '你的屋頂', value: r.annualKwh, color: 'var(--green-700)', emphasis: true },
                  { label: '台灣平均（同容量）', value: Math.round(r.annualKwh * 0.92), color: 'var(--ink-300)', emphasis: false },
                ].map((row, i) => {
                  const pct = (row.value / r.annualKwh) * 100;
                  return (
                    <div key={i}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                        <span style={{ color: row.emphasis ? 'var(--green-900)' : 'var(--ink-500)', fontWeight: row.emphasis ? 600 : 400 }}>{row.label}</span>
                        <span className="num" style={{ fontWeight: 600, color: row.emphasis ? 'var(--green-900)' : 'var(--ink-500)' }}>{row.value.toLocaleString()} kWh</span>
                      </div>
                      <div style={{ height: 8, background: 'var(--ink-100)', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: row.color, transition: 'width 1s' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 14, fontSize: 12, color: 'var(--green-700)', fontWeight: 500 }}>↑ 比台灣平均高 8.7%</div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 20 }}>
          {/* Cost breakdown */}
          <div className="card" style={{ padding: 28 }}>
            <h3 className="h-section" style={{ margin: '0 0 22px' }}>成本拆解</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <BreakdownRow label="安裝費用" value={state.totalCost ?? 0} color="var(--ink-700)" max={state.totalCost ?? 1} />
              <BreakdownRow label={`${state.county ?? '台北市'} 補助`} value={-(state.subsidyAmount ?? 0)} color="var(--green-700)" max={state.totalCost ?? 1} />
              <div style={{ borderTop: '1px dashed var(--ink-200)', paddingTop: 14, marginTop: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>實際自付</span>
                  <span className="num" style={{ fontSize: 28, fontWeight: 700, color: 'var(--green-900)' }}>NT$ {state.outOfPocket?.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 26, padding: 18, background: 'var(--green-50)', borderRadius: 12 }}>
              <div className="caption" style={{ marginBottom: 6 }}>年度收益來源</div>
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>自用省電費</div>
                  <div className="num" style={{ fontSize: 18, fontWeight: 700, color: 'var(--green-900)' }}>
                    NT$ {Math.round(r.selfUsedKwh * 2.5).toLocaleString()}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>台電躉購</div>
                  <div className="num" style={{ fontSize: 18, fontWeight: 700, color: 'var(--green-900)' }}>
                    NT$ {Math.round(r.soldKwh * 5.7).toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="caption" style={{ marginTop: 10 }}>FIT 收購費率 5.7 元/度 · 保障 20 年</div>
            </div>
          </div>

          {/* Revenue curve */}
          <div className="card" style={{ padding: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
              <h3 className="h-section" style={{ margin: 0 }}>20 年累計淨收益</h3>
              <span className="body-sm">含衰退率 0.5%/年</span>
            </div>
            <RevenueChart annualRevenue={r.annualRevenue} outOfPocket={state.outOfPocket ?? 400000} paybackYears={r.paybackYears} />

            <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, paddingTop: 18, borderTop: '1px solid var(--ink-100)' }}>
              <div>
                <div className="caption">起始投資</div>
                <div className="num" style={{ fontSize: 16, fontWeight: 600, color: 'var(--danger)', marginTop: 4 }}>
                  −NT$ {Math.round((state.outOfPocket ?? 400000) / 10000)}萬
                </div>
              </div>
              <div>
                <div className="caption">年均收益</div>
                <div className="num" style={{ fontSize: 16, fontWeight: 600, color: 'var(--green-700)', marginTop: 4 }}>
                  +NT$ {Math.round(r.annualRevenue / 1000)}K
                </div>
              </div>
              <div>
                <div className="caption">20 年 IRR</div>
                <div className="num" style={{ fontSize: 16, fontWeight: 600, color: 'var(--green-900)', marginTop: 4 }}>約 10.5%</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CTA */}
      <div style={{
        marginTop: 36, padding: 28,
        background: 'var(--green-900)', color: 'var(--white)',
        borderRadius: 'var(--radius-lg)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexWrap: 'wrap', gap: 16,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -60, right: -40, width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle, rgba(232,165,60,0.2), transparent 70%)' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 4, letterSpacing: '0.08em', textTransform: 'uppercase' }}>下一步</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>下載完整報告，或找認證廠商實勘</div>
          <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>報告含結構評估項目清單、推薦廠商比較表，PDF 約 12 頁。</div>
        </div>
        <div style={{ display: 'flex', gap: 10, position: 'relative' }}>
          <button className="btn btn-secondary" style={{ background: 'transparent', color: 'var(--white)', borderColor: 'rgba(255,255,255,0.3)' }}>
            尋找廠商
          </button>
          <button className="btn" style={{ background: 'var(--amber)', color: 'var(--green-900)', boxShadow: '0 4px 0 #8B5A10' }}>
            下載評估報告
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M8 2 L8 11 M4 7 L8 11 L12 7 M3 14 L13 14"/>
            </svg>
          </button>
        </div>
      </div>

      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'center' }}>
        <button className="btn-ghost" onClick={onRestart} style={{ fontSize: 13 }}>
          ← 重新評估其他地址
        </button>
      </div>
    </div>
  );
}
