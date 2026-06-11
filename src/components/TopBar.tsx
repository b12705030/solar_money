'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Map, Store, Users, ShieldCheck, History, Mail, LogIn, LogOut } from 'lucide-react';
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const close = () => setMenuOpen(false);

  const handleInbox = () => { close(); onInboxClick?.(); };
  const handleHistory = () => { close(); onHistoryClick?.(); };
  const handleLogin = () => { close(); onLoginClick?.(); };
  const handleLogout = () => { close(); onLogout?.(); };
  const handleVendorApply = () => { close(); onVendorApplyClick?.(); };
  const handleVendorDash = () => { close(); onVendorDashClick?.(); };
  const handleAdminPanel = () => { close(); onAdminPanelClick?.(); };

  return (
    <div className="topbar">
      <button className="brand" onClick={onHome}>
        <img src="/logo.png" alt="屋頂日光" className="brand-mark" />
        <div className="brand-meta">
          <span>屋頂日光</span>
          <span className="sub">台灣屋頂太陽能自助評估</span>
        </div>
      </button>

      {/* Desktop nav — hidden on mobile */}
      <div className="topbar-actions topbar-desktop-actions">
        <span className="topbar-source">資料來源：中央氣象署 · 台電 · 能源署</span>
        <span className="pill topbar-pill">Beta</span>
        <Link href="/map" className="topbar-map-link" style={{ fontSize: 13, color: 'var(--ink-600)', textDecoration: 'none', padding: '4px 8px' }}>
          <Map size={13} strokeWidth={1.8} style={{ verticalAlign: 'middle', marginRight: 4 }} />地區分析
        </Link>
        <Link href="/vendors" className="btn-outline-sm" style={{ textDecoration: 'none' }}>找廠商</Link>
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
            {user.role !== 'vendor' && (
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
            )}
            <div className="topbar-user">
              <div className="avatar">{user.email[0].toUpperCase()}</div>
              <span className="role-pill">{ROLE_LABELS[user.role ?? 'user']}</span>
              <button className="btn-ghost caption" style={{ padding: '2px 0' }} onClick={onLogout}>登出</button>
            </div>
          </>
        ) : (
          <button className="btn-outline topbar-login-btn" onClick={onLoginClick}>登入 / 註冊</button>
        )}
      </div>

      {/* Mobile right — hamburger, hidden on desktop */}
      <div className="topbar-mobile-right">
        <button
          className="topbar-hamburger"
          onClick={() => setMenuOpen(true)}
          aria-label="開啟選單"
        >
          ☰
        </button>
      </div>

      {mounted && createPortal(
        <div
          className={`topbar-mobile-overlay${menuOpen ? ' topbar-mobile-overlay--open' : ''}`}
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <div className="topbar-mobile-menu">
            <div className="topbar-mobile-menu-header">
              <span className="topbar-mobile-menu-title">選單</span>
              <button className="topbar-mobile-menu-close" onClick={close} aria-label="關閉">✕</button>
            </div>

            <div className="topbar-mobile-menu-items">
              {user && (
                <>
                  <div className="topbar-mobile-menu-user">
                    <div className="avatar">{user.email[0].toUpperCase()}</div>
                    <div className="topbar-mobile-menu-user-info">
                      <span className="topbar-mobile-menu-email">{user.email}</span>
                      <span className="topbar-mobile-menu-role">{ROLE_LABELS[user.role ?? 'user']}</span>
                    </div>
                  </div>
                  <div className="topbar-mobile-menu-divider" />
                </>
              )}

              <Link href="/map" className="topbar-mobile-menu-item" onClick={close}>
                <Map size={14} strokeWidth={1.8} />地區分析
              </Link>
              <Link href="/vendors" className="topbar-mobile-menu-item" onClick={close}>
                <Users size={14} strokeWidth={1.8} />找廠商
              </Link>

              {(!user || user.role === 'user') && (
                <button className="topbar-mobile-menu-item topbar-mobile-menu-item--primary" onClick={handleVendorApply}>
                  <Store size={14} strokeWidth={1.8} />廠商入駐
                </button>
              )}

              <div className="topbar-mobile-menu-divider" />

              {user ? (
                <>
                  {user.role === 'vendor' && (
                    <button className="topbar-mobile-menu-item" onClick={handleVendorDash}>
                      <ShieldCheck size={14} strokeWidth={1.8} />廠商後台
                    </button>
                  )}
                  {user.role === 'admin' && (
                    <button className="topbar-mobile-menu-item" onClick={handleAdminPanel}>
                      <ShieldCheck size={14} strokeWidth={1.8} />管理後台
                    </button>
                  )}
                  <button className="topbar-mobile-menu-item" onClick={handleHistory}>
                    <History size={14} strokeWidth={1.8} />歷史紀錄
                  </button>
                  {user.role !== 'vendor' && (
                    <button className="topbar-mobile-menu-item" onClick={handleInbox}>
                      <Mail size={14} strokeWidth={1.8} />收件箱
                      {inboxUnread > 0 && <span style={{ marginLeft: 4, background: 'var(--green-700)', color: '#fff', borderRadius: 99, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>{inboxUnread}</span>}
                    </button>
                  )}
                  <div className="topbar-mobile-menu-divider" />
                  <button className="topbar-mobile-menu-item topbar-mobile-menu-item--danger" onClick={handleLogout}>
                    <LogOut size={14} strokeWidth={1.8} />登出
                  </button>
                </>
              ) : (
                <button className="topbar-mobile-menu-item topbar-mobile-menu-item--primary" onClick={handleLogin}>
                  <LogIn size={14} strokeWidth={1.8} />登入 / 註冊
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
