import { db } from './db';
import { initialWallet } from './factory';
import { entityKinds, type Context, type Entity, type LocalChange, type User, type WalletState } from '../domain/types';
import { hasXanoSession, getXanoSessionRevision, getXanoToken, getXanoSessionUserId, XanoError, xanoApi } from './xano/client';
import { validateXanoSession } from './xano/auth';
import { canRead } from '../domain/permissions';
import { xanoReady } from './xano/config';
import { snapshotToWalletState, toSyncEnvelope, type RemoteSnapshot } from './xano/mapper';

export interface SyncResult { acknowledgedIds: string[]; conflicts: { entityType: string; entityId: string; localVersion: number; remoteVersion: number }[]; }
export interface RemoteChanges { cursor: string; changes: LocalChange[]; }
export interface SyncAdapter { push(changes: LocalChange[]): Promise<SyncResult>; pull(cursor?: string): Promise<RemoteChanges>; }

const online = () => typeof navigator === 'undefined' || navigator.onLine;
const changeKey = (change: Pick<LocalChange, 'entityType' | 'entityId'>) => `${change.entityType}:${change.entityId}`;
const now = () => new Date().toISOString();

// In-memory activity is transient; persisted results remain in syncMeta.
const active = new Map<string, Promise<Awaited<ReturnType<typeof performSync>>>>();
const scheduled = new Set<string>();
const changedDuringSync = new Set<string>();
const listeners = new Set<() => void>();
export const subscribeSync = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const isSyncing = (workspaceId: string) => active.has(workspaceId);
const notifySync = () => listeners.forEach(listener => listener());

export function scheduleWalletSync(ctx: Context) {
  if (!xanoReady() || !hasXanoSession(ctx.user.id) || !online()) return;
  if (active.has(ctx.workspaceId)) { changedDuringSync.add(ctx.workspaceId); return; }
  if (scheduled.has(ctx.workspaceId)) return;
  scheduled.add(ctx.workspaceId);
  // Yield to the caller after the local transaction has committed.
  setTimeout(() => { scheduled.delete(ctx.workspaceId); void syncWallet(ctx).catch(() => undefined); }, 0);
}

function assertSession(ctx: Context, revision: number) {
  if (!hasXanoSession(ctx.user.id) || getXanoSessionRevision() !== revision) throw new Error('A sessão Xano mudou. Conecte novamente para continuar.');
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
    for (const kind of entityKinds) for (const entity of state[kind]) if (canRead(state, ctx, entity)) add(makeChange(kind, entity.id, entity, entity.version));
    add(makeChange('preferences', state.id, { ...state.preferences, id: state.id }, 1, 'update'));
    const attachments = await db.attachments.where('workspaceId').equals(state.id).toArray();
    for (const attachment of attachments) {
      if (!canRead(state, ctx, attachment)) continue;
      const { blob: _blob, ...metadata } = attachment;
      add(makeChange('attachments', attachment.id, metadata, attachment.version));
    }
    state.outbox = [...bootstrap, ...existing];
    await db.wallets.put(state);
    await db.syncMeta.put({ ...meta, id: state.id, bootstrapQueued: true, lastAttemptAt: now() });
  });
}

class XanoSyncAdapter implements SyncAdapter {
  constructor(private ctx: Context, private revision: number) {}

  async push(changes: LocalChange[]): Promise<SyncResult> {
    const acknowledgedIds: string[] = [], conflicts: SyncResult['conflicts'] = [];
    for (const change of changes) {
      try {
        assertSession(this.ctx, this.revision);
        const envelope = toSyncEnvelope(change, this.ctx.workspaceId, this.ctx.user);
        const response = await xanoApi<{ ok: boolean; version?: number }>(`/sync/${envelope.table}`, { method: 'POST', body: JSON.stringify(envelope) });
        if (!response?.ok) throw new Error('O Xano não confirmou a operação.');
        assertSession(this.ctx, this.revision);
        acknowledgedIds.push(change.id);
      } catch (error) {
        if (error instanceof XanoError && error.message.includes('SYNC_CONFLICT')) {
          const remoteVersion = typeof (error.payload as Record<string, unknown> | undefined)?.remote_version === 'number' ? Number((error.payload as Record<string, unknown>).remote_version) : change.version;
          conflicts.push({ entityType: change.entityType, entityId: change.entityId, localVersion: change.version, remoteVersion });
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
  const acknowledged = new Set(result.acknowledgedIds), conflicts = new Set(result.conflicts.map(conflict => `${conflict.entityType}:${conflict.entityId}`));
  await db.transaction('rw', [db.wallets, db.syncMeta], async () => {
    const state = await db.wallets.get(ctx.workspaceId);
    if (!state) return;
    state.outbox = state.outbox.filter(change => !acknowledged.has(change.id));
    for (const change of sent) {
      if (conflicts.has(changeKey(change))) markEntityStatus(state, change, 'conflict');
      else if (acknowledged.has(change.id) && !state.outbox.some(pending => pending.entityType === change.entityType && pending.entityId === change.entityId)) markEntityStatus(state, change, 'synced');
    }
    await db.wallets.put(state);
    const previous = await db.syncMeta.get(ctx.workspaceId);
    await db.syncMeta.put({ ...previous, id: ctx.workspaceId, bootstrapQueued: previous?.bootstrapQueued ?? true, lastError: result.conflicts.length ? 'Existem conflitos aguardando resolução.' : undefined, conflicts: result.conflicts.length ? result.conflicts : undefined });
  });
}

async function remoteSnapshot(workspaceId: string) {
  return xanoApi<RemoteSnapshot>(`/sync/bootstrap?workspace_id=${encodeURIComponent(workspaceId)}`);
}

const snapshotList = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) return value.filter(row => row && typeof row === 'object') as Record<string, unknown>[];
  if (value && typeof value === 'object' && Array.isArray((value as { items?: unknown[] }).items)) return (value as { items: unknown[] }).items.filter(row => row && typeof row === 'object') as Record<string, unknown>[];
  return value && typeof value === 'object' ? [value as Record<string, unknown>] : [];
};

function remoteVersion(snapshot: RemoteSnapshot, change: LocalChange, ctx: Context) {
  const remoteTable = toSyncEnvelope(change, ctx.workspaceId, ctx.user).table;
  const table = (remoteTable === 'workspace_members' ? 'members' : remoteTable) as keyof RemoteSnapshot;
  const row = snapshotList(snapshot[table]).find(item => String(item.id ?? '') === change.entityId);
  return typeof row?.version === 'number' ? row.version : undefined;
}

function remoteRecord(snapshot: RemoteSnapshot, change: LocalChange, ctx: Context) {
  const remoteTable = toSyncEnvelope(change, ctx.workspaceId, ctx.user).table;
  const table = (remoteTable === 'workspace_members' ? 'members' : remoteTable) as keyof RemoteSnapshot;
  return snapshotList(snapshot[table]).find(item => String(item.id ?? '') === change.entityId);
}

function conflictValue(state: WalletState, change: LocalChange): Record<string, unknown> | undefined {
  if ((entityKinds as readonly string[]).includes(change.entityType)) return (state[change.entityType as typeof entityKinds[number]] as Entity[]).find(entity => entity.id === change.entityId) as unknown as Record<string, unknown> | undefined;
  if (change.entityType === 'workspace') return state.workspace as unknown as Record<string, unknown>;
  if (change.entityType === 'members') return state.members.find(member => member.id === change.entityId) as unknown as Record<string, unknown> | undefined;
  if (change.entityType === 'preferences') return state.preferences as unknown as Record<string, unknown>;
  return undefined;
}

function comparable(value: unknown): string {
  const omit = new Set(['syncStatus', 'version', 'updatedAt', 'updatedBy', 'updated_at', 'updated_by']);
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.entries(item as Record<string, unknown>).filter(([key]) => !omit.has(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child)]));
  };
  return JSON.stringify(normalize(value));
}

function timestamp(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function replaceConflictWithRemote(current: WalletState, remote: WalletState, change: LocalChange) {
  if ((entityKinds as readonly string[]).includes(change.entityType)) {
    const kind = change.entityType as typeof entityKinds[number];
    const replacement = (remote[kind] as Entity[]).find(entity => entity.id === change.entityId);
    const target = current[kind] as Entity[];
    const index = target.findIndex(entity => entity.id === change.entityId);
    if (replacement && index >= 0) target[index] = replacement;
    else if (replacement) target.push(replacement);
    else if (index >= 0) target.splice(index, 1);
  } else if (change.entityType === 'workspace') current.workspace = remote.workspace;
  else if (change.entityType === 'members') {
    const replacement = remote.members.find(member => member.id === change.entityId);
    current.members = [...current.members.filter(member => member.id !== change.entityId), ...(replacement ? [replacement] : [])];
  } else if (change.entityType === 'preferences') current.preferences = remote.preferences;
}

type AutomaticDecision = { winner: 'local' | 'remote'; rule: string };

function automaticDecision(ctx: Context, change: LocalChange, local: Record<string, unknown>, remote: Record<string, unknown> | undefined, rawRemote: Record<string, unknown> | undefined): AutomaticDecision {
  if (!remote && !rawRemote) return ['delete', 'purge'].includes(change.action)
    ? { winner: 'remote', rule: 'exclusão já aplicada na nuvem' }
    : { winner: 'local', rule: 'registro existe apenas neste dispositivo' };
  if (remote && comparable(local) === comparable(remote)) return { winner: 'remote', rule: 'conteúdo já é igual na nuvem' };
  const localTime = timestamp(local.updatedAt) ?? timestamp(change.createdAt);
  const remoteTime = timestamp(remote?.updatedAt) ?? timestamp(rawRemote?.updated_at);
  if (localTime === undefined || remoteTime === undefined || localTime === remoteTime) return { winner: 'remote', rule: 'data ausente, inválida ou empatada' };
  if (['delete', 'purge'].includes(change.action)) return localTime > remoteTime
    ? { winner: 'local', rule: 'exclusão local é a operação mais recente' }
    : { winner: 'remote', rule: 'edição da nuvem é mais recente que a exclusão local' };
  const scope = String(local.scope ?? remote?.scope ?? rawRemote?.scope ?? 'shared');
  if (scope === 'personal' || scope === 'private') return localTime > remoteTime
    ? { winner: 'local', rule: 'dado pessoal local é mais recente' }
    : { winner: 'remote', rule: 'dado pessoal da nuvem é mais recente' };
  const localAuthor = String(local.updatedBy ?? local.ownerUserId ?? ctx.user.id);
  const remoteAuthor = String(remote?.updatedBy ?? remote?.ownerUserId ?? rawRemote?.updated_by ?? rawRemote?.owner_user_id ?? '');
  if (localAuthor && remoteAuthor && localAuthor !== remoteAuthor) return { winner: 'remote', rule: 'dado compartilhado foi alterado por outro autor' };
  return localTime > remoteTime
    ? { winner: 'local', rule: 'alteração compartilhada do mesmo autor é mais recente' }
    : { winner: 'remote', rule: 'alteração compartilhada da nuvem é mais recente' };
}

async function saveConflictBackup(ctx: Context, state: WalletState) {
  const attachments = await db.attachments.where('workspaceId').equals(ctx.workspaceId).toArray();
  await db.safetyBackups.add({ id: crypto.randomUUID(), userId: ctx.user.id, createdAt: now(), state: structuredClone(state), attachments });
}

async function resolveConflictsAutomatically(ctx: Context, revision: number, conflicts: SyncResult['conflicts']) {
  const state = await db.wallets.get(ctx.workspaceId);
  if (!state) throw new Error('Família não encontrada para sincronização.');
  const snapshot = await remoteSnapshot(ctx.workspaceId);
  assertSession(ctx, revision);
  const remote = snapshotToWalletState(snapshot, ctx.user);
  await saveConflictBackup(ctx, state);
  const conflictKeys = new Set(conflicts.map(conflict => `${conflict.entityType}:${conflict.entityId}`));
  const decisions = new Map<string, AutomaticDecision>();
  for (const change of state.outbox.filter(item => conflictKeys.has(changeKey(item)))) {
    const local = (change.payload && typeof change.payload === 'object' ? change.payload : conflictValue(state, change) ?? {}) as Record<string, unknown>;
    decisions.set(changeKey(change), automaticDecision(ctx, change, local, conflictValue(remote, change), remoteRecord(snapshot, change, ctx)));
  }
  await db.transaction('rw', [db.wallets, db.syncMeta], async () => {
    const current = await db.wallets.get(ctx.workspaceId);
    if (!current) return;
    const nextOutbox: LocalChange[] = [];
    for (const change of current.outbox) {
      const decision = decisions.get(changeKey(change));
      if (!decision) { nextOutbox.push(change); continue; }
      if (decision.winner === 'local') {
        const conflict = conflicts.find(item => item.entityType === change.entityType && item.entityId === change.entityId);
        const version = Math.max(change.version, conflict?.remoteVersion ?? 0, remoteVersion(snapshot, change, ctx) ?? 0) + 1;
        const payload = change.payload && typeof change.payload === 'object' ? { ...(change.payload as Record<string, unknown>), version, syncStatus: 'local' } : change.payload;
        const localEntity = conflictValue(current, change);
        if (localEntity && 'version' in localEntity) { localEntity.version = version; localEntity.syncStatus = 'local'; }
        nextOutbox.push({ ...change, id: crypto.randomUUID(), version, payload });
      } else replaceConflictWithRemote(current, remote, change);
      const payload = change.payload as { scope?: string; ownerUserId?: string } | undefined;
      current.audit.push({ id: crypto.randomUUID(), workspaceId: current.id, entityType: change.entityType, entityId: change.entityId, action: 'sync_conflict_resolved', actorUserId: ctx.user.id, actorName: ctx.user.name, timestamp: now(), scope: payload?.scope === 'personal' ? 'personal' : 'shared', ownerUserId: payload?.ownerUserId ?? ctx.user.id, afterData: { winner: decision.winner, rule: decision.rule, automatic: true } });
    }
    current.outbox = nextOutbox;
    await db.wallets.put(current);
    await db.syncMeta.update(ctx.workspaceId, { lastError: undefined, conflicts: undefined });
  });
  return decisions.size;
}

/** Resolve optimistic-lock conflicts without ever silently discarding the local copy. */
export async function resolveSyncConflicts(ctx: Context, strategy: 'local' | 'remote') {
  if (!xanoReady() || !hasXanoSession(ctx.user.id)) throw new Error('Entre novamente para resolver o conflito.');
  if (!online()) throw new Error('Conecte-se à internet para resolver o conflito.');
  if (isSyncing(ctx.workspaceId)) throw new Error('Aguarde a sincronização atual terminar.');
  const revision = getXanoSessionRevision();
  const [state, meta] = await Promise.all([db.wallets.get(ctx.workspaceId), db.syncMeta.get(ctx.workspaceId)]);
  if (!state) throw new Error('Família não encontrada para sincronização.');
  const recorded = meta?.conflicts ?? [];
  const conflictKeys = new Set(recorded.map(conflict => `${conflict.entityType}:${conflict.entityId}`));
  // Compatibility with conflicts persisted by versions that predate conflict metadata.
  if (!conflictKeys.size) for (const kind of entityKinds) for (const entity of state[kind]) if (entity.syncStatus === 'conflict') conflictKeys.add(`${kind}:${entity.id}`);
  const conflicted = state.outbox.filter(change => conflictKeys.has(changeKey(change)));
  if (!conflicted.length) throw new Error('Nenhuma alteração em conflito foi encontrada. Tente sincronizar novamente.');
  const snapshot = await remoteSnapshot(ctx.workspaceId);
  assertSession(ctx, revision);
  await saveConflictBackup(ctx, state);

  if (strategy === 'local') {
    await db.transaction('rw', [db.wallets, db.syncMeta], async () => {
      const current = await db.wallets.get(ctx.workspaceId);
      if (!current) return;
      current.outbox = current.outbox.map(change => {
        if (!conflictKeys.has(changeKey(change))) return change;
        const known = recorded.find(conflict => conflict.entityType === change.entityType && conflict.entityId === change.entityId)?.remoteVersion ?? 0;
        const version = Math.max(change.version, known, remoteVersion(snapshot, change, ctx) ?? 0) + 1;
        const payload = change.payload && typeof change.payload === 'object' ? { ...(change.payload as Record<string, unknown>), version, syncStatus: 'local' } : change.payload;
        if ((entityKinds as readonly string[]).includes(change.entityType)) {
          const item = (current[change.entityType as typeof entityKinds[number]] as Entity[]).find(entity => entity.id === change.entityId);
          if (item) { item.version = version; item.syncStatus = 'local'; }
        }
        return { ...change, id: crypto.randomUUID(), version, payload };
      });
      await db.wallets.put(current);
      await db.syncMeta.update(ctx.workspaceId, { lastError: undefined, conflicts: undefined });
    });
  } else {
    const remote = snapshotToWalletState(snapshot, ctx.user);
    await db.transaction('rw', [db.wallets, db.syncMeta], async () => {
      const current = await db.wallets.get(ctx.workspaceId);
      if (!current) return;
      for (const key of conflictKeys) {
        const separator = key.indexOf(':');
        const entityType = key.slice(0, separator), entityId = key.slice(separator + 1);
        if ((entityKinds as readonly string[]).includes(entityType)) {
          const kind = entityType as typeof entityKinds[number];
          const replacement = (remote[kind] as Entity[]).find(entity => entity.id === entityId);
          const target = current[kind] as Entity[];
          const index = target.findIndex(entity => entity.id === entityId);
          if (replacement && index >= 0) target[index] = replacement;
          else if (replacement) target.push(replacement);
          else if (index >= 0) target.splice(index, 1);
        } else if (entityType === 'workspace') current.workspace = remote.workspace;
        else if (entityType === 'members') {
          const replacement = remote.members.find(member => member.id === entityId);
          current.members = [...current.members.filter(member => member.id !== entityId), ...(replacement ? [replacement] : [])];
        } else if (entityType === 'preferences') current.preferences = remote.preferences;
      }
      current.outbox = current.outbox.filter(change => !conflictKeys.has(changeKey(change)));
      await db.wallets.put(current);
      await db.syncMeta.update(ctx.workspaceId, { lastError: undefined, conflicts: undefined });
    });
  }
  return syncWallet(ctx);
}

// Old importBackup versions queued an audit summary as if "backup" were a
// remote entity. Archive that exact event durably; never acknowledge it as a
// server write or discard unknown entity types. Financial imports stay queued.
async function migrateLocalAuditEvents(ctx: Context) {
  await db.transaction('rw', [db.wallets, db.syncMeta], async () => {
    const state = await db.wallets.get(ctx.workspaceId);
    if (!state) return;
    const local = state.outbox.filter(change => {
      const p = change.payload as Record<string, unknown> | null;
      return change.entityType === 'backup' && change.action === 'import'
        && change.entityId === state.id && p?.id === state.id
        && p.scope === 'personal' && p.ownerUserId === ctx.user.id;
    });
    if (!local.length) return;
    const meta = await db.syncMeta.get(state.id);
    const events = new Map((meta?.localAuditEvents ?? []).map(event => [event.id, event]));
    for (const event of local) {
      events.set(event.id, event);
      if (!state.audit.some(a => a.entityType === 'backup' && a.action === 'import' && a.entityId === state.id && a.actorUserId === ctx.user.id && a.timestamp === event.createdAt)) {
        state.audit.push({ id: event.id, workspaceId: state.id, entityType: 'backup', entityId: event.entityId, action: event.action, actorUserId: ctx.user.id, actorName: ctx.user.name, timestamp: event.createdAt, scope: 'personal', ownerUserId: ctx.user.id, afterData: event.payload });
      }
    }
    const archived = new Set(local.map(event => event.id));
    state.outbox = state.outbox.filter(event => !archived.has(event.id));
    await db.syncMeta.put({ ...meta, id: state.id, bootstrapQueued: meta?.bootstrapQueued ?? false, localAuditEvents: [...events.values()] });
    await db.wallets.put(state);
  });
}

async function replaceFromRemote(ctx: Context, revision: number) {
  assertSession(ctx, revision);
  const snapshot = await remoteSnapshot(ctx.workspaceId);
  assertSession(ctx, revision);
  const remote = snapshotToWalletState(snapshot, ctx.user);
  if (remote.id !== ctx.workspaceId) throw new Error('Snapshot remoto pertence a outra família.');
  await db.transaction('rw', [db.wallets, db.syncMeta], async () => {
    const current = await db.wallets.get(ctx.workspaceId);
    if (!current || current.outbox.length) return;
    // The server snapshot excludes other users' private records stored on this device.
    const privateToOthers = (item: { scope: string; ownerUserId: string }) => item.scope === 'personal' && item.ownerUserId !== ctx.user.id;
    for (const kind of entityKinds) {
      const ids = new Set(remote[kind].map(item => item.id));
      (remote[kind] as Entity[]).push(...current[kind].filter(item => privateToOthers(item) && !ids.has(item.id)));
    }
    remote.trash.push(...current.trash.filter(item => privateToOthers(item.snapshot) && !remote.trash.some(row => row.id === item.id)));
    remote.audit.push(...current.audit.filter(item => (privateToOthers(item) || (item.entityType === 'backup' && item.action === 'import') || item.action === 'sync_conflict_resolved') && !remote.audit.some(row => row.id === item.id)));
    remote.notices = current.notices;
    await db.wallets.put(remote);
    const previous = await db.syncMeta.get(ctx.workspaceId);
    await db.syncMeta.put({ ...previous, id: ctx.workspaceId, bootstrapQueued: true, lastSuccessAt: now(), lastError: undefined });
  });
}

async function performSync(ctx: Context, revision: number, automaticAttempt = 0) {
  if (!xanoReady() || !hasXanoSession(ctx.user.id)) return { status: 'local' as const };
  if (!online()) return { status: 'offline' as const };
  await ensureBootstrapOutbox(ctx);
  await migrateLocalAuditEvents(ctx);
  const state = await db.wallets.get(ctx.workspaceId);
  if (!state) throw new Error('Família não encontrada para sincronização.');
  const sent = state.outbox.map(change => {
    // Recover complete snapshots for delete events queued by older app versions.
    if (!['delete', 'purge'].includes(change.action)) return change;
    const snapshot = state.trash.find(item => item.snapshot.id === change.entityId)?.snapshot
      ?? state.audit.slice().reverse().find(item => item.entityId === change.entityId && item.entityType === change.entityType && item.action === change.action)?.afterData;
    return snapshot ? { ...change, payload: snapshot } : change;
  }).filter(change => {
    const payload = change.payload as { scope?: string; ownerUserId?: string } | undefined;
    return payload?.scope !== 'personal' || payload.ownerUserId === ctx.user.id;
  });
  if (sent.length) {
    const result = await new XanoSyncAdapter(ctx, revision).push(sent);
    await applyPushResult(ctx, sent, result);
    if (result.conflicts.length) {
      if (automaticAttempt === 0) {
        try {
          const resolved = await resolveConflictsAutomatically(ctx, revision, result.conflicts);
          if (resolved) return performSync(ctx, revision, 1);
        } catch { /* Keep the persisted conflict and expose the manual fallback. */ }
      }
      return { status: 'conflict' as const, conflicts: result.conflicts };
    }
  }
  const after = await db.wallets.get(ctx.workspaceId);
  if (after && after.outbox.length === 0) await replaceFromRemote(ctx, revision);
  const current = await db.wallets.get(ctx.workspaceId);
  return { status: current?.outbox.length ? 'pending' as const : 'synced' as const };
}

export function syncWallet(ctx: Context) {
  const existing = active.get(ctx.workspaceId);
  if (existing) return existing;
  const revision = getXanoSessionRevision();
  let completed = false;
  const task = Promise.resolve().then(async () => {
    if (!xanoReady() || !hasXanoSession(ctx.user.id)) return { status: 'local' as const };
    if (!online()) return { status: 'offline' as const };
    const previous = await db.syncMeta.get(ctx.workspaceId);
    await db.syncMeta.put({ ...previous, id: ctx.workspaceId, bootstrapQueued: previous?.bootstrapQueued ?? false, lastAttemptAt: now(), lastError: undefined });
    try { const result = await performSync(ctx, revision, previous?.conflicts?.length ? 1 : 0); completed = result.status === 'synced' || result.status === 'pending'; return result; }
    catch (error) {
      await db.syncMeta.update(ctx.workspaceId, { lastError: error instanceof Error ? error.message : 'Não foi possível sincronizar.' });
      throw error;
    }
  }).finally(() => {
    active.delete(ctx.workspaceId); notifySync();
    if (changedDuringSync.delete(ctx.workspaceId) && completed) scheduleWalletSync(ctx);
  });
  active.set(ctx.workspaceId, task);
  notifySync();
  return task;
}

export async function syncAllForUser(user: User) {
  if (!xanoReady() || !online()) return;
  if (getXanoToken() && !getXanoSessionUserId()) await validateXanoSession(user.id);
  if (!hasXanoSession(user.id)) return;
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
  if (!xanoReady() || !hasXanoSession(user.id) || !online()) return 0;
  const memberships = membershipRows(await xanoApi<unknown>('/sync/workspaces'));
  let count = 0;
  for (const membership of memberships) {
    const workspaceId = String(membership.workspace_id ?? '');
    if (!workspaceId) continue;
    if (await db.wallets.get(workspaceId)) {
      await syncWallet({ user, workspaceId });
      count += 1;
      continue;
    }
    const snapshot = await remoteSnapshot(workspaceId);
    const state = snapshotToWalletState(snapshot, user);
    await db.transaction('rw', [db.wallets, db.syncMeta], async () => {
      if (await db.wallets.get(workspaceId)) return;
      await db.wallets.put(state);
      await db.syncMeta.put({ id: state.id, bootstrapQueued: true, lastAttemptAt: now(), lastSuccessAt: now() });
    });
    count += 1;
  }
  if (!count) {
    const existing = (await db.wallets.toArray()).filter(wallet => wallet.members.some(member => member.userId === user.id && member.status === 'active'));
    if (existing.length) { await syncAllForUser(user); return existing.length; }
    const state = initialWallet(user);
    await db.wallets.add(state);
    await syncWallet({ user, workspaceId: state.id });
    count = 1;
  }
  return count;
}
