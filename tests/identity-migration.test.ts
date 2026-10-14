import { beforeEach, describe, expect, it } from 'vitest';
import { LocalAuthProvider } from '../src/data/auth';
import { db } from '../src/data/db';
import { migrateLocalIdentity, remapIdentityReferences } from '../src/data/identity-migration';

const local = new LocalAuthProvider();
const password = 'senha-segura-para-migrar';

beforeEach(async () => {
  await local.signOut();
  await Promise.all([
    db.users.clear(), db.credentials.clear(), db.sessions.clear(), db.wallets.clear(),
    db.attachments.clear(), db.safetyBackups.clear(), db.syncMeta.clear(),
  ]);
});

describe('migração da identidade local para o UUID remoto', () => {
  it('troca somente campos conhecidos de identidade em payloads aninhados', () => {
    const value = { id: 'local-id', ownerUserId: 'local-id', note: 'local-id', nested: { created_by: 'local-id' } };
    expect(remapIdentityReferences(value, 'local-id', 'remote-id')).toEqual({
      id: 'local-id', ownerUserId: 'remote-id', note: 'local-id', nested: { created_by: 'remote-id' },
    });
  });

  it('migra usuário, credencial, sessão, carteira, fila, auditoria e backups atomicamente', async () => {
    const user = await local.signUp({ name: 'Pessoa Local', email: 'pessoa@example.com', username: 'pessoa', password });
    const wallet = (await db.wallets.toArray())[0];
    const category = wallet.categories[0];
    wallet.audit.push({
      id: crypto.randomUUID(), workspaceId: wallet.id, entityType: 'categories', entityId: category.id, action: 'update',
      actorUserId: user.id, actorName: user.name, timestamp: new Date().toISOString(), scope: 'shared', ownerUserId: user.id,
      beforeData: { ownerUserId: user.id }, afterData: { updatedBy: user.id },
    });
    wallet.outbox.push({ id: crypto.randomUUID(), entityType: 'categories', entityId: category.id, action: 'update', version: 1, createdAt: new Date().toISOString(), payload: { ...category } });
    wallet.notices.push({ id: crypto.randomUUID(), type: 'budget', title: 'Teste', detail: 'Teste', entityId: category.id, date: '2026-10-14', read: false, ownerUserId: user.id, scope: 'shared' });
    await db.wallets.put(wallet);
    await db.safetyBackups.add({ id: crypto.randomUUID(), userId: user.id, createdAt: new Date().toISOString(), state: structuredClone(wallet), attachments: [] });
    await db.syncMeta.put({ id: wallet.id, bootstrapQueued: false, localAuditEvents: [{ id: crypto.randomUUID(), entityType: 'backup', entityId: wallet.id, action: 'import', version: 1, createdAt: new Date().toISOString(), payload: { ownerUserId: user.id } }] });

    const remoteId = crypto.randomUUID();
    const migrated = await migrateLocalIdentity(user.id, { id: remoteId, name: 'Pessoa Remota', email: 'PESSOA@example.com' });

    expect(migrated).toMatchObject({ id: remoteId, name: 'Pessoa Remota', email: 'pessoa@example.com', username: 'pessoa' });
    expect(await db.users.get(user.id)).toBeUndefined();
    expect(await db.credentials.get(user.id)).toBeUndefined();
    expect(await db.credentials.get(remoteId)).toBeDefined();
    expect((await db.sessions.toArray()).every(session => session.userId === remoteId)).toBe(true);
    const persisted = JSON.stringify({
      wallets: await db.wallets.toArray(), backups: await db.safetyBackups.toArray(), sync: await db.syncMeta.toArray(),
    });
    expect(persisted).not.toContain(user.id);
    expect(persisted).toContain(remoteId);
    expect((await local.signIn('pessoa', password)).id).toBe(remoteId);
  });

  it('rejeita outro e-mail sem modificar a conta local', async () => {
    const user = await local.signUp({ name: 'Pessoa', email: 'local@example.com', username: 'local', password });
    await expect(migrateLocalIdentity(user.id, { id: crypto.randomUUID(), name: 'Outra', email: 'outra@example.com' })).rejects.toThrow('não corresponde');
    expect(await db.users.get(user.id)).toEqual(user);
  });
});
