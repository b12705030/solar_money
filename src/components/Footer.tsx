export default function Footer() {
  return (
    <footer style={{
      borderTop: '1px solid var(--ink-100)',
      padding: '24px 40px',
      display: 'flex', justifyContent: 'space-between',
      fontSize: 12, color: 'var(--ink-500)',
      maxWidth: 1400, margin: '0 auto', width: '100%',
    }}>
      <div>© 2026 屋頂日光 · 評估結果僅供參考，實際發電量以廠商實勘為準</div>
      <div style={{ display: 'flex', gap: 20 }}>
        <a href="#" style={{ color: 'inherit' }}>關於</a>
        <a href="#" style={{ color: 'inherit' }}>常見問題</a>
        <a href="#" style={{ color: 'inherit' }}>資料授權</a>
      </div>
    </footer>
  );
}
