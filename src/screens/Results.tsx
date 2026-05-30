'use client';
import { useState, useMemo, useEffect, useRef } from 'react';
import { MapPin } from 'lucide-react';
import { Info } from '@/components/ui';
import { computeResults } from '@/lib/compute';
import PrintReport from '@/components/PrintReport';
import { useAuth } from '@/contexts/AuthContext';
import InquiryModal from '@/components/InquiryModal';
import type { SolarState, ComputedResults, VendorDetail, VendorRecommendation, RegionPotential } from '@/lib/types';
import { TW_IRRADIANCE, DEFAULT_TEMP, DEFAULT_WIND } from '@/lib/constants';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

function getUserId(): string {
  const key = 'solar_user_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

const MONTHS = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

function MonthlyChart({ data, highlight }: { data: number[]; highlight?: string }) {
  const max = Math.max(...data);
  const highlightIdx = highlight === 'summer' ? [5, 6, 7] : highlight === 'winter' ? [11, 0, 1] : [];

  return (
    <div>
      <div className="monthly-chart-bars">
        {data.map((v, i) => {
          const h = (v / max) * 100;
          const hl = highlightIdx.includes(i);
          return (
            <div key={i} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%' }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', width: '100%' }}>
                <div style={{
                  width: '100%', height: `${h}%`,
                  background: hl
                    ? 'linear-gradient(180deg, #E8A53C 0%, #C8861E 100%)'
                    : 'linear-gradient(180deg, var(--green-500) 0%, var(--green-700) 100%)',
                  borderRadius: '6px 6px 0 0',
                  position: 'relative', transition: 'height 0.8s var(--ease-out)',
                  boxShadow: hl ? '0 2px 8px rgba(232,165,60,0.3)' : 'none',
                }}>
                  {v === max && (
                    <div className="num" style={{
                      position: 'absolute', top: -22, left: '50%', transform: 'translateX(-50%)',
                      fontSize: 11, fontWeight: 700,
                      color: hl ? '#8B5A10' : 'var(--green-900)', whiteSpace: 'nowrap',
                    }}>{v.toLocaleString()}</div>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-500)', fontFamily: 'var(--font-num)' }}>{MONTHS[i]}</div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--ink-100)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-500)' }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--green-700)' }} />
          月發電量 (kWh)
        </div>
        {highlightIdx.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-500)' }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: '#E8A53C' }} />
            優化目標月份
          </div>
        )}
      </div>
    </div>
  );
}

function RevenueChart({ annualRevenue, outOfPocket, paybackYears }: { annualRevenue: number; outOfPocket: number; paybackYears: number }) {
  const years = 20;
  const points = Array.from({ length: years + 1 }, (_, y) => {
    const revenue = Array.from({ length: y }, (_, i) => annualRevenue * Math.pow(0.995, i)).reduce((a, b) => a + b, 0);
    return { y, net: revenue - outOfPocket };
  });
  const maxNet = points[points.length - 1].net;
  const minNet = -outOfPocket;
  const range = maxNet - minNet;

  const W = 600, H = 200, PAD = 20;
  const px = (y: number) => PAD + (y / years) * (W - PAD * 2);
  const py = (net: number) => H - PAD - ((net - minNet) / range) * (H - PAD * 2);
  const zeroY = py(0);

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(p.y)} ${py(p.net)}`).join(' ');
  const areaD = `${pathD} L ${px(years)} ${zeroY} L ${px(0)} ${zeroY} Z`;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 220 }}>
        <defs>
          <linearGradient id="revGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#40916C" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#40916C" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="var(--ink-200)" strokeDasharray="4 4" />
        <text x={PAD} y={zeroY - 4} fontSize="10" fill="var(--ink-400)" fontFamily="var(--font-num)">收支平衡</text>
        <path d={areaD} fill="url(#revGrad)" />
        <path d={pathD} stroke="var(--green-700)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <line x1={px(paybackYears)} y1={PAD} x2={px(paybackYears)} y2={H - PAD} stroke="#E8A53C" strokeWidth="1.5" strokeDasharray="2 3" />
        <circle cx={px(paybackYears)} cy={zeroY} r="6" fill="#E8A53C" stroke="white" strokeWidth="2" />
        <text x={px(paybackYears)} y={PAD - 4} fontSize="11" fill="#8B5A10" fontFamily="var(--font-num)" fontWeight="600" textAnchor="middle">
          ▼ {paybackYears} 年回本
        </text>
        <circle cx={px(years)} cy={py(maxNet)} r="5" fill="var(--green-700)" stroke="white" strokeWidth="2" />
        <text x={px(years) - 6} y={py(maxNet) - 10} fontSize="11" fill="var(--green-900)" fontFamily="var(--font-num)" fontWeight="600" textAnchor="end">
          +NT$ {Math.round(maxNet / 1000)}K
        </text>
        {[0, 5, 10, 15, 20].map(y => (
          <text key={y} x={px(y)} y={H - 4} fontSize="10" fill="var(--ink-400)" textAnchor="middle" fontFamily="var(--font-num)">{y} 年</text>
        ))}
      </svg>
    </div>
  );
}

function BreakdownRow({ label, value, color, max }: { label: string; value: number; color: string; max: number }) {
  const pct = Math.abs(value) / max * 100;
  const isNegative = value < 0;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="body-sm" style={{ color: 'var(--ink-700)' }}>{label}</span>
        <span className="num" style={{ fontSize: 15, fontWeight: 600, color: isNegative ? 'var(--green-700)' : 'var(--ink-900)' }}>
          {isNegative ? '−' : ''}NT$ {Math.abs(value).toLocaleString()}
        </span>
      </div>
      <div style={{ height: 6, background: 'var(--ink-100)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, transition: 'width 0.8s' }} />
      </div>
    </div>
  );
}

function VendorCard({
  vendor,
  onContact,
  onDetail,
}: {
  vendor: VendorRecommendation;
  onContact: (vendor: VendorRecommendation) => void;
  onDetail: (vendor: VendorRecommendation) => void;
}) {
  return (
    <div className="vendor-card">
      <div className="vendor-card-header">
        <div>
          <div className="vendor-card-name">{vendor.name}</div>
          <div className="vendor-card-meta">{vendor.portfolioMeta}</div>
        </div>
        <div className="vendor-card-rating">
          <span>★</span>
          {vendor.rating.toFixed(1)}
        </div>
      </div>
      <div className="vendor-card-portfolio">{vendor.portfolioTitle}</div>
      <div className="vendor-card-stats">
        <div>
          <span className="caption">案例容量</span>
          <strong>{vendor.capacityKw} kWp</strong>
        </div>
        <div>
          <span className="caption">評價數</span>
          <strong>{vendor.reviewCount} 則</strong>
        </div>
      </div>
      <div className="vendor-card-tags">
        {vendor.tags.map(tag => <span key={tag}>{tag}</span>)}
      </div>
      <div className="vendor-card-contact">
        <div>
          <div>{vendor.phone}</div>
          <div>{vendor.email}</div>
        </div>
        <div className="vendor-card-actions">
          <button className="btn-ghost vendor-detail-btn" onClick={() => onDetail(vendor)}>
            查看詳情
          </button>
          <button className="btn btn-primary vendor-contact-btn" onClick={() => onContact(vendor)}>
            聯絡廠商
          </button>
        </div>
      </div>
    </div>
  );
}

function VendorDetailModal({
  vendor,
  loading,
  error,
  onClose,
  onContact,
}: {
  vendor: VendorDetail | null;
  loading: boolean;
  error: boolean;
  onClose: () => void;
  onContact: (vendor: VendorRecommendation) => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal vendor-detail-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">廠商詳細資料</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {loading && <div className="vendor-state">載入廠商資料中⋯</div>}
        {!loading && error && <div className="vendor-state vendor-state--error">暫時無法載入廠商資料，請稍後再試。</div>}

        {!loading && !error && vendor && (
          <div className="vendor-detail-content">
            <div className="vendor-detail-hero">
              <div>
                <div className="vendor-detail-name">{vendor.name}</div>
                <div className="vendor-detail-meta">{vendor.counties.join('、')}</div>
              </div>
              <div className="vendor-card-rating">
                <span>★</span>
                {vendor.rating.toFixed(1)}
              </div>
            </div>

            <div className="vendor-card-tags">
              {vendor.tags.map(tag => <span key={tag}>{tag}</span>)}
            </div>

            <div className="vendor-detail-contact">
              <div>
                <span className="caption">電話</span>
                <strong>{vendor.phone || '尚未提供'}</strong>
              </div>
              <div>
                <span className="caption">Email</span>
                <strong>{vendor.email || '尚未提供'}</strong>
              </div>
              <div>
                <span className="caption">評價</span>
                <strong>{vendor.reviewCount} 則</strong>
              </div>
            </div>

            <div>
              <div className="vendor-detail-section-title">作品集</div>
              {vendor.portfolios.length === 0 && (
                <div className="vendor-state">此廠商尚未上傳作品集。</div>
              )}
              {vendor.portfolios.length > 0 && (
                <div className="vendor-portfolio-list">
                  {vendor.portfolios.map(portfolio => (
                    <div className="vendor-portfolio-item" key={portfolio.id}>
                      <div>
                        <div className="vendor-portfolio-title">{portfolio.title}</div>
                        <div className="vendor-card-meta">{portfolio.meta}</div>
                      </div>
                      <div className="vendor-portfolio-capacity">{portfolio.capacityKw} kWp</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="vendor-detail-footer">
              <button className="btn btn-secondary" onClick={onClose}>返回</button>
              <button className="btn btn-primary" onClick={() => onContact(vendor)}>聯絡廠商</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Results({ state, onRestart, onLoginClick }: { state: SolarState; onRestart: () => void; onLoginClick?: () => void }) {
  const { user } = useAuth();

  const [monthlyGhi,      setMonthlyGhi]      = useState<number[] | null>(null);
  const [monthlyTemp,     setMonthlyTemp]     = useState<number[] | null>(null);
  const [monthlyWind,     setMonthlyWind]     = useState<number[] | null>(null);
  const [monthlyHumidity, setMonthlyHumidity] = useState<number[] | null>(null);
  const [apiGoalAdj,      setApiGoalAdj]      = useState<number[] | null>(null);
  const [apiBestAngle,    setApiBestAngle]    = useState<number | null>(null);
  const [tiltLoading,     setTiltLoading]     = useState(!!(state.address?.lat && state.address?.lng));
  useEffect(() => {
    const lat = state.address?.lat;
    const lng = state.address?.lng;
    if (!lat || !lng) { setTiltLoading(false); return; }
    const goal = state.goal ?? 'annual';
    setTiltLoading(true);
    const monthlyUseParam = (goal === 'match' && state.monthlyUsage?.length === 12)
      ? `&monthly_use=${state.monthlyUsage.join(',')}`
      : '';
    fetch(`${API_URL}/api/township?lat=${lat}&lng=${lng}&goal=${goal}${monthlyUseParam}`)
      .then(res => res.ok ? res.json() : null)
      .then(d => {
        if (d?.monthly_ghi?.length      === 12) setMonthlyGhi(d.monthly_ghi);
        if (d?.monthly_temp?.length     === 12) setMonthlyTemp(d.monthly_temp);
        if (d?.monthly_wind?.length     === 12) setMonthlyWind(d.monthly_wind);
        if (d?.monthly_humidity?.length === 12) setMonthlyHumidity(d.monthly_humidity);
        if (Array.isArray(d?.goal_adj)  && d.goal_adj.length === 12) setApiGoalAdj(d.goal_adj);
        if (typeof d?.best_angle === 'number') setApiBestAngle(d.best_angle);
      })
      .catch(() => {})
      .finally(() => setTiltLoading(false));
  }, [state.address?.lat, state.address?.lng, state.goal]);

  const r: ComputedResults = useMemo(
    () => computeResults(
      state,
      monthlyGhi   ?? undefined,
      monthlyTemp  ?? undefined,
      monthlyWind  ?? undefined,
      apiGoalAdj   ?? undefined,
      apiBestAngle ?? undefined,
    ),
    [state, monthlyGhi, monthlyTemp, monthlyWind, apiGoalAdj, apiBestAngle],
  );
  const [tab, setTab] = useState<'generation' | 'investment'>('generation');
  const [anonymousUserId, setAnonymousUserId] = useState<string | null>(null);
  const [assessmentStored, setAssessmentStored] = useState(false);
  const [claimedAccountId, setClaimedAccountId] = useState<string | null>(null);
  const [authToastMessage, setAuthToastMessage] = useState('');
  const [regionInfo, setRegionInfo] = useState<RegionPotential | null>(null);
  const [vendorsVisible, setVendorsVisible] = useState(false);
  const [recommendedVendors, setRecommendedVendors] = useState<VendorRecommendation[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [vendorsError, setVendorsError] = useState(false);
  const [vendorDetailOpen, setVendorDetailOpen] = useState(false);
  const [vendorDetail, setVendorDetail] = useState<VendorDetail | null>(null);
  const [vendorDetailLoading, setVendorDetailLoading] = useState(false);
  const [vendorDetailError, setVendorDetailError] = useState(false);
  const [inquiryVendor, setInquiryVendor] = useState<VendorRecommendation | null>(null);
  const [inquirySent, setInquirySent] = useState<string | null>(null);
  const [claimError, setClaimError] = useState(false);
  const loginTimerRef = useRef<number | null>(null);
  const vendorSectionRef = useRef<HTMLDivElement | null>(null);
  const pendingContactVendorRef = useRef<VendorRecommendation | null>(null);

  useEffect(() => {
    const userId = getUserId();
    setAnonymousUserId(userId);
    const payload = {
      user_id: userId,
      address: state.address?.label ?? null,
      lat: state.address?.lat ?? null,
      lng: state.address?.lng ?? null,
      county: state.county ?? null,
      roof_area_ping: state.roofArea ?? null,
      monthly_kwh: state.monthlyKwh,
      goal: state.goal ?? null,
      capacity_kw: state.capacity ?? null,
      total_cost: state.totalCost ?? null,
      subsidy_amount: state.subsidyAmount ?? null,
      out_of_pocket: state.outOfPocket ?? null,
      annual_kwh: r.annualKwh,
      self_sufficiency: r.selfSufficiency,
      payback_years: r.paybackYears,
      total_20yr: r.total20yr,
      annual_revenue: r.annualRevenue,
      best_angle: r.bestAngle,
      result: { monthlyKwh: r.monthlyKwh },
    };
    fetch(`${API_URL}/api/assessments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(res => {
        if (res.ok) setAssessmentStored(true);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 地區潛力 badge
  useEffect(() => {
    if (!state.townshipCode) return;
    fetch(`${API_URL}/api/region-potential/${encodeURIComponent(state.townshipCode)}`)
      .then(res => (res.ok ? res.json() : Promise.reject()))
      .then((data: RegionPotential) => setRegionInfo(data))
      .catch(() => {});
  }, [state.townshipCode]);

  useEffect(() => {
    const controller = new AbortController();
    const params = state.county ? `?county=${encodeURIComponent(state.county)}&limit=3` : '?limit=3';
    setVendorsLoading(true);
    setVendorsError(false);
    fetch(`${API_URL}/api/vendors${params}`, { signal: controller.signal })
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('vendors request failed'))))
      .then((vendors: VendorRecommendation[]) => {
        setRecommendedVendors(Array.isArray(vendors) ? vendors : []);
      })
      .catch(err => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setRecommendedVendors([]);
        setVendorsError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setVendorsLoading(false);
      });

    return () => controller.abort();
  }, [state.county]);

  useEffect(() => {
    if (!user || !anonymousUserId || !assessmentStored || claimedAccountId === user.id) return;
    fetch(`${API_URL}/api/me/claim?user_id=${encodeURIComponent(anonymousUserId)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${user.token}` },
    })
      .then(res => {
        if (res.ok) setClaimedAccountId(user.id);
        else setClaimError(true);
      })
      .catch(() => setClaimError(true));
  }, [anonymousUserId, assessmentStored, claimedAccountId, user]);

  // 登入後：清除 toast/timer，並自動重試 pending 的廠商聯絡動作
  useEffect(() => {
    if (!user) return;
    if (authToastMessage) setAuthToastMessage('');
    if (loginTimerRef.current) {
      window.clearTimeout(loginTimerRef.current);
      loginTimerRef.current = null;
    }
    const pending = pendingContactVendorRef.current;
    if (pending) {
      pendingContactVendorRef.current = null;
      setInquiryVendor(pending);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => () => {
    if (loginTimerRef.current) window.clearTimeout(loginTimerRef.current);
  }, []);

  const promptLogin = (message: string) => {
    if (user || !onLoginClick) return;
    setAuthToastMessage(message);
    if (loginTimerRef.current) window.clearTimeout(loginTimerRef.current);
    loginTimerRef.current = window.setTimeout(() => {
      setAuthToastMessage('');
      onLoginClick();
      loginTimerRef.current = null;
    }, 2000);
  };

  const handleSaveClick = () => {
    promptLogin('需要登入才能儲存，正在開啟登入視窗⋯');
  };

  const handleVendorContact = (vendor: VendorRecommendation) => {
    if (!user) {
      pendingContactVendorRef.current = vendor;
      promptLogin('需要登入才能聯絡廠商，正在開啟登入視窗⋯');
      return;
    }
    setInquiryVendor(vendor);
  };

  const handleFindVendors = () => {
    setVendorsVisible(true);
    window.setTimeout(() => {
      vendorSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

  const handleVendorDetail = (vendor: VendorRecommendation) => {
    setVendorDetailOpen(true);
    setVendorDetail(null);
    setVendorDetailError(false);
    setVendorDetailLoading(true);
    fetch(`${API_URL}/api/vendors/${encodeURIComponent(vendor.id)}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('vendor detail request failed'))))
      .then((detail: VendorDetail) => setVendorDetail(detail))
      .catch(() => setVendorDetailError(true))
      .finally(() => setVendorDetailLoading(false));
  };

  const GOAL_LABELS: Record<string, string> = {
    annual: '全年總發電量最高', summer: '夏季發電量最高', winter: '冬季發電量最高',
    peak: '正午峰值最高', match: '與用電曲線最匹配', roi: '投資回收最快',
  };
  const GOAL_TILT_INSIGHT: Record<string, string> = {
    annual: '全年均衡最佳化，穩定長期發電收益',
    summer: '夏季日照角高，仰角較低讓面板正對夏季太陽',
    winter: '冬季日照角低，仰角較高讓面板直對冬季陽光',
    peak:   '以全年正午（11–13 時）為基準最佳化，最大化午間自用發電量',
    match:  '配合台灣住宅夏季冷氣尖峰用電，降低每月買電支出',
    roi:    '夏季電費較高，優先最大化夏季發電，加速投資回收',
  };
  const goalLabel = GOAL_LABELS[state.goal ?? 'annual'] ?? '全年總發電量最高';
  const goalTiltInsight = GOAL_TILT_INSIGHT[state.goal ?? 'annual'] ?? '';

  return (
    <div style={{ paddingBottom: 40 }}>
      {/* PDF report — hidden on screen, shown only when printing */}
      <PrintReport state={state} r={r} />

      {/* Screen layout — hidden when printing */}
      <div className="screen-only">
      {/* Print-only header — hidden on screen */}
      <div className="print-header" style={{ marginBottom: 24, paddingBottom: 16, borderBottom: '2px solid var(--green-200)' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--green-900)' }}>屋頂太陽能可行性評估報告</div>
        <div style={{ fontSize: 13, color: 'var(--ink-500)', marginTop: 4 }}>
          {state.address?.label ?? ''} · {state.county ?? ''} · 列印日期：{new Date().toLocaleDateString('zh-TW')}
        </div>
      </div>

      {/* Summary header */}
      <div style={{ marginBottom: 28 }}>
        <div className="eyebrow" style={{ marginBottom: 16, color: 'var(--amber)' }}>
          <span style={{ background: 'var(--amber)' }}></span>評估結果
        </div>
        <h2 className="h-title" style={{ margin: '0 0 8px' }}>你家屋頂很適合裝太陽能</h2>
        <p className="body" style={{ color: 'var(--ink-500)' }}>
          基於 {state.address?.label ?? '你輸入的地址'} 的日照資料、{r.region}氣候模型與 {state.county ?? '台北市'} 政府補助計算。
        </p>

        {/* 地區潛力 badge */}
        {regionInfo && (
          <div style={{
            display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
            maxWidth: '100%',
            marginTop: 14, padding: '10px 16px',
            background: regionInfo.tier === '高潛力' ? '#FFF8EE'
                       : regionInfo.tier === '中潛力' ? '#F0F9F2'
                       : 'var(--ink-50)',
            border: `1px solid ${
              regionInfo.tier === '高潛力' ? '#E8A53C'
              : regionInfo.tier === '中潛力' ? 'var(--green-300)'
              : 'var(--ink-200)'}`,
            borderRadius: 10, fontSize: 14,
          }}>
            <MapPin size={14} strokeWidth={1.8} style={{ flexShrink: 0 }} />
            <span style={{ fontWeight: 600, color: 'var(--ink-900)' }}>
              {regionInfo.countyname}{regionInfo.townname}
            </span>
            <span style={{ color: 'var(--ink-400)' }}>·</span>
            <span style={{
              fontWeight: 700,
              color: regionInfo.tier === '高潛力' ? '#C8861E'
                    : regionInfo.tier === '中潛力' ? 'var(--green-700)'
                    : 'var(--ink-500)',
            }}>
              全台太陽能潛力 #{regionInfo.rank} / {regionInfo.total}
            </span>
            <span style={{
              padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: regionInfo.tier === '高潛力' ? '#E8A53C'
                         : regionInfo.tier === '中潛力' ? 'var(--green-500)'
                         : 'var(--ink-300)',
              color: regionInfo.tier === '一般' ? 'var(--ink-700)' : '#fff',
            }}>
              {regionInfo.tier}
            </span>
          </div>
        )}
      </div>

      {/* 氣候適宜性卡片 (Han et al. 2026 ADR model) */}
      {(() => {
        const suitMap = {
          good: { label: '優良', color: 'var(--green-700)', bg: '#F0F9F2', border: 'var(--green-300)' },
          fair: { label: '尚可', color: '#C8861E',          bg: '#FFF8EE', border: '#E8A53C' },
          poor: { label: '偏低', color: '#B02424',          bg: '#FFF1F1', border: '#F5ACAC' },
        } as const;
        const s = suitMap[r.suitability];
        const avgPR = r.monthlyPR.reduce((a, b) => a + b, 0) / 12;
        const prDeltaPct = ((avgPR - 0.78) / 0.78 * 100).toFixed(1);
        const prSign = avgPR >= 0.78 ? '+' : '';
        const twAvg = Math.round(417 / 0.325); // 1283 kWh/kWp (paper value ÷ 0.325 kWp/panel)
        const yieldDiff = r.pvYieldPerKwp - twAvg;
        const yieldSign = yieldDiff >= 0 ? '+' : '';
        return (
          <div style={{
            marginBottom: 20, padding: '16px 20px',
            background: s.bg, border: `1px solid ${s.border}`, borderRadius: 12,
            display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 20,
          }}>
            <div style={{ flex: '0 0 auto' }}>
              <div className="caption" style={{ marginBottom: 4 }}>氣候適宜性</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  padding: '3px 10px', borderRadius: 6, fontSize: 13, fontWeight: 700,
                  background: s.color, color: '#fff',
                }}>{s.label}</span>
              </div>
            </div>

            <div style={{ flex: '0 0 auto' }}>
              <div className="caption" style={{ marginBottom: 2 }}>年發電效率</div>
              <div>
                <span className="num" style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{r.pvYieldPerKwp}</span>
                <span style={{ fontSize: 12, color: 'var(--ink-500)', marginLeft: 4 }}>kWh/kWp</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-400)' }}>
                台灣均值 {twAvg} · <span style={{ color: s.color }}>{yieldSign}{yieldDiff.toFixed(0)} kWh/kWp</span>
              </div>
            </div>

            <div style={{ flex: '0 0 auto' }}>
              <div className="caption" style={{ marginBottom: 2 }}>
                溫度效率修正
              </div>
              <div>
                <span className="num" style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-700)' }}>{prSign}{prDeltaPct}%</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-400)' }}>相對固定 PR=0.78 的月均修正</div>
            </div>

            <div style={{ flex: '1 1 200px', borderTop: 'none', alignSelf: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--ink-400)', lineHeight: 1.5 }}>
                依 Han et al. (2026) Faiman T<sub>cell</sub> 模型計算，考量月均溫度與風速對電池片效率之影響
              </div>
            </div>
          </div>
        );
      })()}

      {/* Headline numbers */}
      <div className="card elevated results-kpi-card" style={{ marginBottom: 28, background: 'linear-gradient(135deg, #FFFFFF 0%, #F0F9F2 100%)' }}>
        <div className="results-kpi-grid">
          <div>
            <div className="caption" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              年發電量
              {tiltLoading && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 999, background: 'var(--ink-100)', color: 'var(--ink-500)', fontSize: 10, fontWeight: 500 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', border: '1.5px solid var(--ink-200)', borderTopColor: 'var(--green-600)', animation: 'spin 0.6s linear infinite', flexShrink: 0 }} />
                  計算中
                </span>
              )}
            </div>
            <div>
              <span className="num" style={{ fontSize: 48, fontWeight: 700, color: 'var(--green-900)', lineHeight: 1 }}>
                {r.annualKwh.toLocaleString()}
              </span>
              <span style={{ fontSize: 16, color: 'var(--ink-500)', marginLeft: 6 }}>kWh</span>
            </div>
            <div className="body-sm" style={{ marginTop: 8 }}>相當於 {(r.annualKwh / (state.monthlyKwh || 350)).toFixed(1)} 個月用電量</div>
          </div>

          <div className="results-kpi-item--divided">
            <div className="caption" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              能源自給率<Info tip="自發電量 ÷ 總用電量" />
              {tiltLoading && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 999, background: 'var(--ink-100)', color: 'var(--ink-500)', fontSize: 10, fontWeight: 500 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', border: '1.5px solid var(--ink-200)', borderTopColor: 'var(--green-600)', animation: 'spin 0.6s linear infinite', flexShrink: 0 }} />
                  計算中
                </span>
              )}
            </div>
            <div>
              <span className="num" style={{ fontSize: 48, fontWeight: 700, color: 'var(--green-900)', lineHeight: 1 }}>{r.selfSufficiency}</span>
              <span style={{ fontSize: 16, color: 'var(--ink-500)', marginLeft: 6 }}>%</span>
            </div>
            <div className="results-kpi-progress">
              <div className="results-kpi-progress-fill" style={{ width: `${r.selfSufficiency}%` }} />
            </div>
          </div>

          <div className="results-kpi-item--divided">
            <div className="caption" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              預估回本年限
              {tiltLoading && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 999, background: 'var(--ink-100)', color: 'var(--ink-500)', fontSize: 10, fontWeight: 500 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', border: '1.5px solid var(--ink-200)', borderTopColor: 'var(--green-600)', animation: 'spin 0.6s linear infinite', flexShrink: 0 }} />
                  計算中
                </span>
              )}
            </div>
            <div>
              <span className="num" style={{ fontSize: 48, fontWeight: 700, color: '#C8861E', lineHeight: 1 }}>{r.paybackYears}</span>
              <span style={{ fontSize: 16, color: 'var(--ink-500)', marginLeft: 6 }}>年</span>
            </div>
            <div className="body-sm" style={{ marginTop: 8 }}>保固 25 年 · 剩餘純收益 {(25 - r.paybackYears).toFixed(1)} 年</div>
          </div>

          <div className="results-kpi-item--divided">
            <div className="caption" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              20 年總收益
              {tiltLoading && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 999, background: 'var(--ink-100)', color: 'var(--ink-500)', fontSize: 10, fontWeight: 500 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', border: '1.5px solid var(--ink-200)', borderTopColor: 'var(--green-600)', animation: 'spin 0.6s linear infinite', flexShrink: 0 }} />
                  計算中
                </span>
              )}
            </div>
            <div>
              <span className="num" style={{ fontSize: 34, fontWeight: 700, color: 'var(--green-900)', lineHeight: 1 }}>
                NT$ {Math.round(r.total20yr / 10000)}
              </span>
              <span style={{ fontSize: 16, color: 'var(--ink-500)', marginLeft: 4 }}>萬</span>
            </div>
            <div className="body-sm" style={{ marginTop: 8, fontFamily: 'var(--font-num)' }}>NT$ {r.total20yr.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Tabs — hidden when printing (both panels show via CSS) */}
      <div className="results-tab-nav">
        {([
          { id: 'generation' as const, label: '發電潛力' },
          { id: 'investment' as const, label: '投資試算' },
        ]).map(t => (
          <button
            key={t.id}
            className={`results-tab-btn${tab === t.id ? ' results-tab-btn--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Generation panel — always in DOM; hidden via CSS when inactive tab */}
      <div className={tab !== 'generation' ? 'tab-panel tab-panel--hidden' : 'tab-panel'}>
        <div className="tab-section-title">發電潛力</div>
        <div className="results-gen-grid">
          <div className="card" style={{ padding: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 24 }}>
              <h3 className="h-section" style={{ margin: 0 }}>月發電量</h3>
              <span className="body-sm">單位：kWh</span>
            </div>
            <MonthlyChart data={r.monthlyKwh} highlight={state.goal} />
            <div style={{ marginTop: 20, padding: 14, background: 'var(--green-50)', borderRadius: 10, fontSize: 13, color: 'var(--ink-700)' }}>
              {tiltLoading
                ? <span style={{ color: 'var(--ink-400)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', flexShrink: 0, border: '1.5px solid var(--ink-200)', borderTopColor: 'var(--green-600)', animation: 'spin 0.6s linear infinite' }} />
                    正在依你的地點計算最佳仰角…
                  </span>
                : apiBestAngle != null
                  ? <>★ 目標「<b>{goalLabel}</b>」，pvlib 依你的地點緯度計算最佳仰角 <b>{r.bestAngle}°</b>。{goalTiltInsight}。</>
                  : <>★ 根據你選的目標「<b>{goalLabel}</b>」建議最佳安裝角度。</>
              }
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Best angle */}
            <div className="card" style={{ padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span className="caption">最佳安裝角度</span>
                {apiBestAngle != null && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                    padding: '2px 8px', borderRadius: 999,
                    background: 'var(--green-50)', color: 'var(--green-700)',
                    fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
                    border: '1px solid var(--green-200)',
                  }}>pvlib 計算</span>
                )}
              </div>
              {tiltLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 0', color: 'var(--ink-400)', fontSize: 14 }}>
                  <div style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0, border: '2px solid var(--ink-200)', borderTopColor: 'var(--green-700)', animation: 'spin 0.6s linear infinite' }} />
                  依日照幾何計算最佳仰角…
                </div>
              ) : (
                <>
                  <div className="num" style={{ fontSize: 34, fontWeight: 700, color: 'var(--green-900)' }}>{r.bestAngle}°</div>
                  <div className="body-sm" style={{ marginTop: 6 }}>{r.recommendedAngle}</div>
                  {(() => {
                    const ang = r.bestAngle * Math.PI / 180;
                    // Layout: ground at y=100, viewBox 240×120, panel base at bx=44
                    const bx = 75, by = 100, L = 90, T = 10;

                    // Panel face normal = (−sinθ, −cosθ): points upper-LEFT (south in this
                    // east-view cross-section). Sun must be on the left so rays hit the front face.
                    // sy = 100 − 85·cos(tilt): high tilt (winter) → sun lower; low tilt → near top.
                    const sx = 28;
                    const sy = Math.max(14, by - 85 * Math.cos(ang));

                    // Panel face corners (sky-facing edge) in SVG space — needed for rays
                    const P4x = bx - T * Math.sin(ang),    P4y = by - T * Math.cos(ang);
                    const P3x = bx + L * Math.cos(ang) - T * Math.sin(ang);
                    const P3y = by - L * Math.sin(ang) - T * Math.cos(ang);

                    // 2 solar rays from sun to evenly spaced points on panel face
                    const rays = [0.28, 0.72].map(t => ({
                      x1: sx.toFixed(1), y1: sy.toFixed(1),
                      x2: (P4x + t * (P3x - P4x)).toFixed(1),
                      y2: (P4y + t * (P3y - P4y)).toFixed(1),
                    }));

                    // Arc
                    const arcR = 36;
                    const arcEx = bx + arcR * Math.cos(ang);
                    const arcEy = by - arcR * Math.sin(ang);

                    // Angle label: at the arc endpoint (where arc meets panel line),
                    // slightly below the panel edge — always in the "wedge" between panel and ground
                    const lblX = bx + (arcR + 2) * Math.cos(ang);
                    const lblY = by - (arcR + 2) * Math.sin(ang) + 11;

                    return (
                      <svg viewBox="0 0 240 120" style={{ width: '100%', marginTop: 16 }}>
                        {/* Ground fill */}
                        <rect x="0" y={by} width="240" height="20" fill="var(--green-50)" />
                        {/* Ground line */}
                        <line x1="0" y1={by} x2="240" y2={by} stroke="var(--ink-300)" strokeWidth="1.5" />
                        {/* Mounting leg */}
                        <line x1={bx} y1={by} x2={bx} y2={by + 9}
                          stroke="var(--ink-400)" strokeWidth="2.5" strokeLinecap="round" />

                        {/* Solar rays */}
                        {rays.map((ray, i) => (
                          <line key={i} x1={ray.x1} y1={ray.y1} x2={ray.x2} y2={ray.y2}
                            stroke="var(--amber)" strokeWidth="1.2" strokeDasharray="5 3" opacity="0.6" />
                        ))}

                        {/* Angle arc — filled sector */}
                        <path
                          d={`M ${bx + arcR} ${by} A ${arcR} ${arcR} 0 0 0 ${arcEx.toFixed(1)} ${arcEy.toFixed(1)} L ${bx} ${by} Z`}
                          fill="rgba(251,191,36,0.13)" />
                        {/* Angle arc — stroke */}
                        <path
                          d={`M ${bx + arcR} ${by} A ${arcR} ${arcR} 0 0 0 ${arcEx.toFixed(1)} ${arcEy.toFixed(1)}`}
                          fill="none" stroke="var(--amber)" strokeWidth="2" />

                        {/* Panel — rotated rect for clean shape, no distortion */}
                        <g transform={`translate(${bx},${by}) rotate(${-r.bestAngle})`}>
                          <rect x="0" y={-T} width={L} height={T} fill="var(--green-700)" rx="1.5" />
                          {/* Cell grid lines */}
                          {[0.33, 0.66].map((t, i) => (
                            <line key={i} x1={+(L * t).toFixed(1)} y1={-T} x2={+(L * t).toFixed(1)} y2={0}
                              stroke="rgba(255,255,255,0.3)" strokeWidth="0.9" />
                          ))}
                          {/* Sky-facing highlight */}
                          <line x1="3" y1={-T} x2={L - 3} y2={-T}
                            stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" strokeLinecap="round" />
                          {/* Right end cap */}
                          <line x1={L} y1={-T + 1} x2={L} y2={-1}
                            stroke="var(--green-900)" strokeWidth="1.5" opacity="0.4" strokeLinecap="round" />
                        </g>

                        {/* Angle label: at arc endpoint, below panel edge */}
                        <text x={lblX.toFixed(1)} y={lblY.toFixed(1)} fontSize="11"
                          fontFamily="var(--font-num)" fill="#8B5A10" fontWeight="700"
                          textAnchor="start">{r.bestAngle}°</text>

                        {/* Sun */}
                        <circle cx={sx.toFixed(1)} cy={sy.toFixed(1)} r="8"
                          fill="var(--amber)" opacity="0.95" />
                        {/* 12 rays: alternating long (every 60°) and short (every 60°, offset 30°) */}
                        {[0,30,60,90,120,150,180,210,240,270,300,330].map((deg, i) => {
                          const rd = deg * Math.PI / 180;
                          const isLong = i % 2 === 0;
                          const r1 = 11, r2 = isLong ? 19 : 14;
                          return (
                            <line key={i}
                              x1={(sx + r1 * Math.cos(rd)).toFixed(1)} y1={(sy + r1 * Math.sin(rd)).toFixed(1)}
                              x2={(sx + r2 * Math.cos(rd)).toFixed(1)} y2={(sy + r2 * Math.sin(rd)).toFixed(1)}
                              stroke="var(--amber)"
                              strokeWidth={isLong ? '2' : '1.2'}
                              strokeLinecap="round"
                              opacity={isLong ? '0.85' : '0.5'} />
                          );
                        })}
                      </svg>
                    );
                  })()}
                </>
              )}
            </div>

            {/* Comparison */}
            <div className="card" style={{ padding: 24 }}>
              <div className="caption" style={{ marginBottom: 12 }}>與台灣平均比較</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                  { label: '你的屋頂', value: r.annualKwh, color: 'var(--green-700)', emphasis: true },
                  { label: '台灣平均（同容量）', value: Math.round(r.annualKwh * 0.92), color: 'var(--ink-300)', emphasis: false },
                ].map((row, i) => {
                  const pct = (row.value / r.annualKwh) * 100;
                  return (
                    <div key={i}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                        <span style={{ color: row.emphasis ? 'var(--green-900)' : 'var(--ink-500)', fontWeight: row.emphasis ? 600 : 400 }}>{row.label}</span>
                        <span className="num" style={{ fontWeight: 600, color: row.emphasis ? 'var(--green-900)' : 'var(--ink-500)' }}>{row.value.toLocaleString()} kWh</span>
                      </div>
                      <div style={{ height: 8, background: 'var(--ink-100)', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: row.color, transition: 'width 1s' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 14, fontSize: 12, color: 'var(--green-700)', fontWeight: 500 }}>
                ↑ 比台灣平均高 {(((r.annualKwh / Math.round(r.annualKwh * 0.92)) - 1) * 100).toFixed(1)}%
              </div>
            </div>
          </div>
        </div>

        {/* Climate parameters card — inside generation tab */}
        {(() => {
        const dispGhi      = monthlyGhi      ?? TW_IRRADIANCE[r.region];
        const dispTemp     = monthlyTemp     ?? DEFAULT_TEMP[r.region];
        const dispWind     = monthlyWind     ?? DEFAULT_WIND[r.region];
        const fromApi      = !!(monthlyGhi && monthlyTemp && monthlyWind);

        type ClimateRow = { label: string; unit: string; data: number[]; fmt: (v: number) => string; colorScale: (v: number, arr: number[]) => string };
        const rows: ClimateRow[] = [
          {
            label: '日射量', unit: 'kWh/m²/d', data: dispGhi,
            fmt: v => v.toFixed(1),
            colorScale: (v, arr) => {
              const norm = (v - Math.min(...arr)) / (Math.max(...arr) - Math.min(...arr) || 1);
              return `rgba(64, 145, 108, ${0.1 + norm * 0.55})`;
            },
          },
          {
            label: '月均氣溫', unit: '°C', data: dispTemp,
            fmt: v => v.toFixed(0),
            colorScale: (v, arr) => {
              const norm = (v - Math.min(...arr)) / (Math.max(...arr) - Math.min(...arr) || 1);
              return `rgba(220, 80, 60, ${0.08 + norm * 0.45})`;
            },
          },
          {
            label: '風速', unit: 'm/s', data: dispWind,
            fmt: v => v.toFixed(1),
            colorScale: (v, arr) => {
              const norm = (v - Math.min(...arr)) / (Math.max(...arr) - Math.min(...arr) || 1);
              return `rgba(59, 130, 190, ${0.08 + norm * 0.45})`;
            },
          },
          ...(monthlyHumidity ? [{
            label: '相對濕度', unit: '%', data: monthlyHumidity,
            fmt: (v: number) => v.toFixed(0),
            colorScale: (v: number, arr: number[]) => {
              const norm = (v - Math.min(...arr)) / (Math.max(...arr) - Math.min(...arr) || 1);
              return `rgba(100, 160, 220, ${0.08 + norm * 0.45})`;
            },
          }] as ClimateRow[] : []),
        ];

        return (
          <div className="card" style={{ padding: 24, marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 className="h-section" style={{ margin: 0 }}>氣候輸入參數</h3>
                <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 3 }}>
                  用於 Faiman T<sub>cell</sub> 模型計算月動態 PR
                </div>
              </div>
              <span style={{
                padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                background: fromApi ? 'var(--green-100)' : 'var(--ink-100)',
                color: fromApi ? 'var(--green-800)' : 'var(--ink-500)',
              }}>
                {fromApi ? 'NASA POWER' : '台灣氣候均值（fallback）'}
              </span>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-num)' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--ink-500)', fontWeight: 600, whiteSpace: 'nowrap', borderBottom: '1px solid var(--ink-150)' }}>
                      指標
                    </th>
                    {MONTHS.map(m => (
                      <th key={m} style={{ textAlign: 'center', padding: '6px 4px', color: 'var(--ink-400)', fontWeight: 500, borderBottom: '1px solid var(--ink-150)', minWidth: 36 }}>
                        {m}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.label}>
                      <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: 'var(--ink-700)', fontWeight: 500, fontFamily: 'inherit' }}>
                        {row.label}
                        <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--ink-400)' }}>({row.unit})</span>
                      </td>
                      {row.data.map((v, i) => (
                        <td key={i} style={{
                          textAlign: 'center', padding: '5px 4px',
                          background: row.colorScale(v, row.data),
                          color: 'var(--ink-800)', fontWeight: 500, borderRadius: 4,
                        }}>
                          {row.fmt(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: 'var(--ink-700)', fontWeight: 500, fontFamily: 'inherit' }}>
                      動態 PR
                      <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--ink-400)' }}>(—)</span>
                    </td>
                    {r.monthlyPR.map((v, i) => (
                      <td key={i} style={{
                        textAlign: 'center', padding: '5px 4px',
                        background: (() => {
                          const base = 0.78;
                          const diff = (v - base) / base;
                          if (diff >= 0) return `rgba(64, 145, 108, ${Math.min(0.6, diff * 6 + 0.1)})`;
                          return `rgba(220, 80, 60, ${Math.min(0.5, Math.abs(diff) * 6 + 0.1)})`;
                        })(),
                        color: 'var(--ink-800)', fontWeight: 500, borderRadius: 4,
                      }}>
                        {v.toFixed(3)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--ink-400)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <span>
                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'rgba(64,145,108,0.5)', marginRight: 4, verticalAlign: 'middle' }} />
                高值
              </span>
              <span>
                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'rgba(220,80,60,0.4)', marginRight: 4, verticalAlign: 'middle' }} />
                動態 PR 低於基準 0.78（熱衰減）
              </span>
              <span>
                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'rgba(64,145,108,0.45)', marginRight: 4, verticalAlign: 'middle' }} />
                動態 PR 高於基準 0.78（冷卻效果）
              </span>
            </div>
          </div>
        );
      })()}
      </div>{/* end generation tab-panel */}

      {/* Investment panel — always in DOM; hidden via CSS when inactive tab */}
      <div className={tab !== 'investment' ? 'tab-panel tab-panel--hidden' : 'tab-panel'}>
        <div className="tab-section-title">投資試算</div>
        <div className="results-inv-grid">
          {/* Cost breakdown */}
          <div className="card" style={{ padding: 28 }}>
            <h3 className="h-section" style={{ margin: '0 0 22px' }}>成本拆解</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <BreakdownRow label="安裝費用" value={state.totalCost ?? 0} color="var(--ink-700)" max={state.totalCost ?? 1} />
              <BreakdownRow label={`${state.county ?? '台北市'} 補助`} value={-(state.subsidyAmount ?? 0)} color="var(--green-700)" max={state.totalCost ?? 1} />
              <div style={{ borderTop: '1px dashed var(--ink-200)', paddingTop: 14, marginTop: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>實際自付</span>
                  <span className="num" style={{ fontSize: 28, fontWeight: 700, color: 'var(--green-900)' }}>NT$ {state.outOfPocket?.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 26, padding: 18, background: 'var(--green-50)', borderRadius: 12 }}>
              <div className="caption" style={{ marginBottom: 6 }}>年度收益來源</div>
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>自用省電費</div>
                  <div className="num" style={{ fontSize: 18, fontWeight: 700, color: 'var(--green-900)' }}>
                    NT$ {r.selfUseRevenue.toLocaleString()}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>台電躉購</div>
                  <div className="num" style={{ fontSize: 18, fontWeight: 700, color: 'var(--green-900)' }}>
                    NT$ {(r.annualRevenue - r.selfUseRevenue).toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="caption" style={{ marginTop: 10 }}>FIT 收購費率 5.7 元/度 · 保障 20 年</div>
            </div>
          </div>

          {/* Revenue curve */}
          <div className="card" style={{ padding: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
              <h3 className="h-section" style={{ margin: 0 }}>20 年累計淨收益</h3>
              <span className="body-sm">含衰退率 0.5%/年</span>
            </div>
            <RevenueChart annualRevenue={r.annualRevenue} outOfPocket={state.outOfPocket ?? 400000} paybackYears={r.paybackYears} />

            <div className="results-inv-summary">
              <div>
                <div className="caption">起始投資</div>
                <div className="num" style={{ fontSize: 16, fontWeight: 600, color: 'var(--danger)', marginTop: 4 }}>
                  −NT$ {Math.round((state.outOfPocket ?? 400000) / 10000)}萬
                </div>
              </div>
              <div>
                <div className="caption">年均收益</div>
                <div className="num" style={{ fontSize: 16, fontWeight: 600, color: 'var(--green-700)', marginTop: 4 }}>
                  +NT$ {Math.round(r.annualRevenue / 1000)}K
                </div>
              </div>
              <div>
                <div className="caption">20 年 IRR</div>
                <div className="num" style={{ fontSize: 16, fontWeight: 600, color: 'var(--green-900)', marginTop: 4 }}>約 10.5%</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="results-cta">
        <div className="results-cta-decoration" />
        <div style={{ position: 'relative' }}>
          <div className="results-cta-eyebrow">下一步</div>
          <div className="results-cta-title">下載完整報告，或找認證廠商實勘</div>
          <div className="results-cta-sub">報告含結構評估項目清單、推薦廠商比較表，PDF 約 12 頁。</div>
        </div>
        <div className="results-cta-actions">
          <button
            className="btn btn-secondary results-vendor-jump-btn"
            onClick={handleFindVendors}
          >
            尋找廠商
          </button>
          {onLoginClick && (
            <button
              className="btn results-save-btn"
              disabled={!!user}
              onClick={handleSaveClick}
            >
              {user ? '已儲存 ✓' : '儲存評估結果'}
            </button>
          )}
          <button
            className="btn results-download-btn"
            onClick={() => window.print()}
          >
            下載評估報告
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M8 2 L8 11 M4 7 L8 11 L12 7 M3 14 L13 14"/>
            </svg>
          </button>
        </div>
      </div>

      {vendorsVisible && (
        <div className="vendor-section" ref={vendorSectionRef}>
          <div className="vendor-section-header">
            <div>
              <div className="eyebrow" style={{ marginBottom: 12 }}>推薦廠商</div>
              <h3 className="h-section" style={{ margin: 0 }}>適合 {state.county ?? '你所在地區'} 的認證廠商</h3>
            </div>
            <div className="vendor-section-sub">依服務地區與相似案場初步排序，實際報價仍需現場勘查。</div>
          </div>
          {vendorsLoading && (
            <div className="vendor-state">載入推薦廠商中⋯</div>
          )}
          {!vendorsLoading && vendorsError && (
            <div className="vendor-state vendor-state--error">暫時無法載入推薦廠商，請稍後再試。</div>
          )}
          {!vendorsLoading && !vendorsError && recommendedVendors.length === 0 && (
            <div className="vendor-state">目前尚無服務 {state.county ?? '你所在地區'} 的廠商。</div>
          )}
          {!vendorsLoading && !vendorsError && recommendedVendors.length > 0 && (
            <div className="vendor-grid">
              {recommendedVendors.map(vendor => (
                <VendorCard
                  key={vendor.id}
                  vendor={vendor}
                  onContact={handleVendorContact}
                  onDetail={handleVendorDetail}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {authToastMessage && !user && (
        <div className="results-save-toast" role="status" aria-live="polite">
          {authToastMessage}
        </div>
      )}

      {claimError && (
        <div className="no-print" style={{ marginTop: 16, textAlign: 'center', fontSize: 12, color: 'var(--danger)' }}>
          評估結果儲存至帳號失敗，請重新整理後再試。
        </div>
      )}

      <div className="no-print" style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>
        <button className="btn-ghost" onClick={onRestart} style={{ fontSize: 13 }}>
          ← 重新評估其他地址
        </button>
      </div>
      </div>{/* end screen-only */}
      {vendorDetailOpen && (
        <VendorDetailModal
          vendor={vendorDetail}
          loading={vendorDetailLoading}
          error={vendorDetailError}
          onClose={() => setVendorDetailOpen(false)}
          onContact={handleVendorContact}
        />
      )}
      {inquiryVendor && user && (
        <InquiryModal
          vendor={inquiryVendor}
          state={state}
          results={r}
          token={user.token}
          onClose={() => setInquiryVendor(null)}
          onSent={() => {
            setInquirySent(inquiryVendor.name);
            setInquiryVendor(null);
          }}
        />
      )}
      {inquirySent && (
        <div className="results-save-toast" role="status" aria-live="polite">
          詢價已送出給 {inquirySent}，廠商將盡快回覆！
        </div>
      )}
    </div>
  );
}
