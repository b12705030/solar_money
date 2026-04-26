export type AccountRole = 'user' | 'vendor' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  token: string;
  role: AccountRole;
}

const KEY = 'solar_auth';
const ROLES: AccountRole[] = ['user', 'vendor', 'admin'];

export function normalizeRole(role: unknown): AccountRole {
  return ROLES.includes(role as AccountRole) ? (role as AccountRole) : 'user';
}

export function getStoredAuth(): AuthUser | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthUser;
    return { ...parsed, role: normalizeRole(parsed.role) };
  } catch {
    return null;
  }
}

export function setStoredAuth(user: AuthUser): void {
  localStorage.setItem(KEY, JSON.stringify(user));
}

export function clearStoredAuth(): void {
  localStorage.removeItem(KEY);
}
