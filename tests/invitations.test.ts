import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capabilities } from '../src/domain/types';
import { clearXanoToken, getXanoToken, hasXanoSession, setXanoToken } from '../src/data/xano/client';
import { acceptInvite, createInvite, declineInvite, listWorkspaceInvites, pendingInvites, regenerateInvite, resolveInvite, revokeInvite } from '../src/data/invitations';

vi.mock('../src/data/xano/config', () => ({ xanoConfig: { enabled: true, apiBaseUrl: 'https://invites.test', authBaseUrl: 'https://auth.test' }, xanoReady: () => true }));
const fetchMock = vi.fn<typeof fetch>();
const storage = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }; };
const invite = { id: 'invite-1', workspace_id: 'workspace-1', email: 'maria@example.invalid', role: 'member', permissions: ['shared.read'], status: 'pending', created_at: 1791201600000, updated_at: 1791201600000, expires_at: 1791806400000, accepted_at: null, send_count: 1 };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const body = () => JSON.parse(fetchMock.mock.calls.at(-1)![1]!.body as string);
const authorization = () => new Headers(fetchMock.mock.calls.at(-1)![1]!.headers).get('Authorization');

beforeEach(() => {
  vi.stubGlobal('localStorage', storage()); vi.stubGlobal('sessionStorage', storage());
  vi.stubGlobal('navigator', { onLine: true }); vi.stubGlobal('fetch', fetchMock);
  clearXanoToken(); setXanoToken('normal-user-token', true, 'user-1'); fetchMock.mockReset();
});
afterEach(() => { clearXanoToken(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('convites online pelo token normal BS Wallet', () => {
  it('cria convite autenticado na origem configurada e envia apenas o contrato autorizado', async () => {
    fetchMock.mockResolvedValue(json({ invite: { ...invite, token_hash: 'never-return-hash' }, token: 'share-once-token' }));
    const result = await createInvite({ workspace_id: invite.workspace_id, email: invite.email, role: 'member', permissions: ['shared.read'] });
    expect(fetchMock.mock.calls[0][0]).toBe('https://invites.test/workspace/invites/create');
    expect(authorization()).toBe('Bearer normal-user-token');
    expect(body()).toEqual({ workspace_id: invite.workspace_id, email: invite.email, role: 'member', permissions: ['shared.read'] });
    expect(result.token).toBe('share-once-token');
    expect(result.invite).not.toHaveProperty('token_hash');
  });

  it('resolve token antes do login, sem Authorization e sem retornar dados privados extras', async () => {
    clearXanoToken();
    fetchMock.mockResolvedValue(json({ valid: true, workspace_name: 'Família teste', role: 'member', masked_email: 'ma***@example.invalid', expires_at: invite.expires_at, token_hash: 'private-hash', token: 'private-token', transactions: [{ amount: 9000 }] }));
    const result = await resolveInvite('link-token');
    expect(fetchMock.mock.calls[0][0]).toBe('https://invites.test/workspace/invites/resolve');
    expect(authorization()).toBeNull();
    expect(body()).toEqual({ token: 'link-token' });
    expect(result).toMatchObject({ valid: true, workspace_name: 'Família teste', expires_at: new Date(invite.expires_at).toISOString() });
    expect(JSON.stringify(result)).not.toMatch(/private-hash|private-token|transactions/);
  });

  it('consulta pendentes sem aceitar email arbitrário e remove segredos da resposta', async () => {
    fetchMock.mockResolvedValue(json([{ ...invite, workspace_name: 'Família teste', token_hash: 'do-not-persist', token: 'do-not-persist' }]));
    const result = await pendingInvites();
    expect(fetchMock.mock.calls[0][0]).toBe('https://invites.test/workspace/invites/pending');
    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined();
    expect(authorization()).toBe('Bearer normal-user-token');
    expect(result).toHaveLength(1);
    expect(result[0].permissions).toEqual(['shared.read']);
    expect(JSON.stringify(result)).not.toContain('do-not-persist');
  });

  it('lista apenas workspace solicitado e mantém permissões vazias sem defaults', async () => {
    fetchMock.mockResolvedValue(json([{ ...invite, permissions: [], token_hash: 'hidden' }]));
    const result = await listWorkspaceInvites('workspace /1');
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/workspace/invites/list');
    expect(url.searchParams.get('workspace_id')).toBe('workspace /1');
    expect(result[0].permissions).toEqual([]);
    expect(result[0]).not.toHaveProperty('token_hash');
  });

  it.each([{ token: 'link-token' }, { invite_id: 'invite-1' }])('aceita convite pelo alvo %o', async target => {
    fetchMock.mockResolvedValue(json({ ok: true, workspace_id: 'workspace-1', membership_id: 'member-1' }));
    expect(await acceptInvite(target)).toEqual({ ok: true, workspace_id: 'workspace-1', membership_id: 'member-1' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://invites.test/workspace/invites/accept');
    expect(body()).toEqual(target);
    expect(authorization()).toBe('Bearer normal-user-token');
  });

  it('recusa e revoga usando IDs no corpo, sem tokens em URLs', async () => {
    fetchMock.mockImplementation(async () => json({ ok: true }));
    await declineInvite({ invite_id: 'invite-1' });
    expect(body()).toEqual({ invite_id: 'invite-1' });
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('https://invites.test/workspace/invites/decline');
    await revokeInvite('invite-1');
    expect(body()).toEqual({ invite_id: 'invite-1' });
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('https://invites.test/workspace/invites/revoke');
  });

  it('regenera link preservando token somente no resultado transitório', async () => {
    fetchMock.mockResolvedValue(json({ invite: { ...invite, send_count: 2, token_hash: 'hash-must-stay-remote' }, token: 'new-link-token' }));
    const result = await regenerateInvite('invite-1');
    expect(body()).toEqual({ invite_id: 'invite-1' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://invites.test/workspace/invites/regenerate');
    expect(result.token).toBe('new-link-token');
    expect(result.invite.send_count).toBe(2);
    expect(JSON.stringify(result.invite)).not.toContain('hash-must-stay-remote');
    expect(localStorage.getItem('new-link-token')).toBeNull();
  });

  it('recusa operações offline antes de usar a rede', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    await expect(createInvite({ workspace_id: 'workspace-1', email: invite.email, role: 'member', permissions: [] })).rejects.toThrow(/internet|online/i);
    await expect(pendingInvites()).rejects.toThrow(/internet|online/i);
    await expect(acceptInvite({ token: 'token' })).rejects.toThrow(/internet|online/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exige sessão nas operações autenticadas', async () => {
    clearXanoToken();
    await expect(pendingInvites()).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('erro 403 de destinatário incorreto mantém a sessão individual', async () => {
    fetchMock.mockResolvedValue(json({ message: 'Este convite pertence a outro e-mail.' }, 403));
    await expect(acceptInvite({ token: 'another-person-token' })).rejects.toThrow(/outro e-mail/);
    expect(getXanoToken()).toBe('normal-user-token');
    expect(hasXanoSession('user-1')).toBe(true);
  });

  it('erro 401 expira a sessão sem fabricar sucesso', async () => {
    fetchMock.mockResolvedValue(json({ message: 'Sessão expirada' }, 401));
    await expect(pendingInvites()).rejects.toThrow(/expirada/);
    expect(getXanoToken()).toBeNull();
  });

  it.each([409, 410, 500])('propaga falha HTTP %i sem suprimir o erro', async status => {
    fetchMock.mockResolvedValue(json({ message: 'Convite indisponível' }, status));
    await expect(acceptInvite({ invite_id: 'invite-1' })).rejects.toThrow('Convite indisponível');
    expect(getXanoToken()).toBe('normal-user-token');
  });

  it('utiliza as capabilities existentes, sem nomenclatura alternativa', async () => {
    fetchMock.mockResolvedValue(json({ invite: { ...invite, permissions: [...capabilities] }, token: 'link-token' }));
    await createInvite({ workspace_id: 'workspace-1', email: invite.email, role: 'admin', permissions: [...capabilities] });
    expect(body().permissions).toEqual([...capabilities]);
  });
});

import { db } from '../src/data/db';
import { initialWallet } from '../src/data/factory';
import { hydrateUserFromXano } from '../src/data/sync';
import { loadAcceptedWorkspace } from '../src/components/InvitationSupport';
vi.mock('../src/data/sync', () => ({ hydrateUserFromXano: vi.fn() }));

describe('validação do contrato e retorno ao workspace aceito', () => {
  it('normaliza email e impede envio de invited_by fornecido pelo cliente', async () => {
    fetchMock.mockResolvedValue(json({ invite, token: 'token' }));
    await createInvite({ workspace_id: 'workspace-1', email: ' MARIA@EXAMPLE.INVALID ', role: 'member', permissions: [], invited_by: 'forged-user' } as Parameters<typeof createInvite>[0]);
    expect(body()).toEqual({ workspace_id: 'workspace-1', email: 'maria@example.invalid', role: 'member', permissions: [] });
  });
  it('rejeita admin_master e capability inventada antes da rede', async () => {
    await expect(createInvite({ workspace_id: 'workspace-1', email: invite.email, role: 'admin_master', permissions: [] } as unknown as Parameters<typeof createInvite>[0])).rejects.toThrow();
    await expect(createInvite({ workspace_id: 'workspace-1', email: invite.email, role: 'member', permissions: ['invented.permission'] } as unknown as Parameters<typeof createInvite>[0])).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('não aceita token e invite_id juntos nem alvo vazio', async () => {
    await expect(acceptInvite({ token: 'token', invite_id: 'invite-1' } as unknown as Parameters<typeof acceptInvite>[0])).rejects.toThrow();
    await expect(declineInvite({} as Parameters<typeof declineInvite>[0])).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('resposta inesperada não é tratada como aceite confirmado', async () => {
    fetchMock.mockResolvedValue(json({ ok: true, token_hash: 'unexpected-secret' }));
    await expect(acceptInvite({ token: 'token' })).rejects.toThrow(/formato inesperado/);
  });
  it('retorno valid=false não expõe campos extras de resposta', async () => {
    fetchMock.mockResolvedValue(json({ valid: false, token: 'unexpected-secret', token_hash: 'unexpected-secret' }));
    expect(await resolveInvite('invalid-token')).toEqual({ valid: false });
  });
  it('só conclui hidratação quando membership ativa está no IndexedDB; repetir não reenvia aceite', async () => {
    const user = { id: 'user-1', name: 'Maria', email: invite.email, username: 'maria', createdAt: '2026-10-05' };
    await db.wallets.clear();
    vi.mocked(hydrateUserFromXano).mockReset().mockResolvedValue(0);
    await expect(loadAcceptedWorkspace(user, 'joined-family')).rejects.toThrow(/ainda não foi carregada/);
    const wallet = initialWallet(user); wallet.id = 'joined-family'; wallet.workspace.id = wallet.id;
    vi.mocked(hydrateUserFromXano).mockImplementationOnce(async () => { await db.wallets.put(wallet); return 1; });
    await expect(loadAcceptedWorkspace(user, 'joined-family')).resolves.toBeUndefined();
    expect(hydrateUserFromXano).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
    await db.wallets.clear();
  });
  it('não conclui callback com membership desabilitada', async () => {
    const user = { id: 'user-1', name: 'Maria', email: invite.email, username: 'maria', createdAt: '2026-10-05' };
    const wallet = initialWallet(user); wallet.members[0].status = 'disabled'; await db.wallets.put(wallet);
    vi.mocked(hydrateUserFromXano).mockReset().mockResolvedValue(1);
    await expect(loadAcceptedWorkspace(user, wallet.id)).rejects.toThrow(/ainda não foi carregada/);
    await db.wallets.clear();
  });
});

