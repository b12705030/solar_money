'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Star } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import type { UserInquiry, InquiryMessage } from '@/lib/types';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

function VendorAvatar({ name, logo }: { name: string; logo: string | null }) {
  if (logo) return <img src={logo} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} alt="" />;
  return (
    <div style={{
      width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
      background: 'var(--green-700)', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 15, fontWeight: 700,
    }}>{name[0]}</div>
  );
}

function StarDisplay({ rating, comment }: { rating: number; comment: string | null }) {
  return (
    <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'var(--green-50)', border: '1px solid var(--green-200)', fontSize: 13 }}>
      <span style={{ display: 'inline-flex', gap: 1, top: 2, position: 'relative' }}>
        {[1,2,3,4,5].map(n => (
          <Star key={n} size={13} strokeWidth={1.5}
            fill={n <= rating ? '#f59e0b' : 'none'}
            color={n <= rating ? '#f59e0b' : '#d1d5db'} />
        ))}
      </span>
      {comment && <span style={{ marginLeft: 8, color: 'var(--ink-600)' }}>{comment}</span>}
    </div>
  );
}

export default function UserInbox({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [inquiries, setInquiries] = useState<UserInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<UserInquiry | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const authHeader = `Bearer ${user?.token ?? ''}`;

  const fetchInquiries = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch(`${API}/api/me/inquiries`, { headers: { Authorization: authHeader } });
      if (res.ok) {
        const data: UserInquiry[] = await res.json();
        setInquiries(data);
        setSelected(prev => prev ? (data.find(i => i.id === prev.id) ?? data[0] ?? null) : (data[0] ?? null));
      }
    } finally {
      setLoading(false);
    }
  }, [user, authHeader]);

  useEffect(() => { fetchInquiries(); }, [fetchInquiries]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selected?.messages?.length]);

  const sendMessage = async () => {
    if (!input.trim() || !selected) return;
    setSending(true);
    try {
      const res = await fetch(`${API}/api/me/inquiries/${selected.id}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ content: input.trim() }),
      });
      if (res.ok) {
        const msg: InquiryMessage = await res.json();
        setInquiries(prev => prev.map(i =>
          i.id === selected.id ? { ...i, messages: [...i.messages, msg] } : i
        ));
        setSelected(prev => prev ? { ...prev, messages: [...prev.messages, msg] } : prev);
        setInput('');
      }
    } finally {
      setSending(false);
    }
  };

  const submitReview = async () => {
    if (!selected || reviewRating === 0) return;
    setReviewSubmitting(true);
    try {
      const res = await fetch(`${API}/api/me/inquiries/${selected.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ vendor_id: selected.vendorId, rating: reviewRating, comment: reviewComment.trim() || null }),
      });
      if (res.ok) {
        const update = { reviewId: 'done', reviewRating, reviewComment: reviewComment.trim() || null };
        setInquiries(prev => prev.map(i => i.id === selected.id ? { ...i, ...update } : i));
        setSelected(prev => prev ? { ...prev, ...update } : prev);
        setReviewOpen(false);
        setReviewRating(0);
        setReviewComment('');
      }
    } finally {
      setReviewSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendMessage(); }
  };

  const unread = (inq: UserInquiry) => {
    const msgs = inq.messages;
    return msgs.length > 0 && msgs[msgs.length - 1].sender === 'vendor' && !inq.reviewId;
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        style={{ width: '90vw', maxWidth: 860, height: '82vh', padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 12 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header" style={{ padding: '16px 20px', borderBottom: '1px solid var(--ink-100)', flexShrink: 0 }}>
          <div className="modal-title">詢價收件箱</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-400)' }}>載入中⋯</div>
        ) : inquiries.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-400)', fontSize: 14 }}>尚無詢價紀錄</div>
        ) : (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Left: vendor list */}
            <div style={{ width: 220, flexShrink: 0, borderRight: '1px solid var(--ink-100)', overflowY: 'auto' }}>
              {inquiries.map(inq => {
                const active = selected?.id === inq.id;
                const hasUnread = unread(inq);
                return (
                  <div
                    key={inq.id}
                    onClick={() => setSelected(inq)}
                    style={{
                      padding: '12px 16px', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center',
                      background: active ? 'var(--green-50)' : 'transparent',
                      borderLeft: active ? '3px solid var(--green-700)' : '3px solid transparent',
                    }}
                  >
                    <VendorAvatar name={inq.vendorName} logo={inq.vendorLogo} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inq.vendorName}</span>
                        {hasUnread && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green-700)', flexShrink: 0 }} />}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 2 }}>
                        {new Date(inq.createdAt).toLocaleDateString('zh-TW')}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Right: chat */}
            {selected && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* Chat header */}
                <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--ink-100)', flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{selected.vendorName}</span>
                    {selected.vendorRating > 0 && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, flexShrink: 0 }}>
                        <span style={{ display: 'inline-flex', gap: 1 }}>
                          {[1,2,3,4,5].map(n => (
                            <Star key={n} size={11} strokeWidth={1.5}
                              fill={n <= Math.round(selected.vendorRating) ? '#f59e0b' : 'none'}
                              color={n <= Math.round(selected.vendorRating) ? '#f59e0b' : '#d1d5db'} />
                          ))}
                        </span>
                        <span style={{ fontWeight: 600, color: '#f59e0b' }}>{selected.vendorRating.toFixed(1)}</span>
                        {selected.vendorReviewCount > 0 && <span style={{ color: 'var(--ink-400)' }}>（{selected.vendorReviewCount} 則評價）</span>}
                      </span>
                    )}
                  </div>
                  <div className="inq-house-chips" style={{ marginTop: 6 }}>
                    {selected.address && <span>{selected.address}</span>}
                    {selected.capacityKw > 0 && <span>{selected.capacityKw} kWp</span>}
                    {selected.annualKwh > 0 && <span>{Math.round(selected.annualKwh).toLocaleString()} kWh/年</span>}
                    {selected.paybackYears > 0 && <span>回本 {selected.paybackYears.toFixed(1)} 年</span>}
                  </div>
                  {selected.messages.some(m => m.sender === 'vendor') && !selected.reviewId && (
                    <button
                      className="btn-outline-sm"
                      onClick={() => setReviewOpen(v => !v)}
                      style={{ marginTop: 6 }}
                    >
                      <Star size={13} strokeWidth={1.5} style={{ position: 'relative', top: 1.5, marginRight: 4 }} /> 為廠商評分
                    </button>
                  )}
                  {reviewOpen && (
                    <div style={{ marginTop: 12, padding: '14px 16px', background: 'var(--green-50)', borderRadius: 10, border: '1px solid var(--green-200)' }}>
                      <div style={{ display: 'flex', gap: 2, marginBottom: 10 }}>
                        {[1,2,3,4,5].map(n => (
                          <button key={n} onClick={() => setReviewRating(n)} style={{
                            background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px',
                            transition: 'transform 0.12s',
                            transform: n <= reviewRating ? 'scale(1.15)' : 'scale(1)',
                            lineHeight: 1, display: 'flex',
                          }}>
                            <Star size={20} strokeWidth={1.5}
                              fill={n <= reviewRating ? '#f59e0b' : 'none'}
                              color={n <= reviewRating ? '#f59e0b' : '#d1d5db'} />
                          </button>
                        ))}
                      </div>
                      <input
                        value={reviewComment}
                        onChange={e => setReviewComment(e.target.value)}
                        placeholder="(選填) 留下你的評價..."
                        style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--green-200)', fontSize: 13, boxSizing: 'border-box', background: '#fff', outline: 'none' }}
                      />
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button
                          className="btn btn-primary"
                          disabled={reviewRating === 0 || reviewSubmitting}
                          onClick={submitReview}
                          style={{ fontSize: 13, padding: '8px 20px', borderRadius: 8 }}
                        >
                          {reviewSubmitting ? '送出中⋯' : '送出評價'}
                        </button>
                        <button className="btn-ghost" onClick={() => setReviewOpen(false)} style={{ fontSize: 13 }}>取消</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Messages */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {selected.messages.map(msg => {
                    const isUser = msg.sender === 'user';
                    return (
                      <div key={msg.id} style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', gap: 8, alignItems: 'flex-end' }}>
                        {!isUser && <VendorAvatar name={selected.vendorName} logo={selected.vendorLogo} />}
                        <div style={{ maxWidth: '70%' }}>
                          <div style={{
                            padding: '10px 14px', borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                            background: isUser ? 'var(--green-700)' : 'var(--green-100)',
                            color: isUser ? '#fff' : 'var(--green-900)',
                            fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap',
                          }}>{msg.content}</div>
                          <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 3, textAlign: isUser ? 'right' : 'left' }}>
                            {new Date(msg.createdAt).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {selected.reviewId && selected.reviewRating && (
                    <StarDisplay rating={selected.reviewRating} comment={selected.reviewComment} />
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="inq-input-area">
                  <textarea
                    className="inq-textarea form-input"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="輸入訊息… (Ctrl+Enter 送出)"
                  />
                  <button
                    className="btn btn-primary"
                    onClick={sendMessage}
                    disabled={sending || !input.trim()}
                    style={{ flexShrink: 0, alignSelf: 'center', borderRadius: 12, fontSize: 13, padding: '12px 16px' }}
                  >
                    {sending ? '送出中⋯' : '送出'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
