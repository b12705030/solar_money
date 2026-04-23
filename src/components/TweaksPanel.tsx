'use client';
import type { TweaksState } from '@/lib/types';

const THEME_SWATCHES = [
  { id: 'forest' as const, colors: ['#2D6A4F', '#B7E4C7'] },
  { id: 'ocean'  as const, colors: ['#1D5A80', '#BFDCEC'] },
  { id: 'earth'  as const, colors: ['#6B4423', '#E5CFAE'] },
];

export default function TweaksPanel({
  tweaks,
  update,
}: {
  tweaks: TweaksState;
  update: (key: keyof TweaksState, value: string) => void;
}) {
  return (
    <div className="tweaks-panel">
      <h4>
        <span>Tweaks</span>
        <span style={{ fontSize: 10, color: 'var(--ink-400)', fontWeight: 400 }}>設計變體</span>
      </h4>

      <div className="tweaks-row">
        <label>主題色</label>
        <div className="swatches">
          {THEME_SWATCHES.map(t => (
            <div
              key={t.id}
              className={`swatch ${tweaks.theme === t.id ? 'active' : ''}`}
              onClick={() => update('theme', t.id)}
              style={{ background: `linear-gradient(135deg, ${t.colors[0]} 50%, ${t.colors[1]} 50%)` }}
            />
          ))}
        </div>
      </div>

      <div className="tweaks-row">
        <label>圓角風格</label>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['comfortable', 'compact'] as const).map(d => (
            <button
              key={d}
              onClick={() => update('density', d)}
              style={{
                padding: '4px 10px', fontSize: 11,
                borderRadius: 6, border: '1px solid',
                borderColor: tweaks.density === d ? 'var(--green-700)' : 'var(--ink-200)',
                background:   tweaks.density === d ? 'var(--green-50)' : 'var(--white)',
                color:        tweaks.density === d ? 'var(--green-700)' : 'var(--ink-500)',
              }}
            >
              {d === 'comfortable' ? '柔和' : '俐落'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--ink-100)' }}>
        設定自動儲存。切換主題可即時預覽在整個 wizard 的視覺效果。
      </div>
    </div>
  );
}
