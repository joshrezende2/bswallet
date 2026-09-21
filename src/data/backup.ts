import { z } from 'zod';
import { db } from './db';
import { auth } from './auth';
import { base } from './factory';
import { exportState, downloadBlob } from './exports';
import { record, validateRelations } from './wallet-service';
import { memberOf, requireWrite } from '../domain/permissions';
import { schemas, validateEntity } from '../domain/validation';
import { entityKinds, type Attachment, type Context, type Entity, type Kind, type Scope, type WalletState } from '../domain/types';
const metadata = z.object({ id: z.string().min(1).max(200), workspaceId: z.string().min(1), ownerUserId: z.string().min(1), scope: z.enum(['personal', 'shared']), createdAt: z.string().datetime(), createdBy: z.string(), updatedAt: z.string().datetime(), updatedBy: z.string(), version: z.number().int().positive(), syncStatus: z.enum(['local', 'pending', 'synced', 'conflict']) });
const invoice = metadata.extend({ cardId: z.string(), cycleMonth: z.string().regex(/^\d{4}-\d{2}$/), closingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), paidAt: z.string().datetime().optional() });
const group = metadata.extend({ originalAmount: z.number().int().positive(), numberOfInstallments: z.number().int().min(2).max(360), cardId: z.string(), purchaseDate: z.string(), firstInvoiceId: z.string() });
const envelope = z.object({ schemaVersion: z.literal(1), appVersion: z.string(), exportedAt: z.string().datetime(), exportedBy: z.string(), data: z.record(z.unknown()), attachments: z.array(z.object({ id: z.string(), transactionId: z.string(), fileName: z.string().max(200), mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']), size: z.number().int().min(1).max(25 * 1024 * 1024), base64: z.string(), checksum: z.string() })).max(10000) });
export type Backup = z.infer<typeof envelope>;
export function validateBackup(input: unknown): Backup {
  const parsed = envelope.safeParse(input); if (!parsed.success) throw new Error('Backup inválido ou de versão incompatível. Esperada schemaVersion 1.');
  const value = parsed.data; let count = 0; const seen = new Set<string>();
  for (const kind of entityKinds) {
    const records = value.data[kind]; if (!Array.isArray(records)) throw new Error(`Coleção ausente: ${kind}.`);
    for (const entity of records) {
      if (++count > 100000) throw new Error('O backup excede 100.000 registros.');
      const meta = metadata.safeParse(entity); if (!meta.success) throw new Error(`Metadados inválidos em ${kind}.`);
      if (seen.has(meta.data.id)) throw new Error('O backup contém identificadores duplicados.'); seen.add(meta.data.id);
      if (kind in schemas) validateEntity(kind as keyof typeof schemas, entity);
      else if (!(kind === 'invoices' ? invoice : group).safeParse(entity).success) throw new Error(`Registro inválido em ${kind}.`);
    }
  }
  if (!Array.isArray(value.data.trash) || !Array.isArray(value.data.audit) || !Array.isArray(value.data.occurrenceKeys)) throw new Error('Histórico ou lixeira inválidos.');
  const references = ['categoryId', 'personId', 'ownerPersonId', 'accountId', 'fromAccountId', 'toAccountId', 'cardId', 'additionalOfCardId', 'invoiceId', 'installmentGroupId', 'firstInvoiceId'];
  for (const kind of entityKinds) for (const item of value.data[kind] as Record<string, unknown>[]) for (const field of references) if (item[field] && !seen.has(String(item[field]))) throw new Error(`Vínculo ausente no backup: ${field}.`);
  return value;
}
async function toBase64(blob: Blob) { const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(binary); }
export async function createBackup(ctx: Context) {
  const state = await exportState(ctx), allowedTx = new Set([...state.transactions.map(t => t.id), ...state.trash.filter(t => t.kind === 'transactions').map(t => t.snapshot.id)]);
  const attachmentRows = (await db.attachments.where('workspaceId').equals(ctx.workspaceId).toArray()).filter(a => allowedTx.has(a.transactionId));
  const attachments = await Promise.all(attachmentRows.map(async a => ({ id: a.id, transactionId: a.transactionId, fileName: a.fileName, mimeType: a.mimeType, size: a.size, checksum: a.checksum, base64: await toBase64(a.blob) })));
  const txIds = new Set(state.transactions.map(t => t.id));
  const raw = await db.wallets.get(ctx.workspaceId);
  state.occurrenceKeys = (raw?.occurrenceKeys ?? []).filter(k => state.recurrences.some(r => k.startsWith(r.id + ':')));
  const data = { ...Object.fromEntries(entityKinds.map(k => [k, state[k]])), workspace: { name: state.workspace.name }, trash: state.trash, audit: state.audit, occurrenceKeys: state.occurrenceKeys, preferences: state.preferences };
  void txIds;
  return { schemaVersion: 1, appVersion: '0.1.0', exportedAt: new Date().toISOString(), exportedBy: ctx.user.id, data, attachments } as Backup;
}
export async function exportBackup(ctx: Context) { const backup = await createBackup(ctx); downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }), `bs-wallet-backup-${new Date().toISOString().slice(0, 10)}.json`); }
export async function importBackup(ctx: Context, input: unknown) {
  await auth.requireUser(ctx.user.id); const backup = validateBackup(input);
  const decoded = await Promise.all(backup.attachments.map(async a => {
    let binary: string; try { binary = atob(a.base64); } catch { throw new Error('Anexo com conteúdo inválido.'); }
    if (binary.length !== a.size) throw new Error('Tamanho do anexo inconsistente.');
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    const checksum = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    if (checksum !== a.checksum) throw new Error('A verificação de integridade de um anexo falhou.');
    const magic = String.fromCharCode(...bytes.slice(0, 12));
    if (!(a.mimeType === 'application/pdf' ? magic.startsWith('%PDF-') : a.mimeType === 'image/png' ? bytes[0] === 137 && magic.slice(1, 4) === 'PNG' : a.mimeType === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 : magic.startsWith('RIFF') && magic.slice(8, 12) === 'WEBP')) throw new Error('Formato do anexo incompatível.');
    return { ...a, blob: new Blob([bytes], { type: a.mimeType }) };
  }));
  return db.transaction('rw', [db.wallets, db.attachments, db.safetyBackups], async () => {
    const state = await db.wallets.get(ctx.workspaceId); if (!state) throw new Error('Família não encontrada.');
    const member = memberOf(state, ctx);
    if (entityKinds.some(k => (backup.data[k] as Entity[]).some(e => e.scope === 'shared')) && member.role !== 'master_admin') throw new Error('Somente o Master pode importar dados compartilhados.');
    const ids = new Map<string, string>();
    for (const kind of entityKinds) for (const e of backup.data[kind] as Entity[]) ids.set(e.id, crypto.randomUUID());
    const remap = (value: unknown): unknown => {
      if (typeof value === 'string') { if (ids.has(value)) return ids.get(value)!; for (const [old, next] of ids) if (value.startsWith(old + ':')) return next + value.slice(old.length); return value; }
      if (Array.isArray(value)) return value.map(remap);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v)]));
      return value;
    };
    const before = structuredClone(state), priorAttachments = await db.attachments.where('workspaceId').equals(state.id).toArray();
    await db.safetyBackups.add({ id: crypto.randomUUID(), userId: ctx.user.id, createdAt: new Date().toISOString(), state: before, attachments: priorAttachments });
    const imported: { kind: Kind; item: Entity }[] = [];
    for (const kind of entityKinds) for (const incoming of backup.data[kind] as Entity[]) {
      const item = { ...(remap(incoming) as Entity), ...base(state.id, ctx.user.id, incoming.scope), id: ids.get(incoming.id)! } as Entity;
      if ('linkedUserId' in item) item.linkedUserId = undefined;
      requireWrite(state, ctx, item, kind === 'budgets' ? 'budgets.manage' : kind === 'transactions' || kind === 'transfers' ? 'transactions.editOwn' : 'catalog.manage', true);
      (state[kind] as Entity[]).push(item); imported.push({ kind, item });
    }
    for (const { kind, item } of imported) { validateRelations(state, ctx, kind, item, undefined, true); record(state, ctx, kind, 'import', item); }
    state.occurrenceKeys.push(...(backup.data.occurrenceKeys as string[]).map(k => remap(k) as string));
    for (const a of decoded) {
      const transactionId = ids.get(a.transactionId), transaction = state.transactions.find(t => t.id === transactionId);
      if (!transaction) continue;
      const attachment: Attachment = { ...base(state.id, ctx.user.id, transaction.scope), transactionId: transaction.id, fileName: a.fileName, mimeType: a.mimeType, size: a.size, checksum: a.checksum, blob: a.blob };
      await db.attachments.add(attachment);
    }
    record(state, ctx, 'backup', 'import', { id: state.id, scope: 'personal', ownerUserId: ctx.user.id }, { exportedAt: backup.exportedAt, records: imported.length });
    await db.wallets.put(state); return imported.length;
  });
}
