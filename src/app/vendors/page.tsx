'use client';
import { useState } from 'react';
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

  return (
    <div className="app">
      <TopBar
        user={user}
        onHome={() => router.push('/')}
        onLogout={logout}
        onLoginClick={() => setAuthOpen(true)}
        onHistoryClick={() => setHistoryOpen(true)}
        onInboxClick={() => setInboxOpen(true)}
        onVendorApplyClick={() => setVendorApplyOpen(true)}
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
      {authOpen        && <AuthModal onClose={() => setAuthOpen(false)} />}
      {vendorApplyOpen && (
        <VendorApplyModal
          onClose={() => setVendorApplyOpen(false)}
          onLoginClick={() => { setVendorApplyOpen(false); setAuthOpen(true); }}
        />
      )}
    </div>
  );
}
