import type { AuthState } from './types';

const AUTH_STORAGE_KEY = 'gdash_auth';
const VISIT_SESSION_KEY = 'gdash_visit_session';

export function readStoredAuth(): AuthState | null {
  const raw = localStorage.getItem(AUTH_STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as AuthState;
  } catch (error) {
    console.error('Failed to parse auth storage', error);
    localStorage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }
}

export function persistAuth(auth: AuthState | null) {
  if (!auth) {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    return;
  }

  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
}

export function getVisitSessionId() {
  const existing = sessionStorage.getItem(VISIT_SESSION_KEY);
  if (existing) {
    return existing;
  }

  const newSessionId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  sessionStorage.setItem(VISIT_SESSION_KEY, newSessionId);
  return newSessionId;
}

export function clearVisitSessionId() {
  sessionStorage.removeItem(VISIT_SESSION_KEY);
}
