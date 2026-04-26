'use client';
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

type Tab = 'login' | 'register';

export default function AuthModal({ onClose }: { onClose: () => void }) {
  const { login, register } = useAuth();
  const [tab, setTab] = useState<Tab>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (tab === 'login') await login(email, password);
      else await register(email, password);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '發生錯誤，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>

        <div className="modal-header">
          <div className="modal-title">
            <div className="brand-mark" />
            {tab === 'login' ? '登入帳號' : '建立帳號'}
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="tab-switcher">
          {(['login', 'register'] as Tab[]).map(t => (
            <button
              key={t}
              className={`tab-btn${tab === t ? ' active' : ''}`}
              onClick={() => { setTab(t); setError(''); }}
            >
              {t === 'login' ? '登入' : '註冊'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-field">
            <label className="form-label">Email</label>
            <input
              className="form-input"
              type="email" required value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
            />
          </div>
          <div className="form-field">
            <label className="form-label">
              密碼
              {tab === 'register' && <span className="hint">（至少 8 字元）</span>}
            </label>
            <input
              className="form-input"
              type="password" required value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {error && <div className="form-error">{error}</div>}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ marginTop: 4, width: '100%', borderRadius: 8 }}
          >
            {loading ? '處理中⋯' : tab === 'login' ? '登入' : '建立帳號'}
          </button>
        </form>

        <div style={{ marginTop: 18, textAlign: 'center' }} className="caption">
          登入即同意本站服務條款與隱私政策
        </div>
      </div>
    </div>
  );
}
