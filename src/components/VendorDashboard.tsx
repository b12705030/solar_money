'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { SUBSIDIES } from '@/lib/constants';
import type { MyVendor, Inquiry, VendorPortfolio } from '@/lib/types';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
const COUNTIES = Object.keys(SUBSIDIES);

type Tab = 'profile' | 'portfolios' | 'inquiries';

interface Props {
  onClose: () => void;
}

export default function VendorDashboard({ onClose }: Props) {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('profile');
  const [vendor, setVendor] = useState<MyVendor | null>(null);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  useEffect(() => { fetchVendor(); }, [fetchVendor]);
  useEffect(() => {
    if (tab === 'inquiries') fetchInquiries();
  }, [tab, fetchInquiries]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal vendor-dashboard-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">廠商後台</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="vd-tab-nav">
          {(['profile', 'portfolios', 'inquiries'] as Tab[]).map(t => (
            <button
              key={t}
              className={`vd-tab-btn${tab === t ? ' vd-tab-btn--active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'profile' ? '廠商資料' : t === 'portfolios' ? '作品集' : '詢價紀錄'}
            </button>
          ))}
        </div>

        <div className="vd-body">
          {loading ? (
            <div className="vd-loading">載入中⋯</div>
          ) : error ? (
            <div className="vd-error">{error}</div>
          ) : (
            <>
              {tab === 'profile'     && vendor && <ProfileTab vendor={vendor} onSaved={fetchVendor} authHeaders={authHeaders()} />}
              {tab === 'portfolios'  && vendor && <PortfoliosTab vendor={vendor} onChanged={fetchVendor} authHeaders={authHeaders()} />}
              {tab === 'inquiries'   && <InquiriesTab inquiries={inquiries} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}


// ── Profile Tab ──────────────────────────────────────────────────────────────

function ProfileTab({
  vendor,
  onSaved,
  authHeaders,
}: {
  vendor: MyVendor;
  onSaved: () => void;
  authHeaders: Record<string, string>;
}) {
  const [name, setName]       = useState(vendor.name);
  const [phone, setPhone]     = useState(vendor.phone);
  const [email, setEmail]     = useState(vendor.email);
  const [counties, setCounties] = useState<string[]>(vendor.counties);
  const [tags, setTags]       = useState(vendor.tags.join('、'));
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg]         = useState('');

  const toggleCounty = (c: string) =>
    setCounties(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);

  const save = async () => {
    setSaving(true);
    setMsg('');
    try {
      const res = await fetch(`${API}/api/me/vendor`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({
          name,
          phone,
          email,
          counties,
          tags: tags.split(/[、,，\s]+/).map(t => t.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? '儲存失敗');
      setMsg('已儲存');
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const statusLabel: Record<string, string> = {
    pending: '審核中',
    approved: '已核准',
    rejected: '未通過',
  };

  return (
    <div className="vd-profile">
      <div className="vd-status-row">
        <span className="vd-status-label">審核狀態</span>
        <span className={`vd-status-badge vd-status-badge--${vendor.applicationStatus}`}>
          {statusLabel[vendor.applicationStatus] ?? vendor.applicationStatus}
        </span>
        <span className="vd-status-label" style={{ marginLeft: 16 }}>評分</span>
        <span className="vd-status-value">{vendor.rating.toFixed(1)} ({vendor.reviewCount} 則)</span>
      </div>

      <div className="form-field">
        <label className="form-label">公司名稱</label>
        <input className="form-input" value={name} onChange={e => setName(e.target.value)} />
      </div>
      <div className="vendor-apply-grid">
        <div className="form-field">
          <label className="form-label">電話</label>
          <input className="form-input" value={phone} onChange={e => setPhone(e.target.value)} />
        </div>
        <div className="form-field">
          <label className="form-label">Email</label>
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
        <label className="form-label">標籤（逗號或頓號分隔）</label>
        <input className="form-input" value={tags} onChange={e => setTags(e.target.value)} placeholder="集合住宅、補助代辦" />
      </div>

      {msg && <div className={`vd-save-msg${msg === '已儲存' ? ' vd-save-msg--ok' : ' vd-save-msg--err'}`}>{msg}</div>}
      <button className="btn btn-primary" disabled={saving} onClick={save}>
        {saving ? '儲存中⋯' : '儲存變更'}
      </button>
    </div>
  );
}


// ── Portfolios Tab ───────────────────────────────────────────────────────────

function PortfoliosTab({
  vendor,
  onChanged,
  authHeaders,
}: {
  vendor: MyVendor;
  onChanged: () => void;
  authHeaders: Record<string, string>;
}) {
  const [title, setTitle]   = useState('');
  const [meta, setMeta]     = useState('');
  const [capKw, setCapKw]   = useState('');
  const [year, setYear]     = useState('');
  const [adding, setAdding] = useState(false);
  const [err, setErr]       = useState('');

  const add = async () => {
    if (!title.trim() || !meta.trim()) { setErr('請填寫標題與說明'); return; }
    setAdding(true);
    setErr('');
    try {
      const res = await fetch(`${API}/api/me/vendor/portfolios`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          title: title.trim(),
          meta: meta.trim(),
          capacityKw: capKw ? parseFloat(capKw) : null,
          completedYear: year ? parseInt(year, 10) : null,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? '新增失敗');
      setTitle(''); setMeta(''); setCapKw(''); setYear('');
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '新增失敗');
    } finally {
      setAdding(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await fetch(`${API}/api/me/vendor/portfolios/${id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      onChanged();
    } catch { /* ignore */ }
  };

  return (
    <div className="vd-portfolios">
      <div className="vd-portfolio-list">
        {vendor.portfolios.length === 0 && (
          <div className="vd-empty">尚無作品集，請新增。</div>
        )}
        {vendor.portfolios.map((p: VendorPortfolio) => (
          <div key={p.id} className="vd-portfolio-item">
            <div className="vd-portfolio-info">
              <div className="vd-portfolio-title">{p.title}</div>
              <div className="vd-portfolio-meta">{p.meta}</div>
              <div className="vd-portfolio-sub">
                {p.capacityKw > 0 && <span>{p.capacityKw} kWp</span>}
                {p.completedYear && <span>{p.completedYear} 完工</span>}
              </div>
            </div>
            <button className="vd-portfolio-delete" onClick={() => remove(p.id)}>刪除</button>
          </div>
        ))}
      </div>

      <div className="vd-add-portfolio">
        <div className="vd-section-title">新增作品</div>
        <div className="form-field">
          <label className="form-label">標題</label>
          <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="信義區集合住宅屋頂型案場" />
        </div>
        <div className="form-field">
          <label className="form-label">說明</label>
          <input className="form-input" value={meta} onChange={e => setMeta(e.target.value)} placeholder="住宅大樓 · 22.4 kWp · 2025 完工" />
        </div>
        <div className="vendor-apply-grid">
          <div className="form-field">
            <label className="form-label">裝置容量 (kWp)</label>
            <input className="form-input" type="number" min="0" step="0.1" value={capKw} onChange={e => setCapKw(e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">完工年份</label>
            <input className="form-input" type="number" min="2000" max="2099" value={year} onChange={e => setYear(e.target.value)} />
          </div>
        </div>
        {err && <div className="form-error">{err}</div>}
        <button className="btn btn-primary" disabled={adding} onClick={add}>
          {adding ? '新增中⋯' : '新增作品'}
        </button>
      </div>
    </div>
  );
}


// ── Inquiries Tab ────────────────────────────────────────────────────────────

function InquiriesTab({ inquiries }: { inquiries: Inquiry[] }) {
  if (inquiries.length === 0) {
    return <div className="vd-empty">尚未收到詢價紀錄。</div>;
  }
  return (
    <div className="vd-inquiry-list">
      {inquiries.map(inq => (
        <div key={inq.id} className="vd-inquiry-item">
          <div className="vd-inquiry-row">
            <span className="vd-inquiry-email">{inq.inquirerEmail ?? '匿名用戶'}</span>
            <span className="vd-inquiry-date">{new Date(inq.createdAt).toLocaleDateString('zh-TW')}</span>
          </div>
          <div className="vd-inquiry-row vd-inquiry-detail">
            {inq.county && <span>{inq.county}</span>}
            {inq.address && <span>{inq.address}</span>}
            {inq.capacityKw > 0 && <span>{inq.capacityKw} kWp</span>}
            {inq.annualKwh > 0 && <span>年發電 {Math.round(inq.annualKwh).toLocaleString()} kWh</span>}
            {inq.paybackYears > 0 && <span>回本 {inq.paybackYears.toFixed(1)} 年</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
