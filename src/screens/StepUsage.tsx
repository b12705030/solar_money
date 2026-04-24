'use client';
import { Badge, SunIcon } from '@/components/ui';
import { Slider } from '@/components/Slider';
import type { SolarState } from '@/lib/types';

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

  return (
    <div>
      <div style={{ maxWidth: 720 }}>
        <div className="eyebrow" style={{ marginBottom: 16 }}>Step 2 · 用電狀況</div>
        <h2 className="h-title" style={{ margin: '0 0 14px' }}>你家每個月用多少電？</h2>
        <p className="body" style={{ marginBottom: 40, color: 'var(--ink-500)' }}>
          不確定？可以看台電帳單的「本期用電度數」，或直接用台灣家庭平均值繼續。
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 40 }}>
        {/* Input card */}
        <div className="card elevated" style={{ padding: 36 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 24 }}>
            <div className="body-sm">月均用電度數</div>
            {kwh === 350 && <Badge tone="ink">預設值</Badge>}
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 30 }}>
            <input
              type="number" min="50" max="2000" value={kwh}
              onChange={e => update({ monthlyKwh: Math.max(50, Math.min(2000, +e.target.value || 0)) })}
              className="num"
              style={{
                fontSize: 72, fontWeight: 700, color: 'var(--green-700)',
                border: 'none', outline: 'none', background: 'transparent',
                width: 180, padding: 0,
              }}
            />
            <span style={{ fontSize: 22, color: 'var(--ink-500)', fontWeight: 500 }}>度 / 月</span>
          </div>

          <Slider min={100} max={1200} value={kwh} onChange={v => update({ monthlyKwh: v })} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
            <div style={{ textAlign: 'left' }}>
              <div className="num" style={{ fontSize: 13, fontWeight: 600 }}>100</div>
              <div className="caption">小家庭</div>
            </div>
            <div style={{ textAlign: 'center', opacity: kwh >= 300 && kwh <= 400 ? 1 : 0.4 }}>
              <div className="num" style={{ fontSize: 13, fontWeight: 600, color: 'var(--green-700)' }}>350</div>
              <div className="caption">平均</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div className="num" style={{ fontSize: 13, fontWeight: 600 }}>700</div>
              <div className="caption">多人家庭</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="num" style={{ fontSize: 13, fontWeight: 600 }}>1,200+</div>
              <div className="caption">大用電戶</div>
            </div>
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
