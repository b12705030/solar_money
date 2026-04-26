'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { SUBSIDIES } from '@/lib/constants';
import type { MyVendor, Inquiry, VendorPortfolio, CaseStatus, PotentialLead } from '@/lib/types';
import DashLayout, { IconBuilding, IconFolder, IconInbox, IconUsers } from '@/components/DashLayout';
import type { NavItem } from '@/components/DashLayout';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
const COUNTIES = Object.keys(SUBSIDIES);

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

  useEffect(() => { if (user?.role === 'vendor') fetchVendor(); }, [user, fetchVendor]);
  useEffect(() => { if (tab === 'inquiries') fetchInquiries(); }, [tab, fetchInquiries]);
  useEffect(() => { if (tab === 'leads') fetchLeads(); }, [tab, fetchLeads]);

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
          {tab === 'profile'    && <ProfileTab    vendor={vendor} onSaved={fetchVendor} authHeaders={authHeaders()} />}
          {tab === 'portfolios' && <PortfoliosTab vendor={vendor} onChanged={fetchVendor} authHeaders={authHeaders()} />}
          {tab === 'inquiries'  && (
            <InquiriesTab
              inquiries={inquiries}
              authHeaders={authHeaders()}
              onStatusChange={(id, s) =>
                setInquiries(prev => prev.map(i => i.id === id ? { ...i, caseStatus: s } : i))
              }
            />
          )}
          {tab === 'leads' && (
            <LeadsTab leads={leads} subscriptionStatus={vendor.subscriptionStatus ?? 'free'} />
          )}
        </>
      )}
    </DashLayout>
  );
}


// ── Profile Tab ──────────────────────────────────────────────────────────────

function ProfileTab({
  vendor, onSaved, authHeaders,
}: {
  vendor: MyVendor;
  onSaved: () => void;
  authHeaders: Record<string, string>;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return <ProfileView vendor={vendor} onEdit={() => setEditing(true)} />;
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
function ProfileView({ vendor, onEdit }: { vendor: MyVendor; onEdit: () => void }) {
  const statusColors: Record<string, string> = {
    pending:  'vd-status-badge--pending',
    approved: 'vd-status-badge--approved',
    rejected: 'vd-status-badge--rejected',
  };

  return (
    <div>
      <div className="dash-content-header">
        <div className="dash-content-title">廠商資料</div>
        <div className="dash-content-sub">公開顯示於推薦列表的公司資訊</div>
      </div>

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

        {/* Info rows */}
        <div className="dash-profile-info-list">
          <div className="dash-profile-info-row">
            <span className="dash-profile-info-label">聯絡電話</span>
            <span className="dash-profile-info-value">{vendor.phone || '—'}</span>
          </div>
          <div className="dash-profile-info-row">
            <span className="dash-profile-info-label">聯絡 Email</span>
            <span className="dash-profile-info-value">{vendor.email || '—'}</span>
          </div>
          <div className="dash-profile-info-row">
            <span className="dash-profile-info-label">服務縣市</span>
            <span className="dash-profile-info-value">
              {vendor.counties.length === 0 ? '—' : (
                <span className="dash-profile-counties">
                  {vendor.counties.map(c => (
                    <span key={c} className="dash-profile-county-chip">{c}</span>
                  ))}
                </span>
              )}
            </span>
          </div>
          {vendor.tags.length > 0 && (
            <div className="dash-profile-info-row">
              <span className="dash-profile-info-label">服務標籤</span>
              <span className="dash-profile-info-value">
                <span className="dash-profile-tag-list">
                  {vendor.tags.map(t => (
                    <span key={t} className="dash-profile-tag">{t}</span>
                  ))}
                </span>
              </span>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="dash-profile-footer">
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
  const [saving,      setSaving]      = useState(false);
  const [msg,         setMsg]         = useState('');

  const toggleCounty = (c: string) =>
    setCounties(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setLogoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setSaving(true); setMsg('');
    try {
      // Upload logo if changed
      if (logoPreview !== vendor.logoUrl) {
        await fetch(`${API}/api/me/vendor/logo`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ logo_url: logoPreview }),
        });
      }
      const res = await fetch(`${API}/api/me/vendor`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({
          name, phone, email, counties,
          tags: tags.split(/[、,，\s]+/).map(t => t.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? '儲存失敗');
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
              <button type="button" className="btn-ghost" style={{ fontSize: 13, padding: '4px 10px' }} onClick={() => setLogoPreview(null)}>
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
  const remove = async () => {
    try {
      await fetch(`${API}/api/me/vendor/portfolios/${portfolio.id}`, { method: 'DELETE', headers: authHeaders });
      onChanged();
    } catch { /* ignore */ }
  };

  return (
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
          <button className="dash-portfolio-del" onClick={remove}>刪除</button>
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
  const [photo,   setPhoto]   = useState<string | null>(null);
  const [adding,  setAdding]  = useState(false);
  const [err,     setErr]     = useState('');

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result as string);
    reader.readAsDataURL(file);
  };

  const add = async () => {
    if (!title.trim() || !meta.trim()) { setErr('請填寫標題與說明'); return; }
    setAdding(true); setErr('');
    try {
      const res = await fetch(`${API}/api/me/vendor/portfolios`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          title: title.trim(), meta: meta.trim(),
          capacityKw: capKw ? parseFloat(capKw) : null,
          completedYear: year ? parseInt(year, 10) : null,
          photoUrl: photo,
          description: desc.trim() || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? '新增失敗');
      onAdded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '新增失敗');
      setAdding(false);
    }
  };

  return (
    <div className="dash-add-form-card">
      <div className="dash-add-form-title">新增作品</div>
      <div className="dash-edit-form">
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
              <button type="button" className="btn-ghost" style={{ fontSize: 13 }} onClick={() => setPhoto(null)}>移除</button>
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
          <label className="form-label">客戶描述 <span className="form-label-opt">選填，說明建築類型、挑戰與解法</span></label>
          <textarea className="form-input" rows={3} value={desc} onChange={e => setDesc(e.target.value)} placeholder="屋主為三層透天厝，南向屋頂，安裝 8 片高效模組，成功申請台北市補助 12 萬元..." />
        </div>
        <div className="dash-edit-form-row">
          <div className="form-field">
            <label className="form-label">裝置容量 (kWp)<span className="form-label-opt">選填</span></label>
            <input className="form-input" type="number" min="0" step="0.1" value={capKw} onChange={e => setCapKw(e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">完工年份<span className="form-label-opt">選填</span></label>
            <input className="form-input" type="number" min="2000" max="2099" value={year} onChange={e => setYear(e.target.value)} />
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
  );
}


// ── Inquiries Tab — chat-style ───────────────────────────────────────────────

function InquiriesTab({
  inquiries, authHeaders, onStatusChange,
}: {
  inquiries: Inquiry[];
  authHeaders: Record<string, string>;
  onStatusChange: (id: string, s: CaseStatus) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    inquiries.length > 0 ? inquiries[0].id : null,
  );
  const selected = inquiries.find(i => i.id === selectedId) ?? null;

  return (
    <div>
      <div className="dash-content-header">
        <div className="dash-content-title">收件箱</div>
        <div className="dash-content-sub">點選左側聯絡人查看對話，在右側直接回覆與更新案件狀態</div>
      </div>

      <div className="dash-stats">
        {(['new','contacted','quoted','closed'] as CaseStatus[]).map(s => (
          <div key={s} className="dash-stat">
            <div className={`dash-stat-value case-stat-${s}`}>
              {inquiries.filter(i => i.caseStatus === s).length}
            </div>
            <div className="dash-stat-label">{CASE_STATUS_LABEL[s]}</div>
          </div>
        ))}
      </div>

      {inquiries.length === 0 ? (
        <div className="dash-empty">尚未收到任何詢價</div>
      ) : (
        <div className="inq-shell">
          {/* Left: contact list */}
          <div className="inq-contacts-col">
            {inquiries.map(inq => (
              <div
                key={inq.id}
                className={`inq-contact-item${selectedId === inq.id ? ' inq-contact-item--active' : ''}`}
                onClick={() => setSelectedId(inq.id)}
              >
                <div className="inq-contact-row">
                  <div className="inq-contact-avatar">
                    {inq.inquirerEmail ? inq.inquirerEmail[0].toUpperCase() : '?'}
                  </div>
                  <div className="inq-contact-body">
                    <div className="inq-contact-email">
                      {inq.inquirerEmail ?? '匿名'}
                    </div>
                    <div className="inq-contact-preview">
                      {inq.message
                        ? inq.message.slice(0, 40) + (inq.message.length > 40 ? '…' : '')
                        : `${inq.county ?? ''} ${inq.capacityKw > 0 ? `· ${inq.capacityKw} kWp` : ''}`.trim() || '詢價'}
                    </div>
                  </div>
                </div>
                <div className="inq-contact-footer">
                  <span className={`inq-cs-badge ${CASE_STATUS_CLASS[inq.caseStatus]}`}>
                    {CASE_STATUS_LABEL[inq.caseStatus]}
                  </span>
                  <span className="inq-contact-date">
                    {new Date(inq.createdAt).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Right: chat window */}
          {selected ? (
            <ChatWindow
              key={selected.id}
              inquiry={selected}
              authHeaders={authHeaders}
              onStatusChange={(s) => onStatusChange(selected.id, s)}
              onReplySent={(reply) =>
                onStatusChange(selected.id, selected.caseStatus === 'new' ? 'contacted' : selected.caseStatus)
              }
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
  onReplySent: (reply: string) => void;
}) {
  const [replyText,   setReplyText]   = useState('');
  const [localReply,  setLocalReply]  = useState(inquiry.vendorReply ?? null);
  const [localStatus, setLocalStatus] = useState<CaseStatus>(inquiry.caseStatus);
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
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? '回覆失敗');
      setLocalReply(replyText.trim());
      setReplyText('');
      onReplySent(replyText.trim());
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
    setLocalStatus(s);
    onStatusChange(s);
    await fetch(`${API}/api/me/vendor/inquiries/${inquiry.id}/status`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ status: s }),
    }).catch(() => {});
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
        {/* Assessment summary as system card */}
        <div className="inq-system-card">
          <div className="inq-system-card-label">評估資料</div>
          <div className="dash-inquiry-chips" style={{ marginTop: 4 }}>
            {inquiry.address && <span>{inquiry.address}</span>}
            {inquiry.county && !inquiry.address && <span>{inquiry.county}</span>}
            {inquiry.capacityKw > 0 && <span>{inquiry.capacityKw} kWp</span>}
            {inquiry.annualKwh > 0 && <span>{Math.round(inquiry.annualKwh).toLocaleString()} kWh/年</span>}
            {inquiry.paybackYears > 0 && <span>回本 {inquiry.paybackYears.toFixed(1)} 年</span>}
          </div>
          <div className="inq-system-date">
            詢價時間：{new Date(inquiry.createdAt).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' })}
          </div>
        </div>

        {/* User message */}
        {inquiry.message && (
          <div className="inq-msg-row inq-msg-row--user">
            <div className="inq-msg-avatar">{inquiry.inquirerEmail ? inquiry.inquirerEmail[0].toUpperCase() : '?'}</div>
            <div className="inq-msg inq-msg--user">{inquiry.message}</div>
          </div>
        )}

        {/* Vendor reply */}
        {localReply && (
          <div className="inq-msg-row inq-msg-row--vendor">
            <div className="inq-msg inq-msg--vendor">{localReply}</div>
            <div className="inq-msg-avatar inq-msg-avatar--vendor">我</div>
          </div>
        )}
      </div>

      {/* Input area */}
      {err && <div className="form-error" style={{ padding: '0 16px 8px', fontSize: 13 }}>{err}</div>}
      {inquiry.inquirerEmail ? (
        <div className="inq-input-area">
          <textarea
            className="form-input inq-textarea"
            placeholder={`回覆 ${inquiry.inquirerEmail}… (Ctrl+Enter 送出)`}
            rows={3}
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className="btn btn-primary"
            disabled={saving || !replyText.trim()}
            onClick={sendReply}
            style={{ flexShrink: 0, alignSelf: 'flex-end' }}
          >
            {saving ? '送出中⋯' : localReply ? '更新回覆' : '送出回覆'}
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
  leads, subscriptionStatus,
}: {
  leads: PotentialLead[];
  subscriptionStatus: string;
}) {
  const isAdvanced = subscriptionStatus === 'mock' || subscriptionStatus === 'advanced';
  const visibleLeads = isAdvanced ? leads : leads.slice(0, 3);
  const lockedCount = isAdvanced ? 0 : Math.max(0, leads.length - 3);

  return (
    <div>
      <div className="dash-content-header">
        <div className="dash-content-title">潛在客戶名單</div>
        <div className="dash-content-sub">服務縣市內已完成評估、但尚未聯繫貴公司的用戶</div>
      </div>

      {!isAdvanced && (
        <div className="leads-plan-banner">
          <div>
            <div className="leads-plan-banner-title">進階方案功能</div>
            <div className="leads-plan-banner-sub">升級可查看所有潛在客戶聯絡資訊，主動開發業務</div>
          </div>
          <button className="btn btn-primary btn-sm">升級進階方案</button>
        </div>
      )}

      <div className="dash-stats">
        <div className="dash-stat">
          <div className="dash-stat-value">{leads.length}</div>
          <div className="dash-stat-label">潛在客戶數</div>
        </div>
        <div className="dash-stat">
          <div className="dash-stat-value">
            {leads.filter(l => l.capacityKw > 0).length}
          </div>
          <div className="dash-stat-label">有評估資料</div>
        </div>
      </div>

      {leads.length === 0 ? (
        <div className="dash-empty">目前服務縣市內暫無潛在評估資料</div>
      ) : (
        <div className="leads-grid">
          {visibleLeads.map(lead => (
            <div key={lead.id} className="lead-card">
              <div className="lead-card-header">
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
            </div>
          ))}

          {lockedCount > 0 && (
            <div className="lead-card lead-card--locked">
              <div className="lead-locked-count">+{lockedCount} 筆</div>
              <div className="lead-locked-label">升級進階方案查看更多</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
