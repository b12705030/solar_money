'use client';
import { useState, useEffect, useMemo } from 'react';
import { Star, MapPin } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import type { VendorRecommendation, VendorDetail } from '@/lib/types';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

const ALL_COUNTIES = [
  '台北市','新北市','基隆市','桃園市','新竹市','新竹縣','苗栗縣',
  '台中市','彰化縣','南投縣','雲林縣','嘉義市','嘉義縣',
  '台南市','高雄市','屏東縣','宜蘭縣','花蓮縣','台東縣',
  '澎湖縣','金門縣','連江縣',
];

type SortKey = 'rating' | 'reviews';

async function getCountyFromGeolocation(): Promise<string | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      try {
        if (MAPBOX_TOKEN) {
          const res = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${coords.longitude},${coords.latitude}.json?access_token=${MAPBOX_TOKEN}&language=zh-TW&types=region,place&limit=1`
          );
          if (res.ok) {
            const data = await res.json();
            const name: string = data.features?.[0]?.text ?? '';
            const matched = ALL_COUNTIES.find(c =>
              name.includes(c.replace(/[市縣]$/, '')) || c.includes(name.replace(/[市縣]$/, ''))
            );
            if (matched) { resolve(matched); return; }
          }
        }
        const res = await fetch(`${API}/api/address-township?lat=${coords.latitude}&lng=${coords.longitude}`);
        if (res.ok) {
          const data = await res.json();
          const tn: string = data.townshipName ?? '';
          const matched = ALL_COUNTIES.find(c =>
            tn.startsWith(c.replace(/[市縣]$/, '')) || c.startsWith(tn.replace(/[市縣]$/, ''))
          );
          resolve(matched ?? null);
        } else resolve(null);
      } catch { resolve(null); }
    }, () => resolve(null));
  });
}

function VendorAvatar({ name, logo }: { name: string; logo?: string | null }) {
  if (logo) return <img src={logo} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />;
  return (
    <div style={{
      width: 44, height: 44, borderRadius: 10, flexShrink: 0,
      background: 'var(--green-100)', color: 'var(--green-700)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 18, fontWeight: 700,
    }}>{name[0]}</div>
  );
}

function StarRow({ rating }: { rating: number }) {
  return (
    <span style={{ display: 'inline-flex', gap: 1 }}>
      {[1,2,3,4,5].map(n => (
        <Star key={n} size={11} strokeWidth={1.5}
          fill={n <= Math.round(rating) ? '#f59e0b' : 'none'}
          color={n <= Math.round(rating) ? '#f59e0b' : '#d1d5db'} />
      ))}
    </span>
  );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      flexShrink: 0,
      fontSize: 12, padding: '4px 12px', borderRadius: 999, cursor: 'pointer',
      fontWeight: active ? 600 : 400,
      border: `1px solid ${active ? 'var(--green-700)' : 'var(--ink-150, #e5e7eb)'}`,
      background: active ? 'var(--green-700)' : 'var(--white)',
      color: active ? '#fff' : 'var(--ink-600)',
      transition: 'all 0.12s',
      whiteSpace: 'nowrap' as const,
    }}>{children}</button>
  );
}

export default function VendorBrowser() {
  const { user } = useAuth();
  const [vendors, setVendors] = useState<VendorRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [county, setCounty] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [minRating, setMinRating] = useState(0);
  const [sort, setSort] = useState<SortKey>('rating');
  const [geoLoading, setGeoLoading] = useState(false);

  // 詳情 modal
  const [detailVendor, setDetailVendor] = useState<VendorRecommendation | null>(null);
  const [detailData, setDetailData] = useState<VendorDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // 聯絡 modal
  const [contactVendor, setContactVendor] = useState<VendorRecommendation | null>(null);
  const [contactMsg, setContactMsg] = useState('廠商您好，我想詢問貴公司的太陽能安裝服務，請問方便提供報價嗎？謝謝！');
  const [contactSending, setContactSending] = useState(false);
  const [contactDone, setContactDone] = useState(false);
  const [contactError, setContactError] = useState('');

  const openDetail = (v: VendorRecommendation) => {
    setDetailVendor(v);
    setDetailData(null);
    setDetailLoading(true);
    fetch(`${API}/api/vendors/${encodeURIComponent(v.id)}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: VendorDetail | null) => setDetailData(d))
      .catch(() => {})
      .finally(() => setDetailLoading(false));
  };

  const openContact = (v: VendorRecommendation) => {
    setContactVendor(v);
    setContactMsg('廠商您好，我想詢問貴公司的太陽能安裝服務，請問方便提供報價嗎？謝謝！');
    setContactDone(false);
    setContactError('');
  };

  const sendContact = async () => {
    if (!contactVendor || !user) return;
    setContactSending(true);
    setContactError('');
    try {
      const res = await fetch(`${API}/api/vendors/${contactVendor.id}/inquire`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({ message: contactMsg.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail ?? '送出失敗');
      }
      setContactDone(true);
    } catch (e) {
      setContactError(e instanceof Error ? e.message : '送出失敗');
    } finally {
      setContactSending(false);
    }
  };

  useEffect(() => {
    fetch(`${API}/api/vendors?limit=50`)
      .then(r => r.ok ? r.json() : [])
      .then((d: VendorRecommendation[]) => setVendors(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    vendors.forEach(v => v.tags.forEach(t => set.add(t)));
    return [...set];
  }, [vendors]);

  const filtered = useMemo(() => {
    let list = [...vendors];
    if (county) list = list.filter(v =>
      v.counties.some(c => c.includes(county.replace(/[市縣]$/, '')) || county.includes(c.replace(/[市縣]$/, '')))
    );
    if (selectedTags.length) list = list.filter(v => selectedTags.every(t => v.tags.includes(t)));
    if (minRating > 0) list = list.filter(v => v.rating >= minRating);
    list.sort((a, b) => sort === 'rating' ? b.rating - a.rating : b.reviewCount - a.reviewCount);
    return list;
  }, [vendors, county, selectedTags, minRating, sort]);

  const toggleTag = (t: string) =>
    setSelectedTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

  const handleGeo = async () => {
    setGeoLoading(true);
    const detected = await getCountyFromGeolocation();
    if (detected) setCounty(detected);
    setGeoLoading(false);
  };

  return (
    <div>
      {/* 標題列 */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>認證廠商</div>
          <h2 className="h-title" style={{ margin: 0, fontSize: 22 }}>找到適合你的安裝廠商</h2>
        </div>
        <span style={{ fontSize: 13, color: 'var(--ink-400)' }}>{loading ? '—' : `${filtered.length} 家`}</span>
      </div>

      {/* 篩選器 */}
      <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* 縣市列 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={handleGeo}
            disabled={geoLoading}
            style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 12, padding: '4px 12px', borderRadius: 999,
              border: '1px solid var(--green-300)', background: 'var(--green-50)',
              color: 'var(--green-700)', cursor: 'pointer', fontWeight: 500,
              whiteSpace: 'nowrap',
            }}
          >
            <MapPin size={12} strokeWidth={2} />
            {geoLoading ? '定位中⋯' : '自動定位'}
          </button>
          <div style={{ width: 1, height: 18, background: 'var(--ink-150, #e5e7eb)', flexShrink: 0 }} />
          <FilterPill active={county === ''} onClick={() => setCounty('')}>全部</FilterPill>
          {ALL_COUNTIES.map(c => (
            <FilterPill key={c} active={county === c} onClick={() => setCounty(county === c ? '' : c)}>{c}</FilterPill>
          ))}
        </div>

        {/* 專長標籤 + 評分 + 排序 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {allTags.map(t => (
            <FilterPill key={t} active={selectedTags.includes(t)} onClick={() => toggleTag(t)}>{t}</FilterPill>
          ))}
          <div style={{ width: 1, height: 18, background: 'var(--ink-150, #e5e7eb)', flexShrink: 0 }} />
          <FilterPill active={minRating === 0} onClick={() => setMinRating(0)}>全部評分</FilterPill>
          <FilterPill active={minRating === 4} onClick={() => setMinRating(minRating === 4 ? 0 : 4)}>4★ 以上</FilterPill>
          <FilterPill active={minRating === 4.5} onClick={() => setMinRating(minRating === 4.5 ? 0 : 4.5)}>4.5★ 以上</FilterPill>
          <div style={{ width: 1, height: 18, background: 'var(--ink-150, #e5e7eb)', flexShrink: 0 }} />
          <FilterPill active={sort === 'rating'} onClick={() => setSort('rating')}>依評分</FilterPill>
          <FilterPill active={sort === 'reviews'} onClick={() => setSort('reviews')}>依評價數</FilterPill>
        </div>
      </div>

      {/* 廠商列表 */}
      {loading ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--ink-400)', fontSize: 14 }}>載入廠商中⋯</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--ink-400)', fontSize: 14 }}>沒有符合條件的廠商</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
          {filtered.map(v => (
            <div key={v.id} style={{
              display: 'flex', flexDirection: 'column', gap: 12,
              padding: '16px 18px',
              background: 'var(--white)',
              border: '1px solid var(--ink-100)',
              borderRadius: 12,
              boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
              transition: 'box-shadow 0.15s, border-color 0.15s',
              cursor: 'default',
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.10)'; (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--green-200)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 4px rgba(0,0,0,0.05)'; (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--ink-100)'; }}
            >
              {/* 頂部：logo + 名稱 + 評分 */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <VendorAvatar name={v.name} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-900)', marginBottom: 2 }}>{v.name}</div>
                  {v.rating > 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                      <StarRow rating={v.rating} />
                      <span style={{ fontWeight: 700, color: '#92400e' }}>{v.rating.toFixed(1)}</span>
                      {v.reviewCount > 0 && <span style={{ color: 'var(--ink-400)' }}>（{v.reviewCount} 則評價）</span>}
                    </div>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--ink-400)' }}>暫無評價</span>
                  )}
                </div>
              </div>

              {/* 代表案例 */}
              {v.portfolioTitle && (
                <div style={{ fontSize: 13, color: 'var(--green-800)', fontWeight: 500, lineHeight: 1.4 }}>
                  {v.portfolioTitle}
                  {v.portfolioMeta && <span style={{ color: 'var(--ink-400)', fontWeight: 400, marginLeft: 6 }}>{v.portfolioMeta}</span>}
                </div>
              )}

              {/* 服務縣市 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--ink-500)', flexWrap: 'wrap' }}>
                <MapPin size={11} strokeWidth={2} color="var(--green-600)" style={{ flexShrink: 0 }} />
                {v.counties.slice(0, 4).join('・')}{v.counties.length > 4 ? `⋯+${v.counties.length - 4}` : ''}
              </div>

              {/* 標籤 */}
              {v.tags.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {v.tags.map(t => (
                    <span key={t} style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 999,
                      background: 'var(--green-50)', border: '1px solid var(--green-200)',
                      color: 'var(--green-700)', fontWeight: 500,
                    }}>{t}</span>
                  ))}
                </div>
              )}

              {/* 底部：聯絡資訊 */}
              <div style={{ marginTop: 'auto', paddingTop: 10, borderTop: '1px solid var(--ink-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--ink-500)', lineHeight: 1.6, minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.phone}</div>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.email}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => openDetail(v)} style={{
                    fontSize: 12, padding: '6px 14px', borderRadius: 8,
                    border: '1px solid var(--green-700)', background: 'transparent',
                    color: 'var(--green-700)', cursor: 'pointer', fontWeight: 500,
                  }}>詳情</button>
                  <button onClick={() => openContact(v)} style={{
                    fontSize: 12, padding: '6px 14px', borderRadius: 8,
                    border: 'none', background: 'var(--green-700)',
                    color: '#fff', cursor: 'pointer', fontWeight: 500,
                  }}>聯絡</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 詳情 Modal */}
      {detailVendor && (
        <div className="modal-backdrop" onClick={() => setDetailVendor(null)}>
          <div className="modal" style={{ width: '90vw', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{detailVendor.name}</div>
              <button className="modal-close" onClick={() => setDetailVendor(null)}>×</button>
            </div>
            <div style={{ padding: '0 24px 24px' }}>
              {detailLoading ? (
                <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--ink-400)' }}>載入中⋯</div>
              ) : detailData ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, fontSize: 13 }}>
                    <StarRow rating={detailData.rating} />
                    {detailData.rating > 0 && <span style={{ fontWeight: 700, color: '#92400e' }}>{detailData.rating.toFixed(1)}</span>}
                    {detailData.reviewCount > 0 && <span style={{ color: 'var(--ink-400)' }}>（{detailData.reviewCount} 則評價）</span>}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 16 }}>
                    {detailData.tags.map(t => (
                      <span key={t} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'var(--green-50)', border: '1px solid var(--green-200)', color: 'var(--green-700)', fontWeight: 500 }}>{t}</span>
                    ))}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--ink-500)', marginBottom: 16, lineHeight: 1.7 }}>
                    <div>服務縣市：{detailData.counties.join('、')}</div>
                    <div>電話：{detailData.phone}</div>
                    <div>Email：{detailData.email}</div>
                  </div>
                  {detailData.portfolios.length > 0 && (
                    <>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-700)', marginBottom: 10 }}>作品集</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {detailData.portfolios.map(p => (
                          <div key={p.id} style={{ padding: '10px 14px', background: 'var(--green-50)', borderRadius: 8, border: '1px solid var(--green-100)' }}>
                            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--green-900)' }}>{p.title}</div>
                            <div style={{ fontSize: 12, color: 'var(--ink-400)', marginTop: 2 }}>{p.meta}</div>
                            {p.description && <div style={{ fontSize: 12, color: 'var(--ink-600)', marginTop: 6 }}>{p.description}</div>}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--ink-400)' }}>無法載入資料</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 聯絡 Modal */}
      {contactVendor && (
        <div className="modal-backdrop" onClick={() => setContactVendor(null)}>
          <div className="modal" style={{ width: '90vw', maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">聯絡 {contactVendor.name}</div>
              <button className="modal-close" onClick={() => setContactVendor(null)}>×</button>
            </div>
            <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {contactDone ? (
                <div style={{ padding: '24px 0', textAlign: 'center' }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
                  <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>詢價已送出！</div>
                  <div style={{ fontSize: 13, color: 'var(--ink-400)' }}>廠商將盡快與你聯繫</div>
                  <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={() => setContactVendor(null)}>關閉</button>
                </div>
              ) : !user ? (
                <div style={{ padding: '20px 0', textAlign: 'center' }}>
                  <div style={{ fontSize: 13, color: 'var(--ink-500)', marginBottom: 16 }}>需要登入才能聯絡廠商</div>
                  <a href="/" className="btn btn-primary" style={{ textDecoration: 'none' }}>回首頁登入</a>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 13, color: 'var(--ink-500)' }}>
                    <div>{contactVendor.phone}</div>
                    <div>{contactVendor.email}</div>
                  </div>
                  <textarea
                    value={contactMsg}
                    onChange={e => setContactMsg(e.target.value)}
                    rows={5}
                    className="form-input"
                    style={{ resize: 'vertical', fontSize: 13 }}
                  />
                  {contactError && <div className="form-error">{contactError}</div>}
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" onClick={() => setContactVendor(null)}>取消</button>
                    <button className="btn btn-primary" disabled={contactSending || !contactMsg.trim()} onClick={sendContact}>
                      {contactSending ? '送出中⋯' : '送出詢價'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
