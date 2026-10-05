import { db } from './db';
import { initialWallet } from './factory';
import { entityKinds, type Context, type Entity, type LocalChange, type User, type WalletState } from '../domain/types';
import { getXanoToken, XanoError, xanoApi } from './xano/client';
import { xanoConfig, xanoReady } from './xano/config';
import { snapshotToWalletState, toSyncEnvelope, type RemoteSnapshot } from './xano/mapper';

export interface SyncResult { acknowledgedIds: string[]; conflicts: { entityId: string; localVersion: number; remoteVersion: number }[]; }
export interface RemoteChanges { cursor: string; changes: LocalChange[]; }
export interface SyncAdapter { push(changes: LocalChange[]): Promise<SyncResult>; pull(cursor?: string): Promise<RemoteChanges>; }

export const syncStatus = {
  mode: xanoConfig.enabled ? 'cloud' as const : 'local' as const,
  label: xanoConfig.enabled ? 'Sincronização com Xano ativa' : 'Salvo neste dispositivo',
  remoteEnabled: xanoConfig.enabled,
};

const online = () => typeof navigator === 'undefined' || navigator.onLine;
const changeKey = (change: Pick<LocalChange, 'entityType' | 'entityId'>) => `${change.entityType}:${change.entityId}`;
const now = () => new Date().toISOString();

// In-memory activity is transient; persisted results remain in syncMeta.
const active = new Map<string, Promise<Awaited<ReturnType<typeof performSync>>>>();
const listeners = new Set<() => void>();
export const subscribeSync = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const isSyncing = (workspaceId: string) => active.has(workspaceId);
const notifySync = () => listeners.forEach(listener => listener());

export function scheduleWalletSync(ctx: Context) {
  if (!xanoReady() || !getXanoToken() || !online()) return;
  // Yield to the caller after the local transaction has committed.
  setTimeout(() => { void syncWallet(ctx).catch(() => undefined); }, 0);
}

export function startAutoSync(user: User, target: EventTarget = window) {
  const retry = () => { void syncAllForUser(user).catch(() => undefined); };
  target.addEventListener('online', retry);
  const timer = setInterval(retry, 60_000);
  return () => { target.removeEventListener('online', retry); clearInterval(timer); };
}

function makeChange(entityType: string, entityId: string, payload: unknown, version = 1, action = 'create'): LocalChange {
  return { id: crypto.randomUUID(), entityType, entityId, action, version, createdAt: now(), payload };
}

async function ensureBootstrapOutbox(ctx: Context) {
  const meta = await db.syncMeta.get(ctx.workspaceId);
  if (meta?.bootstrapQueued) return;
  await db.transaction('rw', [db.wallets, db.attachments, db.syncMeta], async () => {
    const state = await db.wallets.get(ctx.workspaceId);
    if (!state) return;
    const existing = state.outbox.slice();
    const queued = new Set(existing.map(changeKey));
    const bootstrap: LocalChange[] = [];
    const add = (change: LocalChange, force = false) => {
      const key = changeKey(change);
      if (force || !queued.has(key)) { bootstrap.push(change); queued.add(key); }
    };
    // Workspace + vínculo do usuário precisam chegar antes de qualquer entidade protegida.
    add(makeChange('workspace', state.workspace.id, state.workspace), true);
    for (const member of state.members) add(makeChange('members', member.id, member), true);
    for (const kind of entityKinds) for (const entity of state[kind]) add(makeChange(kind, entity.id, entity, entity.version));
    add(makeChange('preferences', state.id, { ...state.preferences, id: state.id }, 1, 'update'));
    const attachments = await db.attachments.where('workspaceId').equals(state.id).toArray();
    for (const attachment of attachments) {
      const { blob: _blob, ...metadata } = attachment;
      add(makeChange('attachments', attachment.id, metadata, attachment.version));
    }
    state.outbox = [...bootstrap, ...existing];
    await db.wallets.put(state);
    await db.syncMeta.put({ ...meta, id: state.id, bootstrapQueued: true, lastAttemptAt: now() });
  });
}

class XanoSyncAdapter implements SyncAdapter {
  constructor(private ctx: Context) {}

  async push(changes: LocalChange[]): Promise<SyncResult> {
    const acknowledgedIds: string[] = [], conflicts: SyncResult['conflicts'] = [];
    for (const change of changes) {
      try {
        const envelope = toSyncEnvelope(change, this.ctx.workspaceId, this.ctx.user);
        const response = await xanoApi<{ ok: boolean; version?: number }>(`/sync/${envelope.table}`, { method: 'POST', body: JSON.stringify(envelope) });
        if (!response?.ok) throw new Error('O Xano não confirmou a operação.');
        acknowledgedIds.push(change.id);
      } catch (error) {
        if (error instanceof XanoError && error.message.includes('SYNC_CONFLICT')) {
          const remoteVersion = typeof (error.payload as Record<string, unknown> | undefined)?.remote_version === 'number' ? Number((error.payload as Record<string, unknown>).remote_version) : change.version;
          conflicts.push({ entityId: change.entityId, localVersion: change.version, remoteVersion });
          continue;
        }
        // Keep earlier acknowledgements even if a later request fails.
        await applyPushResult(this.ctx, changes, { acknowledgedIds, conflicts });
        throw error;
      }
    }
    return { acknowledgedIds, conflicts };
  }

  async pull(_cursor?: string): Promise<RemoteChanges> {
    return { cursor: now(), changes: [] };
  }
}

function markEntityStatus(state: WalletState, change: LocalChange, status: 'synced' | 'conflict') {
  if (!(entityKinds as readonly string[]).includes(change.entityType)) return;
  const kind = change.entityType as typeof entityKinds[number];
  const item = (state[kind] as Entity[]).find(entity => entity.id === change.entityId);
  if (item) item.syncStatus = status;
}

async function applyPushResult(ctx: Context, sent: LocalChange[], result: SyncResult) {
  const acknowledged = new Set(result.acknowledgedIds), conflicts = new Set(result.conflicts.map(conflict => conflict.entityId));
  await db.transaction('rw', [db.wallets, db.syncMeta], async () => {
    const state = await db.wallets.get(ctx.workspaceId);
    if (!state) return;
    state.outbox = state.outbox.filter(change => !acknowledged.has(change.id));
    for (const change of sent) {
      if (conflicts.has(change.entityId)) markEntityStatus(state, change, 'conflict');
      else if (acknowledged.has(change.id) && !state.outbox.some(pending => pending.entityType === change.entityType && pending.entityId === change.entityId)) markEntityStatus(state, change, 'synced');
    }
    await db.wallets.put(state);
    const previous = await db.syncMeta.get(ctx.workspaceId);
    await db.syncMeta.put({ ...previous, id: ctx.workspaceId, bootstrapQueued: previous?.bootstrapQueued ?? true, lastError: result.conflicts.length ? 'Existem conflitos aguardando resolução.' : undefined });
  });
}

async function remoteSnapshot(workspaceId: string) {
  return xanoApi<RemoteSnapshot>(`/sync/bootstrap?workspace_id=${encodeURIComponent(workspaceId)}`);
}

async function replaceFromRemote(ctx: Context) {
  const snapshot = await remoteSnapshot(ctx.workspaceId);
  const remote = snapshotToWalletState(snapshot, ctx.user);
  if (remote.id !== ctx.workspaceId) throw new Error('Snapshot Xano pertence a outra família.');
  await db.transaction('rw', [db.wallets, db.syncMeta], async () => {
    const current = await db.wallets.get(ctx.workspaceId);
    if (!current || current.outbox.length) return;
    remote.notices = current.notices;
    await db.wallets.put(remote);
    const previous = await db.syncMeta.get(ctx.workspaceId);
    await db.syncMeta.put({ ...previous, id: ctx.workspaceId, bootstrapQueued: true, lastSuccessAt: now(), lastError: undefined });
  });
}

async function performSync(ctx: Context) {
  if (!xanoReady() || !getXanoToken()) return { status: 'local' as const };
  if (!online()) return { status: 'offline' as const };
  await ensureBootstrapOutbox(ctx);
  const state = await db.wallets.get(ctx.workspaceId);
  if (!state) throw new Error('Família não encontrada para sincronização.');
  const sent = state.outbox.slice();
  if (sent.length) {
    const result = await new XanoSyncAdapter(ctx).push(sent);
    await applyPushResult(ctx, sent, result);
    if (result.conflicts.length) return { status: 'conflict' as const, conflicts: result.conflicts };
  }
  const after = await db.wallets.get(ctx.workspaceId);
  if (after && after.outbox.length === 0) await replaceFromRemote(ctx);
  const current = await db.wallets.get(ctx.workspaceId);
  return { status: current?.outbox.length ? 'pending' as const : 'synced' as const };
}

export function syncWallet(ctx: Context) {
  const existing = active.get(ctx.workspaceId);
  if (existing) return existing;
  const task = Promise.resolve().then(async () => {
    if (!xanoReady() || !getXanoToken()) return { status: 'local' as const };
    if (!online()) return { status: 'offline' as const };
    const previous = await db.syncMeta.get(ctx.workspaceId);
    await db.syncMeta.put({ ...previous, id: ctx.workspaceId, bootstrapQueued: previous?.bootstrapQueued ?? false, lastAttemptAt: now(), lastError: undefined });
    try { return await performSync(ctx); }
    catch (error) {
      await db.syncMeta.update(ctx.workspaceId, { lastError: error instanceof Error ? error.message : 'Não foi possível sincronizar.' });
      throw error;
    }
  }).finally(() => { active.delete(ctx.workspaceId); notifySync(); });
  active.set(ctx.workspaceId, task);
  notifySync();
  return task;
}

export async function syncAllForUser(user: User) {
  if (!xanoReady() || !getXanoToken() || !online()) return;
  const wallets = await db.wallets.toArray();
  for (const wallet of wallets.filter(item => item.members.some(member => member.userId === user.id && member.status === 'active'))) {
    try { await syncWallet({ user, workspaceId: wallet.id }); } catch { /* Each wallet keeps its outbox for the next retry. */ }
  }
}

function membershipRows(value: unknown) {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).items)) return (value as { items: Record<string, unknown>[] }).items;
  return [];
}

export async function hydrateUserFromXano(user: User) {
  if (!xanoReady() || !getXanoToken() || !online()) return 0;
  const memberships = membershipRows(await xanoApi<unknown>('/sync/workspaces'));
  let count = 0;
  for (const membership of memberships) {
    const workspaceId = String(membership.workspace_id ?? '');
    if (!workspaceId) continue;
    const snapshot = await remoteSnapshot(workspaceId);
    const state = snapshotToWalletState(snapshot, user);
    await db.transaction('rw', [db.wallets, db.syncMeta], async () => {
      await db.wallets.put(state);
      await db.syncMeta.put({ id: state.id, bootstrapQueued: true, lastAttemptAt: now(), lastSuccessAt: now() });
    });
    count += 1;
  }
  if (!count) {
    const state = initialWallet(user);
    await db.wallets.add(state);
    await syncWallet({ user, workspaceId: state.id });
    count = 1;
  }
  return count;
}
