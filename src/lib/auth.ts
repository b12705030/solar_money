export interface AuthUser {
  id: string;
  email: string;
  token: string;
}

const KEY = 'solar_auth';

export function getStoredAuth(): AuthUser | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
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
