'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import type { UserInquiry } from '@/lib/types';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

interface Assessment {
  id: string;
  address: string | null;
  county: string | null;
  annual_kwh: number | null;
  payback_years: number | null;
  out_of_pocket: number | null;
  capacity_kw: number | null;
  created_at: string;
}

const COMPARE_ROWS: { key: keyof Assessment; label: string; fmt: (v: unknown) => string }[] = [
  { key: 'address',      label: '地址',     fmt: v => (v as string) ?? '—' },
  { key: 'county',       label: '縣市',     fmt: v => (v as string) ?? '—' },
  { key: 'capacity_kw',  label: '裝機容量', fmt: v => v != null ? `${v} kWp` : '—' },
  { key: 'annual_kwh',   label: '年發電量', fmt: v => v != null ? `${(v as number).toLocaleString()} kWh` : '—' },
  { key: 'payback_years',label: '回本年限', fmt: v => v != null ? `${v} 年` : '—' },
  { key: 'out_of_pocket',label: '實際自付', fmt: v => v != null ? `NT$ ${(v as number).toLocaleString()}` : '—' },
];

type DrawerTab = 'assessments' | 'inquiries';

export default function HistoryDrawer({ onClose }: { onClose: () => void }) {
  const { user, logout } = useAuth();
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('assessments');
  const [list, setList] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [inquiries, setInquiries] = useState<UserInquiry[]>([]);
  const [inquiriesLoading, setInquiriesLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    fetch(`${API}/api/me/assessments`, {
      headers: { Authorization: `Bearer ${user.token}` },
    })
      .then(r => {
        if (r.status === 401) { logout(); return []; }
        return r.json();
      })
      .then((data: unknown) => setList(Array.isArray(data) ? data as Assessment[] : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [logout, user]);

  useEffect(() => {
    if (!user || drawerTab !== 'inquiries' || inquiries.length > 0) return;
    setInquiriesLoading(true);
    fetch(`${API}/api/me/inquiries`, {
      headers: { Authorization: `Bearer ${user.token}` },
    })
      .then(r => r.ok ? r.json() : [])
      .then((data: unknown) => setInquiries(Array.isArray(data) ? data as UserInquiry[] : []))
      .catch(() => {})
      .finally(() => setInquiriesLoading(false));
  }, [drawerTab, inquiries.length, user]);

  const toggleSelect = (id: string) =>
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 2 ? [...prev, id] : prev,
    );

  const compareItems = list.filter(a => selected.includes(a.id));

  return (
    <div className="drawer">
      {/* Header */}
      <div className="drawer-header">
        <div>
          <div className="drawer-title">我的記錄</div>
          <div className="drawer-subtitle">{user?.email}</div>
        </div>
        <button className="modal-close" onClick={onClose}>×</button>
      </div>

      {/* Tab bar */}
      <div className="drawer-tabs">
        <button
          className={`drawer-tab${drawerTab === 'assessments' ? ' drawer-tab--active' : ''}`}
          onClick={() => setDrawerTab('assessments')}
        >
          評估紀錄
        </button>
        <button
          className={`drawer-tab${drawerTab === 'inquiries' ? ' drawer-tab--active' : ''}`}
          onClick={() => setDrawerTab('inquiries')}
        >
          我的詢價
          {inquiries.filter(i => i.vendorReply && !i.reviewId).length > 0 && (
            <span className="drawer-tab-badge">
              {inquiries.filter(i => i.vendorReply && !i.reviewId).length}
            </span>
          )}
        </button>
      </div>

      {/* ── Assessments tab ── */}
      {drawerTab === 'assessments' && (
        <>
          {selected.length > 0 && (
            <div className="drawer-compare-bar">
              <span className="body-sm" style={{ color: 'var(--green-700)', fontWeight: 500 }}>
                已選 {selected.length} / 2 筆
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                {selected.length === 2 && (
                  <button className="btn btn-primary" style={{ padding: '5px 14px', fontSize: 12, borderRadius: 6 }} onClick={() => setComparing(true)}>
                    並排比較
                  </button>
                )}
                <button className="btn-ghost" style={{ padding: '5px 12px', fontSize: 12 }} onClick={() => setSelected([])}>
                  清除
                </button>
              </div>
            </div>
          )}

          <div className="drawer-body">
            {loading && <div className="drawer-empty">載入中⋯</div>}

            {!loading && list.length === 0 && (
              <div className="drawer-empty">
                尚無評估紀錄<br />
                <span className="caption">完成評估後會自動儲存</span>
              </div>
            )}

            {!loading && !comparing && list.map(a => {
              const isSelected = selected.includes(a.id);
              const date = new Date(a.created_at).toLocaleDateString('zh-TW', { year: 'numeric', month: 'short', day: 'numeric' });
              return (
                <div
                  key={a.id}
                  className={`assessment-card${isSelected ? ' assessment-card--selected' : ''}`}
                  onClick={() => toggleSelect(a.id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div className="assessment-card-title" style={{ flex: 1, paddingRight: 8 }}>
                      {a.address ?? '未知地址'}
                    </div>
                    <span className="caption" style={{ flexShrink: 0 }}>{date}</span>
                  </div>
                  <div className="assessment-card-meta">
                    {a.capacity_kw  != null && <span>{a.capacity_kw} kWp</span>}
                    {a.payback_years != null && <span>回本 {a.payback_years} 年</span>}
                    {a.out_of_pocket != null && <span>自付 NT$ {Math.round(a.out_of_pocket / 10000)} 萬</span>}
                  </div>
                </div>
              );
            })}

            {comparing && compareItems.length === 2 && (
              <div>
                <button
                  className="btn-ghost"
                  style={{ padding: '0 0 16px', fontSize: 13, color: 'var(--green-700)' }}
                  onClick={() => setComparing(false)}
                >
                  ← 返回列表
                </button>
                <table className="compare-table">
                  <thead>
                    <tr>
                      <th />
                      {compareItems.map(a => (
                        <th key={a.id}>
                          {new Date(a.created_at).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' })}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARE_ROWS.map(({ key, label, fmt }) => (
                      <tr key={key}>
                        <td>{label}</td>
                        {compareItems.map(a => <td key={a.id}>{fmt(a[key])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Inquiries tab ── */}
      {drawerTab === 'inquiries' && (
        <div className="drawer-body">
          {inquiriesLoading && <div className="drawer-empty">載入中⋯</div>}
          {!inquiriesLoading && inquiries.length === 0 && (
            <div className="drawer-empty">
              尚未送出任何詢價<br />
              <span className="caption">在評估結果頁點擊「聯絡廠商」即可詢價</span>
            </div>
          )}
          {!inquiriesLoading && inquiries.map(inq => (
            <UserInquiryCard
              key={inq.id}
              inquiry={inq}
              token={user?.token ?? ''}
              onReviewed={(id, rating) =>
                setInquiries(prev => prev.map(i => i.id === id ? { ...i, reviewId: 'done', reviewRating: rating } : i))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}


// ── User Inquiry Card ─────────────────────────────────────────────────────────

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="star-rating">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          className={`star-btn${n <= (hovered || value) ? ' star-btn--active' : ''}`}
          onMouseEnter={() => setHovered(n)}
          onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(n)}
          aria-label={`${n} 星`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function UserInquiryCard({
  inquiry, token, onReviewed,
}: {
  inquiry: UserInquiry;
  token: string;
  onReviewed: (id: string, rating: number) => void;
}) {
  const [reviewOpen,  setReviewOpen]  = useState(false);
  const [rating,      setRating]      = useState(0);
  const [comment,     setComment]     = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [err,         setErr]         = useState('');

  const submitReview = async () => {
    if (rating === 0) { setErr('請選擇評分'); return; }
    setSubmitting(true); setErr('');
    try {
      const res = await fetch(`${API}/api/me/inquiries/${inquiry.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ vendor_id: inquiry.vendorId, rating, comment: comment.trim() || null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? '送出失敗');
      onReviewed(inquiry.id, rating);
      setReviewOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '送出失敗');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="user-inquiry-card">
      {/* Vendor header */}
      <div className="user-inquiry-vendor-row">
        {inquiry.vendorLogo ? (
          <img src={inquiry.vendorLogo} className="user-inquiry-vendor-logo" alt="" />
        ) : (
          <div className="user-inquiry-vendor-avatar">{inquiry.vendorName[0]}</div>
        )}
        <div>
          <div className="user-inquiry-vendor-name">{inquiry.vendorName}</div>
          <div className="user-inquiry-date">
            {new Date(inquiry.createdAt).toLocaleDateString('zh-TW')}
          </div>
        </div>
        <span className={`vd-status-badge ${inquiry.vendorReply ? 'vd-status-badge--approved' : 'vd-status-badge--pending'}`}
          style={{ marginLeft: 'auto' }}>
          {inquiry.vendorReply ? '已回覆' : '等待回覆'}
        </span>
      </div>

      {/* Chips */}
      <div className="dash-inquiry-chips">
        {inquiry.address && <span>{inquiry.address}</span>}
        {inquiry.county && !inquiry.address && <span>{inquiry.county}</span>}
        {inquiry.capacityKw > 0 && <span>{inquiry.capacityKw} kWp</span>}
        {inquiry.annualKwh > 0 && <span>{Math.round(inquiry.annualKwh).toLocaleString()} kWh/年</span>}
      </div>

      {/* My message */}
      {inquiry.message && (
        <div className="user-inquiry-msg">
          <div className="user-inquiry-msg-label">我的留言</div>
          <div className="user-inquiry-msg-text">{inquiry.message}</div>
        </div>
      )}

      {/* Vendor reply */}
      {inquiry.vendorReply && (
        <div className="user-inquiry-reply">
          <div className="user-inquiry-reply-label">廠商回覆</div>
          <div className="user-inquiry-reply-text">{inquiry.vendorReply}</div>
          {inquiry.repliedAt && (
            <div className="user-inquiry-reply-date">
              {new Date(inquiry.repliedAt).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' })}
            </div>
          )}

          {/* Review section */}
          {inquiry.reviewId ? (
            <div className="user-inquiry-reviewed">
              {'★'.repeat(inquiry.reviewRating ?? 0)}{'☆'.repeat(5 - (inquiry.reviewRating ?? 0))}
              <span>已評價</span>
            </div>
          ) : (
            reviewOpen ? (
              <div className="user-inquiry-review-form">
                <div className="user-inquiry-review-label">為廠商評分</div>
                <StarRating value={rating} onChange={setRating} />
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="選填：文字評價"
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                />
                {err && <div className="form-error" style={{ fontSize: 13 }}>{err}</div>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary btn-sm" disabled={submitting} onClick={submitReview}>
                    {submitting ? '送出中⋯' : '送出評價'}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setReviewOpen(false)}>取消</button>
                </div>
              </div>
            ) : (
              <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => setReviewOpen(true)}>
                為廠商評分
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
