// Единая обёртка над fetch + авто-рефреш access-токена через refresh-cookie.
// На /login: не пытаемся рефрешить и не редиректим — просто отдаём 401 наружу.

export type ApiOptions = RequestInit & {
  /** Не пытаться рефрешить access-token при 401 */
  noAuthRetry?: boolean;
  /** Не делать программный редирект на /login при 401 */
  suppressRedirectOn401?: boolean;
};

type MeUser = { id: number; login: string; role: 'admin' | 'user'; nickname?: string | null };
export type MeResponse = { user: MeUser | null };

let refreshPromise: Promise<boolean> | null = null;

const isLoginPath = () =>
  typeof window !== 'undefined' && window.location.pathname.startsWith('/login');

async function doFetch(input: RequestInfo | URL, init?: RequestInit) {
  const res = await fetch(input, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  return res;
}

async function tryRefresh(): Promise<boolean> {
  // На /login рефреш не делаем вообще.
  if (isLoginPath()) return false;

  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const r = await doFetch('/api/refresh', { method: 'POST' });
        if (!r.ok) return false;
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => {
          refreshPromise = null;
        }, 0);
      }
    })();
  }
  return refreshPromise;
}

function onUnauthorized(opts?: ApiOptions) {
  const onLoginPage = isLoginPath();
  const suppress = opts?.suppressRedirectOn401 || opts?.noAuthRetry || onLoginPage;
  if (suppress) return;

  if (!onLoginPage) {
    window.history.replaceState(null, '', '/login');
    window.location.assign('/login');
  }
}

async function safeErrorMessage(res: Response) {
  try {
    const j = await res.json();
    return (j && (j.error || j.message)) || `${res.status} ${res.statusText}`;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

export async function api<T = any>(url: string, options: ApiOptions = {}): Promise<T> {
  // На /login по умолчанию вырубаем refresh/redirect, даже если забыли проставить опции
  const onLogin = isLoginPath();
  const opts: ApiOptions = onLogin
    ? { ...options, noAuthRetry: true, suppressRedirectOn401: true }
    : options;

  const res = await doFetch(url, opts);

  if (res.status === 204) return undefined as T;
  if (res.ok) return (await res.json()) as T;

  if (res.status === 401 && !opts.noAuthRetry) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      const retry = await doFetch(url, opts);
      if (retry.ok) return (await retry.json()) as T;
      if (retry.status === 401) {
        onUnauthorized(opts);
        throw new Error('UNAUTHORIZED');
      }
      const msg2 = await safeErrorMessage(retry);
      throw new Error(msg2);
    } else {
      onUnauthorized(opts);
      throw new Error('UNAUTHORIZED');
    }
  }

  const msg = await safeErrorMessage(res);
  throw new Error(msg);
}

// Удобная обёртка для /api/me
export function me(opts?: ApiOptions) {
  return api<MeResponse>('/api/me', opts);
}
