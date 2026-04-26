'use client';
import { useState } from 'react';
import { SUBSIDIES } from '@/lib/constants';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
const COUNTIES = Object.keys(SUBSIDIES);

export default function VendorApplyModal({ onClose }: { onClose: () => void }) {
  const [companyName, setCompanyName] = useState('');
  const [companyTaxId, setCompanyTaxId] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [counties, setCounties] = useState<string[]>([]);
  const [licenseNote, setLicenseNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const toggleCounty = (county: string) => {
    setCounties(prev =>
      prev.includes(county) ? prev.filter(item => item !== county) : [...prev, county],
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/vendors/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: companyName,
          company_tax_id: companyTaxId || null,
          contact_name: contactName,
          email,
          phone,
          counties,
          license_note: licenseNote || null,
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal vendor-apply-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">廠商入駐申請</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {submitted ? (
          <div className="vendor-apply-success">
            <div className="vendor-apply-success-title">申請已送出</div>
            <div className="body-sm">平台審核通過後，廠商資料才會公開顯示於推薦列表。</div>
            <button className="btn btn-primary" onClick={onClose}>完成</button>
          </div>
        ) : (
          <form onSubmit={submit} className="vendor-apply-form">
            <div className="form-field">
              <label className="form-label">公司名稱</label>
              <input className="form-input" required value={companyName} onChange={e => setCompanyName(e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">統一編號</label>
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
              <label className="form-label">Email</label>
              <input className="form-input" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
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
              <label className="form-label">相關執照 / 備註</label>
              <textarea className="form-input vendor-apply-textarea" value={licenseNote} onChange={e => setLicenseNote(e.target.value)} />
            </div>

            {error && <div className="form-error">{error}</div>}

            <button className="btn btn-primary" disabled={loading} type="submit">
              {loading ? '送出中⋯' : '送出申請'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
