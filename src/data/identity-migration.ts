import { db, type Credential, type SessionRecord, type SyncMeta } from './db';
import type { Attachment, User, WalletState } from '../domain/types';

const identityFields = new Set([
  'userId', 'ownerUserId', 'createdBy', 'updatedBy', 'linkedUserId', 'actorUserId', 'deletedBy', 'masterAdminUserId',
  'user_id', 'owner_user_id', 'created_by', 'updated_by', 'linked_user_id', 'actor_user_id', 'deleted_by', 'master_admin_user_id',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Replace identity references only in known identity fields, never in arbitrary text or entity IDs. */
export function remapIdentityReferences<T>(value: T, localUserId: string, remoteUserId: string): T {
  if (Array.isArray(value)) return value.map(item => remapIdentityReferences(item, localUserId, remoteUserId)) as T;
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    identityFields.has(key) && child === localUserId ? remoteUserId : remapIdentityReferences(child, localUserId, remoteUserId),
  ])) as T;
}

export interface RemoteIdentity {
  id: string;
  name: string;
  email: string;
  type?: User['type'];
}

/** Atomically adopts the UUID authenticated by the remote account and rewrites every local identity reference. */
export async function migrateLocalIdentity(localUserId: string, remote: RemoteIdentity): Promise<User> {
  if (!localUserId || !remote.id) throw new Error('Não foi possível identificar as contas para a migração.');
  if (localUserId === remote.id) {
    const current = await db.users.get(localUserId);
    if (!current) throw new Error('A conta local não foi encontrada.');
    return current;
  }

  return db.transaction('rw', [db.users, db.credentials, db.sessions, db.wallets, db.attachments, db.safetyBackups, db.syncMeta], async () => {
    const local = await db.users.get(localUserId);
    if (!local) throw new Error('A conta local não foi encontrada para migração.');
    const remoteEmail = remote.email.trim().toLowerCase();
    if (local.email.trim().toLowerCase() !== remoteEmail) throw new Error('A conta remota não corresponde ao e-mail da conta local.');
    if (await db.users.get(remote.id)) throw new Error('O UUID remoto já pertence a outra conta neste dispositivo.');

    const [credential, sessions, wallets, attachments, backups, syncMetadata] = await Promise.all([
      db.credentials.get(localUserId),
      db.sessions.where('userId').equals(localUserId).toArray(),
      db.wallets.toArray(),
      db.attachments.toArray(),
      db.safetyBackups.toArray(),
      db.syncMeta.toArray(),
    ]);
    const migratedUser: User = { ...local, id: remote.id, name: remote.name, email: remoteEmail, type: remote.type ?? local.type };
    const migrate = <T>(value: T) => remapIdentityReferences(value, localUserId, remote.id);

    // Preserve the financial state before the first cloud sync. The backup uses
    // the canonical identity so restoring it cannot reintroduce the mismatch.
    for (const wallet of wallets) {
      const walletAttachments = attachments.filter(attachment => attachment.workspaceId === wallet.id);
      await db.safetyBackups.add({
        id: crypto.randomUUID(), userId: remote.id, createdAt: new Date().toISOString(),
        state: migrate(structuredClone(wallet)), attachments: migrate(structuredClone(walletAttachments)),
      });
    }

    await db.users.delete(localUserId);
    await db.users.add(migratedUser);
    if (credential) {
      await db.credentials.delete(localUserId);
      await db.credentials.put({ ...credential, userId: remote.id } satisfies Credential);
    }
    await Promise.all(sessions.map(session => db.sessions.put({ ...session, userId: remote.id } satisfies SessionRecord)));
    await Promise.all(wallets.map(wallet => db.wallets.put(migrate(structuredClone(wallet)) as WalletState)));
    await Promise.all(attachments.map(attachment => db.attachments.put(migrate(structuredClone(attachment)) as Attachment)));
    await Promise.all(backups.map(backup => db.safetyBackups.put({
      ...backup,
      userId: backup.userId === localUserId ? remote.id : backup.userId,
      state: migrate(structuredClone(backup.state)),
      attachments: migrate(structuredClone(backup.attachments)),
    })));
    await Promise.all(syncMetadata.map(meta => db.syncMeta.put(migrate(structuredClone(meta)) as SyncMeta)));
    return migratedUser;
  });
}
