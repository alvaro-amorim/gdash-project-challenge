const LOCAL_API_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i;

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();

export type PublicAuthConfig = {
  googleClientId: string;
  emailLoginEnabled: boolean;
  emailDeliveryMode: 'resend' | 'smtp' | 'disabled';
};

function browserRunsLocally() {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

export function getRuntimeConfigWarnings() {
  const warnings: string[] = [];

  if (!browserRunsLocally() && LOCAL_API_PATTERN.test(API_BASE_URL)) {
    warnings.push(
      'A API publicada ainda aponta para localhost. Configure VITE_API_BASE_URL com a URL publica do backend.',
    );
  }

  return warnings;
}

export function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

export async function requestApi<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const [configWarning] = getRuntimeConfigWarnings();
  if (configWarning) {
    throw new Error(configWarning);
  }

  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let message = 'Request failed';

    try {
      const errorPayload = await response.json();
      message =
        errorPayload.message ||
        errorPayload.error ||
        JSON.stringify(errorPayload) ||
        message;
    } catch {
      message = await response.text();
    }

    throw new Error(message || 'Request failed');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return (await response.text()) as T;
  }

  return response.json() as Promise<T>;
}

export async function fetchPublicAuthConfig(): Promise<PublicAuthConfig> {
  try {
    return await requestApi<PublicAuthConfig>('/auth/public-config');
  } catch {
    return {
      googleClientId: '',
      emailLoginEnabled: true,
      emailDeliveryMode: 'disabled',
    };
  }
}
