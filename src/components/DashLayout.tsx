'use client';
import { useState } from 'react';
import Link from 'next/link';

// ── Monochrome SVG Icons ──────────────────────────────────────────────────────
const S = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const IconBuilding    = () => <svg {...S}><path d="M3 21h18M3 9l9-4 9 4v12H3V9z"/><path d="M9 21v-6h6v6"/></svg>;
export const IconFolder      = () => <svg {...S}><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>;
export const IconInbox       = () => <svg {...S}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>;
export const IconClipboard   = () => <svg {...S}><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>;
export const IconUsers       = () => <svg {...S}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>;
export const IconHome        = () => <svg {...S}><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
export const IconChevronLeft = () => <svg {...S}><polyline points="15 18 9 12 15 6"/></svg>;
export const IconChevronRight= () => <svg {...S}><polyline points="9 18 15 12 9 6"/></svg>;
export const IconLogOut      = () => <svg {...S}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>;

// ── Types ─────────────────────────────────────────────────────────────────────
export interface NavItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

interface Props {
  sectionTitle: string;
  navItems: NavItem[];
  activeTab: string;
  onTabChange: (key: string) => void;
  userEmail: string;
  children: React.ReactNode;
}

// ── Layout ────────────────────────────────────────────────────────────────────
export default function DashLayout({
  sectionTitle, navItems, activeTab, onTabChange, userEmail, children,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="dash-page">
      {/* Top bar */}
      <header className="dash-topbar">
        <Link href="/" className="dash-topbar-brand">
          <div className="brand-mark" />
          {!collapsed && <span className="dash-topbar-wordmark">屋頂日光</span>}
        </Link>
        <div className="dash-topbar-sep" />
        <span className="dash-topbar-section">{sectionTitle}</span>
        <div className="dash-topbar-right">
          <span className="dash-topbar-email">{userEmail}</span>
          <Link href="/" className="dash-back-btn">
            <IconHome />
            <span>返回首頁</span>
          </Link>
        </div>
      </header>

      <div className="dash-body">
        {/* Sidebar */}
        <nav className={`dash-sidebar${collapsed ? ' dash-sidebar--collapsed' : ''}`}>
          <div className="dash-nav-list">
            {/* Header row: label + collapse toggle on same line */}
            <div className="dash-nav-header">
              {!collapsed && <span className="dash-nav-section-label">選單</span>}
              <button
                className="dash-collapse-btn"
                onClick={() => setCollapsed(c => !c)}
                title={collapsed ? '展開選單' : '收起選單'}
              >
                {collapsed ? <IconChevronRight /> : <IconChevronLeft />}
              </button>
            </div>

            {navItems.map(item => (
              <button
                key={item.key}
                className={`dash-nav-btn${activeTab === item.key ? ' dash-nav-btn--active' : ''}`}
                onClick={() => onTabChange(item.key)}
                title={collapsed ? item.label : undefined}
              >
                <span className="dash-nav-btn-icon">{item.icon}</span>
                {!collapsed && (
                  <span className="dash-nav-btn-label">{item.label}</span>
                )}
                {!collapsed && item.badge != null && item.badge > 0 && (
                  <span className="dash-nav-badge">{item.badge}</span>
                )}
                {collapsed && item.badge != null && item.badge > 0 && (
                  <span className="dash-nav-badge dash-nav-badge--dot" />
                )}
              </button>
            ))}
          </div>
        </nav>

        {/* Content */}
        <main className="dash-content">
          {children}
        </main>
      </div>
    </div>
  );
}
