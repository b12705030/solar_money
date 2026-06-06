'use client';
import { useState, useEffect, useMemo } from 'react';
import { MapPin } from 'lucide-react';
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

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-400)', whiteSpace: 'nowrap', flexShrink: 0 }}>
      {children}
    </span>
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
  const [geoToast, setGeoToast] = useState('');
  const [countyTooltipId, setCountyTooltipId] = useState<string | null>(null);

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
    setGeoToast('');
    const detected = await getCountyFromGeolocation();
    setGeoLoading(false);
    if (detected) {
      setCounty(detected);
      setGeoToast(`已定位到：${detected}`);
      setTimeout(() => setGeoToast(''), 3000);
    } else {
      setGeoToast('無法取得位置');
      setTimeout(() => setGeoToast(''), 3000);
    }
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
      <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* 服務縣市 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FilterLabel>服務縣市</FilterLabel>
          <select
            value={county}
            onChange={e => setCounty(e.target.value)}
            style={{
              fontSize: 13, padding: '5px 10px', borderRadius: 8,
              border: '1px solid var(--ink-200)', background: 'var(--white)',
              color: county ? 'var(--green-700)' : 'var(--ink-500)',
              fontWeight: county ? 600 : 400, cursor: 'pointer',
              outline: 'none',
            }}
          >
            <option value="">全部縣市</option>
            {ALL_COUNTIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            onClick={handleGeo}
            disabled={geoLoading}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 12, padding: '5px 12px', borderRadius: 8,
              border: '1px solid var(--green-300)', background: 'var(--green-50)',
              color: 'var(--green-700)', cursor: 'pointer', fontWeight: 500,
              whiteSpace: 'nowrap',
            }}
          >
            <MapPin size={12} strokeWidth={2} />
            {geoLoading ? '定位中⋯' : '自動定位'}
          </button>
          {geoToast && (
            <span style={{ fontSize: 12, color: 'var(--green-700)', fontWeight: 500 }}>
              {geoToast}
            </span>
          )}
        </div>

        {/* 服務專長 */}
        {allTags.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <FilterLabel>服務專長</FilterLabel>
            {allTags.map(t => (
              <FilterPill key={t} active={selectedTags.includes(t)} onClick={() => toggleTag(t)}>{t}</FilterPill>
            ))}
          </div>
        )}

        {/* 評分 & 排序 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <FilterLabel>評分篩選</FilterLabel>
          <FilterPill active={minRating === 0} onClick={() => setMinRating(0)}>全部</FilterPill>
          <FilterPill active={minRating === 4} onClick={() => setMinRating(minRating === 4 ? 0 : 4)}>4★ 以上</FilterPill>
          <FilterPill active={minRating === 4.5} onClick={() => setMinRating(minRating === 4.5 ? 0 : 4.5)}>4.5★ 以上</FilterPill>
          <div style={{ width: 1, height: 16, background: 'var(--ink-150)', flexShrink: 0 }} />
          <FilterLabel>排序</FilterLabel>
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
        <div className="vendor-grid">
          {filtered.map(v => (
            <div key={v.id} className="vendor-card">
              <div className="vendor-card-header">
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0 }}>
                  <VendorAvatar name={v.name} logo={v.logoUrl} />
                  <div style={{ minWidth: 0 }}>
                    <div className="vendor-card-name">{v.name}</div>
                    <div className="vendor-card-meta" style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                      {v.counties.slice(0, 3).join('・')}
                      {v.counties.length > 3 && (
                        <span
                          style={{ position: 'relative', display: 'inline-flex' }}
                          onMouseEnter={() => setCountyTooltipId(v.id)}
                          onMouseLeave={() => setCountyTooltipId(null)}
                        >
                          <span style={{
                            fontSize: 10, padding: '1px 6px', borderRadius: 999,
                            background: 'var(--ink-100)', color: 'var(--ink-500)', fontWeight: 500,
                            cursor: 'default',
                          }}>+{v.counties.length - 3}</span>
                          {countyTooltipId === v.id && (
                            <div style={{
                              position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%',
                              transform: 'translateX(-50%)',
                              background: '#1f2937', color: '#fff',
                              fontSize: 11, padding: '5px 9px', borderRadius: 6,
                              whiteSpace: 'nowrap', zIndex: 50, pointerEvents: 'none',
                              boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                            }}>
                              {v.counties.slice(3).join('、')}
                            </div>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="vendor-card-rating">
                  <span>★</span>
                  {v.rating > 0 ? v.rating.toFixed(1) : '—'}
                </div>
              </div>

              {v.portfolioTitle && (
                <div className="vendor-card-portfolio">{v.portfolioTitle}</div>
              )}

              <div className="vendor-card-stats">
                <div>
                  <span className="caption">案例容量</span>
                  <strong>{v.capacityKw > 0 ? `${v.capacityKw} kWp` : '—'}</strong>
                </div>
                <div>
                  <span className="caption">評價數</span>
                  <strong>{v.reviewCount > 0 ? `${v.reviewCount} 則` : '暫無'}</strong>
                </div>
              </div>

              {v.tags.length > 0 && (
                <div className="vendor-card-tags">
                  {v.tags.map(t => <span key={t}>{t}</span>)}
                </div>
              )}

              <div className="vendor-card-contact">
                <div style={{ fontSize: 12, color: 'var(--ink-500)', lineHeight: 1.6, minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.phone}</div>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.email}</div>
                </div>
                <div className="vendor-card-actions">
                  <button className="btn-ghost vendor-detail-btn" onClick={() => openDetail(v)}>查看詳情</button>
                  {user?.role !== 'vendor' && (
                    <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 14px' }} onClick={() => openContact(v)}>聯絡</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 詳情 Modal */}
      {detailVendor && (
        <div className="modal-backdrop" onClick={() => setDetailVendor(null)}>
          <div className="modal vendor-detail-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">廠商詳細資料</div>
              <button className="modal-close" onClick={() => setDetailVendor(null)}>×</button>
            </div>
            {detailLoading && <div className="vendor-state">載入廠商資料中⋯</div>}
            {!detailLoading && !detailData && <div className="vendor-state vendor-state--error">暫時無法載入廠商資料，請稍後再試。</div>}
            {!detailLoading && detailData && (
              <div className="vendor-detail-content">
                <div className="vendor-detail-hero">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <VendorAvatar name={detailData.name} logo={detailData.logoUrl} />
                    <div>
                      <div className="vendor-detail-name">{detailData.name}</div>
                      <div className="vendor-detail-meta">{detailData.counties.join('、')}</div>
                    </div>
                  </div>
                  <div className="vendor-card-rating">
                    <span>★</span>
                    {detailData.rating > 0 ? detailData.rating.toFixed(1) : '—'}
                  </div>
                </div>
                <div className="vendor-card-tags">
                  {detailData.tags.map(t => <span key={t}>{t}</span>)}
                </div>
                <div className="vendor-detail-contact">
                  <div>
                    <span className="caption">電話</span>
                    <strong>{detailData.phone || '尚未提供'}</strong>
                  </div>
                  <div>
                    <span className="caption">Email</span>
                    <strong>{detailData.email || '尚未提供'}</strong>
                  </div>
                  <div>
                    <span className="caption">評價</span>
                    <strong>{detailData.reviewCount > 0 ? `${detailData.reviewCount} 則` : '暫無'}</strong>
                  </div>
                </div>
                <div>
                  <div className="vendor-detail-section-title">作品集</div>
                  {detailData.portfolios.length === 0 && <div className="vendor-state">此廠商尚未上傳作品集。</div>}
                  {detailData.portfolios.length > 0 && (
                    <div className="vendor-portfolio-list">
                      {detailData.portfolios.map(p => (
                        <div className="vendor-portfolio-item" key={p.id}>
                          <div>
                            <div className="vendor-portfolio-title">{p.title}</div>
                            <div className="vendor-card-meta">{p.meta}</div>
                          </div>
                          <div className="vendor-portfolio-capacity">{p.capacityKw} kWp</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="vendor-detail-footer">
                  <button className="btn btn-secondary" onClick={() => setDetailVendor(null)}>返回</button>
                  {user?.role !== 'vendor' && (
                    <button className="btn btn-primary" onClick={() => { setDetailVendor(null); openContact(detailData); }}>聯絡廠商</button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 聯絡 Modal */}
      {contactVendor && (
        <div className="modal-backdrop" onClick={() => setContactVendor(null)}>
          <div className="modal inquiry-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">聯絡廠商</div>
              <button className="modal-close" onClick={() => setContactVendor(null)}>×</button>
            </div>
            {contactDone ? (
              <div className="inquiry-modal-body" style={{ textAlign: 'center', padding: '32px 20px' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>✓</div>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>詢價已送出！</div>
                <div style={{ fontSize: 13, color: 'var(--ink-400)', marginBottom: 20 }}>廠商將盡快與你聯繫</div>
                <button className="btn btn-primary" onClick={() => setContactVendor(null)}>關閉</button>
              </div>
            ) : !user ? (
              <div className="inquiry-modal-body" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: 'var(--ink-500)', marginBottom: 16 }}>需要登入才能聯絡廠商</div>
                <a href="/" className="btn btn-primary" style={{ textDecoration: 'none' }}>回首頁登入</a>
              </div>
            ) : (
              <form className="inquiry-modal-body" onSubmit={e => { e.preventDefault(); sendContact(); }}>
                <div className="inquiry-vendor-row">
                  <div className="inquiry-vendor-name">{contactVendor.name}</div>
                  <div className="inquiry-vendor-meta">{contactVendor.phone} · {contactVendor.email}</div>
                </div>
                <div className="form-field">
                  <label className="form-label">補充說明</label>
                  <textarea
                    className="form-input inquiry-message"
                    value={contactMsg}
                    onChange={e => setContactMsg(e.target.value)}
                    rows={5}
                  />
                </div>
                {contactError && <div className="form-error">{contactError}</div>}
                <div className="inquiry-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setContactVendor(null)}>取消</button>
                  <button type="submit" className="btn btn-primary" disabled={contactSending || !contactMsg.trim()}>
                    {contactSending ? '送出中⋯' : '送出詢價'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
