import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/data/db';
import { initialWallet } from '../src/data/factory';
import { walletService } from '../src/data/wallet-service';
import { isSyncing, startAutoSync, syncWallet } from '../src/data/sync';
import { xanoApi, XanoError } from '../src/data/xano/client';
import type { Context, User } from '../src/domain/types';

const control = vi.hoisted(() => ({ enabled: true, token: 'test-token' as string | null }));
vi.mock('../src/data/xano/config', () => ({ xanoConfig: { enabled: true }, xanoReady: () => control.enabled }));
vi.mock('../src/data/xano/client', async importOriginal => ({ ...await importOriginal<typeof import('../src/data/xano/client')>(), getXanoToken: () => control.token, xanoApi: vi.fn() }));
vi.mock('../src/data/auth', () => ({ auth: { requireUser: vi.fn().mockResolvedValue(undefined) } }));
const api = vi.mocked(xanoApi);
const user: User = { id: 'user-test', name: 'Teste', email: 'test@example.com', username: 'test', createdAt: '2026-01-01' };
let ctx: Context;
let cleanup: (() => void) | undefined;
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };

async function create(name = 'Compra') {
  const wallet = (await db.wallets.get(ctx.workspaceId))!;
  return walletService.createTransaction(ctx, { name, amount: 1000, type: 'expense', status: 'confirmed', transactionDate: '2026-10-05', competenceDate: '2026-10-05', categoryId: wallet.categories.find(c => c.type !== 'income')!.id, paymentMode: 'single', scope: 'shared' });
}
async function snapshot() {
  const wallet = (await db.wallets.get(ctx.workspaceId))!;
  return { workspace: { id: wallet.id, name: wallet.workspace.name, created_by: user.id }, transactions: wallet.transactions.map(t => ({ ...t, workspace_id: wallet.id, owner_user_id: user.id })) };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.stubGlobal('navigator', { onLine: true });
  control.enabled = true; control.token = 'test-token';
  api.mockReset();
  await db.wallets.clear(); await db.syncMeta.clear(); await db.attachments.clear();
  const wallet = initialWallet(user);
  await db.wallets.put(wallet);
  ctx = { user, workspaceId: wallet.id };
  await db.syncMeta.put({ id: wallet.id, bootstrapQueued: true });
  api.mockImplementation(async (_path, init) => init?.method === 'POST' ? { ok: true } : snapshot());
});
afterEach(() => { cleanup?.(); cleanup = undefined; vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('sincronização automática offline-first', () => {
  it('retorna o lançamento salvo antes da rede e envia o mesmo UUID após o commit local', async () => {
    const [tx] = await create();
    expect(api).not.toHaveBeenCalled();
    expect((await db.wallets.get(ctx.workspaceId))!.outbox).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(0);
    await syncWallet(ctx);
    const envelope = JSON.parse(api.mock.calls.find(([, init]) => init?.method === 'POST')![1]!.body as string);
    expect(envelope.entity_id).toBe(tx.id);
    const saved = (await db.wallets.get(ctx.workspaceId))!;
    expect(saved.outbox).toHaveLength(0);
    expect(saved.transactions[0]).toMatchObject({ id: tx.id, syncStatus: 'synced' });
  });

  it('preserva dados offline e envia ao receber online; cleanup remove listener e timer', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const target = new EventTarget();
    cleanup = startAutoSync(user, target);
    await create();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api).not.toHaveBeenCalled();
    expect((await db.wallets.get(ctx.workspaceId))!.outbox).toHaveLength(1);
    vi.stubGlobal('navigator', { onLine: true });
    target.dispatchEvent(new Event('online'));
    await syncWallet(ctx);
    expect((await db.wallets.get(ctx.workspaceId))!.outbox).toHaveLength(0);
    cleanup(); cleanup = undefined; api.mockClear();
    target.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api).not.toHaveBeenCalled();
  });

  it('reutiliza a mesma Promise e preserva uma edição criada durante o envio', async () => {
    const [tx] = await create();
    const gate = deferred(), entered = deferred();
    api.mockImplementation(async () => { entered.resolve(); await gate.promise; return { ok: true }; });
    const first = syncWallet(ctx);
    expect(syncWallet(ctx)).toBe(first);
    await entered.promise;
    expect(isSyncing(ctx.workspaceId)).toBe(true);
    await walletService.save(ctx, 'transactions', { ...tx, name: 'Editado' }, tx.id, tx.version);
    gate.resolve();
    expect(await first).toEqual({ status: 'pending' });
    const saved = (await db.wallets.get(ctx.workspaceId))!;
    expect(api).toHaveBeenCalledTimes(1);
    expect(saved.outbox).toHaveLength(1);
    expect(saved.transactions[0]).toMatchObject({ name: 'Editado', syncStatus: 'local' });
    expect(isSyncing(ctx.workspaceId)).toBe(false);
  });

  it.each([new XanoError(500, 'HTTP 500'), new XanoError(0, 'Sem rede')])('preserva operação e registra falha: %s', async error => {
    await create(); api.mockRejectedValue(error);
    await expect(syncWallet(ctx)).rejects.toThrow(error.message);
    const saved = (await db.wallets.get(ctx.workspaceId))!;
    expect(saved.transactions).toHaveLength(1); expect(saved.outbox).toHaveLength(1);
    expect(saved.transactions[0].syncStatus).not.toBe('synced');
    expect((await db.syncMeta.get(ctx.workspaceId))!.lastError).toBe(error.message);
    expect(isSyncing(ctx.workspaceId)).toBe(false);
  });

  it('remove apenas os IDs confirmados antes de uma falha parcial', async () => {
    await create('A'); await create('B');
    const ids = (await db.wallets.get(ctx.workspaceId))!.outbox.map(c => c.id);
    api.mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new XanoError(500, 'Falha'));
    await expect(syncWallet(ctx)).rejects.toThrow('Falha');
    expect((await db.wallets.get(ctx.workspaceId))!.outbox.map(c => c.id)).toEqual([ids[1]]);
    expect((await db.syncMeta.get(ctx.workspaceId))!.lastSuccessAt).toBeUndefined();
  });

  it('não descarta operação sem confirmação explícita do Xano', async () => {
    await create(); api.mockResolvedValue({ ok: false });
    await expect(syncWallet(ctx)).rejects.toThrow('não confirmou');
    expect((await db.wallets.get(ctx.workspaceId))!.outbox).toHaveLength(1);
  });

  it('não sobrescreve uma alteração salva enquanto o pull estava em andamento', async () => {
    const remote = await snapshot(), gate = deferred(), entered = deferred();
    api.mockImplementation(async () => { entered.resolve(); await gate.promise; return remote; });
    const task = syncWallet(ctx); await entered.promise;
    await create('Durante pull'); gate.resolve(); expect((await task).status).toBe('pending');
    const saved = (await db.wallets.get(ctx.workspaceId))!;
    expect(saved.transactions[0].name).toBe('Durante pull'); expect(saved.outbox).toHaveLength(1);
  });

  it('faz pull periódico sem POST vazio e respeita configuração e token', async () => {
    cleanup = startAutoSync(user, new EventTarget());
    await vi.advanceTimersByTimeAsync(60_000); await syncWallet(ctx);
    expect(api.mock.calls.every(([, init]) => !init?.method)).toBe(true);
    expect(api).toHaveBeenCalled(); api.mockClear();
    control.enabled = false;
    await vi.advanceTimersByTimeAsync(60_000); await syncWallet(ctx);
    control.enabled = true; control.token = null;
    await vi.advanceTimersByTimeAsync(60_000); await syncWallet(ctx);
    expect(api).not.toHaveBeenCalled();
  });

  it('preserva bootstrap dos cadastros existentes e os conflitos', async () => {
    await db.syncMeta.delete(ctx.workspaceId);
    api.mockRejectedValue(new XanoError(409, 'SYNC_CONFLICT', { remote_version: 2 }));
    expect((await syncWallet(ctx)).status).toBe('conflict');
    const saved = (await db.wallets.get(ctx.workspaceId))!;
    expect(saved.outbox.some(c => c.entityType === 'workspace')).toBe(true);
    expect(saved.outbox.some(c => c.entityType === 'categories')).toBe(true);
    expect(saved.categories[0].syncStatus).toBe('conflict');
    expect((await db.syncMeta.get(ctx.workspaceId))!.lastError).toContain('conflitos');
  });
});
