'use client';
import { useEffect, useRef } from 'react';

export default function Footer() {
  const copyrightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = copyrightRef.current;
    if (!el) return;

    const fit = () => {
      el.style.fontSize = '';

      if (window.innerWidth > 768) return;

      const parent = el.parentElement!;
      const ps = getComputedStyle(parent);
      const available = parent.clientWidth
        - Number.parseFloat(ps.paddingLeft)
        - Number.parseFloat(ps.paddingRight);
      if (available <= 0) return;

      // 用 off-screen span 量自然文字寬度，避免受容器限制
      const probe = document.createElement('span');
      probe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;white-space:nowrap;visibility:hidden;pointer-events:none;';
      probe.style.font = getComputedStyle(el).font;
      probe.textContent = el.textContent;
      document.body.appendChild(probe);
      const textWidth = probe.offsetWidth;
      document.body.removeChild(probe);

      if (textWidth === 0) return;

      const currentSize = Number.parseFloat(getComputedStyle(el).fontSize);
      el.style.fontSize = `${currentSize * (available / textWidth) * 0.97}px`;
    };

    // 等第一幀 paint 後再量，確保 layout 穩定
    requestAnimationFrame(fit);
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  return (
    <footer className="footer">
      <div ref={copyrightRef} className="footer-copyright">
        © 2026 屋頂日光 · 評估結果僅供參考，實際發電量以廠商實勘為準
      </div>
      <div className="footer-links">
        <a href="#" style={{ color: 'inherit' }}>關於</a>
        <a href="#" style={{ color: 'inherit' }}>常見問題</a>
        <a href="#" style={{ color: 'inherit' }}>資料授權</a>
      </div>
    </footer>
  );
}
