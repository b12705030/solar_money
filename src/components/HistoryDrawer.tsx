'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

interface Assessment {
  id: string;
  address: string | null;
  county: string | null;
  annual_kwh: number | null;
  payback_years: number | null;
  out_of_pocket: number | null;
  capacity_kw: number | null;
  created_at: string;
}

const COMPARE_ROWS: { key: keyof Assessment; label: string; fmt: (v: unknown) => string }[] = [
  { key: 'address',      label: '地址',     fmt: v => (v as string) ?? '—' },
  { key: 'county',       label: '縣市',     fmt: v => (v as string) ?? '—' },
  { key: 'capacity_kw',  label: '裝機容量', fmt: v => v != null ? `${v} kWp` : '—' },
  { key: 'annual_kwh',   label: '年發電量', fmt: v => v != null ? `${(v as number).toLocaleString()} kWh` : '—' },
  { key: 'payback_years',label: '回本年限', fmt: v => v != null ? `${v} 年` : '—' },
  { key: 'out_of_pocket',label: '實際自付', fmt: v => v != null ? `NT$ ${(v as number).toLocaleString()}` : '—' },
];

export default function HistoryDrawer({ onClose }: { onClose: () => void }) {
  const { user, logout } = useAuth();
  const [list, setList] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    if (!user) return;
    fetch(`${API}/api/me/assessments`, {
      headers: { Authorization: `Bearer ${user.token}` },
    })
      .then(r => {
        if (r.status === 401) {
          logout();
          return [];
        }
        return r.json();
      })
      .then((data: unknown) => setList(Array.isArray(data) ? data as Assessment[] : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [logout, user]);

  const toggleSelect = (id: string) =>
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 2 ? [...prev, id] : prev,
    );

  const compareItems = list.filter(a => selected.includes(a.id));

  return (
    <div className="drawer">
      {/* Header */}
      <div className="drawer-header">
        <div>
          <div className="drawer-title">歷史評估紀錄</div>
          <div className="drawer-subtitle">{user?.email}</div>
        </div>
        <button className="modal-close" onClick={onClose}>×</button>
      </div>

      {/* Compare action bar */}
      {selected.length > 0 && (
        <div className="drawer-compare-bar">
          <span className="body-sm" style={{ color: 'var(--green-700)', fontWeight: 500 }}>
            已選 {selected.length} / 2 筆
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {selected.length === 2 && (
              <button className="btn btn-primary" style={{ padding: '5px 14px', fontSize: 12, borderRadius: 6 }} onClick={() => setComparing(true)}>
                並排比較
              </button>
            )}
            <button className="btn-ghost" style={{ padding: '5px 12px', fontSize: 12 }} onClick={() => setSelected([])}>
              清除
            </button>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="drawer-body">
        {loading && <div className="drawer-empty">載入中⋯</div>}

        {!loading && list.length === 0 && (
          <div className="drawer-empty">
            尚無評估紀錄<br />
            <span className="caption">完成評估後會自動儲存</span>
          </div>
        )}

        {/* Assessment list */}
        {!loading && !comparing && list.map(a => {
          const isSelected = selected.includes(a.id);
          const date = new Date(a.created_at).toLocaleDateString('zh-TW', { year: 'numeric', month: 'short', day: 'numeric' });
          return (
            <div
              key={a.id}
              className={`assessment-card${isSelected ? ' assessment-card--selected' : ''}`}
              onClick={() => toggleSelect(a.id)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div className="assessment-card-title" style={{ flex: 1, paddingRight: 8 }}>
                  {a.address ?? '未知地址'}
                </div>
                <span className="caption" style={{ flexShrink: 0 }}>{date}</span>
              </div>
              <div className="assessment-card-meta">
                {a.capacity_kw  != null && <span>{a.capacity_kw} kWp</span>}
                {a.payback_years != null && <span>回本 {a.payback_years} 年</span>}
                {a.out_of_pocket != null && <span>自付 NT$ {Math.round(a.out_of_pocket / 10000)} 萬</span>}
              </div>
            </div>
          );
        })}

        {/* Side-by-side comparison */}
        {comparing && compareItems.length === 2 && (
          <div>
            <button
              className="btn-ghost"
              style={{ padding: '0 0 16px', fontSize: 13, color: 'var(--green-700)' }}
              onClick={() => setComparing(false)}
            >
              ← 返回列表
            </button>
            <table className="compare-table">
              <thead>
                <tr>
                  <th />
                  {compareItems.map(a => (
                    <th key={a.id}>
                      {new Date(a.created_at).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' })}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map(({ key, label, fmt }) => (
                  <tr key={key}>
                    <td>{label}</td>
                    {compareItems.map(a => <td key={a.id}>{fmt(a[key])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
