'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { SUBSIDIES } from '@/lib/constants';
import type { MyVendor, Inquiry, InquiryMessage, VendorPortfolio, CaseStatus, PotentialLead } from '@/lib/types';
import DashLayout, { IconBuilding, IconFolder, IconInbox, IconUsers } from '@/components/DashLayout';
import type { NavItem } from '@/components/DashLayout';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
const COUNTIES = Object.keys(SUBSIDIES);

// FastAPI field_validator errors return detail as an array; HTTPException returns a string.
// ctx.error can be {} (object) in Pydantic v2 — must check typeof before using.
function parseDetail(detail: unknown, fallback: string): string {
  if (Array.isArray(detail)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const first = detail[0] as any;
    if (!first) return fallback;
    if (typeof first?.ctx?.error === 'string') return first.ctx.error;
    if (typeof first?.msg === 'string') return first.msg.replace(/^Value error,\s*/i, '');
    return fallback;
  }
  if (typeof detail === 'string') return detail;
  return fallback;
}

type Tab = 'profile' | 'portfolios' | 'inquiries' | 'leads';

const STATUS_LABEL: Record<string, string> = {
  pending:  '審核中',
  approved: '已核准',
  rejected: '未通過',
};

const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  new:       '新詢價',
  contacted: '已聯繫',
  quoted:    '已報價',
  closed:    '已成交',
};
const CASE_STATUS_CLASS: Record<CaseStatus, string> = {
  new:       'cs-new',
  contacted: 'cs-contacted',
  quoted:    'cs-quoted',
  closed:    'cs-closed',
};

export default function VendorPage() {
  const { user } = useAuth();
  const router   = useRouter();
  const [mounted, setMounted]     = useState(false);
  const [tab, setTab]             = useState<Tab>('profile');
  const [vendor, setVendor]       = useState<MyVendor | null>(null);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [leads, setLeads]         = useState<PotentialLead[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!user) { router.replace('/'); return; }
    if (user.role !== 'vendor') { router.replace('/'); return; }
  }, [mounted, user, router]);

  const authHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${user?.token ?? ''}`,
  }), [user?.token]);

  const fetchVendor = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/me/vendor`, { headers: authHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? '載入失敗');
      setVendor(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : '載入失敗');
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  const fetchInquiries = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/me/vendor/inquiries`, { headers: authHeaders() });
      if (res.ok) setInquiries(await res.json());
    } catch { /* ignore */ }
  }, [authHeaders]);

  const fetchLeads = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/me/vendor/leads`, { headers: authHeaders() });
      if (res.ok) setLeads(await res.json());
    } catch { /* ignore */ }
  }, [authHeaders]);

  useEffect(() => {
    if (user?.role !== 'vendor') return;
    // Kick off all three in parallel so tab switches are instant
    fetchVendor();
    fetchInquiries();
    fetchLeads();
  }, [user, fetchVendor, fetchInquiries, fetchLeads]);
  // Only re-fetch on tab switch if data was cleared (e.g. after a mutation)
  useEffect(() => { if (tab === 'inquiries' && inquiries.length === 0) fetchInquiries(); }, [tab, fetchInquiries, inquiries.length]);
  useEffect(() => { if (tab === 'leads'     && leads.length    === 0) fetchLeads();    }, [tab, fetchLeads,    leads.length]);

  if (!mounted || !user) return null;

  const unread = inquiries.filter(i => i.caseStatus === 'new').length;

  const navItems: NavItem[] = [
    { key: 'profile',    label: '廠商資料', icon: <IconBuilding /> },
    { key: 'portfolios', label: '作品集',   icon: <IconFolder /> },
    { key: 'inquiries',  label: '收件箱',   icon: <IconInbox />, badge: unread || undefined },
    { key: 'leads',      label: '潛在客戶', icon: <IconUsers />, badge: leads.length || undefined },
  ];

  return (
    <DashLayout
      sectionTitle="廠商後台"
      navItems={navItems}
      activeTab={tab}
      onTabChange={k => setTab(k as Tab)}
      userEmail={user.email}
    >
      {loading ? (
        <div className="dash-loading">載入中⋯</div>
      ) : error ? (
        <div className="vd-error">{error}</div>
      ) : !vendor ? null : (
        <>
          {tab === 'profile'    && <ProfileTab    vendor={vendor} onSaved={fetchVendor} authHeaders={authHeaders()} onGoToPortfolios={() => setTab('portfolios')} />}
          {tab === 'portfolios' && <PortfoliosTab vendor={vendor} onChanged={fetchVendor} authHeaders={authHeaders()} />}
          {tab === 'inquiries'  && (
            <InquiriesTab
              inquiries={inquiries}
              authHeaders={authHeaders()}
              onStatusChange={(id, s) =>
                setInquiries(prev => prev.map(i => i.id === id ? { ...i, caseStatus: s } : i))
              }
              onMessageSent={(id, msg) =>
                setInquiries(prev => prev.map(i =>
                  i.id === id ? { ...i, messages: [...(i.messages ?? []), msg] } : i
                ))
              }
              onMarkRead={(id) => {
                setInquiries(prev => prev.map(i =>
                  i.id === id ? { ...i, vendorLastReadAt: new Date().toISOString() } : i
                ));
                fetch(`${API}/api/me/vendor/inquiries/${id}/read`, { method: 'POST', headers: authHeaders() });
              }}
            />
          )}
          {tab === 'leads' && (
            <LeadsTab
              leads={leads}
              subscriptionStatus={vendor.subscriptionStatus ?? 'free'}
              upgradeRequestStatus={vendor.upgradeRequestStatus ?? null}
              upgradeRejectionReason={vendor.upgradeRejectionReason ?? null}
              authHeaders={authHeaders()}
            />
          )}
        </>
      )}
    </DashLayout>
  );
}


// ── Shared: empty-field display (module-level to keep component type stable) ─
function EmptyField({ text = '尚未填寫' }: { text?: string }) {
  return <span style={{ color: 'var(--ink-300)', fontStyle: 'italic', fontSize: 13 }}>{text}</span>;
}

// ── Profile Tab ──────────────────────────────────────────────────────────────

function ProfileTab({
  vendor, onSaved, authHeaders, onGoToPortfolios,
}: {
  vendor: MyVendor;
  onSaved: () => void;
  authHeaders: Record<string, string>;
  onGoToPortfolios: () => void;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return <ProfileView vendor={vendor} onEdit={() => setEditing(true)} onGoToPortfolios={onGoToPortfolios} />;
  }
  return (
    <ProfileEditForm
      vendor={vendor}
      authHeaders={authHeaders}
      onSaved={() => { onSaved(); setEditing(false); }}
      onCancel={() => setEditing(false)}
    />
  );
}

// ── Profile: read-only card ──
function ProfileView({
  vendor, onEdit, onGoToPortfolios,
}: {
  vendor: MyVendor;
  onEdit: () => void;
  onGoToPortfolios: () => void;
}) {
  const statusColors: Record<string, string> = {
    pending:  'vd-status-badge--pending',
    approved: 'vd-status-badge--approved',
    rejected: 'vd-status-badge--rejected',
  };

  // A1 — 計算未填欄位
  const missingFields = [
    !vendor.phone                  && '電話',
    !vendor.email                  && 'Email',
    vendor.counties.length === 0   && '服務縣市',
    vendor.tags.length    === 0    && '服務標籤',
    !vendor.logoUrl                && 'Logo',
  ].filter(Boolean) as string[];

  return (
    <div>
      <div className="dash-content-header">
        <div className="dash-content-title">廠商資料</div>
        <div className="dash-content-sub">公開顯示於推薦列表的公司資訊</div>
      </div>

      {/* A1 — 完整度橫幅 */}
      {missingFields.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          background: 'var(--warning-bg, #fef9c3)',
          border: '1px solid #fde68a',
          borderRadius: 'var(--radius-sm)',
          padding: '10px 16px',
          marginBottom: 14,
          fontSize: 13,
        }}>
          <span style={{ color: '#92400e' }}>
            ⚠ 資料未完整：<strong>{missingFields.join('、')}</strong> 尚未填寫，完整資料可提升推薦列表曝光度
          </span>
          <button className="btn btn-secondary btn-sm" style={{ flexShrink: 0 }} onClick={onEdit}>
            立即補充
          </button>
        </div>
      )}

      <div className="dash-profile-card">
        {/* Header */}
        <div className="dash-profile-header">
          {vendor.logoUrl ? (
            <img src={vendor.logoUrl} className="dash-profile-logo-img" alt="logo" />
          ) : (
            <div className="dash-profile-avatar">{vendor.name[0]}</div>
          )}
          <div className="dash-profile-header-info">
            <div className="dash-profile-name">{vendor.name}</div>
            <div className="dash-profile-badges">
              <span className={`vd-status-badge ${statusColors[vendor.applicationStatus] ?? ''}`}>
                {STATUS_LABEL[vendor.applicationStatus] ?? vendor.applicationStatus}
              </span>
              {vendor.subscriptionStatus === 'advanced' && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
                  padding: '2px 8px', borderRadius: 99,
                  background: 'var(--green-100)', color: 'var(--green-800)',
                  border: '1px solid var(--green-300)',
                }}>
                  ★ 進階方案
                </span>
              )}
              {vendor.reviewCount > 0 && (
                <span className="dash-profile-rating">
                  ★ {vendor.rating.toFixed(1)}
                  <span className="dash-profile-rating-count">（{vendor.reviewCount} 則評價）</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="dash-profile-divider" />

        {/* A2 — Stats 統計列 */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--ink-100)' }}>
          <div style={{ flex: 1, textAlign: 'center', padding: '14px 8px' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-900)', lineHeight: 1 }}>
              {vendor.portfolios.length}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 4 }}>件作品集</div>
          </div>
          <div style={{ width: 1, background: 'var(--ink-100)', margin: '10px 0' }} />
          <div style={{ flex: 1, textAlign: 'center', padding: '14px 8px' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-900)', lineHeight: 1 }}>
              {vendor.reviewCount}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 4 }}>則評價</div>
          </div>
          <div style={{ width: 1, background: 'var(--ink-100)', margin: '10px 0' }} />
          <div style={{ flex: 1, textAlign: 'center', padding: '14px 8px' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: vendor.reviewCount > 0 ? 'var(--ink-900)' : 'var(--ink-300)', lineHeight: 1 }}>
              {vendor.reviewCount > 0 ? vendor.rating.toFixed(1) : '—'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 4 }}>平均評分</div>
          </div>
        </div>

        {/* Info rows */}
        <div className="dash-profile-info-list">
          <div className="dash-profile-info-row">
            <span className="dash-profile-info-label">聯絡電話</span>
            <span className="dash-profile-info-value">
              {vendor.phone || <EmptyField />}
            </span>
          </div>
          <div className="dash-profile-info-row">
            <span className="dash-profile-info-label">聯絡 Email</span>
            <span className="dash-profile-info-value">
              {vendor.email || <EmptyField />}
            </span>
          </div>
          <div className="dash-profile-info-row">
            <span className="dash-profile-info-label">服務縣市</span>
            <span className="dash-profile-info-value">
              {vendor.counties.length === 0 ? (
                /* A3 — 縣市空時加橘色警示 */
                <span style={{
                  fontSize: 12, color: '#b45309',
                  background: '#fef3c7', border: '1px solid #fde68a',
                  borderRadius: 6, padding: '2px 8px',
                }}>
                  未設定 — 設定後才能出現在推薦列表
                </span>
              ) : (
                <span className="dash-profile-counties">
                  {vendor.counties.map(c => (
                    <span key={c} className="dash-profile-county-chip">{c}</span>
                  ))}
                </span>
              )}
            </span>
          </div>
          <div className="dash-profile-info-row">
            <span className="dash-profile-info-label">服務標籤</span>
            <span className="dash-profile-info-value">
              {vendor.tags.length === 0 ? <EmptyField /> : (
                <span className="dash-profile-tag-list">
                  {vendor.tags.map(t => (
                    <span key={t} className="dash-profile-tag">{t}</span>
                  ))}
                </span>
              )}
            </span>
          </div>
        </div>

        {/* Footer actions */}
        <div className="dash-profile-footer">
          {/* A4 — 作品集為空時的快速入口 */}
          {vendor.portfolios.length === 0 && (
            <button className="btn btn-ghost btn-sm" onClick={onGoToPortfolios}>
              ＋ 前往新增作品集
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={onEdit}>
            編輯資料
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Profile: edit form ──
function ProfileEditForm({
  vendor, authHeaders, onSaved, onCancel,
}: {
  vendor: MyVendor;
  authHeaders: Record<string, string>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name,        setName]        = useState(vendor.name);
  const [phone,       setPhone]       = useState(vendor.phone);
  const [email,       setEmail]       = useState(vendor.email);
  const [counties,    setCounties]    = useState<string[]>(vendor.counties);
  const [tags,        setTags]        = useState(vendor.tags.join('、'));
  const [logoPreview, setLogoPreview] = useState<string | null>(vendor.logoUrl);
  const [logoFile,    setLogoFile]    = useState<File | null>(null);
  const [removeLogo,  setRemoveLogo]  = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [msg,         setMsg]         = useState('');

  const toggleCounty = (c: string) =>
    setCounties(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setMsg('檔案超過 5 MB 上限');
      e.target.value = '';
      return;
    }
    setMsg('');
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
    setRemoveLogo(false);
  };

  const save = async () => {
    setSaving(true); setMsg('');
    try {
      // Upload logo to R2 if a new file was selected
      if (logoFile) {
        const form = new FormData();
        form.append('file', logoFile);
        const res = await fetch(`${API}/api/me/vendor/logo`, {
          method: 'POST',
          headers: { Authorization: authHeaders.Authorization },
          body: form,
        });
        if (!res.ok) throw new Error('Logo 上傳失敗');
      }
      const res = await fetch(`${API}/api/me/vendor`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({
          name, phone, email, counties,
          remove_logo: removeLogo,
          tags: tags.split(/[、,，\s]+/).map(t => t.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error(parseDetail((await res.json().catch(() => ({}))).detail, '儲存失敗'));
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '儲存失敗');
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="dash-content-header">
        <div className="dash-content-title">編輯廠商資料</div>
        <div className="dash-content-sub">變更後點擊「儲存變更」，資料立即更新</div>
      </div>

      <div className="dash-edit-form">
        {/* Logo */}
        <div className="form-field">
          <label className="form-label">公司 Logo <span className="form-label-opt">選填</span></label>
          <div className="vendor-apply-logo-row">
            <label className="vendor-apply-logo-upload">
              {logoPreview ? (
                <img src={logoPreview} className="vendor-apply-logo-preview" alt="logo 預覽" />
              ) : (
                <div className="vendor-apply-logo-placeholder">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                  <span>上傳圖片</span>
                  <span className="vendor-apply-logo-hint">JPG / PNG</span>
                </div>
              )}
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleLogoChange} style={{ display: 'none' }} />
            </label>
            {logoPreview && (
              <button type="button" className="btn-ghost" style={{ fontSize: 13, padding: '4px 10px' }} onClick={() => {
                if (logoPreview.startsWith('blob:')) URL.revokeObjectURL(logoPreview);
                setLogoPreview(null);
                setLogoFile(null);
                setRemoveLogo(true);
              }}>
                移除
              </button>
            )}
          </div>
        </div>

        <div className="form-field">
          <label className="form-label">公司名稱</label>
          <input className="form-input" value={name} onChange={e => setName(e.target.value)} />
        </div>

        <div className="dash-edit-form-row">
          <div className="form-field">
            <label className="form-label">聯絡電話</label>
            <input className="form-input" value={phone} onChange={e => setPhone(e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">聯絡 Email</label>
            <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
        </div>

        <div className="form-field">
          <label className="form-label">服務縣市</label>
          <div className="county-chip-grid">
            {COUNTIES.map(c => (
              <label key={c} className={`county-chip${counties.includes(c) ? ' county-chip--selected' : ''}`}>
                <input type="checkbox" checked={counties.includes(c)} onChange={() => toggleCounty(c)} />
                {c}
              </label>
            ))}
          </div>
        </div>

        <div className="form-field">
          <label className="form-label">服務標籤
            <span className="form-label-opt">以逗號或頓號分隔</span>
          </label>
          <input className="form-input" value={tags} onChange={e => setTags(e.target.value)} placeholder="集合住宅、補助代辦、台電併聯" />
        </div>

        {msg && <div className="form-error">{msg}</div>}

        <div className="dash-edit-form-actions">
          <button className="btn btn-secondary btn-sm" onClick={onCancel} disabled={saving}>取消</button>
          <button className="btn btn-primary btn-sm" disabled={saving} onClick={save}>
            {saving ? '儲存中⋯' : '儲存變更'}
          </button>
        </div>
      </div>
    </div>
  );
}


// ── Portfolios Tab ───────────────────────────────────────────────────────────

const IconBriefcase = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="7" width="20" height="14" rx="2"/>
    <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>
    <line x1="12" y1="12" x2="12" y2="12"/>
    <path d="M2 12h20"/>
  </svg>
);

function PortfoliosTab({
  vendor, onChanged, authHeaders,
}: {
  vendor: MyVendor;
  onChanged: () => void;
  authHeaders: Record<string, string>;
}) {
  const [showAddForm, setShowAddForm] = useState(false);

  return (
    <div>
      <div className="dash-content-header">
        <div className="dash-content-title">作品集</div>
        <div className="dash-content-sub">展示已完成的安裝案場，提升民眾信任感</div>
      </div>

      {vendor.portfolios.length === 0 && !showAddForm ? (
        /* Empty state — 104 style */
        <div className="dash-portfolio-empty">
          <div className="dash-portfolio-empty-icon">
            <IconBriefcase />
          </div>
          <div className="dash-portfolio-empty-title">尚未新增作品</div>
          <div className="dash-portfolio-empty-desc">
            新增完成的安裝案場，展示真實業績，讓潛在客戶更信任你
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAddForm(true)}>
            ＋ 新增第一件作品
          </button>
        </div>
      ) : (
        <>
          {/* Stats + toolbar */}
          {vendor.portfolios.length > 0 && (
            <div className="dash-portfolio-topbar">
              <div className="dash-stats" style={{ margin: 0, flex: 1 }}>
                <div className="dash-stat">
                  <div className="dash-stat-value">{vendor.portfolios.length}</div>
                  <div className="dash-stat-label">作品數量</div>
                </div>
                <div className="dash-stat">
                  <div className="dash-stat-value">
                    {vendor.portfolios.reduce((s, p) => s + (p.capacityKw || 0), 0).toFixed(1)}
                  </div>
                  <div className="dash-stat-label">總容量 kWp</div>
                </div>
              </div>
              <button
                className={`btn btn-sm ${showAddForm ? 'btn-ghost' : 'btn-secondary'}`}
                onClick={() => setShowAddForm(v => !v)}
              >
                {showAddForm ? '取消' : '＋ 新增作品'}
              </button>
            </div>
          )}

          {/* Card grid */}
          {vendor.portfolios.length > 0 && (
            <div className="dash-portfolio-grid">
              {vendor.portfolios.map((p: VendorPortfolio) => (
                <PortfolioCard key={p.id} portfolio={p} authHeaders={authHeaders} onChanged={onChanged} />
              ))}
            </div>
          )}

          {/* Add form */}
          {showAddForm && (
            <AddPortfolioForm
              authHeaders={authHeaders}
              onAdded={() => { onChanged(); setShowAddForm(false); }}
              onCancel={() => setShowAddForm(false)}
            />
          )}
        </>
      )}
    </div>
  );
}

function PortfolioCard({
  portfolio, authHeaders, onChanged,
}: {
  portfolio: VendorPortfolio;
  authHeaders: Record<string, string>;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);

  const remove = async () => {
    try {
      await fetch(`${API}/api/me/vendor/portfolios/${portfolio.id}`, { method: 'DELETE', headers: authHeaders });
      onChanged();
    } catch { /* ignore */ }
  };

  return (
    <>
      <div className="dash-portfolio-card">
        {portfolio.photoUrl ? (
          <img src={portfolio.photoUrl} className="dash-portfolio-photo" alt={portfolio.title} />
        ) : (
          <div className="dash-portfolio-thumb" />
        )}
        <div className="dash-portfolio-body">
          <div className="dash-portfolio-title">{portfolio.title}</div>
          <div className="dash-portfolio-meta">{portfolio.meta}</div>
          {portfolio.description && (
            <div className="dash-portfolio-desc">{portfolio.description}</div>
          )}
          <div className="dash-portfolio-footer">
            <span className="dash-portfolio-kw">
              {portfolio.capacityKw > 0 ? `${portfolio.capacityKw} kWp` : '—'}
              {portfolio.completedYear ? ` · ${portfolio.completedYear}` : ''}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="dash-portfolio-del" onClick={() => setEditing(true)}>編輯</button>
              <button className="dash-portfolio-del" onClick={remove}>刪除</button>
            </div>
          </div>
        </div>
      </div>
      {editing && (
        <EditPortfolioModal
          portfolio={portfolio}
          authHeaders={authHeaders}
          onSaved={() => { onChanged(); setEditing(false); }}
          onCancel={() => setEditing(false)}
        />
      )}
    </>
  );
}

function EditPortfolioModal({
  portfolio, authHeaders, onSaved, onCancel,
}: {
  portfolio: VendorPortfolio;
  authHeaders: Record<string, string>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [title,   setTitle]   = useState(portfolio.title);
  const [meta,    setMeta]    = useState(portfolio.meta);
  const [capKw,   setCapKw]   = useState(portfolio.capacityKw > 0 ? String(portfolio.capacityKw) : '');
  const [year,    setYear]    = useState(portfolio.completedYear ? String(portfolio.completedYear) : '');
  const [desc,    setDesc]    = useState(portfolio.description ?? '');
  const [photo,      setPhoto]      = useState<string | null>(portfolio.photoUrl);
  const [photoFile,  setPhotoFile]  = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState('');

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setErr('檔案超過 5 MB 上限'); e.target.value = ''; return; }
    setErr('');
    setPhotoFile(file);
    setPhoto(URL.createObjectURL(file));
    setRemovePhoto(false);
  };

  const save = async () => {
    if (saving) return;
    if (!title.trim() || !meta.trim()) { setErr('請填寫標題與說明'); return; }
    setSaving(true); setErr('');
    try {
      let photoUrl: string | null | undefined = undefined;
      if (photoFile) {
        const form = new FormData();
        form.append('file', photoFile);
        const uploadRes = await fetch(`${API}/api/me/vendor/upload-image`, {
          method: 'POST',
          headers: { Authorization: authHeaders.Authorization },
          body: form,
        });
        if (!uploadRes.ok) throw new Error('照片上傳失敗，請重試');
        photoUrl = (await uploadRes.json()).url;
      } else if (removePhoto) {
        photoUrl = null;
      }
      const body: Record<string, unknown> = {
        title: title.trim(), meta: meta.trim(),
        capacityKw: capKw ? parseFloat(capKw) : null,
        completedYear: year ? parseInt(year, 10) : null,
        description: desc.trim() || null,
      };
      if (photoUrl !== undefined) body.photoUrl = photoUrl;
      const res = await fetch(`${API}/api/me/vendor/portfolios/${portfolio.id}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(parseDetail((await res.json().catch(() => ({}))).detail, '儲存失敗'));
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '儲存失敗');
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 720, width: '92vw', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">編輯作品</div>
          <button className="modal-close" onClick={onCancel}>×</button>
        </div>
        <div className="dash-edit-form" style={{ padding: '0 24px 24px' }}>
          <div className="form-field">
            <label className="form-label">施工照片 <span className="form-label-opt">選填</span></label>
            <div className="portfolio-photo-upload-row">
              <label className="portfolio-photo-upload">
                {photo ? (
                  <img src={photo} className="portfolio-photo-preview" alt="施工照" />
                ) : (
                  <div className="vendor-apply-logo-placeholder">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                      <polyline points="21 15 16 10 5 21"/>
                    </svg>
                    <span>上傳施工照</span>
                    <span className="vendor-apply-logo-hint">JPG / PNG</span>
                  </div>
                )}
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoChange} style={{ display: 'none' }} />
              </label>
              {photo && (
                <button type="button" className="btn-ghost" style={{ fontSize: 13 }} onClick={() => {
                  if (photo.startsWith('blob:')) URL.revokeObjectURL(photo);
                  setPhoto(null); setPhotoFile(null); setRemovePhoto(true);
                }}>移除</button>
              )}
            </div>
          </div>
          <div className="form-field">
            <label className="form-label">案場標題</label>
            <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">案場說明</label>
            <input className="form-input" value={meta} onChange={e => setMeta(e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">客戶描述 <span className="form-label-opt">選填</span></label>
            <textarea className="form-input" rows={3} value={desc} onChange={e => setDesc(e.target.value)} />
          </div>
          <div className="dash-edit-form-row">
            <div className="form-field">
              <label className="form-label">裝置容量 (kWp) <span className="form-label-opt">選填</span></label>
              <input className="form-input" type="number" min="0" step="0.1" value={capKw} onChange={e => setCapKw(e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">完工年份 <span className="form-label-opt">選填</span></label>
              <input className="form-input" type="number" min="2000" max="2035" value={year} onChange={e => setYear(e.target.value)} />
            </div>
          </div>
          {err && <div className="form-error">{err}</div>}
          <div className="dash-edit-form-actions">
            <button className="btn btn-secondary btn-sm" onClick={onCancel} disabled={saving}>取消</button>
            <button className="btn btn-primary btn-sm" disabled={saving} onClick={save}>
              {saving ? '儲存中⋯' : '儲存變更'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AddPortfolioForm({
  authHeaders, onAdded, onCancel,
}: {
  authHeaders: Record<string, string>;
  onAdded: () => void;
  onCancel: () => void;
}) {
  const [title,   setTitle]   = useState('');
  const [meta,    setMeta]    = useState('');
  const [capKw,   setCapKw]   = useState('');
  const [year,    setYear]    = useState('');
  const [desc,    setDesc]    = useState('');
  const [photo,      setPhoto]      = useState<string | null>(null);
  const [photoFile,  setPhotoFile]  = useState<File | null>(null);
  const [adding,     setAdding]     = useState(false);
  const [err,        setErr]        = useState('');

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setErr('檔案超過 5 MB 上限');
      e.target.value = '';
      return;
    }
    setErr('');
    setPhotoFile(file);
    setPhoto(URL.createObjectURL(file));
  };

  const add = async () => {
    if (adding) return;
    if (!title.trim() || !meta.trim()) { setErr('請填寫標題與說明'); return; }
    setAdding(true); setErr('');
    try {
      let photoUrl: string | null = null;
      if (photoFile) {
        const form = new FormData();
        form.append('file', photoFile);
        const uploadRes = await fetch(`${API}/api/me/vendor/upload-image`, {
          method: 'POST',
          headers: { Authorization: authHeaders.Authorization },
          body: form,
        });
        if (!uploadRes.ok) {
          const detail = await uploadRes.json().catch(() => ({}));
          throw new Error(detail?.detail ?? '照片上傳失敗，請重試');
        }
        photoUrl = (await uploadRes.json()).url;
      }
      const res = await fetch(`${API}/api/me/vendor/portfolios`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          title: title.trim(), meta: meta.trim(),
          capacityKw: capKw ? parseFloat(capKw) : null,
          completedYear: year ? parseInt(year, 10) : null,
          photoUrl,
          description: desc.trim() || null,
        }),
      });
      if (!res.ok) throw new Error(parseDetail((await res.json().catch(() => ({}))).detail, '新增失敗'));
      onAdded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '新增失敗');
      setAdding(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 720, width: '92vw', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">新增作品</div>
          <button className="modal-close" onClick={onCancel}>×</button>
        </div>

        <div className="dash-edit-form" style={{ padding: '0 24px 24px' }}>
          {/* Photo upload */}
          <div className="form-field">
            <label className="form-label">施工照片 <span className="form-label-opt">選填</span></label>
            <div className="portfolio-photo-upload-row">
              <label className="portfolio-photo-upload">
                {photo ? (
                  <img src={photo} className="portfolio-photo-preview" alt="施工照" />
                ) : (
                  <div className="vendor-apply-logo-placeholder">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                      <polyline points="21 15 16 10 5 21"/>
                    </svg>
                    <span>上傳施工照</span>
                    <span className="vendor-apply-logo-hint">JPG / PNG</span>
                  </div>
                )}
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoChange} style={{ display: 'none' }} />
              </label>
              {photo && (
                <button type="button" className="btn-ghost" style={{ fontSize: 13 }} onClick={() => {
                  URL.revokeObjectURL(photo);
                  setPhoto(null);
                  setPhotoFile(null);
                }}>移除</button>
              )}
            </div>
          </div>
          <div className="form-field">
            <label className="form-label">案場標題</label>
            <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="信義區集合住宅屋頂型案場" />
          </div>
          <div className="form-field">
            <label className="form-label">案場說明</label>
            <input className="form-input" value={meta} onChange={e => setMeta(e.target.value)} placeholder="住宅大樓 · 22.4 kWp · 2025 完工" />
          </div>
          <div className="form-field">
            <label className="form-label">客戶描述 <span className="form-label-opt">選填</span></label>
            <textarea className="form-input" rows={3} value={desc} onChange={e => setDesc(e.target.value)} placeholder="屋主為三層透天厝，南向屋頂，安裝 8 片高效模組，成功申請台北市補助 12 萬元..." />
          </div>
          <div className="dash-edit-form-row">
            <div className="form-field">
              <label className="form-label">裝置容量 (kWp)<span className="form-label-opt">選填</span></label>
              <input className="form-input" type="number" min="0" step="0.1" value={capKw} onChange={e => setCapKw(e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">完工年份<span className="form-label-opt">選填</span></label>
              <input className="form-input" type="number" min="2000" max="2035" value={year} onChange={e => setYear(e.target.value)} />
            </div>
          </div>
          {err && <div className="form-error">{err}</div>}
          <div className="dash-edit-form-actions">
            <button className="btn btn-secondary btn-sm" onClick={onCancel} disabled={adding}>取消</button>
            <button className="btn btn-primary btn-sm" disabled={adding} onClick={add}>
              {adding ? '新增中⋯' : '新增作品'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ── Inquiries Tab — chat-style ───────────────────────────────────────────────

function InquiriesTab({
  inquiries, authHeaders, onStatusChange, onMessageSent, onMarkRead,
}: {
  inquiries: Inquiry[];
  authHeaders: Record<string, string>;
  onStatusChange: (id: string, s: CaseStatus) => void;
  onMessageSent: (id: string, msg: InquiryMessage) => void;
  onMarkRead: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    inquiries.length > 0 ? inquiries[0].id : null,
  );
  const selected = inquiries.find(i => i.id === selectedId) ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="dash-content-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="dash-content-title">收件箱</div>
          <div className="dash-content-sub">點選左側聯絡人查看對話，在右側直接回覆與更新案件狀態</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['new','contacted','quoted','closed'] as CaseStatus[]).map(s => {
            const count = inquiries.filter(i => i.caseStatus === s).length;
            return (
              <div key={s} className={`cs-${s}`} style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '6px 14px', borderRadius: 999,
                background: 'var(--surface)', border: '1px solid var(--border)',
                fontSize: 13,
              }}>
                <span style={{ fontWeight: 700, fontFamily: 'var(--font-num)', fontSize: 16 }}>{count}</span>
                <span style={{ color: 'var(--text-muted)' }}>{CASE_STATUS_LABEL[s]}</span>
              </div>
            );
          })}
        </div>
      </div>

      {inquiries.length === 0 ? (
        <div className="dash-empty">尚未收到任何詢價</div>
      ) : (
        <div className="inq-shell">
          {/* Left: contact list */}
          <div className="inq-contacts-col">
            {inquiries.map(inq => {
              const lastMsg = inq.messages[inq.messages.length - 1];
              const hasUnread = lastMsg?.sender === 'user' && (
                !inq.vendorLastReadAt || new Date(lastMsg.createdAt) > new Date(inq.vendorLastReadAt)
              );
              const lastDate = lastMsg
                ? new Date(lastMsg.createdAt).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })
                : new Date(inq.createdAt).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
              const preview = lastMsg
                ? (lastMsg.sender === 'vendor' ? '我：' : '') + lastMsg.content.slice(0, 30) + (lastMsg.content.length > 30 ? '…' : '')
                : `${inq.county ?? ''} ${inq.capacityKw > 0 ? `· ${inq.capacityKw} kWp` : ''}`.trim() || '詢價';
              return (
                <div
                  key={inq.id}
                  className={`inq-contact-item${selectedId === inq.id ? ' inq-contact-item--active' : ''}`}
                  onClick={() => {
                    setSelectedId(inq.id);
                    if (hasUnread) onMarkRead(inq.id);
                  }}
                >
                  <div className="inq-contact-row">
                    <div className="inq-contact-avatar">
                      {inq.inquirerEmail ? inq.inquirerEmail[0].toUpperCase() : '?'}
                    </div>
                    <div className="inq-contact-body">
                      <div className="inq-contact-email" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{inq.inquirerEmail ?? '匿名'}</span>
                        {hasUnread && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green-700)', flexShrink: 0 }} />}
                      </div>
                      <div className="inq-contact-preview">{preview}</div>
                    </div>
                  </div>
                  <div className="inq-contact-footer">
                    <span className={`inq-cs-badge ${CASE_STATUS_CLASS[inq.caseStatus]}`}>
                      {CASE_STATUS_LABEL[inq.caseStatus]}
                    </span>
                    <span className="inq-contact-date">{lastDate}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right: chat window */}
          {selected ? (
            <ChatWindow
              key={selected.id}
              inquiry={selected}
              authHeaders={authHeaders}
              onStatusChange={(s) => onStatusChange(selected.id, s)}
              onReplySent={(msg) => {
                onMessageSent(selected.id, msg);
                if (selected.caseStatus === 'new') onStatusChange(selected.id, 'contacted');
              }}
            />
          ) : (
            <div className="inq-chat-empty">選擇左側聯絡人查看對話</div>
          )}
        </div>
      )}
    </div>
  );
}

function ChatWindow({
  inquiry, authHeaders, onStatusChange, onReplySent,
}: {
  inquiry: Inquiry;
  authHeaders: Record<string, string>;
  onStatusChange: (s: CaseStatus) => void;
  onReplySent: (msg: InquiryMessage) => void;
}) {
  const [replyText,    setReplyText]    = useState('');
  const [localMessages, setLocalMessages] = useState<import('@/lib/types').InquiryMessage[]>(inquiry.messages ?? []);
  const [localStatus,  setLocalStatus]  = useState<CaseStatus>(inquiry.caseStatus);
  const [saving,      setSaving]      = useState(false);
  const [err,         setErr]         = useState('');

  const sendReply = async () => {
    if (!replyText.trim()) return;
    setSaving(true); setErr('');
    try {
      const res = await fetch(`${API}/api/me/vendor/inquiries/${inquiry.id}/reply`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ reply: replyText.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail ?? '回覆失敗');
      const newMsg: InquiryMessage = data;
      setLocalMessages(prev => [...prev, newMsg]);
      setReplyText('');
      onReplySent(newMsg);
      // auto-advance status
      if (localStatus === 'new') {
        await updateStatus('contacted');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : '回覆失敗');
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (s: CaseStatus) => {
    const prev = localStatus;
    setLocalStatus(s);
    onStatusChange(s);
    try {
      const res = await fetch(`${API}/api/me/vendor/inquiries/${inquiry.id}/status`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ status: s }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setLocalStatus(prev);
      onStatusChange(prev);
      setErr('狀態更新失敗，請重試');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendReply();
    }
  };

  return (
    <div className="inq-chat-col">
      {/* Header */}
      <div className="inq-chat-header">
        <div className="inq-chat-contact">
          {inquiry.inquirerEmail ?? '匿名用戶'}
        </div>
        <div className="inq-house-chips">
          {inquiry.address && <span>{inquiry.address}</span>}
          {inquiry.county && !inquiry.address && <span>{inquiry.county}</span>}
          {inquiry.capacityKw > 0 && <span>{inquiry.capacityKw} kWp</span>}
          {inquiry.annualKwh > 0 && <span>{Math.round(inquiry.annualKwh).toLocaleString()} kWh/年</span>}
          {inquiry.paybackYears > 0 && <span>回本 {inquiry.paybackYears.toFixed(1)} 年</span>}
        </div>
        <div className="inq-chat-header-actions">
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>案件狀態</span>
          <select
            className="inq-status-select"
            value={localStatus}
            onChange={e => updateStatus(e.target.value as CaseStatus)}
          >
            {(['new','contacted','quoted','closed'] as CaseStatus[]).map(s => (
              <option key={s} value={s}>{CASE_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Messages */}
      <div className="inq-messages">
        {localMessages.map(msg => {
          const isVendor = msg.sender === 'vendor';
          const time = msg.createdAt ? new Date(msg.createdAt).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
          const initial = inquiry.inquirerEmail ? inquiry.inquirerEmail[0].toUpperCase() : '?';
          return (
            <div key={msg.id} style={{ display: 'flex', justifyContent: isVendor ? 'flex-end' : 'flex-start', gap: 8, alignItems: 'flex-end' }}>
              {!isVendor && (
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--green-200)', color: 'var(--ink-800)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                  {initial}
                </div>
              )}
              <div style={{ maxWidth: '70%' }}>
                <div style={{
                  padding: '10px 14px',
                  borderRadius: isVendor ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background: isVendor ? 'var(--green-700)' : 'var(--green-100)',
                  color: isVendor ? '#fff' : 'var(--green-900)',
                  fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap',
                }}>{msg.content}</div>
                {time && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, textAlign: isVendor ? 'right' : 'left' }}>{time}</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Input area */}
      {err && <div className="form-error" style={{ padding: '0 16px 8px', fontSize: 13 }}>{err}</div>}
      {inquiry.inquirerEmail ? (
        <div className="inq-input-area">
          <textarea
            className="form-input inq-textarea"
            placeholder={`回覆 ${inquiry.inquirerEmail}… (Ctrl+Enter 送出)`}
            rows={2}
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className="btn btn-primary"
            disabled={saving || !replyText.trim()}
            onClick={sendReply}
            style={{ flexShrink: 0, alignSelf: 'center', borderRadius: 12, fontSize: 13, padding: '12px 16px' }}
          >
            {saving ? '送出中⋯' : '送出回覆'}
          </button>
        </div>
      ) : (
        <div className="inq-anon-notice">匿名詢價無法回覆（用戶未登入）</div>
      )}
    </div>
  );
}


// ── Leads Tab ────────────────────────────────────────────────────────────────

function LeadsTab({
  leads, subscriptionStatus, upgradeRequestStatus, upgradeRejectionReason, authHeaders,
}: {
  leads: PotentialLead[];
  subscriptionStatus: string;
  upgradeRequestStatus: string | null;
  upgradeRejectionReason: string | null;
  authHeaders: Record<string, string>;
}) {
  const isAdvanced = subscriptionStatus !== 'free' && subscriptionStatus !== 'mock' && !!subscriptionStatus;
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeSubmitting, setUpgradeSubmitting] = useState(false);
  const [upgradeSubmitted, setUpgradeSubmitted] = useState(upgradeRequestStatus === 'pending');
  const [upgradeError, setUpgradeError] = useState('');

  const badgeStyle = (bg: string, color: string, border: string): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 4,
    fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
    padding: '2px 8px', borderRadius: 99,
    background: bg, color, border: `1px solid ${border}`,
  });

  const PlanBadge = isAdvanced ? (
    <span style={badgeStyle('var(--green-100)', 'var(--green-800)', 'var(--green-300)')}>★ 進階方案</span>
  ) : (upgradeRequestStatus === 'pending' || upgradeSubmitted) ? (
    <span style={badgeStyle('var(--warning-bg, #fef9c3)', '#92400e', '#fde68a')}>審核中</span>
  ) : upgradeRequestStatus === 'rejected' ? (
    <span style={badgeStyle('#fee2e2', '#991b1b', '#fecaca')}>已拒絕</span>
  ) : null;

  return (
    <div>
      <div className="dash-content-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="dash-content-title">潛在客戶名單</div>
          {PlanBadge}
        </div>
        {upgradeRequestStatus === 'rejected' && !upgradeSubmitted && (
          <div style={{ marginTop: 4, fontSize: 12, color: '#991b1b' }}>
            {upgradeRejectionReason
              ? `上次拒絕原因：${upgradeRejectionReason}`
              : '上次升級申請已被拒絕，你可以重新提交申請'}
          </div>
        )}
        <div className="dash-content-sub">服務縣市內已完成評估、但尚未聯繫貴公司的用戶</div>
      </div>

      {!isAdvanced && (
        <div className="leads-plan-banner">
          <div>
            <div className="leads-plan-banner-title">進階方案功能</div>
            <div className="leads-plan-banner-sub">免費方案僅顯示 3 筆，升級可解鎖全部潛在客戶名單</div>
          </div>
          {upgradeSubmitted ? (
            <button className="btn btn-secondary btn-sm" disabled style={{ opacity: 0.65, cursor: 'default' }}>
              已提交申請
            </button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => setShowUpgrade(true)}>升級進階方案</button>
          )}
        </div>
      )}

      <div className="dash-stats">
        <div className="dash-stat">
          <div className="dash-stat-value">{leads.length}</div>
          <div className="dash-stat-label">潛在客戶數</div>
        </div>
        <div className="dash-stat">
          <div className="dash-stat-value">{leads.filter(l => l.capacityKw > 0).length}</div>
          <div className="dash-stat-label">有評估資料</div>
        </div>
      </div>

      {leads.length === 0 ? (
        <div className="dash-empty">目前服務縣市內暫無潛在評估資料</div>
      ) : (
        <div className="leads-grid">
          {leads.map(lead => (
            <div key={lead.id} className="lead-card">
              <div className="lead-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div className="lead-card-email">{lead.accountEmail}</div>
                <div className="lead-card-date">
                  {new Date(lead.createdAt).toLocaleDateString('zh-TW')}
                </div>
              </div>
              <div className="dash-inquiry-chips" style={{ marginTop: 8 }}>
                {lead.county && <span>{lead.county}</span>}
                {lead.capacityKw > 0 && <span>{lead.capacityKw} kWp</span>}
                {lead.annualKwh > 0 && <span>{Math.round(lead.annualKwh).toLocaleString()} kWh/年</span>}
                {lead.paybackYears > 0 && <span>回本 {lead.paybackYears.toFixed(1)} 年</span>}
                {lead.outOfPocket > 0 && <span>自付 NT${Math.round(lead.outOfPocket / 10000)} 萬</span>}
              </div>
              {lead.address && (
                <div className="lead-card-address">{lead.address}</div>
              )}
              <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <a
                  href={`mailto:${lead.accountEmail}`}
                  className="btn-outline-sm"
                  style={{ textDecoration: 'none' }}
                >
                  寄送 Email
                </a>
              </div>
            </div>
          ))}

          {!isAdvanced && leads.length > 0 && (
            <div
              className="lead-card"
              style={{ position: 'relative', overflow: 'hidden', cursor: 'pointer' }}
              onClick={() => setShowUpgrade(true)}
            >
              {/* 假資料模糊背景 */}
              <div style={{ filter: 'blur(6px)', userSelect: 'none', pointerEvents: 'none' }}>
                <div className="lead-card-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div className="lead-card-email">user@example.com</div>
                  <div className="lead-card-date">2026/5/12</div>
                </div>
                <div className="dash-inquiry-chips" style={{ marginTop: 8 }}>
                  <span>台北市</span><span>9.2 kWp</span><span>10,450 kWh/年</span><span>回本 9.1 年</span>
                </div>
                <div className="lead-card-address" style={{ marginTop: 6 }}>台北市大安區某某路 88 號</div>
              </div>
              {/* 解鎖 overlay */}
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(255,255,255,0.55)', gap: 6,
              }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--ink-500)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-700)' }}>升級查看全部名單</span>
              </div>
            </div>
          )}
        </div>
      )}

      {showUpgrade && (
        <div className="modal-backdrop" onClick={() => { setShowUpgrade(false); setUpgradeError(''); }}>
          <div className="modal" style={{ maxWidth: 420, padding: 32 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ marginBottom: 20 }}>
              <div className="modal-title">升級進階方案</div>
              <button className="modal-close" onClick={() => { setShowUpgrade(false); setUpgradeError(''); }}>×</button>
            </div>

            {upgradeSubmitted ? (
              <div style={{ textAlign: 'center', padding: '12px 0 8px' }}>
                <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
                  <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="9 12 11 14 15 10" />
                  </svg>
                </div>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>申請已送出！</div>
                <p style={{ fontSize: 14, color: 'var(--ink-600)', lineHeight: 1.7, marginBottom: 24 }}>
                  管理員將在 1–3 個工作天內與您確認，開通後即可查看所有潛在客戶資訊。
                </p>
                <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setShowUpgrade(false)}>
                  關閉
                </button>
              </div>
            ) : (
              <>
                <p style={{ fontSize: 14, color: 'var(--ink-600)', lineHeight: 1.7, marginBottom: 20 }}>
                  免費方案每次最多顯示 3 筆潛在客戶，進階方案升級後可查看服務縣市內的完整名單（無筆數上限），主動開發更多業務機會。
                </p>
                <div style={{ background: 'var(--green-50)', borderRadius: 10, padding: '14px 18px', marginBottom: 24, fontSize: 14 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>進階方案包含</div>
                  <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-600)', lineHeight: 2 }}>
                    <li>無筆數上限的潛在客戶名單</li>
                    <li>優先出現在廠商推薦列表</li>
                  </ul>
                </div>
                {upgradeError && (
                  <div className="form-error" style={{ marginBottom: 12 }}>{upgradeError}</div>
                )}
                <button
                  className="btn btn-primary"
                  style={{ width: '100%' }}
                  disabled={upgradeSubmitting}
                  onClick={async () => {
                    setUpgradeSubmitting(true); setUpgradeError('');
                    try {
                      const res = await fetch(`${API}/api/me/vendor/upgrade-request`, {
                        method: 'POST', headers: authHeaders,
                      });
                      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? '申請失敗，請稍後再試');
                      setUpgradeSubmitted(true);
                    } catch (e) {
                      setUpgradeError(e instanceof Error ? e.message : '申請失敗，請稍後再試');
                    } finally {
                      setUpgradeSubmitting(false);
                    }
                  }}
                >
                  {upgradeSubmitting ? '送出中⋯' : '送出升級申請'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
