'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import TopBar from '@/components/TopBar';
import Footer from '@/components/Footer';
import ProgressBar from '@/components/ProgressBar';
import TweaksPanel from '@/components/TweaksPanel';
import WizardFooter from '@/components/WizardFooter';
import AuthModal from '@/components/AuthModal';
import HistoryDrawer from '@/components/HistoryDrawer';
import UserInbox from '@/components/UserInbox';
import VendorApplyModal from '@/components/VendorApplyModal';
import Landing from '@/screens/Landing';
import StepAddress from '@/screens/StepAddress';
import StepUsage from '@/screens/StepUsage';
import StepGoal from '@/screens/StepGoal';
import StepParams from '@/screens/StepParams';
import Results from '@/screens/Results';
import { useAuth } from '@/contexts/AuthContext';
import { applyTheme, applyDensity } from '@/lib/theme';
import { STEPS, TWEAKS_DEFAULTS } from '@/lib/constants';
import type { SolarState, TweaksState } from '@/lib/types';

const DEFAULT_STATE: SolarState = { monthlyKwh: 350 };

export default function App() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(-1);
  const [state, setState] = useState<SolarState>(DEFAULT_STATE);
  const [exiting, setExiting] = useState<number | null>(null);
  const [tweaks, setTweaks] = useState<TweaksState>(TWEAKS_DEFAULTS);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [vendorApplyOpen, setVendorApplyOpen] = useState(false);
  const [pendingVendorApply, setPendingVendorApply] = useState(false);
  const [vendorLoginToast, setVendorLoginToast] = useState(false);
  const vendorToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevAuthOpenRef = useRef(false);

  useEffect(() => {
    if (user && pendingVendorApply) {
      setPendingVendorApply(false);
      setAuthOpen(false);
      setVendorApplyOpen(true);
    }
  }, [user, pendingVendorApply]);

  // Bug 1 fix: 關閉登入視窗但未登入時，清除 pendingVendorApply，
  // 避免之後透過其他路徑登入時意外開啟廠商申請表單
  useEffect(() => {
    if (prevAuthOpenRef.current && !authOpen && !user) {
      setPendingVendorApply(false);
    }
    prevAuthOpenRef.current = authOpen;
  }, [authOpen, user]);

  useEffect(() => { applyTheme(tweaks.theme); }, [tweaks.theme]);
  useEffect(() => { applyDensity(tweaks.density); }, [tweaks.density]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shareData = params.get('share');
    if (!shareData) return;
    try {
      const decoded = JSON.parse(decodeURIComponent(shareData)) as SolarState;
      setState({ ...DEFAULT_STATE, ...decoded });
      setStep(4);
      window.history.replaceState({}, '', window.location.pathname);
    } catch {
      // 無效的分享連結，靜默忽略
    }
  }, []);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!e.data) return;
      if (e.data.type === '__activate_edit_mode') setTweaksOpen(true);
      else if (e.data.type === '__deactivate_edit_mode') setTweaksOpen(false);
    };
    window.addEventListener('message', handler);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', handler);
  }, []);

  const update = (patch: Partial<SolarState>) => setState(s => ({ ...s, ...patch }));
  const updateTweak = (key: keyof TweaksState, value: string) => {
    const next = { ...tweaks, [key]: value } as TweaksState;
    setTweaks(next);
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [key]: value } }, '*');
  };

  const go = (next: number) => {
    setExiting(step);
    setTimeout(() => { setStep(next); setExiting(null); }, 50);
  };

  const canAdvance = () => {
    if (step === 0) return !!state.address && !state.roofAreaError && (!state.roofAreaMax || (state.roofArea ?? 0) <= state.roofAreaMax);
    if (step === 1) {
      if ((state.inputMethod ?? 'bill') === 'kwh') return state.monthlyKwh > 0;
      return state.billAmount != null && state.billAmount >= 50;
    }
    if (step === 2) return !!state.goal;
    return true;
  };

  const reset = () => { setState(DEFAULT_STATE); setStep(-1); };
  const start = () => { setState(DEFAULT_STATE); go(0); };

  const topBarProps = {
    user,
    onLoginClick:       () => setAuthOpen(true),
    onHistoryClick:     () => setHistoryOpen(true),
    onInboxClick:       () => setInboxOpen(true),
    onVendorApplyClick: () => {
      if (user) { setVendorApplyOpen(true); return; }
      setPendingVendorApply(true);
      setVendorLoginToast(true);
      // Bug 3 fix: 避免多次點擊累積多個 timer，先清除舊的再設新的
      if (vendorToastTimerRef.current) clearTimeout(vendorToastTimerRef.current);
      vendorToastTimerRef.current = setTimeout(() => {
        setVendorLoginToast(false);
        setAuthOpen(true);
        vendorToastTimerRef.current = null;
      }, 2000);
    },
    onVendorDashClick:  () => router.push('/vendor'),
    onAdminPanelClick:  () => router.push('/admin'),
    onLogout:           logout,
  };

  const modals = (
    <>
      {tweaksOpen      && <TweaksPanel tweaks={tweaks} update={updateTweak} />}
      {vendorLoginToast && (
        <div className="results-save-toast" role="status" aria-live="polite">
          需先登入才能申請廠商入駐，即將開啟登入...
        </div>
      )}
      {authOpen        && <AuthModal onClose={() => setAuthOpen(false)} />}
      {vendorApplyOpen && <VendorApplyModal onClose={() => setVendorApplyOpen(false)} />}
      {historyOpen     && user && <HistoryDrawer onClose={() => setHistoryOpen(false)} />}
      {inboxOpen       && user && <UserInbox onClose={() => setInboxOpen(false)} />}
    </>
  );

  if (step === -1) {
    return (
      <div className="app">
        <TopBar {...topBarProps} />
        <main className="main-content">
          <Landing onStart={start} />
        </main>
        <Footer />
        {modals}
      </div>
    );
  }

  if (step === 4) {
    return (
      <div className="app">
        <TopBar {...topBarProps} onHome={reset} />
        <ProgressBar step={4} steps={STEPS} onStepClick={go} />
        <main className="main-content">
          <div style={{ padding: '24px 0' }}>
            <Results state={state} onRestart={reset} onLoginClick={() => setAuthOpen(true)} />
          </div>
        </main>
        {modals}
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar {...topBarProps} onHome={reset} />
      <ProgressBar step={step} steps={STEPS} onStepClick={go} />
      <main className="main-content" style={{ position: 'relative', overflow: 'hidden' }}>
        <div className="wizard-step-content" style={{ position: 'relative', minHeight: 520 }}>
          {([0, 1, 2, 3] as const).map(i => (
            <div
              key={i}
              className={[
                'screen',
                i === step && exiting !== step ? 'active' : '',
                exiting === i ? 'exit-left' : '',
              ].join(' ')}
            >
              {i === 0 && <StepAddress state={state} update={update} />}
              {i === 1 && <StepUsage   state={state} update={update} />}
              {i === 2 && <StepGoal    state={state} update={update} />}
              {i === 3 && <StepParams  state={state} update={update} />}
            </div>
          ))}
        </div>
      </main>
      <WizardFooter
        step={step} steps={STEPS} canAdvance={canAdvance()}
        onBack={() => (step === 0 ? go(-1) : go(step - 1))}
        onNext={() => go(step + 1)}
      />
      {modals}
    </div>
  );
}
