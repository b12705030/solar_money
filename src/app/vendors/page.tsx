'use client';
import TopBar from '@/components/TopBar';
import VendorBrowser from '@/components/VendorBrowser';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';

export default function VendorsPage() {
  const { user, logout } = useAuth();
  const router = useRouter();

  return (
    <div className="app">
      <TopBar
        user={user}
        onHome={() => router.push('/')}
        onLogout={logout}
        onVendorDashClick={() => router.push('/vendor')}
        onAdminPanelClick={() => router.push('/admin')}
      />
      <main className="main-content">
        <div style={{ padding: '32px 0 48px' }}>
          <VendorBrowser />
        </div>
      </main>
    </div>
  );
}
