'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import type { AuthUser } from '@/lib/auth';
import { clearStoredAuth, getStoredAuth, setStoredAuth } from '@/lib/auth';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

interface AuthContextValue {
  user: AuthUser | null;
  login:    (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout:   () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  login: async () => {},
  register: async () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    setUser(getStoredAuth());
  }, []);

  async function callAuth(path: string, email: string, password: string) {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: '未知錯誤' }));
      throw new Error(err.detail ?? '請求失敗');
    }
    const data = await res.json() as { token: string; user_id: string; email: string };
    const authUser: AuthUser = { id: data.user_id, email: data.email, token: data.token };
    setStoredAuth(authUser);
    setUser(authUser);
    return authUser;
  }

  const login    = (e: string, p: string) => callAuth('/api/auth/login',    e, p).then(() => {});
  const register = (e: string, p: string) => callAuth('/api/auth/register', e, p).then(() => {});
  const logout   = () => { clearStoredAuth(); setUser(null); };

  return (
    <AuthContext.Provider value={{ user, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
