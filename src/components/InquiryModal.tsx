'use client';
import { useState } from 'react';
import type { VendorRecommendation, SolarState, ComputedResults } from '@/lib/types';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

interface Props {
  vendor: VendorRecommendation;
  state: SolarState;
  results: ComputedResults;
  token: string;
  onClose: () => void;
  onSent: () => void;
}

export default function InquiryModal({ vendor, state, results, token, onClose, onSent }: Props) {
  const [message, setMessage] = useState(
    `廠商您好，我想詢問貴公司的太陽能安裝服務。\n\n以下是我的基本資訊，麻煩提供報價與勘查安排，謝謝！`
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/vendors/${vendor.id}/inquire`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          address: state.address?.label ?? null,
          county: state.county ?? null,
          capacity_kw: state.capacity ?? null,
          annual_kwh: results.annualKwh,
          payback_years: results.paybackYears,
          message: message.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? '送出失敗');
      }
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : '送出失敗，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal inquiry-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">聯絡廠商</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={send} className="inquiry-modal-body">
          {/* Vendor & assessment summary */}
          <div className="inquiry-vendor-row">
            <div className="inquiry-vendor-name">{vendor.name}</div>
            <div className="inquiry-vendor-meta">{vendor.phone} · {vendor.email}</div>
          </div>

          <div className="inquiry-summary">
            {state.address?.label && (
              <div className="inquiry-summary-row">
                <span>地址</span>
                <span>{state.address.label}</span>
              </div>
            )}
            {state.county && (
              <div className="inquiry-summary-row">
                <span>縣市</span>
                <span>{state.county}</span>
              </div>
            )}
            {state.capacity != null && (
              <div className="inquiry-summary-row">
                <span>預估容量</span>
                <span>{state.capacity} kWp</span>
              </div>
            )}
            <div className="inquiry-summary-row">
              <span>年發電量</span>
              <span>{results.annualKwh.toLocaleString()} kWh</span>
            </div>
            <div className="inquiry-summary-row">
              <span>回本年限</span>
              <span>{results.paybackYears} 年</span>
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">補充說明</label>
            <textarea
              className="form-input inquiry-message"
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={5}
            />
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="inquiry-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>取消</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? '送出中⋯' : '送出詢價'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
