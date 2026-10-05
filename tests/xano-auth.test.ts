import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auth, LocalAuthProvider } from '../src/data/auth';
import { db } from '../src/data/db';
import { clearXanoToken, getXanoSessionError, getXanoSessionRevision, getXanoSessionUserId, getXanoToken, hasXanoSession, setXanoToken, subscribeXanoSession, xanoApi } from '../src/data/xano/client';
import { validateXanoSession } from '../src/data/xano/auth';
import { syncAllForUser } from '../src/data/sync';

vi.mock('../src/data/xano/config', () => ({ xanoConfig: { enabled: true, apiBaseUrl: 'https://api.test', authBaseUrl: 'https://auth.test' }, xanoReady: () => true }));
vi.mock('../src/data/sync', () => ({ syncAllForUser: vi.fn().mockResolvedValue(undefined), hydrateUserFromXano: vi.fn().mockResolvedValue(1) }));
const local = new LocalAuthProvider();
const password = 'SenhaLocal123456';
const fetchMock = vi.fn<typeof fetch>();
const storage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() };
};

beforeEach(async () => {
  vi.stubGlobal('localStorage', storage()); vi.stubGlobal('sessionStorage', storage());
  vi.stubGlobal('navigator', { onLine: true }); vi.stubGlobal('fetch', fetchMock);
  clearXanoToken(); fetchMock.mockReset(); vi.mocked(syncAllForUser).mockClear();
  await local.signOut(); await db.users.clear(); await db.credentials.clear(); await db.wallets.clear();
});
afterEach(() => { clearXanoToken(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('sessão Xano vinculada à conta local', () => {
  it('cadastro BS Wallet autentica e inicia sync sem conexão adicional', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      const { password: _password, ...user } = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ authToken: 'individual-token', user }));
    });
    const user = await auth.signUp({ name: 'Nova pessoa', email: 'nova@test.com', username: 'nova', password });
    expect(fetchMock.mock.calls[0][0]).toBe('https://auth.test/auth/signup');
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has('Authorization')).toBe(false);
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ id: user.id, name: user.name, email: user.email, password });
    expect(hasXanoSession(user.id)).toBe(true);
    await vi.waitFor(() => expect(syncAllForUser).toHaveBeenCalledWith(user));
  });

  it('login BS Wallet usa a senha do app e retoma sync automaticamente', async () => {
    const user = await local.signUp({ name: 'A', email: 'a@test.com', username: 'user-a', password });
    await local.signOut();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ authToken: 'individual-token', user })));
    await auth.signIn(user.email, password);
    expect(fetchMock.mock.calls[0][0]).toBe('https://auth.test/auth/login');
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ email: user.email, password });
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has('Authorization')).toBe(false);
    expect(hasXanoSession(user.id)).toBe(true);
    await vi.waitFor(() => expect(syncAllForUser).toHaveBeenCalledWith(user));
  });

  it('login de cadastro feito offline cria a conta na nuvem com o mesmo UUID', async () => {
    const user = await local.signUp({ name: 'A', email: 'a@test.com', username: 'user-a', password });
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ authToken: 'individual-token', user })));
    expect((await auth.signIn(user.email, password)).id).toBe(user.id);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['https://auth.test/auth/login', 'https://auth.test/auth/signup']);
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string).id).toBe(user.id);
    expect(hasXanoSession(user.id)).toBe(true);
    await vi.waitFor(() => expect(syncAllForUser).toHaveBeenCalledWith(user));
  });

  it('não aceita token legado para sync antes de validar /auth/me', async () => {
    setXanoToken('legacy', true);
    expect(hasXanoSession('user-a')).toBe(false);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'user-a', name: 'A', email: 'a@test.com' })));
    expect(await validateXanoSession('user-a')).toBe(true);
    expect(hasXanoSession('user-a')).toBe(true);
    expect(getXanoSessionUserId()).toBe('user-a');
  });

  it('descarta token de outra conta durante validação', async () => {
    setXanoToken('wrong-account', true);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'user-b', active: true })));
    expect(await validateXanoSession('user-a')).toBe(false);
    expect(getXanoToken()).toBeNull();
    expect(getXanoSessionError()).toContain('outra conta');
  });

  it('mantém token legado sem habilitar sync quando /auth/me falha por rede', async () => {
    setXanoToken('legacy', true);
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await validateXanoSession('user-a')).toBe(false);
    expect(getXanoToken()).toBe('legacy');
    expect(hasXanoSession('user-a')).toBe(false);
    expect(getXanoSessionError()).toBe('Failed to fetch');
  });

  it('não mostra vínculo com usuário órfão sem token armazenado', () => {
    localStorage.setItem('bs-wallet-xano-token-user', 'user-a');
    expect(getXanoSessionUserId()).toBeNull();
    expect(hasXanoSession('user-a')).toBe(false);
  });

  it('descarta token ao restaurar sem sessão local', async () => {
    setXanoToken('token-a', true, 'user-a');
    expect(await auth.restoreSession()).toBeNull();
    expect(getXanoToken()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('descarta vínculo divergente offline antes de qualquer chamada remota', async () => {
    const user = await local.signUp({ name: 'B', email: 'b@test.com', username: 'user-b', password });
    setXanoToken('token-a', true, 'user-a');
    vi.stubGlobal('navigator', { onLine: false });
    expect((await auth.restoreSession())?.id).toBe(user.id);
    expect(getXanoToken()).toBeNull();
    expect(getXanoSessionError()).toContain('outra conta');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('limpa token anterior ao entrar offline com outra conta local', async () => {
    const user = await local.signUp({ name: 'B', email: 'b@test.com', username: 'user-b', password });
    setXanoToken('token-a', true, 'user-a');
    vi.stubGlobal('navigator', { onLine: false });
    expect((await auth.signIn('user-b', password)).id).toBe(user.id);
    expect(getXanoToken()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('recusa conectar UUID diferente e preserva sessão e carteira locais', async () => {
    const user = await local.signUp({ name: 'A', email: 'a@test.com', username: 'user-a', password });
    const wallets = await db.wallets.toArray();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ authToken: 'remote-token', user: { id: 'different', name: 'A', email: user.email } })));
    await auth.signIn(user.email, password);
    expect(getXanoSessionError()).toContain('UUID diferente');
    expect((await local.restoreSession())?.id).toBe(user.id);
    expect(await db.wallets.toArray()).toEqual(wallets);
    expect(getXanoToken()).toBeNull();
    expect(syncAllForUser).not.toHaveBeenCalled();
  });

  it('mantém login local e exibe falha de rede na conexão remota', async () => {
    const user = await local.signUp({ name: 'A', email: 'a@test.com', username: 'user-a', password });
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect((await auth.signIn(user.email, password)).id).toBe(user.id);
    expect(getXanoSessionError()).toBe('Failed to fetch');
    expect(getXanoToken()).toBeNull();
  });

  it('preserva UUID enviado no cadastro se a confirmação remota falhar', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const user = await auth.signUp({ name: 'A', email: 'a@test.com', username: 'user-a', password });
    const submitted = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(user.id).toBe(submitted.id);
    expect((await local.restoreSession())?.id).toBe(user.id);
    expect(getXanoSessionError()).toBe('Failed to fetch');
  });

  it('uma resposta 401 antiga não invalida a nova sessão', async () => {
    let respond!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise(resolve => { respond = resolve; }));
    setXanoToken('token-a', true, 'user-a');
    const request = xanoApi('/sync/workspaces');
    setXanoToken('token-b', true, 'user-b');
    respond(new Response(JSON.stringify({ message: 'Expired' }), { status: 401 }));
    await expect(request).rejects.toThrow('Expired');
    expect(hasXanoSession('user-b')).toBe(true);
  });

  it('expiração atual invalida o token e notifica snapshots estáveis', async () => {
    const listener = vi.fn(), unsubscribe = subscribeXanoSession(listener);
    setXanoToken('token-a', true, 'user-a');
    const revision = getXanoSessionRevision();
    expect(getXanoSessionRevision()).toBe(revision);
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
    await expect(xanoApi('/sync/workspaces')).rejects.toThrow();
    expect(getXanoToken()).toBeNull();
    expect(getXanoSessionError()).toContain('expirou');
    expect(getXanoSessionRevision()).toBeGreaterThan(revision);
    expect(listener).toHaveBeenCalled(); unsubscribe();
  });

  it('limita a espera de rede e mantém token em falhas transitórias', async () => {
    vi.useFakeTimers();
    setXanoToken('token-a', true, 'user-a');
    fetchMock.mockImplementation((_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
    const request = xanoApi('/sync/workspaces');
    const assertion = expect(request).rejects.toThrow('demorou');
    await vi.advanceTimersByTimeAsync(15_000); await assertion;
    expect(hasXanoSession('user-a')).toBe(true);
  });
});


it('invalida token com HTTP 401 e usa mensagem de login normal', async () => {
  setXanoToken('token-a', false, 'user-a');
  fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
  await expect(xanoApi('/sync/workspaces')).rejects.toThrow();
  expect(getXanoToken()).toBeNull();
  expect(getXanoSessionError()).toBe('Sua sessão expirou. Entre novamente para continuar sincronizando.');
});

it('mantém sessão válida quando uma ação é recusada por falta de permissão', async () => {
  setXanoToken('token-a', false, 'user-a');
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: 'Convite pertence a outro e-mail.' }), { status: 403 }));
  await expect(xanoApi('/workspace/invites/accept', { method: 'POST', body: '{}' })).rejects.toThrow('outro e-mail');
  expect(hasXanoSession('user-a')).toBe(true);
  expect(getXanoSessionError()).toBe('');
});

it('login sem usuário na resposta consulta auth/me e persiste somente token individual', async () => {
  const user = { id: 'new-user', name: 'Maria', email: 'maria@test.com' };
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ authToken: 'maria-token' })))
    .mockResolvedValueOnce(new Response(JSON.stringify(user)));
  expect((await auth.signIn(user.email, password, false)).id).toBe(user.id);
  expect(fetchMock.mock.calls[1][0]).toBe('https://auth.test/auth/me');
  expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('Authorization')).toBe('Bearer maria-token');
  expect(sessionStorage.getItem('bs-wallet-xano-session-token')).toBe('maria-token');
  expect(localStorage.getItem('bs-wallet-xano-token')).toBeNull();
  expect(hasXanoSession(user.id)).toBe(true);
});
