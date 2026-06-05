'use client';
import { useState, useEffect } from 'react';
import TopBar from '@/components/TopBar';
import VendorBrowser from '@/components/VendorBrowser';
import HistoryDrawer from '@/components/HistoryDrawer';
import UserInbox from '@/components/UserInbox';
import AuthModal from '@/components/AuthModal';
import VendorApplyModal from '@/components/VendorApplyModal';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';

export default function VendorsPage() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [historyOpen, setHistoryOpen]         = useState(false);
  const [inboxOpen, setInboxOpen]             = useState(false);
  const [authOpen, setAuthOpen]               = useState(false);
  const [vendorApplyOpen, setVendorApplyOpen] = useState(false);
  const [pendingVendorApply, setPendingVendorApply] = useState(false);
  const [vendorLoginToast, setVendorLoginToast]     = useState(false);

  useEffect(() => {
    if (user && pendingVendorApply) {
      setPendingVendorApply(false);
      setAuthOpen(false);
      setVendorApplyOpen(true);
    }
  }, [user, pendingVendorApply]);

  const handleVendorApplyClick = () => {
    if (user) { setVendorApplyOpen(true); return; }
    setPendingVendorApply(true);
    setVendorLoginToast(true);
    setTimeout(() => { setVendorLoginToast(false); setAuthOpen(true); }, 2000);
  };

  return (
    <div className="app">
      <TopBar
        user={user}
        onHome={() => router.push('/')}
        onLogout={logout}
        onLoginClick={() => setAuthOpen(true)}
        onHistoryClick={() => setHistoryOpen(true)}
        onInboxClick={() => setInboxOpen(true)}
        onVendorApplyClick={handleVendorApplyClick}
        onVendorDashClick={() => router.push('/vendor')}
        onAdminPanelClick={() => router.push('/admin')}
      />
      <main className="main-content">
        <div style={{ padding: '32px 0 48px' }}>
          <VendorBrowser />
        </div>
      </main>
      {historyOpen     && user && <HistoryDrawer onClose={() => setHistoryOpen(false)} />}
      {inboxOpen       && user && <UserInbox    onClose={() => setInboxOpen(false)} />}
      {vendorLoginToast && (
        <div className="results-save-toast" role="status" aria-live="polite">
          需先登入才能申請廠商入駐，即將開啟登入...
        </div>
      )}
      {authOpen        && <AuthModal onClose={() => setAuthOpen(false)} />}
      {vendorApplyOpen && <VendorApplyModal onClose={() => setVendorApplyOpen(false)} />}
    </div>
  );
}
