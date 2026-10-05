import { xanoConfig, xanoReady } from './config';

const persistentTokenKey = 'bs-wallet-xano-token';
const sessionTokenKey = 'bs-wallet-xano-session-token';
let memoryToken: string | null = null;

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
  return memoryToken;
}

export function setXanoToken(token: string, persistent: boolean) {
  memoryToken = token;
  try {
    if (persistent) {
      localStorage.setItem(persistentTokenKey, token);
      sessionStorage.removeItem(sessionTokenKey);
    } else {
      sessionStorage.setItem(sessionTokenKey, token);
      localStorage.removeItem(persistentTokenKey);
    }
  } catch { /* Memory token keeps the current tab usable. */ }
}

export function clearXanoToken() {
  memoryToken = null;
  try { localStorage.removeItem(persistentTokenKey); } catch { /* noop */ }
  try { sessionStorage.removeItem(sessionTokenKey); } catch { /* noop */ }
}

function errorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of ['message', 'error', 'detail']) if (typeof record[key] === 'string' && record[key]) return String(record[key]);
  }
  return fallback;
}

async function request<T>(baseUrl: string, path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
  if (!xanoReady()) throw new XanoError(0, 'A sincronização com o Xano ainda não está habilitada.');
  const token = authenticated ? getXanoToken() : null;
  if (authenticated && !token) throw new XanoError(401, 'Sessão Xano indisponível.');
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`, { ...init, headers });
  } catch (error) {
    throw new XanoError(0, error instanceof Error ? error.message : 'Não foi possível acessar o Xano.');
  }
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) throw new XanoError(response.status, errorMessage(payload, `Xano respondeu com HTTP ${response.status}.`), payload);
  return payload as T;
}

export const xanoApi = <T>(path: string, init?: RequestInit, authenticated = true) => request<T>(xanoConfig.apiBaseUrl, path, init, authenticated);
export const xanoAuth = <T>(path: string, init?: RequestInit, authenticated = true) => request<T>(xanoConfig.authBaseUrl, path, init, authenticated);
