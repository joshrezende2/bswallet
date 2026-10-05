import { xanoConfig, xanoReady } from './config';

const persistentTokenKey = 'bs-wallet-xano-token';
const sessionTokenKey = 'bs-wallet-xano-session-token';
let memoryToken: string | null = null;
let sessionUserId: string | null = null;
let sessionError = '';
let sessionRevision = 0;
const listeners = new Set<() => void>();
const notify = () => { sessionRevision += 1; listeners.forEach(listener => listener()); };
export const subscribeXanoSession = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getXanoSessionRevision = () => sessionRevision;
export const getXanoSessionError = () => sessionError;
export function reportXanoSessionError(error: unknown) {
  sessionError = error instanceof Error ? error.message : String(error ?? '');
  notify();
}

export class XanoError extends Error {
  constructor(public status: number, message: string, public payload?: unknown) {
    super(message);
    this.name = 'XanoError';
  }
}

function readStorage(storage: Storage | undefined, key: string) {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}

export function getXanoToken() {
  if (memoryToken) return memoryToken;
  const session = typeof sessionStorage === 'undefined' ? null : readStorage(sessionStorage, sessionTokenKey);
  const persistent = typeof localStorage === 'undefined' ? null : readStorage(localStorage, persistentTokenKey);
  memoryToken = session || persistent;
  sessionUserId = session
    ? readStorage(sessionStorage, `${sessionTokenKey}-user`)
    : typeof localStorage === 'undefined' ? null : readStorage(localStorage, `${persistentTokenKey}-user`);
  return memoryToken;
}

export function getXanoSessionUserId() { return getXanoToken() ? sessionUserId : null; }
export const hasXanoSession = (userId: string) => Boolean(getXanoToken() && getXanoSessionUserId() === userId);

export function setXanoToken(token: string, persistent: boolean, userId: string | null = null) {
  memoryToken = token;
  sessionUserId = userId;
  sessionError = '';
  try {
    if (persistent) {
      localStorage.setItem(persistentTokenKey, token);
      userId ? localStorage.setItem(`${persistentTokenKey}-user`, userId) : localStorage.removeItem(`${persistentTokenKey}-user`);
      sessionStorage.removeItem(sessionTokenKey);
      sessionStorage.removeItem(`${sessionTokenKey}-user`);
    } else {
      sessionStorage.setItem(sessionTokenKey, token);
      userId ? sessionStorage.setItem(`${sessionTokenKey}-user`, userId) : sessionStorage.removeItem(`${sessionTokenKey}-user`);
      localStorage.removeItem(persistentTokenKey);
      localStorage.removeItem(`${persistentTokenKey}-user`);
    }
  } catch { /* Memory token keeps the current tab usable. */ }
  notify();
}

export function bindXanoSession(token: string, userId: string) {
  if (getXanoToken() !== token) throw new Error('A sessão de sincronização mudou. Tente novamente.');
  const persistent = typeof localStorage !== 'undefined' && readStorage(localStorage, persistentTokenKey) === token;
  setXanoToken(token, persistent, userId);
}

export function clearXanoToken() {
  memoryToken = null;
  sessionUserId = null;
  sessionError = '';
  try { localStorage.removeItem(persistentTokenKey); } catch { /* noop */ }
  try { sessionStorage.removeItem(sessionTokenKey); } catch { /* noop */ }
  try { localStorage.removeItem(`${persistentTokenKey}-user`); } catch { /* noop */ }
  try { sessionStorage.removeItem(`${sessionTokenKey}-user`); } catch { /* noop */ }
  notify();
}

if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === null || event.key.startsWith('bs-wallet-xano-')) {
    memoryToken = null; sessionUserId = null; sessionError = ''; getXanoToken(); notify();
  }
});

function errorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of ['message', 'error', 'detail']) if (typeof record[key] === 'string' && record[key]) return String(record[key]);
  }
  return fallback;
}

async function request<T>(baseUrl: string, path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
  if (!xanoReady()) throw new XanoError(0, 'A sincronização em nuvem ainda não está habilitada.');
  const token = authenticated ? getXanoToken() : null;
  if (authenticated && !token) throw new XanoError(401, 'Sua sessão expirou. Entre novamente para continuar sincronizando.');
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  if (init.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 15_000);
  try {
    const response = await fetch(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`, { ...init, headers, signal: controller.signal });
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = text; }
    }
    if (!response.ok) {
      const error = new XanoError(response.status, errorMessage(payload, `O servidor respondeu com HTTP ${response.status}.`), payload);
      // A valid session can receive 403 for a forbidden invite or membership
      // action. Only authentication failure expires the session.
      if (response.status === 401 && token && getXanoToken() === token) {
        clearXanoToken(); reportXanoSessionError(new Error('Sua sessão expirou. Entre novamente para continuar sincronizando.'));
      }
      throw error;
    }
    return payload as T;
  } catch (error) {
    if (error instanceof XanoError) throw error;
    throw new XanoError(0, controller.signal.aborted ? 'O servidor demorou para responder. Tente novamente.' : error instanceof Error ? error.message : 'Não foi possível acessar o servidor.');
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', abort);
  }
}

export const xanoApi = <T>(path: string, init?: RequestInit, authenticated = true) => request<T>(xanoConfig.apiBaseUrl, path, init, authenticated);
export const xanoAuth = <T>(path: string, init?: RequestInit, authenticated = true) => request<T>(xanoConfig.authBaseUrl, path, init, authenticated);
