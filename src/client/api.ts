import { getActiveLocale, tr } from './i18n';

const TOKEN_KEY = 'marche.token';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// sessionStorage keeps each browser tab independent, so several roles (buyer, vendor, ...)
// can be signed in at the same time on the same machine for testing and demos.
export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

interface RequestOptions {
  method?: string;
  body?: unknown;
}

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Locale': getActiveLocale() };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`/api${path}`, {
    method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && token) {
      setToken(null);
      window.dispatchEvent(new Event('marche:signed-out'));
    }
    throw new ApiError(response.status, (data as { error?: string }).error ?? tr('common.genericError'));
  }
  return data as T;
}

export async function uploadImage(file: File): Promise<string> {
  const token = getToken();
  const response = await fetch('/api/uploads', {
    method: 'POST',
    headers: {
      'Content-Type': file.type,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: file,
  });
  const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!response.ok || !data.url) throw new ApiError(response.status, data.error ?? tr('common.uploadFailed'));
  return data.url;
}
