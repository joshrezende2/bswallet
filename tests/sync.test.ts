import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/data/db';
import { initialWallet } from '../src/data/factory';
import { record, recordAudit, walletService } from '../src/data/wallet-service';
import { hydrateUserFromXano, isSyncing, startAutoSync, syncWallet } from '../src/data/sync';
import { xanoApi, XanoError } from '../src/data/xano/client';
import type { Context, User } from '../src/domain/types';
import { missingRecordFields } from './helpers/xano-contract';

const control = vi.hoisted(() => ({ enabled: true, token: 'test-token' as string | null, revision: 1 }));
vi.mock('../src/data/xano/config', () => ({ xanoConfig: { enabled: true }, xanoReady: () => control.enabled }));
vi.mock('../src/data/xano/client', async importOriginal => ({ ...await importOriginal<typeof import('../src/data/xano/client')>(), getXanoToken: () => control.token, hasXanoSession: (id: string) => Boolean(control.token) && id === 'user-test', getXanoSessionRevision: () => control.revision, getXanoSessionUserId: () => control.token ? 'user-test' : null, xanoApi: vi.fn() }));
vi.mock('../src/data/auth', () => ({ auth: { requireUser: vi.fn().mockResolvedValue(undefined) } }));
const api = vi.mocked(xanoApi);
const user: User = { id: 'user-test', name: 'Teste', email: 'test@example.com', username: 'test', createdAt: '2026-01-01' };
let ctx: Context;
let cleanup: (() => void) | undefined;
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };

async function create(name = 'Compra', scope: 'shared' | 'personal' = 'shared') {
  const wallet = (await db.wallets.get(ctx.workspaceId))!;
  return walletService.createTransaction(ctx, { name, amount: 1000, type: 'expense', status: 'confirmed', transactionDate: '2026-10-05', competenceDate: '2026-10-05', categoryId: wallet.categories.find(c => c.type !== 'income')!.id, paymentMode: 'single', scope });
}
async function snapshot() {
  const wallet = (await db.wallets.get(ctx.workspaceId))!;
  return { workspace: { id: wallet.id, name: wallet.workspace.name, created_by: user.id }, transactions: wallet.transactions.map(t => ({ ...t, workspace_id: wallet.id, owner_user_id: user.id })) };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.stubGlobal('navigator', { onLine: true });
  control.enabled = true; control.token = 'test-token'; control.revision = 1;
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
  it('migra resumo legado de backup para auditoria durável e envia importações financeiras normalmente', async () => {
    await create('Dado importado');
    const state = (await db.wallets.get(ctx.workspaceId))!;
    record(state, ctx, 'backup', 'import', { id: state.id, scope: 'personal', ownerUserId: user.id });
    const legacy = state.outbox.at(-1)!;
    const audit = state.audit.filter(a => a.entityType === 'backup');
    await db.wallets.put(state);
    expect((await syncWallet(ctx)).status).toBe('synced');
    expect((await db.syncMeta.get(state.id))!.localAuditEvents).toEqual([legacy]);
    expect((await db.wallets.get(state.id))!.audit).toEqual(expect.arrayContaining(audit));
    expect((await db.wallets.get(state.id))!.outbox).toHaveLength(0);
    expect(api.mock.calls.filter(([, init]) => init?.method === 'POST').map(([path]) => path)).toEqual(['/sync/transactions']);
    await syncWallet(ctx);
    expect((await db.syncMeta.get(state.id))!.localAuditEvents).toEqual([legacy]);
    expect((await db.wallets.get(state.id))!.audit).toEqual(expect.arrayContaining(audit));
  });

  it('auditoria local nova não cria uma operação financeira', async () => {
    const state = (await db.wallets.get(ctx.workspaceId))!;
    recordAudit(state, ctx, 'backup', 'import', { id: state.id, scope: 'personal', ownerUserId: user.id });
    expect(state.audit.at(-1)).toMatchObject({ entityType: 'backup', action: 'import' });
    expect(state.outbox).toHaveLength(0);
  });

  it('não ignora tipos desconhecidos nem remove operações financeiras quando o servidor falha', async () => {
    await create();
    const state = (await db.wallets.get(ctx.workspaceId))!;
    const financial = structuredClone(state.outbox);
    record(state, ctx, 'backup', 'import', { id: state.id, scope: 'personal', ownerUserId: user.id });
    const legacy = state.outbox.at(-1)!;
    await db.wallets.put(state);
    api.mockRejectedValueOnce(new XanoError(500, 'Falha real'));
    await expect(syncWallet(ctx)).rejects.toThrow('Falha real');
    expect((await db.wallets.get(state.id))!.outbox).toEqual(financial);
    expect((await db.syncMeta.get(state.id))!.localAuditEvents).toEqual([legacy]);
    const current = (await db.wallets.get(state.id))!;
    current.outbox = [{ ...legacy, entityType: 'unknown' }];
    await db.wallets.put(current);
    await expect(syncWallet(ctx)).rejects.toThrow('Entidade sem mapeamento Xano: unknown');
    expect((await db.wallets.get(state.id))!.outbox).toEqual(current.outbox);
  });

  it('reenvia uma operação antiga após record.person_id sem perder o lançamento nem limpar IndexedDB', async () => {
    const wallet = (await db.wallets.get(ctx.workspaceId))!;
    const [tx] = await walletService.createTransaction(ctx, { name: 'Teste Sync', amount: 100, type: 'expense', status: 'confirmed', transactionDate: '2026-10-05', competenceDate: '2026-10-05', categoryId: wallet.categories.find(c => c.type !== 'income')!.id, paymentMode: 'single', scope: 'shared' });
    const queued = (await db.wallets.get(ctx.workspaceId))!.outbox;
    api.mockRejectedValueOnce(new XanoError(400, 'Unable to locate input: record.person_id'));
    await expect(syncWallet(ctx)).rejects.toThrow('record.person_id');
    const failed = (await db.wallets.get(ctx.workspaceId))!;
    expect(failed.transactions).toEqual([tx]);
    expect(failed.outbox).toEqual(queued);
    // Emulate an older JSON export/reload: undefined properties are entirely absent.
    failed.outbox = JSON.parse(JSON.stringify(failed.outbox));
    await db.wallets.put(failed);
    let remote: Record<string, unknown> | undefined;
    api.mockImplementation(async (path, init) => {
      if (init?.method === 'POST') {
        const envelope = JSON.parse(init.body as string);
        expect(path).toBe('/sync/transactions');
        expect(missingRecordFields(envelope.table, envelope.record)).toEqual([]);
        expect(envelope.record).toMatchObject({ id: tx.id, name: 'Teste Sync', amount: 100, category_id: tx.categoryId, person_id: null, account_id: null, card_id: null, notes: null });
        remote = envelope;
        return { ok: true };
      }
      const sent = remote as { record: unknown; payload: unknown };
      return { workspace: { id: wallet.id, name: wallet.workspace.name, created_by: user.id }, transactions: [sent.record], audit_logs: [{ entity_type: 'transactions', entity_id: tx.id, timestamp: tx.createdAt, after_data: sent.payload }] };
    });
    expect((await syncWallet(ctx)).status).toBe('synced');
    const saved = (await db.wallets.get(ctx.workspaceId))!;
    expect(saved.outbox).toEqual([]);
    expect(saved.transactions).toHaveLength(1);
    expect(saved.transactions[0]).toMatchObject({ id: tx.id, name: 'Teste Sync', amount: 100, syncStatus: 'synced' });
  });

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

  it('hidratação de família existente preserva edições pendentes quando o envio falha', async () => {
    const [tx] = await create('Minha edição local');
    const before = (await db.wallets.get(ctx.workspaceId))!;
    api.mockImplementation(async path => {
      if (path === '/sync/workspaces') return [{ workspace_id: ctx.workspaceId }];
      throw new XanoError(0, 'Conexão interrompida');
    });
    await expect(hydrateUserFromXano(user)).rejects.toThrow('Conexão interrompida');
    const saved = (await db.wallets.get(ctx.workspaceId))!;
    expect(saved.transactions).toEqual([tx]);
    expect(saved.outbox).toEqual(before.outbox);
    expect(api.mock.calls.some(([path]) => path.startsWith('/sync/bootstrap'))).toBe(false);
    expect((await db.syncMeta.get(ctx.workspaceId))!.lastSuccessAt).toBeUndefined();
  });

  it('envia snapshot completo e escopo privado ao excluir um lançamento pessoal', async () => {
    const [tx] = await create('Despesa privada', 'personal');
    await walletService.remove(ctx, 'transactions', tx.id);
    const local = (await db.wallets.get(ctx.workspaceId))!;
    const deletion = local.outbox.find(change => change.action === 'delete')!;
    expect(deletion.payload).toMatchObject({ id: tx.id, name: tx.name, amount: tx.amount, categoryId: tx.categoryId, scope: 'personal', ownerUserId: user.id });
    await syncWallet(ctx);
    const sent = api.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(init!.body as string));
    expect(sent.find(envelope => envelope.action === 'delete')).toMatchObject({
      entity_id: tx.id,
      record: { scope: 'private', owner_user_id: user.id },
      payload: { name: tx.name, amount: tx.amount, categoryId: tx.categoryId, scope: 'personal', ownerUserId: user.id },
    });
  });

  it('interrompe POSTs e pull se a sessão muda durante um envio', async () => {
    await create('A'); await create('B');
    const pending = (await db.wallets.get(ctx.workspaceId))!.outbox;
    const entered = deferred(), gate = deferred();
    api.mockImplementation(async () => { entered.resolve(); await gate.promise; return { ok: true }; });
    const request = syncWallet(ctx);
    await entered.promise;
    control.revision += 1;
    gate.resolve();
    await expect(request).rejects.toThrow('sessão Xano mudou');
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0][1]?.method).toBe('POST');
    expect((await db.wallets.get(ctx.workspaceId))!.outbox).toEqual(pending);
    expect((await db.syncMeta.get(ctx.workspaceId))!.lastSuccessAt).toBeUndefined();
  });

  it('preserva registros, lixeira e auditoria privados de outra conta durante pull', async () => {
    const [tx] = await create('Privado de outra conta', 'personal');
    const wallet = (await db.wallets.get(ctx.workspaceId))!;
    const privateTx = { ...tx, ownerUserId: 'other-user' };
    wallet.transactions = [privateTx]; wallet.outbox = [];
    const privateAudit = { ...wallet.audit[0], ownerUserId: 'other-user' };
    wallet.audit = [privateAudit];
    const privateTrash = { id: 'private-trash', kind: 'transactions' as const, snapshot: { ...privateTx, id: 'deleted-private' }, deletedAt: '2026-10-01T00:00:00.000Z', deletedBy: 'other-user', purgeAt: '2026-10-31T00:00:00.000Z' };
    wallet.trash = [privateTrash];
    await db.wallets.put(wallet);
    api.mockResolvedValue({ workspace: { id: wallet.id, name: wallet.workspace.name, created_by: user.id }, transactions: [], audit_logs: [], trash: [] });
    expect((await syncWallet(ctx)).status).toBe('synced');
    const saved = (await db.wallets.get(ctx.workspaceId))!;
    expect(saved.transactions).toEqual([privateTx]);
    expect(saved.audit).toContainEqual(privateAudit);
    expect(saved.trash).toContainEqual(privateTrash);
    expect(api.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
  });

  it('bootstrap envia apenas registros legíveis pela conta autenticada', async () => {
    const wallet = (await db.wallets.get(ctx.workspaceId))!;
    const privateCategory = { ...wallet.categories[0], id: 'other-private-category', ownerUserId: 'other-user', scope: 'personal' as const };
    const ownCategory = { ...wallet.categories[0], id: 'own-private-category', ownerUserId: user.id, scope: 'personal' as const };
    wallet.categories.push(privateCategory, ownCategory);
    await db.wallets.put(wallet); await db.syncMeta.delete(wallet.id);
    await syncWallet(ctx);
    const envelopes = api.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(init!.body as string));
    expect(envelopes.some(envelope => envelope.entity_id === privateCategory.id)).toBe(false);
    expect(envelopes.some(envelope => envelope.entity_id === ownCategory.id)).toBe(true);
    expect(envelopes.some(envelope => envelope.entity_id === wallet.categories[0].id)).toBe(true);
    expect((await db.wallets.get(wallet.id))!.categories).toContainEqual(privateCategory);
  });
});
