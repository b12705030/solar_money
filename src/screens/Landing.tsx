'use client';
import { useState, useRef } from 'react';
import { ChevronIcon, CheckIcon, XIcon } from '@/components/ui';
import { MISCONCEPTIONS } from '@/lib/constants';


function MythCard({ item, idx }: { item: typeof MISCONCEPTIONS[number]; idx: number }) {
  return (
    <div style={{
      flex: '0 0 360px',
      background: 'var(--white)',
      border: '1px solid var(--ink-100)',
      borderRadius: 'var(--radius-lg)',
      padding: 24,
      display: 'flex', flexDirection: 'column',
      boxShadow: 'var(--shadow-sm)',
      scrollSnapAlign: 'start',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: -30, right: -30,
        width: 140, height: 140, borderRadius: '50%',
        background: 'radial-gradient(circle, var(--green-50) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div style={{ fontSize: 11, color: 'var(--ink-400)', fontFamily: 'var(--font-num)', fontWeight: 600, letterSpacing: '0.1em', marginBottom: 18 }}>
        誤解 {String(idx + 1).padStart(2, '0')} / 05
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
        <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: '50%', background: 'var(--ink-100)', color: 'var(--ink-500)', display: 'grid', placeItems: 'center' }}>
          <XIcon size={12} />
        </span>
        <div>
          <div style={{ fontSize: 11, color: 'var(--ink-400)', fontWeight: 500, marginBottom: 2 }}>你可能以為</div>
          <div style={{ fontSize: 15, color: 'var(--ink-700)', fontWeight: 500, lineHeight: 1.45 }}>「{item.myth}」</div>
        </div>
      </div>

      <div style={{ height: 1, background: 'var(--ink-100)', margin: '14px 0' }} />

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flex: 1 }}>
        <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: '50%', background: 'var(--green-700)', color: 'var(--white)', display: 'grid', placeItems: 'center' }}>
          <CheckIcon size={12} />
        </span>
        <div>
          <div style={{ fontSize: 11, color: 'var(--green-700)', fontWeight: 600, marginBottom: 2 }}>其實</div>
          <div style={{ fontSize: 14, color: 'var(--ink-900)', lineHeight: 1.55 }}>{item.truth}</div>
        </div>
      </div>

      <div style={{
        marginTop: 20, padding: '14px 16px',
        background: 'var(--green-50)', borderRadius: 'var(--radius-sm)',
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8,
      }}>
        <div>
          <div className="num" style={{ fontSize: 22, fontWeight: 700, color: 'var(--green-700)', lineHeight: 1 }}>{item.stat}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 2 }}>{item.statLabel}</div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-400)', textAlign: 'right' }}>{item.compare}</div>
      </div>
    </div>
  );
}

export default function Landing({ onStart }: { onStart: () => void }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollIdx, setScrollIdx] = useState(0);

  const scrollBy = (dir: number) => {
    scrollerRef.current?.scrollBy({ left: dir * 380, behavior: 'smooth' });
  };

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    setScrollIdx(Math.round(el.scrollLeft / 380));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 80 }}>
      {/* HERO */}
      <section style={{ paddingTop: 40, position: 'relative' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.85fr', gap: 60, alignItems: 'center' }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 24 }}>屋頂太陽能 · 自助可行性評估</div>
            <h1 className="h-display" style={{ margin: 0 }}>
              輸入你家地址，<br />
              <span style={{ color: 'var(--green-700)' }}>30 秒</span>知道屋頂潛力
            </h1>
            <p className="body-lg" style={{ marginTop: 20, marginBottom: 36, maxWidth: 520 }}>
              不用等廠商來評估，自己先看清楚。整合中央氣象署日照資料、台電躉購費率與各縣市補助金額，一次算出你家適不適合裝。
            </p>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary xl" onClick={onStart}>
                開始評估
                <ChevronIcon dir="right" size={14} />
              </button>
              <span className="body-sm">免註冊 · 資料不留存 · 約需 30 秒</span>
            </div>

            <div style={{ marginTop: 44, display: 'flex', gap: 32, paddingTop: 28, borderTop: '1px solid var(--ink-100)' }}>
              {[
                { k: '中央氣象署', v: '日照資料', unit: '2015–2025' },
                { k: '台電',       v: '躉購費率', unit: 'FIT 2026 Q1' },
                { k: '22 縣市',    v: '補助金額', unit: '即時查詢' },
              ].map((s, i) => (
                <div key={i}>
                  <div className="caption" style={{ marginBottom: 4 }}>{s.k}</div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-900)' }}>{s.v}</div>
                  <div className="num" style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 2 }}>{s.unit}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Hero visual */}
          <div style={{
            borderRadius: 'var(--radius-sm)', overflow: 'hidden',
            boxShadow: '0 32px 80px rgba(27,67,50,0.14), 0 2px 8px rgba(27,67,50,0.08)',
            border: '1px solid var(--ink-100)',
            marginLeft: -30,
            marginTop: 40,
            maxWidth: '100%',
          }}>
            <img
              src="/report.png"
              alt="評估報告預覽"
              style={{ width: '100%', display: 'block' }}
            />
          </div>
        </div>
      </section>

      {/* MISCONCEPTIONS */}
      <section>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 14 }}>很多人裝太陽能前都有這些誤解</div>
            <h2 className="h-title" style={{ margin: 0, maxWidth: 680 }}>你可能以為… 其實…</h2>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-nav" onClick={() => scrollBy(-1)} aria-label="上一張" style={{ padding: 10 }}>
              <ChevronIcon dir="left" />
            </button>
            <button className="btn-nav" onClick={() => scrollBy(1)} aria-label="下一張" style={{ padding: 10 }}>
              <ChevronIcon dir="right" />
            </button>
          </div>
        </div>

        <div
          ref={scrollerRef}
          onScroll={onScroll}
          style={{
            display: 'flex', gap: 20,
            overflowX: 'auto',
            scrollSnapType: 'x mandatory',
            paddingBottom: 24,
            marginLeft: -40, marginRight: -40,
            paddingLeft: 40, paddingRight: 40,
            scrollbarWidth: 'thin',
          }}
        >
          {MISCONCEPTIONS.map((m, i) => <MythCard key={i} item={m} idx={i} />)}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 8 }}>
          {MISCONCEPTIONS.map((_, i) => (
            <div key={i} style={{
              width: i === scrollIdx ? 20 : 6, height: 6, borderRadius: 3,
              background: i === scrollIdx ? 'var(--green-700)' : 'var(--ink-200)',
              transition: 'all 0.3s var(--ease-out)',
            }} />
          ))}
        </div>

        <div style={{ marginTop: 48, display: 'flex', justifyContent: 'center' }}>
          <button className="btn btn-primary xl" onClick={onStart}>
            輸入我的地址，看看我家
            <ChevronIcon dir="right" size={14} />
          </button>
        </div>
      </section>

      <div style={{ height: 40 }} />
    </div>
  );
}
