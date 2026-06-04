'use client';

import Link from 'next/link';
import { Map } from 'lucide-react';
import type { AccountRole } from '@/lib/auth';

const ROLE_LABELS: Record<AccountRole, string> = {
  user: '民眾',
  vendor: '廠商',
  admin: '管理員',
};

interface TopBarProps {
  onHome?:              () => void;
  onLoginClick?:        () => void;
  onHistoryClick?:      () => void;
  onInboxClick?:        () => void;
  inboxUnread?:         number;
  onVendorApplyClick?:  () => void;
  onVendorDashClick?:   () => void;
  onAdminPanelClick?:   () => void;
  user?:                { email: string; role?: AccountRole } | null;
  onLogout?:            () => void;
}

export default function TopBar({ onHome, onLoginClick, onHistoryClick, onInboxClick, inboxUnread = 0, onVendorApplyClick, onVendorDashClick, onAdminPanelClick, user, onLogout }: TopBarProps) {
  return (
    <div className="topbar">
      <button className="brand" onClick={onHome}>
        <img src="/logo.png" alt="屋頂日光" className="brand-mark" />
        <div className="brand-meta">
          <span>屋頂日光</span>
          <span className="sub">台灣屋頂太陽能自助評估</span>
        </div>
      </button>

      <div className="topbar-actions">
        <span className="topbar-source">資料來源：中央氣象署 · 台電 · 能源署</span>
        <span className="pill topbar-pill">Beta</span>
        <Link href="/map" className="topbar-map-link" style={{ fontSize: 13, color: 'var(--ink-600)', textDecoration: 'none', padding: '4px 8px' }}>
          <Map size={13} strokeWidth={1.8} style={{ verticalAlign: 'middle', marginRight: 4 }} />地區分析
        </Link>
        {/* 只有未登入或 user 角色才顯示廠商入駐 */}
        {(!user || user.role === 'user') && (
          <button className="btn-outline-sm" onClick={onVendorApplyClick}>廠商入駐</button>
        )}

        {user ? (
          <>
            {user.role === 'vendor' && (
              <button className="btn-outline-sm" onClick={onVendorDashClick}>廠商後台</button>
            )}
            {user.role === 'admin' && (
              <button className="btn-outline-sm" onClick={onAdminPanelClick}>管理後台</button>
            )}
            <button className="btn-outline-sm" onClick={onHistoryClick}>歷史紀錄</button>
            <button
              className="btn-outline-sm"
              onClick={onInboxClick}
              style={{ position: 'relative' }}
            >
              ✉ 收件箱
              {inboxUnread > 0 && (
                <span style={{
                  position: 'absolute', top: -6, right: -6,
                  background: 'var(--green-700)', color: '#fff',
                  borderRadius: '50%', width: 16, height: 16,
                  fontSize: 10, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{inboxUnread}</span>
              )}
            </button>
            <div className="topbar-user">
              <div className="avatar">{user.email[0].toUpperCase()}</div>
              <span className="role-pill">{ROLE_LABELS[user.role ?? 'user']}</span>
              <button className="btn-ghost caption" style={{ padding: '2px 0' }} onClick={onLogout}>登出</button>
            </div>
          </>
        ) : (
          <button className="btn-outline" onClick={onLoginClick}>登入 / 註冊</button>
        )}
      </div>
    </div>
  );
}
