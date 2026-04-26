'use client';

interface TopBarProps {
  onHome?:         () => void;
  onLoginClick?:   () => void;
  onHistoryClick?: () => void;
  onVendorApplyClick?: () => void;
  user?:           { email: string } | null;
  onLogout?:       () => void;
}

export default function TopBar({ onHome, onLoginClick, onHistoryClick, onVendorApplyClick, user, onLogout }: TopBarProps) {
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
        <button className="btn-outline-sm" onClick={onVendorApplyClick}>廠商入駐</button>

        {user ? (
          <>
            <button className="btn-outline-sm" onClick={onHistoryClick}>歷史紀錄</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="avatar">{user.email[0].toUpperCase()}</div>
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
