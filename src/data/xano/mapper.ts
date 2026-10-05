import { capabilities, type Capability, type Entity, type LocalChange, type Member, type Preferences, type Scope, type User, type WalletState, type Workspace } from '../../domain/types';
import { defaultPermissions } from '../../domain/permissions';

export interface SyncEnvelope {
  operation_id: string;
  entity_type: string;
  table: string;
  action: string;
  workspace_id: string;
  entity_id: string;
  version: number;
  actor_name: string;
  record: Record<string, unknown>;
  payload: unknown;
}

export interface RemoteSnapshot {
  workspace?: unknown;
  members?: unknown;
  people?: unknown;
  categories?: unknown;
  accounts?: unknown;
  cards?: unknown;
  recurrences?: unknown;
  invoices?: unknown;
  transactions?: unknown;
  budgets?: unknown;
  transfers?: unknown;
  installment_groups?: unknown;
  preferences?: unknown;
  audit_logs?: unknown;
  trash?: unknown;
  attachments?: unknown;
}

const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const list = (value: unknown): Record<string, any>[] => {
  if (Array.isArray(value)) return value.map(object);
  if (value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).items)) return ((value as Record<string, unknown>).items as unknown[]).map(object);
  return [];
};
const remoteScope = (scope: unknown) => scope === 'personal' ? 'private' : 'shared';
const localScope = (scope: unknown): Scope => scope === 'private' ? 'personal' : 'shared';
const remoteRole = (role: unknown) => role === 'master_admin' ? 'admin_master' : role;
const localRole = (role: unknown): Member['role'] => role === 'admin_master' ? 'master_admin' : role === 'admin' ? 'admin' : 'member';
const remoteAccountType = (type: unknown) => type === 'digital' ? 'wallet' : type;
const localAccountType = (type: unknown) => type === 'wallet' ? 'digital' : ['checking', 'savings', 'cash', 'other'].includes(String(type)) ? type : 'other';
const remoteCategoryType = (type: unknown) => type === 'both' ? 'expense' : type;
const remoteTransactionStatus = (status: unknown) => status === 'pending' ? 'forecast' : status;
const localTransactionStatus = (status: unknown) => ['forecast', 'pending', 'confirmed', 'cancelled'].includes(String(status)) ? status : 'forecast';
// Xano reads record fields directly: undefined keys disappear in JSON.stringify.
// Normalize at send time so previously persisted outbox entries work unchanged.
const nullable = <T>(value: T | null | undefined): T | null => value ?? null;

function remoteFrequency(payload: Record<string, any>) {
  switch (payload.frequency) {
    case 'biweekly': return { frequency: 'custom', custom_interval_value: 2, custom_interval_unit: 'week' };
    case 'bimonthly': return { frequency: 'custom', custom_interval_value: 2, custom_interval_unit: 'month' };
    case 'quarterly': return { frequency: 'custom', custom_interval_value: 3, custom_interval_unit: 'month' };
    case 'semiannual': return { frequency: 'custom', custom_interval_value: 6, custom_interval_unit: 'month' };
    case 'annual': return { frequency: 'yearly', custom_interval_value: 1, custom_interval_unit: 'year' };
    default: return { frequency: payload.frequency, custom_interval_value: payload.customIntervalValue ?? 1, custom_interval_unit: payload.customIntervalUnit ?? 'month' };
  }
}

function common(payload: Record<string, any>, workspaceId: string, actorUserId: string) {
  return {
    id: payload.id,
    workspace_id: payload.workspaceId ?? workspaceId,
    owner_user_id: payload.ownerUserId ?? actorUserId,
    scope: remoteScope(payload.scope),
    created_at: payload.createdAt,
    created_by: payload.createdBy ?? actorUserId,
    updated_at: payload.updatedAt,
    updated_by: payload.updatedBy ?? actorUserId,
    version: payload.version ?? 1,
    sync_status: 'synced',
  };
}

export function toSyncEnvelope(change: LocalChange, workspaceId: string, actor: User): SyncEnvelope {
  const p = object(change.payload);
  let table = change.entityType;
  let record: Record<string, unknown> = { ...common(p, workspaceId, actor.id) };
  switch (change.entityType) {
    case 'workspace':
      table = 'workspace';
      record = { id: change.entityId, name: p.name, created_by: p.masterAdminUserId ?? actor.id, active: true, scope: 'shared', owner_user_id: p.masterAdminUserId ?? actor.id };
      break;
    case 'members':
      table = 'workspace_members';
      record = { id: change.entityId, workspace_id: workspaceId, user_id: p.userId, role: remoteRole(p.role), permissions: p.permissions ?? (p.role === 'master_admin' ? [...capabilities] : [...defaultPermissions]), active: p.status !== 'disabled', scope: 'shared', owner_user_id: p.userId ?? actor.id };
      break;
    case 'people':
      record = { ...record, name: p.name, linked_user_id: nullable(p.linkedUserId), monthly_spending_limit_enabled: p.monthlySpendingLimitEnabled, monthly_spending_limit: p.monthlySpendingLimit, allowed_category_ids: nullable(p.allowedCategoryIds), active: p.active };
      break;
    case 'categories':
      record = { ...record, name: p.name, icon: nullable(p.icon), type: remoteCategoryType(p.type), active: p.active };
      break;
    case 'accounts':
      record = { ...record, name: p.name, institution: nullable(p.institution), type: remoteAccountType(p.type), owner_person_id: nullable(p.ownerPersonId), active: p.active, notes: nullable(p.notes) };
      break;
    case 'cards':
      record = { ...record, name: p.name, bank: nullable(p.bank), brand: nullable(p.brand), last4_digits: nullable(p.last4Digits), total_limit: p.totalLimit, closing_day: p.closingDay, due_day: p.dueDay, owner_person_id: nullable(p.ownerPersonId), account_id: nullable(p.accountId), active: p.active, notes: nullable(p.notes) };
      break;
    case 'recurrences':
      record = { ...record, name: p.name, amount: p.amount, type: p.type, category_id: nullable(p.categoryId), person_id: nullable(p.personId), account_id: nullable(p.accountId), card_id: nullable(p.cardId), notes: nullable(p.notes), ...remoteFrequency(p), start_date: p.startDate, next_occurrence_date: p.nextOccurrenceDate, auto_confirm: p.autoConfirm, active: p.active };
      break;
    case 'invoices':
      record = { ...record, card_id: p.cardId, cycle_month: p.cycleMonth, closing_date: p.closingDate, due_date: p.dueDate, status: p.paidAt ? 'paid' : 'open' };
      break;
    case 'transactions':
      record = { ...record, name: p.name, amount: p.amount, type: p.type, status: remoteTransactionStatus(p.status), transaction_date: p.transactionDate, competence_date: p.competenceDate, category_id: nullable(p.categoryId), person_id: nullable(p.personId), account_id: nullable(p.accountId), card_id: nullable(p.cardId), invoice_id: nullable(p.invoiceId), recurrence_id: nullable(p.recurrenceId), installment_group_id: nullable(p.installmentGroupId), notes: nullable(p.notes), payment_mode: p.paymentMode, occurrence_key: nullable(p.occurrenceKey), installment_number: nullable(p.installmentNumber), installment_total: nullable(p.installmentTotal) };
      break;
    case 'budgets':
      record = { ...record, name: p.name, category_id: nullable(p.categoryId), person_id: nullable(p.personId), amount: p.limitAmount, reference_month: p.month, active: p.active };
      break;
    case 'transfers':
      record = { ...record, from_account_id: p.fromAccountId, to_account_id: p.toAccountId, amount: p.amount, transfer_date: p.date, notes: nullable(p.notes) };
      break;
    case 'installmentGroups':
      table = 'installment_groups';
      // These four nullable columns exist in the endpoint but not in the current
      // domain group. Keep any legacy values; do not invent domain relationships.
      record = { ...record, name: `Parcelamento ${String(p.id ?? change.entityId).slice(0, 8)}`, total_amount: p.originalAmount, installment_count: p.numberOfInstallments, start_date: p.purchaseDate, category_id: nullable(p.categoryId), person_id: nullable(p.personId), account_id: nullable(p.accountId), card_id: nullable(p.cardId), notes: nullable(p.notes), active: true };
      break;
    case 'preferences':
      table = 'preferences';
      record = { id: change.entityId, workspace_id: workspaceId, user_id: actor.id, notifications_enabled: p.notificationsEnabled, notice_types: nullable(p.noticeTypes), invoice_days: p.invoiceDays, recurrence_days: p.recurrenceDays, installment_days: p.installmentDays, income_days: p.incomeDays, attachment_max_mb: p.attachmentMaxMB, scope: 'shared', owner_user_id: actor.id };
      break;
    case 'attachments':
      table = 'attachments';
      record = { id: change.entityId, workspace_id: p.workspaceId ?? workspaceId, owner_user_id: p.ownerUserId ?? actor.id, created_at: p.createdAt, created_by: p.createdBy ?? actor.id, entity_type: 'transactions', entity_id: p.transactionId, filename: p.fileName, mime_type: nullable(p.mimeType), size_bytes: nullable(p.size), active: change.action !== 'delete' && change.action !== 'purge', scope: remoteScope(p.scope) };
      break;
    default:
      throw new Error(`Entidade sem mapeamento Xano: ${change.entityType}.`);
  }
  return { operation_id: change.id, entity_type: change.entityType, table, action: change.action, workspace_id: workspaceId, entity_id: change.entityId, version: change.version, actor_name: actor.name, record, payload: change.payload };
}

function latestAudit(audits: Record<string, any>[], entityType: string, entityId: string) {
  const candidates = audits.filter(row => row.entity_type === entityType && row.entity_id === entityId);
  candidates.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  return candidates.length ? candidates[candidates.length - 1] : null;
}

function latestPayload(audits: Record<string, any>[], entityType: string, entityId: string) {
  const latest = latestAudit(audits, entityType, entityId);
  return latest?.after_data && typeof latest.after_data === 'object' ? object(latest.after_data) : null;
}

function synced<T extends Record<string, any>>(value: T) { return { ...value, syncStatus: 'synced' } as T; }

function fallbackEntity(entityType: string, row: Record<string, any>): Record<string, any> {
  const base = synced({ id: row.id, workspaceId: row.workspace_id, ownerUserId: row.owner_user_id, scope: localScope(row.scope), createdAt: row.created_at ?? new Date().toISOString(), createdBy: row.created_by ?? row.owner_user_id, updatedAt: row.updated_at ?? row.created_at ?? new Date().toISOString(), updatedBy: row.updated_by ?? row.owner_user_id, version: row.version ?? 1 });
  switch (entityType) {
    case 'people': return { ...base, name: row.name, linkedUserId: row.linked_user_id, monthlySpendingLimitEnabled: Boolean(row.monthly_spending_limit_enabled), monthlySpendingLimit: row.monthly_spending_limit ?? 0, allowedCategoryIds: row.allowed_category_ids ?? [], active: row.active !== false };
    case 'categories': return { ...base, name: row.name, icon: row.icon ?? '', type: row.type ?? 'expense', active: row.active !== false };
    case 'accounts': return { ...base, name: row.name, institution: row.institution ?? '', type: localAccountType(row.type), ownerPersonId: row.owner_person_id, active: row.active !== false, notes: row.notes };
    case 'cards': return { ...base, name: row.name, bank: row.bank ?? '', brand: row.brand ?? '', last4Digits: row.last4_digits ?? '0000', totalLimit: row.total_limit ?? 0, closingDay: row.closing_day ?? 1, dueDay: row.due_day ?? 1, ownerPersonId: row.owner_person_id, accountId: row.account_id, active: row.active !== false, notes: row.notes };
    case 'recurrences': return { ...base, name: row.name, amount: row.amount, type: row.type, categoryId: row.category_id, personId: row.person_id, accountId: row.account_id, cardId: row.card_id, notes: row.notes, frequency: row.frequency === 'yearly' ? 'annual' : row.frequency === 'custom' ? 'custom' : row.frequency, customIntervalValue: row.custom_interval_value ?? 1, customIntervalUnit: row.custom_interval_unit ?? 'month', startDate: row.start_date, nextOccurrenceDate: row.next_occurrence_date, autoConfirm: Boolean(row.auto_confirm), active: row.active !== false };
    case 'invoices': return { ...base, cardId: row.card_id, cycleMonth: row.cycle_month, closingDate: row.closing_date, dueDate: row.due_date, paidAt: row.status === 'paid' ? row.updated_at ?? row.due_date : undefined };
    case 'transactions': return { ...base, name: row.name, amount: row.amount, type: row.type, status: localTransactionStatus(row.status), transactionDate: row.transaction_date, competenceDate: row.competence_date, categoryId: row.category_id, personId: row.person_id, accountId: row.account_id, cardId: row.card_id, invoiceId: row.invoice_id, recurrenceId: row.recurrence_id, installmentGroupId: row.installment_group_id, notes: row.notes, paymentMode: row.payment_mode, occurrenceKey: row.occurrence_key, installmentNumber: row.installment_number, installmentTotal: row.installment_total };
    case 'budgets': return { ...base, name: row.name, categoryId: row.category_id, personId: row.person_id, limitAmount: row.amount, month: row.reference_month, thresholds: [80, 90, 100], active: row.active !== false };
    case 'transfers': return { ...base, name: 'Transferência', fromAccountId: row.from_account_id, toAccountId: row.to_account_id, amount: row.amount, date: row.transfer_date, notes: row.notes };
    case 'installmentGroups': return { ...base, originalAmount: row.total_amount, numberOfInstallments: row.installment_count, cardId: row.card_id, purchaseDate: row.start_date, firstInvoiceId: '' };
    default: return base;
  }
}

function canonicalEntity(entityType: string, row: Record<string, any>, audits: Record<string, any>[]) {
  const payload = latestPayload(audits, entityType, row.id);
  return payload ? synced(payload) : fallbackEntity(entityType, row);
}

export function snapshotToWalletState(snapshot: RemoteSnapshot, user: User): WalletState {
  const audits = list(snapshot.audit_logs);
  const workspaceRow = object(snapshot.workspace);
  const workspacePayload = latestPayload(audits, 'workspace', workspaceRow.id);
  const workspace: Workspace = workspacePayload ? workspacePayload as Workspace : { id: workspaceRow.id, name: workspaceRow.name ?? 'Família', masterAdminUserId: workspaceRow.created_by ?? user.id, defaultScope: 'shared', sharingEnabled: true };
  const memberRows = list(snapshot.members);
  const members: Member[] = memberRows.map(row => {
    const payload = latestPayload(audits, 'members', row.id);
    const role = localRole(row.role);
    // Current membership columns are authoritative, even when audit payloads
    // contain an older grant. Explicit [] means no capabilities, not defaults.
    const source = Array.isArray(row.permissions) ? row.permissions : Array.isArray(payload?.permissions) ? payload.permissions : defaultPermissions;
    const permissions: Capability[] = role === 'master_admin' ? [...capabilities] : source.filter((value: unknown): value is Capability => capabilities.includes(value as Capability));
    return { id: row.id, userId: row.user_id, name: row.user_id === user.id ? user.name : payload?.name ?? row.name ?? 'Membro', email: row.user_id === user.id ? user.email : payload?.email ?? '', role, permissions, status: row.active === false ? 'disabled' : 'active' };
  });
  if (!members.some(member => member.userId === user.id)) members.push({ id: crypto.randomUUID(), userId: user.id, name: user.name, email: user.email, role: workspace.masterAdminUserId === user.id ? 'master_admin' : 'member', permissions: workspace.masterAdminUserId === user.id ? [...capabilities] : [...defaultPermissions], status: 'active' });
  const convert = (entityType: string, value: unknown) => list(value).map(row => canonicalEntity(entityType, row, audits)) as Entity[];
  const transactions = convert('transactions', snapshot.transactions) as WalletState['transactions'];
  const preferenceRow = object(snapshot.preferences);
  const preferencePayload = latestPayload(audits, 'preferences', workspace.id);
  const preferences: Preferences = preferencePayload ? preferencePayload as unknown as Preferences : { notificationsEnabled: preferenceRow.notifications_enabled !== false, noticeTypes: preferenceRow.notice_types ?? ['invoice', 'overdue', 'recurrence', 'installment', 'income', 'budget'], invoiceDays: preferenceRow.invoice_days ?? 3, recurrenceDays: preferenceRow.recurrence_days ?? 1, installmentDays: preferenceRow.installment_days ?? 3, incomeDays: preferenceRow.income_days ?? 1, attachmentMaxMB: preferenceRow.attachment_max_mb ?? 10 };
  const audit = audits.map(row => ({ id: row.id, workspaceId: row.workspace_id, entityType: row.entity_type, entityId: row.entity_id, action: row.action, actorUserId: row.actor_user_id, actorName: row.actor_name ?? '', timestamp: row.timestamp, scope: localScope(row.scope), ownerUserId: row.owner_user_id ?? row.actor_user_id, beforeData: row.before_data, afterData: row.after_data }));
  const trash = list(snapshot.trash).flatMap(row => {
    const kind = row.entity_type as WalletState['trash'][number]['kind'];
    const latest = latestAudit(audits, row.entity_type, row.entity_id);
    if (latest && ['restore', 'purge'].includes(String(latest.action))) return [];
    const payload = object(row.data);
    if (!['transactions', 'accounts', 'cards', 'categories', 'people', 'recurrences', 'budgets', 'transfers', 'invoices', 'installmentGroups'].includes(kind) || !payload.id) return [];
    const deletedAt = typeof row.deleted_at === 'string' ? row.deleted_at : new Date().toISOString();
    return [{ id: row.id, kind, snapshot: synced(payload) as Entity, deletedAt, deletedBy: row.deleted_by, purgeAt: new Date(Date.parse(deletedAt) + 30 * 86400000).toISOString() }];
  });
  return {
    id: workspace.id, workspace, members,
    transactions,
    accounts: convert('accounts', snapshot.accounts) as WalletState['accounts'],
    cards: convert('cards', snapshot.cards) as WalletState['cards'],
    categories: convert('categories', snapshot.categories) as WalletState['categories'],
    people: convert('people', snapshot.people) as WalletState['people'],
    recurrences: convert('recurrences', snapshot.recurrences) as WalletState['recurrences'],
    budgets: convert('budgets', snapshot.budgets) as WalletState['budgets'],
    transfers: convert('transfers', snapshot.transfers) as WalletState['transfers'],
    invoices: convert('invoices', snapshot.invoices) as WalletState['invoices'],
    installmentGroups: convert('installmentGroups', snapshot.installment_groups) as WalletState['installmentGroups'],
    audit, trash, outbox: [], notices: [], occurrenceKeys: transactions.map(item => item.occurrenceKey).filter((value): value is string => Boolean(value)), preferences, demo: false,
  };
}
