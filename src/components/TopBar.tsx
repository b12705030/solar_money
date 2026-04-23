'use client';

export default function TopBar({ onHome }: { onHome?: () => void }) {
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
      </div>
    </div>
  );
}
