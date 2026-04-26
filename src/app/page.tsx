'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import TopBar from '@/components/TopBar';
import Footer from '@/components/Footer';
import ProgressBar from '@/components/ProgressBar';
import TweaksPanel from '@/components/TweaksPanel';
import WizardFooter from '@/components/WizardFooter';
import AuthModal from '@/components/AuthModal';
import HistoryDrawer from '@/components/HistoryDrawer';
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
  const [vendorApplyOpen, setVendorApplyOpen] = useState(false);

  useEffect(() => { applyTheme(tweaks.theme); }, [tweaks.theme]);
  useEffect(() => { applyDensity(tweaks.density); }, [tweaks.density]);

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
    if (step === 0) return !!state.address;
    if (step === 1) return state.monthlyKwh > 0;
    if (step === 2) return !!state.goal;
    return true;
  };

  const reset = () => { setState(DEFAULT_STATE); setStep(-1); };
  const start = () => { setState(DEFAULT_STATE); go(0); };

  const topBarProps = {
    user,
    onLoginClick:       () => setAuthOpen(true),
    onHistoryClick:     () => setHistoryOpen(true),
    onVendorApplyClick: () => setVendorApplyOpen(true),
    onVendorDashClick:  () => router.push('/vendor'),
    onAdminPanelClick:  () => router.push('/admin'),
    onLogout:           logout,
  };

  const modals = (
    <>
      {tweaksOpen      && <TweaksPanel tweaks={tweaks} update={updateTweak} />}
      {authOpen        && <AuthModal onClose={() => setAuthOpen(false)} />}
      {vendorApplyOpen && <VendorApplyModal onClose={() => setVendorApplyOpen(false)} onLoginClick={() => { setVendorApplyOpen(false); setAuthOpen(true); }} />}
      {historyOpen     && user && <HistoryDrawer onClose={() => setHistoryOpen(false)} />}
    </>
  );

  if (step === -1) {
    return (
      <div className="app">
        <TopBar {...topBarProps} />
        <main style={{ maxWidth: 1200, width: '100%', margin: '0 auto', padding: '0 40px', flex: 1 }}>
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
        <ProgressBar step={4} steps={STEPS} />
        <main style={{ maxWidth: 1200, width: '100%', margin: '0 auto', padding: '0 40px', flex: 1 }}>
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
      <ProgressBar step={step} steps={STEPS} />
      <main style={{
        maxWidth: 1200, width: '100%', margin: '0 auto',
        padding: '0 40px', flex: 1,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ padding: '30px 0 40px', position: 'relative', minHeight: 520 }}>
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
