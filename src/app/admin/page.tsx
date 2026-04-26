'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import DashLayout, { IconClipboard, IconUsers } from '@/components/DashLayout';
import type { NavItem } from '@/components/DashLayout';

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
const ROLE_LABELS: Record<string, string> = { user: '民眾', vendor: '廠商', admin: '管理員' };

export default function AdminPage() {
  const { user } = useAuth();
  const router   = useRouter();
  const [mounted, setMounted] = useState(false);
  const [tab, setTab]         = useState<Tab>('vendors');
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!user) { router.replace('/'); return; }
    if (user.role !== 'admin') { router.replace('/'); return; }
  }, [mounted, user, router]);

  const authHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${user?.token ?? ''}`,
  }), [user?.token]);

  if (!mounted || !user) return null;

  const navItems: NavItem[] = [
    { key: 'vendors',  label: '廠商審核', icon: <IconClipboard />, badge: pendingCount || undefined },
    { key: 'accounts', label: '帳號管理', icon: <IconUsers /> },
  ];

  return (
    <DashLayout
      sectionTitle="管理後台"
      navItems={navItems}
      activeTab={tab}
      onTabChange={k => setTab(k as Tab)}
      userEmail={user.email}
    >
      {tab === 'vendors'  && (
        <VendorsTab authHeaders={authHeaders()} onCountChange={setPendingCount} />
      )}
      {tab === 'accounts' && (
        <AccountsTab authHeaders={authHeaders()} />
      )}
    </DashLayout>
  );
}


// ── Vendors Tab ──────────────────────────────────────────────────────────────

function VendorsTab({
  authHeaders,
  onCountChange,
}: {
  authHeaders: Record<string, string>;
  onCountChange: (n: number) => void;
}) {
  const [vendors, setVendors] = useState<PendingVendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API}/api/admin/vendors/pending`, { headers: authHeaders });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? '載入失敗');
      const data = await res.json();
      setVendors(data);
      onCountChange(data.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : '載入失敗');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, onCountChange]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="dash-content-header">
        <div className="dash-content-title">廠商審核</div>
        <div className="dash-content-sub">審核廠商入駐申請，核准後廠商帳號自動升級並公開顯示於推薦列表</div>
      </div>

      {/* Stats */}
      {!loading && !error && (
        <div className="dash-stats">
          <div className="dash-stat">
            <div className="dash-stat-value">{vendors.length}</div>
            <div className="dash-stat-label">待審核申請</div>
          </div>
        </div>
      )}

      {loading && <div className="dash-loading">載入中⋯</div>}
      {error   && <div className="vd-error">{error}</div>}
      {!loading && !error && vendors.length === 0 && (
        <div className="dash-empty">目前沒有待審核的廠商申請</div>
      )}
      {!loading && !error && vendors.map(v => (
        <ApplicationCard key={v.id} vendor={v} authHeaders={authHeaders} onDone={load} />
      ))}
    </div>
  );
}

function ApplicationCard({
  vendor, authHeaders, onDone,
}: {
  vendor: PendingVendor;
  authHeaders: Record<string, string>;
  onDone: () => void;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason,     setReason]     = useState('');
  const [busy,       setBusy]       = useState(false);
  const [msg,        setMsg]        = useState('');

  const approve = async () => {
    setBusy(true); setMsg('');
    try {
      const res = await fetch(`${API}/api/admin/vendors/${vendor.id}/approve`, {
        method: 'POST', headers: authHeaders,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? '操作失敗');
      setMsg('✓ 已核准');
      setTimeout(onDone, 1000);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '操作失敗');
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    setBusy(true); setMsg('');
    try {
      const res = await fetch(`${API}/api/admin/vendors/${vendor.id}/reject`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ reason: reason.trim() || null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? '操作失敗');
      setMsg('✕ 已駁回');
      setTimeout(onDone, 1000);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '操作失敗');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dash-application-card">
      <div className="dash-application-header">
        <div className="dash-application-name">{vendor.name}</div>
        <div className="dash-application-date">
          申請日期：{new Date(vendor.createdAt).toLocaleDateString('zh-TW')}
        </div>
      </div>

      <div className="dash-application-row">
        {vendor.companyTaxId && <span><strong>統編</strong> {vendor.companyTaxId}</span>}
        {vendor.contactName  && <span><strong>聯絡人</strong> {vendor.contactName}</span>}
        <span><strong>電話</strong> {vendor.phone}</span>
        <span><strong>Email</strong> {vendor.email}</span>
      </div>

      <div className="dash-application-counties">
        {vendor.counties.map(c => (
          <span key={c} className="admin-county-chip">{c}</span>
        ))}
      </div>

      {vendor.licenseNote && (
        <div className="dash-application-note">{vendor.licenseNote}</div>
      )}

      {msg ? (
        <div className={`dash-save-msg dash-save-msg--${msg.startsWith('✓') ? 'ok' : 'err'}`}
          style={{ fontSize: 14, fontWeight: 600 }}>
          {msg}
        </div>
      ) : (
        <div className="dash-application-actions">
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={approve}>
            核准
          </button>
          {rejectOpen ? (
            <div className="dash-reject-inline">
              <input
                className="form-input"
                placeholder="駁回原因（選填）"
                value={reason}
                onChange={e => setReason(e.target.value)}
              />
              <button className="btn admin-btn-reject-confirm btn-sm" disabled={busy} onClick={reject}>
                確認駁回
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setRejectOpen(false)}>取消</button>
            </div>
          ) : (
            <button className="btn admin-btn-reject btn-sm" disabled={busy} onClick={() => setRejectOpen(true)}>
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
  const [email,     setEmail]     = useState('');
  const [account,   setAccount]   = useState<AccountResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [newRole,   setNewRole]   = useState<Role>('user');
  const [saving,    setSaving]    = useState(false);
  const [saveMsg,   setSaveMsg]   = useState('');

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSearching(true); setSearchErr(''); setAccount(null); setSaveMsg('');
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
    setSaving(true); setSaveMsg('');
    try {
      const res = await fetch(`${API}/api/admin/accounts/${account.id}/role`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? '更新失敗');
      setAccount(prev => prev ? { ...prev, role: newRole } : prev);
      setSaveMsg(`已將 ${account.email} 的角色更新為「${ROLE_LABELS[newRole]}」`);
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : '更新失敗');
    } finally {
      setSaving(false);
    }
  };

  const roleBadgeClass = (role: string) =>
    role === 'admin' ? 'approved' : role === 'vendor' ? 'pending' : 'rejected';

  return (
    <div>
      <div className="dash-content-header">
        <div className="dash-content-title">帳號管理</div>
        <div className="dash-content-sub">查詢帳號並調整角色；帳號需重新登入才會生效</div>
      </div>

      <form className="dash-account-search" onSubmit={search}>
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

      {searchErr && (
        <div className="vd-error" style={{ padding: '12px 0' }}>{searchErr}</div>
      )}

      {account && (
        <div className="dash-account-result">
          <div className="dash-account-result-header">
            <div className="dash-account-result-email">{account.email}</div>
            <span className={`vd-status-badge vd-status-badge--${roleBadgeClass(account.role)}`}>
              {ROLE_LABELS[account.role] ?? account.role}
            </span>
          </div>
          <div className="dash-account-result-actions">
            <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>變更角色為</span>
            <select
              value={newRole}
              onChange={e => setNewRole(e.target.value as Role)}
            >
              {ROLES.map(r => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
            <button
              className="btn btn-primary"
              disabled={saving || newRole === account.role}
              onClick={saveRole}
            >
              {saving ? '更新中⋯' : '確認更新'}
            </button>
          </div>
          {saveMsg && (
            <div className={`dash-save-msg dash-save-msg--${saveMsg.startsWith('已') ? 'ok' : 'err'}`}
              style={{ marginTop: 12 }}>
              {saveMsg}
            </div>
          )}
        </div>
      )}

      <div className="dash-hint">
        <strong>提示：</strong>更新角色後，該帳號需要<strong>重新登入</strong>才能看到新角色對應的介面。
        廠商帳號需先在首頁提交入駐申請並由此頁核准，或直接在此將角色設為「廠商」進行測試。
      </div>
    </div>
  );
}
