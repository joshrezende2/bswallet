import { describe, expect, it } from 'vitest';
import { snapshotToWalletState, toSyncEnvelope } from '../src/data/xano/mapper';
import type { Base, EntityMap, LocalChange, Member, Preferences, User, Workspace } from '../src/domain/types';
import { missingRecordFields, remoteFields, syncRecordFields } from './helpers/xano-contract';

const user: User = { id: '00000000-0000-4000-8000-000000000001', name: 'Teste', email: 'teste@example.com', username: 'teste', createdAt: '2026-01-01T00:00:00.000Z' };
const workspaceId = '00000000-0000-4000-8000-000000000002';
const base: Base = { id: '00000000-0000-4000-8000-000000000004', workspaceId, ownerUserId: user.id, scope: 'shared', createdAt: user.createdAt, updatedAt: user.createdAt, createdBy: user.id, updatedBy: user.id, version: 1, syncStatus: 'local' };
const categoryId = '00000000-0000-4000-8000-000000000005';
const accountId = '00000000-0000-4000-8000-000000000006';
const cardId = '00000000-0000-4000-8000-000000000007';
const personId = '00000000-0000-4000-8000-000000000008';
const date = '2026-10-05';

// Typed minimal domain entities: all optional properties are deliberately absent.
const entities = {
  transactions: { ...base, name: 'Teste Sync', amount: 100, type: 'expense', status: 'confirmed', transactionDate: date, competenceDate: date, categoryId, paymentMode: 'single' },
  people: { ...base, name: 'Pessoa', monthlySpendingLimitEnabled: false, monthlySpendingLimit: 0, allowedCategoryIds: [], active: true },
  categories: { ...base, name: 'Mercado', icon: '', type: 'expense', active: true },
  accounts: { ...base, name: 'Conta', institution: '', type: 'checking', active: true },
  cards: { ...base, name: 'Cartão', bank: '', brand: '', last4Digits: '1234', totalLimit: 10000, closingDay: 1, dueDay: 10, ownerPersonId: personId, active: true },
  recurrences: { ...base, name: 'Recorrência', amount: 100, type: 'expense', categoryId, frequency: 'monthly', customIntervalValue: 1, customIntervalUnit: 'month', startDate: date, nextOccurrenceDate: date, autoConfirm: false, active: true },
  invoices: { ...base, cardId, cycleMonth: '2026-10', closingDate: date, dueDate: '2026-10-10' },
  budgets: { ...base, name: 'Mercado', month: '2026-10', categoryId, limitAmount: 1000, thresholds: [80, 90, 100], active: true },
  transfers: { ...base, name: 'Transferência', fromAccountId: accountId, toAccountId: '00000000-0000-4000-8000-000000000009', amount: 100, date },
  installmentGroups: { ...base, originalAmount: 1000, numberOfInstallments: 2, cardId, purchaseDate: date, firstInvoiceId: '00000000-0000-4000-8000-000000000010' },
} satisfies EntityMap;
const fixtures: Record<string, Record<string, unknown>> = {
  ...entities,
  workspace: { id: workspaceId, name: 'Família', masterAdminUserId: user.id, defaultScope: 'shared', sharingEnabled: true } satisfies Workspace,
  members: { id: base.id, userId: user.id, name: user.name, email: user.email, role: 'master_admin', permissions: [], status: 'active' } satisfies Member,
  preferences: { id: workspaceId, notificationsEnabled: false, noticeTypes: [], invoiceDays: 0, recurrenceDays: 1, installmentDays: 3, incomeDays: 1, attachmentMaxMB: 10 } satisfies Preferences & { id: string },
  // Legacy attachment metadata can predate a known MIME type; no Blob is sent.
  attachments: { ...base, transactionId: base.id, fileName: 'recibo', size: 0, checksum: '' },
};
const optionalFields: Record<string, string[]> = {
  people: ['linked_user_id'], accounts: ['owner_person_id', 'notes'], cards: ['account_id', 'notes'],
  recurrences: ['person_id', 'account_id', 'card_id', 'notes'],
  transactions: ['person_id', 'account_id', 'card_id', 'invoice_id', 'recurrence_id', 'installment_group_id', 'notes', 'occurrence_key', 'installment_number', 'installment_total'],
  budgets: ['person_id'], transfers: ['notes'], installmentGroups: ['category_id', 'person_id', 'account_id', 'notes'], attachments: ['mime_type'],
};
const serialized = (entityType: string, payload = fixtures[entityType], action = 'create') => JSON.parse(JSON.stringify(toSyncEnvelope({ ...change(entityType, payload), action }, workspaceId, user)));

function change(entityType: string, payload: Record<string, unknown>): LocalChange {
  return { id: '00000000-0000-4000-8000-000000000003', entityType, entityId: String(payload.id), action: 'update', version: Number(payload.version ?? 1), createdAt: '2026-01-01T00:00:00.000Z', payload };
}

describe('mapeamento Xano', () => {
  it('permissões e identidade remotas prevalecem sobre auditoria antiga', () => {
    const row = { id: base.id, user_id: user.id, role: 'member', active: true, permissions: ['shared.read', 'reports.read'] };
    const stale = { ...fixtures.members, role: 'master_admin', status: 'disabled', permissions: ['members.manage'] };
    const snapshot = snapshotToWalletState({ workspace: serialized('workspace').record, members: [row], audit_logs: [{ entity_type: 'members', entity_id: base.id, timestamp: base.createdAt, after_data: stale }] }, user);
    expect(snapshot.members[0]).toMatchObject({ id: base.id, userId: user.id, role: 'member', status: 'active', permissions: ['shared.read', 'reports.read'] });
  });

  it.each([{ permissions: [] }, { permissions: ['unknown.permission'] }])('não substitui permissões remotas vazias por defaults: %j', ({ permissions }) => {
    const snapshot = snapshotToWalletState({ workspace: serialized('workspace').record, members: [{ id: base.id, user_id: user.id, role: 'member', active: true, permissions }] }, user);
    expect(snapshot.members[0].permissions).toEqual([]);
  });

  it('preserva fallback compatível de membros antigos sem permissions', () => {
    const snapshot = snapshotToWalletState({ workspace: serialized('workspace').record, members: [{ id: base.id, user_id: user.id, role: 'member', active: true }] }, user);
    expect(snapshot.members[0].permissions).toEqual(['shared.read', 'shared.create', 'transactions.editOwn', 'attachments.read', 'reports.read']);
  });

  it('cobre exatamente todos os 14 endpoints de escrita', () => {
    expect(Object.keys(syncRecordFields)).toHaveLength(14);
    expect(Object.keys(fixtures).map(type => serialized(type).table).sort()).toEqual(Object.keys(syncRecordFields).sort());
  });

  it('todo null enviado tem coluna anulável no schema publicado do Xano', () => {
    for (const type of Object.keys(fixtures)) {
      const envelope = serialized(type);
      const fields = remoteFields(envelope.table);
      for (const [key, value] of Object.entries(envelope.record)) {
        // scope/owner on administrative entities are envelope/audit metadata.
        if (['scope', 'owner_user_id'].includes(key) && !fields[key]) continue;
        expect(fields, `${envelope.table}.${key}`).toHaveProperty(key);
        if (value === null) expect(fields[key].nullable, `${envelope.table}.${key} aceita null`).toBe(true);
      }
    }
  });

  it('normaliza também opcionais do schema remoto ausentes em payloads antigos', () => {
    const legacyOptional = {
      people: ['allowedCategoryIds'], categories: ['icon'], accounts: ['institution'],
      cards: ['bank', 'brand', 'last4Digits', 'ownerPersonId'], recurrences: ['categoryId'],
      transactions: ['categoryId'], budgets: ['categoryId'], installmentGroups: ['cardId'],
      attachments: ['size'], preferences: ['noticeTypes'],
    };
    for (const [type, keys] of Object.entries(legacyOptional)) {
      const payload = { ...fixtures[type] };
      for (const key of keys) delete payload[key];
      const envelope = serialized(type, payload);
      expect(missingRecordFields(envelope.table, envelope.record), type).toEqual([]);
      const fields = remoteFields(envelope.table);
      for (const [key, value] of Object.entries(envelope.record)) {
        if (value === null) expect(fields[key].nullable, `${envelope.table}.${key}`).toBe(true);
      }
    }
  });

  for (const entityType of Object.keys(fixtures)) {
    it.each(['create', 'update', 'delete', 'purge', 'restore'])(`${entityType}: JSON %s contém cada campo lido pelo XanoScript`, action => {
      const envelope = serialized(entityType, fixtures[entityType], action);
      expect(missingRecordFields(envelope.table, envelope.record)).toEqual([]);
      for (const field of optionalFields[entityType] ?? []) {
        expect(envelope.record).toHaveProperty(field);
        expect(envelope.record[field]).toBeNull();
      }
      expect(envelope.record.scope).toBe('shared');
      expect(envelope.record.owner_user_id).toBe(user.id);
      expect(envelope.payload).toEqual(fixtures[entityType]);
    });
  }

  it('reproduz a perda da propriedade undefined e normaliza também uma outbox antiga', () => {
    const payload = { ...entities.transactions, personId: undefined, accountId: undefined, cardId: undefined, notes: undefined };
    expect(JSON.parse(JSON.stringify({ person_id: payload.personId }))).not.toHaveProperty('person_id');
    const operation = JSON.parse(JSON.stringify(change('transactions', payload))) as LocalChange;
    const before = structuredClone(operation);
    const envelope = JSON.parse(JSON.stringify(toSyncEnvelope(operation, workspaceId, user)));
    for (const field of optionalFields.transactions) {
      expect(envelope.record).toHaveProperty(field);
      expect(envelope.record[field]).toBeNull();
    }
    expect(operation).toEqual(before);
    expect(envelope.record).toMatchObject({ name: 'Teste Sync', amount: 100, type: 'expense', status: 'confirmed', category_id: categoryId });
  });

  it.each([
    ['people', { linkedUserId: user.id }, { linked_user_id: user.id }],
    ['accounts', { ownerPersonId: personId, notes: 'Conta' }, { owner_person_id: personId, notes: 'Conta' }],
    ['cards', { accountId, notes: 'Cartão' }, { account_id: accountId, notes: 'Cartão' }],
    ['transactions', { personId }, { person_id: personId }],
    ['transactions', { accountId }, { account_id: accountId }],
    ['transactions', { cardId, invoiceId: base.id }, { card_id: cardId, invoice_id: base.id }],
    ['transactions', { paymentMode: 'installment', installmentGroupId: base.id, installmentNumber: 1, installmentTotal: 2 }, { payment_mode: 'installment', installment_group_id: base.id, installment_number: 1, installment_total: 2 }],
    ['transactions', { paymentMode: 'recurring', recurrenceId: base.id, occurrenceKey: `${base.id}:${date}` }, { payment_mode: 'recurring', recurrence_id: base.id, occurrence_key: `${base.id}:${date}` }],
    ['recurrences', { personId, accountId, cardId, notes: 'Série' }, { person_id: personId, account_id: accountId, card_id: cardId, notes: 'Série' }],
    ['budgets', { personId }, { person_id: personId }],
    ['transfers', { notes: 'Transferência' }, { notes: 'Transferência' }],
    ['installmentGroups', { categoryId, personId, accountId, notes: 'Legado' }, { category_id: categoryId, person_id: personId, account_id: accountId, notes: 'Legado' }],
    ['attachments', { mimeType: 'image/png' }, { mime_type: 'image/png' }],
  ] satisfies [string, Record<string, unknown>, Record<string, unknown>][] )('preserva vínculos e valores em %s: %j', (type, patch, expected) => {
    const envelope = serialized(type, { ...fixtures[type], ...patch });
    expect(envelope.record).toMatchObject(expected);
    expect(missingRecordFields(envelope.table, envelope.record)).toEqual([]);
  });

  it('preserva zero, false, string vazia e null explícito', () => {
    expect(serialized('transactions', { ...entities.transactions, amount: 0, notes: '', personId: null }).record).toMatchObject({ amount: 0, notes: '', person_id: null });
    expect(serialized('people').record).toMatchObject({ monthly_spending_limit_enabled: false, monthly_spending_limit: 0, allowed_category_ids: [] });
    expect(serialized('attachments').record.size_bytes).toBe(0);
  });

  it.each(['delete', 'purge', 'restore'])('preserva proprietário e escopo privado para %s', action => {
    for (const type of [...Object.keys(entities), 'attachments']) {
      const envelope = serialized(type, { ...fixtures[type], scope: 'personal', ownerUserId: personId }, action);
      expect(envelope.record).toMatchObject({ owner_user_id: personId, scope: 'private' });
      expect(missingRecordFields(envelope.table, envelope.record)).toEqual([]);
    }
  });

  it.each([
    ['cards', 'cards', { additionalOfCardId: cardId }, 'additional_of_card_id'],
    ['recurrences', 'recurrences', { endDate: '2027-01-01' }, 'end_date'],
    ['invoices', 'invoices', { paidAt: date }, 'paid_at'],
    ['installmentGroups', 'installment_groups', { firstInvoiceId: base.id }, 'first_invoice_id'],
    ['transfers', 'transfers', { personId }, 'person_id'],
    ['budgets', 'budgets', { thresholds: [50, 80, 100] }, 'thresholds'],
  ] satisfies [string, string, Record<string, unknown>, string][] )('preserva %s no payload/auditoria sem inventar coluna %s', (type, table, patch, column) => {
    const payload = { ...fixtures[type], ...patch };
    const envelope = serialized(type, payload);
    expect(envelope.record).not.toHaveProperty(column);
    expect(envelope.payload).toEqual(payload);
    const snapshot = snapshotToWalletState({ workspace: serialized('workspace').record, [table]: [envelope.record], audit_logs: [{ entity_type: type, entity_id: base.id, timestamp: base.createdAt, after_data: envelope.payload }] }, user);
    expect((snapshot[type as keyof EntityMap] as unknown[])[0]).toMatchObject(patch);
  });

  it('converte escopo e status sem alterar o payload canônico', () => {
    const payload = { id: '00000000-0000-4000-8000-000000000004', workspaceId, ownerUserId: user.id, scope: 'personal', createdAt: '2026-01-01T00:00:00.000Z', createdBy: user.id, updatedAt: '2026-01-02T00:00:00.000Z', updatedBy: user.id, version: 2, syncStatus: 'local', name: 'Teste', amount: 1000, type: 'expense', status: 'pending', transactionDate: '2026-01-02', competenceDate: '2026-01-02', categoryId: '00000000-0000-4000-8000-000000000005', paymentMode: 'single' };
    const envelope = toSyncEnvelope(change('transactions', payload), workspaceId, user);
    expect(envelope.table).toBe('transactions');
    expect(envelope.record).toMatchObject({ scope: 'private', status: 'forecast', amount: 1000 });
    expect(envelope.payload).toEqual(payload);
  });

  it('traduz frequências compostas para o schema atual do Xano', () => {
    const payload = { id: '00000000-0000-4000-8000-000000000006', workspaceId, ownerUserId: user.id, scope: 'shared', createdAt: '2026-01-01T00:00:00.000Z', createdBy: user.id, updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: user.id, version: 1, syncStatus: 'local', name: 'Trimestral', amount: 1000, type: 'expense', categoryId: '00000000-0000-4000-8000-000000000005', frequency: 'quarterly', customIntervalValue: 1, customIntervalUnit: 'month', startDate: '2026-01-01', nextOccurrenceDate: '2026-04-01', autoConfirm: false, active: true };
    const envelope = toSyncEnvelope(change('recurrences', payload), workspaceId, user);
    expect(envelope.record).toMatchObject({ frequency: 'custom', custom_interval_value: 3, custom_interval_unit: 'month' });
  });
});
