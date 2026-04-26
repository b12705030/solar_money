'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

type Tab = 'vendors' | 'accounts';

interface PendingVendor {
  id: string;
  name: string;
  companyTaxId: string | null;
  contactName: string | null;
  counties: string[];
  phone: string;
  email: string;
  licenseNote: string | null;
  applicationStatus: string;
  createdAt: string;
}

interface AccountResult {
  id: string;
  email: string;
  role: string;
}

const ROLES = ['user', 'vendor', 'admin'] as const;
type Role = typeof ROLES[number];

interface Props {
  onClose: () => void;
}

export default function AdminPanel({ onClose }: Props) {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('vendors');

  const authHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${user?.token ?? ''}`,
  }), [user?.token]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal admin-panel-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">管理後台</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="vd-tab-nav">
          <button
            className={`vd-tab-btn${tab === 'vendors' ? ' vd-tab-btn--active' : ''}`}
            onClick={() => setTab('vendors')}
          >
            廠商審核
          </button>
          <button
            className={`vd-tab-btn${tab === 'accounts' ? ' vd-tab-btn--active' : ''}`}
            onClick={() => setTab('accounts')}
          >
            帳號管理
          </button>
        </div>

        <div className="vd-body">
          {tab === 'vendors'  && <VendorsTab  authHeaders={authHeaders()} />}
          {tab === 'accounts' && <AccountsTab authHeaders={authHeaders()} />}
        </div>
      </div>
    </div>
  );
}


// ── Vendors Tab ──────────────────────────────────────────────────────────────

function VendorsTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [vendors, setVendors] = useState<PendingVendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/admin/vendors/pending`, { headers: authHeaders });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? '載入失敗');
      setVendors(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : '載入失敗');
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="vd-loading">載入中⋯</div>;
  if (error)   return <div className="vd-error">{error}</div>;
  if (vendors.length === 0) return <div className="vd-empty">目前沒有待審核的廠商申請。</div>;

  return (
    <div className="admin-vendor-list">
      {vendors.map(v => (
        <VendorApplicationCard key={v.id} vendor={v} authHeaders={authHeaders} onDone={load} />
      ))}
    </div>
  );
}

function VendorApplicationCard({
  vendor,
  authHeaders,
  onDone,
}: {
  vendor: PendingVendor;
  authHeaders: Record<string, string>;
  onDone: () => void;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason]         = useState('');
  const [busy, setBusy]             = useState(false);
  const [msg, setMsg]               = useState('');

  const approve = async () => {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(`${API}/api/admin/vendors/${vendor.id}/approve`, {
        method: 'POST', headers: authHeaders,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? '操作失敗');
      setMsg('已核准');
      setTimeout(onDone, 800);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '操作失敗');
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(`${API}/api/admin/vendors/${vendor.id}/reject`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ reason: reason.trim() || null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? '操作失敗');
      setMsg('已駁回');
      setTimeout(onDone, 800);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '操作失敗');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-vendor-card">
      <div className="admin-vendor-header">
        <div className="admin-vendor-name">{vendor.name}</div>
        <div className="admin-vendor-date">
          {new Date(vendor.createdAt).toLocaleDateString('zh-TW')}
        </div>
      </div>

      <div className="admin-vendor-meta">
        {vendor.companyTaxId && <span>統編：{vendor.companyTaxId}</span>}
        {vendor.contactName  && <span>聯絡人：{vendor.contactName}</span>}
        <span>{vendor.phone}</span>
        <span>{vendor.email}</span>
      </div>

      <div className="admin-vendor-counties">
        {vendor.counties.map(c => <span key={c} className="admin-county-chip">{c}</span>)}
      </div>

      {vendor.licenseNote && (
        <div className="admin-vendor-note">{vendor.licenseNote}</div>
      )}

      {msg ? (
        <div className={`vd-save-msg ${msg.startsWith('已核') ? 'vd-save-msg--ok' : 'vd-save-msg--err'}`}>
          {msg}
        </div>
      ) : (
        <div className="admin-vendor-actions">
          <button className="btn btn-primary admin-btn-approve" disabled={busy} onClick={approve}>
            核准
          </button>
          {rejectOpen ? (
            <div className="admin-reject-form">
              <input
                className="form-input"
                placeholder="駁回原因（選填）"
                value={reason}
                onChange={e => setReason(e.target.value)}
              />
              <button className="btn admin-btn-reject-confirm" disabled={busy} onClick={reject}>
                確認駁回
              </button>
              <button className="btn-ghost" onClick={() => setRejectOpen(false)}>取消</button>
            </div>
          ) : (
            <button className="btn admin-btn-reject" disabled={busy} onClick={() => setRejectOpen(true)}>
              駁回
            </button>
          )}
        </div>
      )}
    </div>
  );
}


// ── Accounts Tab ─────────────────────────────────────────────────────────────

function AccountsTab({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [email, setEmail]           = useState('');
  const [account, setAccount]       = useState<AccountResult | null>(null);
  const [searching, setSearching]   = useState(false);
  const [searchErr, setSearchErr]   = useState('');
  const [newRole, setNewRole]       = useState<Role>('user');
  const [saving, setSaving]         = useState(false);
  const [saveMsg, setSaveMsg]       = useState('');

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSearching(true);
    setSearchErr('');
    setAccount(null);
    setSaveMsg('');
    try {
      const res = await fetch(
        `${API}/api/admin/accounts/search?email=${encodeURIComponent(email.trim())}`,
        { headers: authHeaders },
      );
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? '查無此帳號');
      const data = await res.json();
      setAccount(data);
      setNewRole(data.role as Role);
    } catch (e) {
      setSearchErr(e instanceof Error ? e.message : '查詢失敗');
    } finally {
      setSearching(false);
    }
  };

  const saveRole = async () => {
    if (!account) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch(`${API}/api/admin/accounts/${account.id}/role`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? '更新失敗');
      setAccount(prev => prev ? { ...prev, role: newRole } : prev);
      setSaveMsg(`已將 ${account.email} 的角色更新為 ${newRole}`);
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : '更新失敗');
    } finally {
      setSaving(false);
    }
  };

  const ROLE_LABELS: Record<string, string> = { user: '民眾', vendor: '廠商', admin: '管理員' };

  return (
    <div className="admin-accounts">
      <form className="admin-search-form" onSubmit={search}>
        <input
          className="form-input"
          type="email"
          placeholder="輸入帳號 Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
        <button className="btn btn-primary" type="submit" disabled={searching}>
          {searching ? '查詢中⋯' : '查詢'}
        </button>
      </form>

      {searchErr && <div className="vd-error" style={{ padding: '12px 0' }}>{searchErr}</div>}

      {account && (
        <div className="admin-account-card">
          <div className="admin-account-row">
            <span className="admin-account-email">{account.email}</span>
            <span className={`vd-status-badge vd-status-badge--${account.role === 'admin' ? 'approved' : account.role === 'vendor' ? 'pending' : 'rejected'}`}>
              {ROLE_LABELS[account.role] ?? account.role}
            </span>
          </div>
          <div className="admin-account-row" style={{ marginTop: 12, gap: 10 }}>
            <select
              className="form-input admin-role-select"
              value={newRole}
              onChange={e => setNewRole(e.target.value as Role)}
            >
              {ROLES.map(r => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
            <button className="btn btn-primary" disabled={saving || newRole === account.role} onClick={saveRole}>
              {saving ? '更新中⋯' : '更新角色'}
            </button>
          </div>
          {saveMsg && (
            <div className={`vd-save-msg ${saveMsg.startsWith('已') ? 'vd-save-msg--ok' : 'vd-save-msg--err'}`}
              style={{ textAlign: 'left', marginTop: 8 }}>
              {saveMsg}
            </div>
          )}
        </div>
      )}

      <div className="admin-hint">
        <strong>提示：</strong>更新角色後，該帳號需要重新登入才能看到新角色對應的介面。
      </div>
    </div>
  );
}
