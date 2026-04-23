'use client';
import { useEffect, useMemo } from 'react';
import { CheckIcon } from '@/components/ui';
import { GOALS } from '@/lib/constants';
import type { SolarState } from '@/lib/types';

type GoalId = 'annual' | 'summer' | 'winter' | 'peak' | 'match' | 'roi';

function GoalIcon({ kind, color }: { kind: string; color: string }) {
  const c = color;
  switch (kind as GoalId) {
    case 'annual':
      return <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke={c} strokeWidth="1.6"><circle cx="14" cy="14" r="5" fill={c} stroke="none"/>{Array.from({length:12}).map((_,i)=>{const a=i*30*Math.PI/180;return<line key={i} x1={14+Math.cos(a)*8} y1={14+Math.sin(a)*8} x2={14+Math.cos(a)*11} y2={14+Math.sin(a)*11} strokeLinecap="round"/>})}</svg>;
    case 'summer':
      return <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke={c} strokeWidth="1.6"><circle cx="14" cy="10" r="4" fill={c} stroke="none"/><path d="M5 22 Q 14 15 23 22" strokeLinecap="round"/><line x1="14" y1="3" x2="14" y2="5" strokeLinecap="round"/><line x1="22" y1="6" x2="20" y2="7.5" strokeLinecap="round"/><line x1="6" y1="6" x2="8" y2="7.5" strokeLinecap="round"/></svg>;
    case 'winter':
      return <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round"><line x1="14" y1="4" x2="14" y2="24"/><line x1="6" y1="9" x2="22" y2="19"/><line x1="6" y1="19" x2="22" y2="9"/><path d="M11 6 L14 9 L17 6"/><path d="M17 22 L14 19 L11 22"/></svg>;
    case 'peak':
      return <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 22 Q 14 4 24 22" fill={c+'22'} stroke={c}/><line x1="14" y1="4" x2="14" y2="22" strokeDasharray="2 3"/></svg>;
    case 'match':
      return <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round"><path d="M3 18 Q 8 10 13 18 T 25 14"/><path d="M3 16 Q 8 8 13 16 T 25 12" strokeDasharray="3 3" opacity="0.6"/></svg>;
    case 'roi':
      return <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round"><path d="M4 22 L12 14 L16 18 L24 8"/><path d="M18 8 L24 8 L24 14"/></svg>;
    default: return null;
  }
}

export default function StepGoal({
  state, update,
}: {
  state: SolarState;
  update: (patch: Partial<SolarState>) => void;
}) {
  const region = state.address?.region ?? '北部';

  const recommended = useMemo(() => {
    if (region === '北部') return 'summer';
    if (region === '南部') return 'annual';
    return 'match';
  }, [region]);

  useEffect(() => {
    if (!state.goal) update({ goal: recommended });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const goal = state.goal ?? recommended;

  return (
    <div>
      <div style={{ maxWidth: 720, marginBottom: 36 }}>
        <div className="eyebrow" style={{ marginBottom: 16 }}>Step 3 · 優化目標</div>
        <h2 className="h-title" style={{ margin: '0 0 14px' }}>你最想達成什麼目標？</h2>
        <p className="body" style={{ color: 'var(--ink-500)' }}>
          不同目標會影響板子的安裝角度與朝向。我們根據你的地區（<b style={{ color: 'var(--green-700)' }}>{region}</b>）推薦了「{GOALS.find(g => g.id === recommended)?.title}」。
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {GOALS.map(g => {
          const active = goal === g.id;
          const isRec = recommended === g.id;
          return (
            <button
              key={g.id}
              onClick={() => update({ goal: g.id })}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.borderColor = 'var(--green-500)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.borderColor = 'var(--ink-200)'; e.currentTarget.style.transform = 'translateY(0)'; }}}
              style={{
                position: 'relative', textAlign: 'left',
                padding: 22,
                background: active ? 'var(--green-700)' : 'var(--white)',
                color: active ? 'var(--white)' : 'var(--ink-900)',
                border: `1.5px solid ${active ? 'var(--green-700)' : 'var(--ink-200)'}`,
                borderRadius: 'var(--radius-lg)',
                transition: 'all 0.25s var(--ease-out)',
                boxShadow: active ? 'var(--shadow-md)' : 'var(--shadow-sm)',
                cursor: 'pointer',
                display: 'flex', flexDirection: 'column', gap: 12,
                minHeight: 160,
              }}
            >
              {isRec && (
                <div style={{ position: 'absolute', top: 12, right: 12 }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '3px 10px', borderRadius: 999,
                    background: active ? 'rgba(255,255,255,0.18)' : 'var(--amber-soft)',
                    color: active ? 'var(--white)' : '#8B5A10',
                    fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
                  }}>★ 推薦</span>
                </div>
              )}
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: active ? 'rgba(255,255,255,0.15)' : 'var(--green-50)',
                display: 'grid', placeItems: 'center',
              }}>
                <GoalIcon kind={g.icon} color={active ? 'var(--white)' : 'var(--green-700)'} />
              </div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>{g.title}</div>
                <div style={{ fontSize: 13, color: active ? 'rgba(255,255,255,0.8)' : 'var(--ink-500)', lineHeight: 1.45 }}>{g.desc}</div>
              </div>
              {active && (
                <div style={{
                  position: 'absolute', top: 12, left: 12,
                  width: 22, height: 22, borderRadius: '50%',
                  background: 'var(--white)', color: 'var(--green-700)',
                  display: 'grid', placeItems: 'center',
                }}>
                  <CheckIcon size={12} />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
