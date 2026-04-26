'use client';

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
  onVendorApplyClick?:  () => void;
  onVendorDashClick?:   () => void;
  onAdminPanelClick?:   () => void;
  user?:                { email: string; role?: AccountRole } | null;
  onLogout?:            () => void;
}

export default function TopBar({ onHome, onLoginClick, onHistoryClick, onVendorApplyClick, onVendorDashClick, onAdminPanelClick, user, onLogout }: TopBarProps) {
  return (
    <div className="topbar">
      <button className="brand" onClick={onHome}>
        <div className="brand-mark" />
        <div className="brand-meta">
          <span>屋頂日光</span>
          <span className="sub">台灣屋頂太陽能自助評估</span>
        </div>
      </button>

      <div className="topbar-actions">
        <span>資料來源：中央氣象署 · 台電 · 能源署</span>
        <span className="pill">Beta</span>
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
