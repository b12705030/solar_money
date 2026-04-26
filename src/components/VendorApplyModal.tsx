'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { SUBSIDIES } from '@/lib/constants';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
const COUNTIES = Object.keys(SUBSIDIES);

interface Props {
  onClose: () => void;
  onLoginClick?: () => void;
}

type AppStatus = 'none' | 'pending' | 'approved' | 'rejected';

interface StatusResult {
  status: AppStatus;
  rejectionReason: string | null;
}

export default function VendorApplyModal({ onClose, onLoginClick }: Props) {
  const { user } = useAuth();
  const [appStatus, setAppStatus] = useState<StatusResult | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [companyTaxId, setCompanyTaxId] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [counties, setCounties] = useState<string[]>([]);
  const [licenseNote, setLicenseNote] = useState('');
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!user) return;
    setStatusLoading(true);
    fetch(`${API}/api/me/application/status`, {
      headers: { Authorization: `Bearer ${user.token}` },
    })
      .then(r => r.json())
      .then((data: StatusResult) => setAppStatus(data))
      .catch(() => setAppStatus({ status: 'none', rejectionReason: null }))
      .finally(() => setStatusLoading(false));
  }, [user]);

  const toggleCounty = (county: string) => {
    setCounties(prev =>
      prev.includes(county) ? prev.filter(item => item !== county) : [...prev, county],
    );
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setLogoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/vendors/apply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({
          company_name: companyName,
          company_tax_id: companyTaxId || null,
          contact_name: contactName,
          email: user.email,
          phone,
          counties,
          license_note: licenseNote || null,
          logo_url: logoPreview || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ detail: '申請送出失敗' }));
        throw new Error(data.detail ?? '申請送出失敗');
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '申請送出失敗，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  const isReApply = appStatus?.status === 'rejected';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal vendor-apply-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">廠商入駐申請</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {/* 未登入 */}
        {!user ? (
          <div className="vendor-apply-login-required">
            <div className="vendor-apply-login-icon">🏢</div>
            <div className="vendor-apply-login-title">請先登入帳號</div>
            <div className="body-sm">廠商入駐需要先有帳號，審核通過後才能使用廠商後台管理服務。</div>
            <div className="vendor-apply-login-actions">
              <button className="btn btn-primary" onClick={() => { onClose(); onLoginClick?.(); }}>
                登入 / 註冊
              </button>
              <button className="btn-ghost" onClick={onClose}>稍後再說</button>
            </div>
          </div>

        /* 狀態載入中 */
        ) : statusLoading ? (
          <div className="vendor-apply-status-loading">查詢申請狀態中⋯</div>

        /* 已送出（pending） */
        ) : appStatus?.status === 'pending' ? (
          <div className="vendor-apply-success">
            <div className="vendor-apply-success-title">申請審核中</div>
            <div className="body-sm">您的入駐申請已送出，平台審核通過後廠商帳號才會啟用。</div>
            <button className="btn btn-primary" onClick={onClose}>關閉</button>
          </div>

        /* 已核准 */
        ) : appStatus?.status === 'approved' ? (
          <div className="vendor-apply-success">
            <div className="vendor-apply-success-title">您已是認證廠商</div>
            <div className="body-sm">帳號已通過審核，請登入廠商後台管理您的資料與詢價。</div>
            <button className="btn btn-primary" onClick={onClose}>關閉</button>
          </div>

        /* 完成送出（剛送出） */
        ) : submitted ? (
          <div className="vendor-apply-success">
            <div className="vendor-apply-success-title">{isReApply ? '重新申請已送出' : '申請已送出'}</div>
            <div className="body-sm">平台審核通過後，廠商資料才會公開顯示於推薦列表。</div>
            <button className="btn btn-primary" onClick={onClose}>完成</button>
          </div>

        /* 申請表單（新申請 or 被駁回後重新申請） */
        ) : (
          <form onSubmit={submit} className="vendor-apply-form">
            {isReApply && (
              <div className="vendor-apply-rejected-notice">
                <strong>上次申請已被駁回</strong>
                {appStatus.rejectionReason && (
                  <div className="body-sm" style={{ marginTop: 4 }}>駁回原因：{appStatus.rejectionReason}</div>
                )}
                <div className="body-sm" style={{ marginTop: 4 }}>您可修改資料後重新送出申請。</div>
              </div>
            )}

            {/* 帳號 Email（唯讀） */}
            <div className="form-field">
              <label className="form-label">帳號 Email</label>
              <div className="vendor-apply-email-display">{user.email}</div>
            </div>

            {/* Logo upload */}
            <div className="form-field">
              <label className="form-label">
                公司 Logo
                <span className="form-label-opt">選填</span>
              </label>
              <div className="vendor-apply-logo-row">
                <label className="vendor-apply-logo-upload">
                  {logoPreview ? (
                    <img src={logoPreview} className="vendor-apply-logo-preview" alt="logo 預覽" />
                  ) : (
                    <div className="vendor-apply-logo-placeholder">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                      </svg>
                      <span>上傳圖片</span>
                      <span className="vendor-apply-logo-hint">JPG / PNG</span>
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleLogoChange}
                    style={{ display: 'none' }}
                  />
                </label>
                {logoPreview && (
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ fontSize: 13, padding: '4px 10px' }}
                    onClick={() => setLogoPreview(null)}
                  >
                    重新選擇
                  </button>
                )}
              </div>
            </div>

            <div className="form-field">
              <label className="form-label">公司名稱</label>
              <input className="form-input" required value={companyName} onChange={e => setCompanyName(e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">
                統一編號
                <span className="form-label-opt">選填</span>
              </label>
              <input className="form-input" value={companyTaxId} onChange={e => setCompanyTaxId(e.target.value)} />
            </div>
            <div className="vendor-apply-grid">
              <div className="form-field">
                <label className="form-label">聯絡人</label>
                <input className="form-input" required value={contactName} onChange={e => setContactName(e.target.value)} />
              </div>
              <div className="form-field">
                <label className="form-label">電話</label>
                <input className="form-input" required value={phone} onChange={e => setPhone(e.target.value)} />
              </div>
            </div>
            <div className="form-field">
              <label className="form-label">服務縣市</label>
              <div className="county-chip-grid">
                {COUNTIES.map(county => (
                  <label key={county} className={`county-chip${counties.includes(county) ? ' county-chip--selected' : ''}`}>
                    <input type="checkbox" checked={counties.includes(county)} onChange={() => toggleCounty(county)} />
                    {county}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-field">
              <label className="form-label">
                相關執照 / 備註
                <span className="form-label-opt">選填</span>
              </label>
              <textarea className="form-input vendor-apply-textarea" value={licenseNote} onChange={e => setLicenseNote(e.target.value)} />
            </div>

            {error && <div className="form-error">{error}</div>}

            <button className="btn btn-primary" disabled={loading} type="submit">
              {loading ? '送出中⋯' : isReApply ? '重新送出申請' : '送出申請'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
