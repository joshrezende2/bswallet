import { db } from './db';
import { auth } from './auth';
import { scheduleWalletSync } from './sync';
import { base } from './factory';
import { addDays, addMonths, budgetUsage, invoiceCycle, nextOccurrence, recurrenceDates, splitInstallments, today } from '../domain/finance';
import { canRead, hasCapability, memberOf, requireRead, requireWrite, validateMemberChange, defaultPermissions } from '../domain/permissions';
import { validateEntity, schemas } from '../domain/validation';
import { entityKinds, type Attachment, type Base, type Context, type Entity, type EntityMap, type Invoice, type Kind, type Member, type Recurrence, type Scope, type Transaction, type WalletState } from '../domain/types';

export function record(state: WalletState, ctx: Context, kind: string, action: string, after: { id: string; scope?: Scope; ownerUserId?: string; version?: number }, before?: unknown) {
  const timestamp = new Date().toISOString();
  state.audit.push({ id: crypto.randomUUID(), workspaceId: state.id, entityType: kind, entityId: after.id, action, actorUserId: ctx.user.id, actorName: ctx.user.name, timestamp, scope: after.scope ?? 'shared', ownerUserId: after.ownerUserId ?? ctx.user.id, beforeData: before, afterData: after });
  state.outbox.push({ id: crypto.randomUUID(), entityType: kind, entityId: after.id, action, version: after.version ?? 1, createdAt: timestamp, payload: action === 'delete' || action === 'purge' ? { id: after.id, workspaceId: state.id, version: after.version } : after });
}
function touch<T extends Base>(entity: T, ctx: Context): T { return { ...entity, version: entity.version + 1, updatedAt: new Date().toISOString(), updatedBy: ctx.user.id, syncStatus: 'local' }; }
function writeCapability(kind: Kind, entity: Base, ctx: Context) {
  if (kind === 'transactions' || kind === 'transfers') return entity.ownerUserId === ctx.user.id ? 'transactions.editOwn' as const : 'transactions.editOthers' as const;
  if (kind === 'budgets') return 'budgets.manage' as const;
  return 'catalog.manage' as const;
}
export function validateRelations(state: WalletState, ctx: Context, kind: Kind, entity: Entity, before?: Entity, historical = false) {
  const item = entity as unknown as Record<string, unknown>, previous = before as unknown as Record<string, unknown> | undefined;
  const relationships = { categoryId: 'categories', personId: 'people', ownerPersonId: 'people', accountId: 'accounts', fromAccountId: 'accounts', toAccountId: 'accounts', cardId: 'cards', additionalOfCardId: 'cards' } as const;
  for (const [field, collection] of Object.entries(relationships)) {
    const id = item[field]; if (!id) continue;
    const related = state[collection].find(v => v.id === id);
    if (!related) throw new Error(`O vínculo ${field} não está disponível. Restaure ou escolha outro cadastro.`);
    requireRead(state, ctx, related);
    if (!historical && !related.active && previous?.[field] !== id) throw new Error('Cadastros inativos não podem ser usados em novos lançamentos.');
    if (entity.scope === 'shared' && related.scope !== 'shared') throw new Error('Um item compartilhado não pode apontar para um cadastro privado.');
    if ((collection === 'cards' || collection === 'accounts') && related.scope !== entity.scope) throw new Error('Cartão e conta devem pertencer à mesma carteira do lançamento.');
    if (id === entity.id) throw new Error('Um cadastro não pode apontar para si próprio.');
  }
  if ('categoryId' in entity && 'type' in entity) {
    const category = state.categories.find(c => c.id === entity.categoryId);
    if (category && category.type !== 'both' && category.type !== entity.type) throw new Error('Categoria incompatível com o tipo de lançamento.');
  }
  if ('personId' in entity && entity.personId && 'categoryId' in entity) {
    const person = state.people.find(p => p.id === entity.personId);
    if (person?.allowedCategoryIds.length && !person.allowedCategoryIds.includes(entity.categoryId)) throw new Error('Esta categoria não está permitida para a pessoa selecionada.');
  }
  if ('cardId' in entity && entity.cardId && 'type' in entity && entity.type === 'income') throw new Error('Receitas devem ser vinculadas a contas, sem cartão de crédito.');
  if (kind === 'people') {
    const person = entity as EntityMap['people'];
    if (person.linkedUserId && !state.members.some(m => m.userId === person.linkedUserId && m.status === 'active')) throw new Error('Usuário não pertence a esta família.');
    for (const id of person.allowedCategoryIds) { const c = state.categories.find(c => c.id === id); if (!c || !canRead(state, ctx, c) || (person.scope === 'shared' && c.scope !== 'shared')) throw new Error('Categoria permitida inválida.'); }
  }
  if (kind === 'recurrences') {
    const recurrence = entity as Recurrence;
    if (recurrence.endDate && recurrence.endDate < recurrence.startDate) throw new Error('O fim deve ser posterior ao início.');
    if (before && state.occurrenceKeys.some(k => k.startsWith(`${entity.id}:`)) && (recurrence.startDate !== (before as Recurrence).startDate || recurrence.frequency !== (before as Recurrence).frequency || recurrence.customIntervalValue !== (before as Recurrence).customIntervalValue || recurrence.customIntervalUnit !== (before as Recurrence).customIntervalUnit)) throw new Error('Para mudar o calendário de uma série com ocorrências, pause-a e crie outra.');
  }
  if (kind === 'budgets') {
    const b = entity as EntityMap['budgets'];
    if (state.budgets.some(x => x.id !== b.id && x.active && x.scope === b.scope && x.month === b.month && x.categoryId === b.categoryId && x.personId === b.personId && (b.scope === 'shared' || x.ownerUserId === b.ownerUserId))) throw new Error('Já existe orçamento para esta categoria, pessoa e mês.');
  }
}
export function ensureInvoice(state: WalletState, ctx: Context, cardId: string, date: string, scope: Scope, overrideMonth?: string) {
  const card = state.cards.find(c => c.id === cardId); if (!card) throw new Error('Cartão não encontrado.');
  const cycle = invoiceCycle(date, card.closingDay, card.dueDay, overrideMonth);
  let invoice = state.invoices.find(i => i.cardId === cardId && i.cycleMonth === cycle.cycleMonth);
  if (!invoice) { invoice = { ...base(state.id, ctx.user.id, scope), cardId, ...cycle }; state.invoices.push(invoice); record(state, ctx, 'invoices', 'create', invoice); }
  return invoice;
}
function assertUnpaid(state: WalletState, transaction: Transaction) { if (state.invoices.find(i => i.id === transaction.invoiceId)?.paidAt) throw new Error('Reabra a fatura antes de alterar seus lançamentos.'); }
function assertScopeChange(state: WalletState, kind: Kind, before: Entity | undefined, next: Entity) {
  if (!before || before.scope === next.scope) return;
  if (kind !== 'transactions' && kind !== 'transfers') throw new Error('O escopo de um cadastro existente é preservado. Crie outro cadastro na carteira desejada.');
  if (kind === 'transactions' && ((before as Transaction).installmentGroupId || (before as Transaction).recurrenceId)) throw new Error('O escopo de ocorrências e parcelas é definido pela série.');
}
async function mutate<T>(ctx: Context, fn: (state: WalletState) => T | Promise<T>): Promise<T> {
  await auth.requireUser(ctx.user.id);
  let changed = false;
  const result = await db.transaction('rw', [db.wallets, db.attachments], async () => {
    const state = await db.wallets.get(ctx.workspaceId); if (!state) throw new Error('Família não encontrada.'); memberOf(state, ctx);
    const pending = state.outbox.length;
    const result = await fn(state); await db.wallets.put(state); changed = state.outbox.length > pending; return result;
  });
  if (changed) scheduleWalletSync(ctx);
  return result;
}
export function accessibleState(state: WalletState, ctx: Context): WalletState {
  memberOf(state, ctx);
  const filtered = { ...state };
  for (const kind of entityKinds) (filtered[kind] as Entity[]) = state[kind].filter(e => canRead(state, ctx, e));
  filtered.trash = state.trash.filter(t => canRead(state, ctx, t.snapshot));
  filtered.audit = state.audit.filter(a => canRead(state, ctx, a));
  filtered.notices = state.notices.filter(n => canRead(state, ctx, n));
  filtered.outbox = [];
  filtered.occurrenceKeys = [];
  if (!hasCapability(state, ctx, 'members.manage')) filtered.members = state.members.filter(m => m.status === 'active').map(m => ({ ...m, email: m.userId === ctx.user.id ? m.email : '', permissions: m.userId === ctx.user.id ? m.permissions : [] }));
  return filtered;
}
export const walletService = {
  async save<K extends keyof typeof schemas>(ctx: Context, kind: K, input: unknown, id?: string, expectedVersion?: number, invoiceMonth?: string) {
    return mutate(ctx, state => {
      const items = state[kind] as Entity[], existing = id ? items.find(e => e.id === id) : undefined;
      if (id && !existing) throw new Error('Item não encontrado.');
      if (existing && expectedVersion !== undefined && existing.version !== expectedVersion) throw new Error('Este item mudou em outra aba. Reabra antes de editar.');
      const parsed = validateEntity(kind, input);
      const item = { ...(existing ? touch(existing, ctx) : base(state.id, ctx.user.id, parsed.scope)), ...parsed } as Entity;
      if (existing) requireWrite(state, ctx, existing, writeCapability(kind, existing, ctx));
      requireWrite(state, ctx, item, writeCapability(kind, item, ctx), !existing);
      assertScopeChange(state, kind, existing, item);
      validateRelations(state, ctx, kind, item, existing);
      if (kind === 'transactions') {
        const tx = item as Transaction; if (existing) assertUnpaid(state, existing as Transaction);
        if (!existing && tx.paymentMode !== 'single') throw new Error('Use o fluxo de parcelas ou recorrências.');
        if (tx.cardId) {
          const previous = existing as Transaction | undefined;
          const oldInvoice = previous?.cardId === tx.cardId && previous.transactionDate === tx.transactionDate ? state.invoices.find(i => i.id === previous.invoiceId) : undefined;
          const invoice = ensureInvoice(state, ctx, tx.cardId, tx.transactionDate, tx.scope, invoiceMonth ?? oldInvoice?.cycleMonth);
          if (invoice.paidAt) throw new Error('Não é possível adicionar a uma fatura paga.');
          tx.invoiceId = invoice.id; tx.competenceDate = invoice.dueDate;
        } else tx.invoiceId = undefined;
      }
      if (existing) items[items.indexOf(existing)] = item; else items.push(item);
      record(state, ctx, kind, existing ? 'update' : 'create', item, existing);
      return item as EntityMap[K];
    });
  },
  async createTransaction(ctx: Context, input: Omit<Transaction, keyof Base | 'invoiceId'> & { scope: Scope }, count = 1, invoiceMonth?: string) {
    return mutate(ctx, state => {
      validateEntity('transactions', input);
      const template = { ...base(state.id, ctx.user.id, input.scope), ...input } as Transaction;
      requireWrite(state, ctx, template, 'transactions.editOwn', true); validateRelations(state, ctx, 'transactions', template);
      if (input.paymentMode === 'recurring') throw new Error('Crie uma recorrência pelo formulário da série.');
      if (input.paymentMode === 'installment' && (!input.cardId || input.type !== 'expense')) throw new Error('Parcelas precisam de uma despesa com cartão.');
      const amounts = input.paymentMode === 'installment' ? splitInstallments(input.amount, count) : [input.amount];
      const groupId = amounts.length > 1 ? crypto.randomUUID() : undefined;
      const first = input.cardId ? ensureInvoice(state, ctx, input.cardId, input.transactionDate, input.scope, invoiceMonth) : undefined;
      const transactions = amounts.map((amount, index) => {
        const invoice = first ? ensureInvoice(state, ctx, input.cardId!, input.transactionDate, input.scope, addMonths(`${first.cycleMonth}-01`, index).slice(0, 7)) : undefined;
        if (invoice?.paidAt) throw new Error('A fatura selecionada já foi paga. Reabra-a antes de adicionar.');
        const tx: Transaction = { ...template, ...base(state.id, ctx.user.id, input.scope), amount, competenceDate: invoice?.dueDate ?? input.competenceDate,
          invoiceId: invoice?.id, installmentGroupId: groupId, installmentNumber: groupId ? index + 1 : undefined, installmentTotal: groupId ? count : undefined };
        state.transactions.push(tx); record(state, ctx, 'transactions', 'create', tx); return tx;
      });
      if (groupId) { const group = { ...base(state.id, ctx.user.id, input.scope), id: groupId, originalAmount: input.amount, numberOfInstallments: count, cardId: input.cardId!, purchaseDate: input.transactionDate, firstInvoiceId: first!.id }; state.installmentGroups.push(group); record(state, ctx, 'installmentGroups', 'create', group); }
      return transactions;
    });
  },
  async updateSeries(ctx: Context, id: string, patch: Pick<Transaction, 'name' | 'categoryId' | 'personId' | 'notes'>) {
    return mutate(ctx, state => {
      const tx = state.transactions.find(t => t.id === id); if (!tx?.installmentGroupId) throw new Error('Série não encontrada.');
      const items = state.transactions.filter(t => t.installmentGroupId === tx.installmentGroupId);
      for (const item of items) {
        requireWrite(state, ctx, item, writeCapability('transactions', item, ctx)); assertUnpaid(state, item);
        const next = { ...touch(item, ctx), ...patch }; validateEntity('transactions', next); validateRelations(state, ctx, 'transactions', next, item);
        state.transactions[state.transactions.indexOf(item)] = next; record(state, ctx, 'transactions', 'update', next, item);
      }
    });
  },
  async remove(ctx: Context, kind: Kind, id: string, series = false) {
    return mutate(ctx, state => {
      const item = (state[kind] as Entity[]).find(e => e.id === id); if (!item) throw new Error('Item não encontrado.');
      if (!['transactions', 'transfers', 'recurrences', 'budgets'].includes(kind)) throw new Error('Desative este cadastro para preservar seus vínculos.');
      let targets: { kind: Kind; item: Entity }[] = [{ kind, item }];
      if (kind === 'transactions' && series) {
        const tx = item as Transaction;
        targets = state.transactions.filter(t => tx.installmentGroupId ? t.installmentGroupId === tx.installmentGroupId : tx.recurrenceId ? t.recurrenceId === tx.recurrenceId : t.id === id).map(item => ({ kind, item }));
        if (tx.recurrenceId) { const r = state.recurrences.find(r => r.id === tx.recurrenceId); if (r) targets.push({ kind: 'recurrences', item: r }); }
      }
      if (kind === 'recurrences' && series) targets.push(...state.transactions.filter(t => t.recurrenceId === id).map(item => ({ kind: 'transactions' as const, item })));
      for (const target of targets) {
        requireWrite(state, ctx, target.item, 'transactions.delete');
        if (target.kind === 'transactions') assertUnpaid(state, target.item as Transaction);
        state.trash.push({ id: crypto.randomUUID(), kind: target.kind, snapshot: target.item, deletedAt: new Date().toISOString(), deletedBy: ctx.user.id, purgeAt: new Date(Date.now() + 30 * 86400000).toISOString() });
        (state[target.kind] as Entity[]) = (state[target.kind] as Entity[]).filter(e => e.id !== target.item.id);
        record(state, ctx, target.kind, 'delete', touch(target.item, ctx), target.item);
      }
    });
  },
  async restore(ctx: Context, trashId: string) {
    return mutate(ctx, state => {
      const item = state.trash.find(t => t.id === trashId); if (!item || Date.parse(item.purgeAt) <= Date.now()) throw new Error('O prazo para restaurar este item terminou.');
      requireWrite(state, ctx, item.snapshot, writeCapability(item.kind, item.snapshot, ctx));
      validateRelations(state, ctx, item.kind, item.snapshot, item.snapshot, true);
      if (item.kind === 'transactions') assertUnpaid(state, item.snapshot as Transaction);
      if ((state[item.kind] as Entity[]).some(e => e.id === item.snapshot.id)) throw new Error('Este item já existe.');
      const restored = touch(item.snapshot, ctx); (state[item.kind] as Entity[]).push(restored);
      state.trash = state.trash.filter(t => t.id !== trashId); record(state, ctx, item.kind, 'restore', restored);
    });
  },
  async purge(ctx: Context, trashId: string) {
    return mutate(ctx, async state => {
      const item = state.trash.find(t => t.id === trashId); if (!item) return;
      requireWrite(state, ctx, item.snapshot, 'transactions.delete');
      await db.attachments.where('transactionId').equals(item.snapshot.id).delete();
      state.trash = state.trash.filter(t => t.id !== trashId); record(state, ctx, item.kind, 'purge', item.snapshot);
    });
  },
  async setInvoicePaid(ctx: Context, id: string, paid: boolean) {
    return mutate(ctx, state => {
      const invoice = state.invoices.find(i => i.id === id); if (!invoice) throw new Error('Fatura não encontrada.');
      requireWrite(state, ctx, invoice, 'catalog.manage');
      for (const tx of state.transactions.filter(t => t.invoiceId === id && t.status !== 'cancelled')) {
        requireWrite(state, ctx, tx, writeCapability('transactions', tx, ctx));
        if (paid && tx.status !== 'confirmed') throw new Error('Confirme ou cancele os lançamentos da fatura antes de marcar como paga.');
      }
      const next = { ...touch(invoice, ctx), paidAt: paid ? new Date().toISOString() : undefined };
      state.invoices[state.invoices.indexOf(invoice)] = next; record(state, ctx, 'invoices', 'status_change', next, invoice);
    });
  },
  async updateMember(ctx: Context, input: Member) {
    return mutate(ctx, state => { const current = state.members.find(m => m.id === input.id); if (!current) throw new Error('Membro não encontrado.'); validateMemberChange(state, ctx, current, input); state.members[state.members.indexOf(current)] = input; record(state, ctx, 'members', 'update', input, current); });
  },
  async addMember(ctx: Context, email: string) {
    const user = await db.users.where('email').equals(email.trim().toLowerCase()).first();
    if (!user) throw new Error('Esta pessoa precisa criar uma conta neste mesmo navegador. Convites por e-mail dependem do Xano.');
    return mutate(ctx, state => {
      if (!hasCapability(state, ctx, 'members.manage')) throw new Error('Sem permissão para gerenciar membros.');
      if (state.members.some(m => m.userId === user.id)) throw new Error('Este usuário já está na família.');
      const member: Member = { id: crypto.randomUUID(), userId: user.id, name: user.name, email: user.email, role: 'member', permissions: [...defaultPermissions], status: 'active' };
      state.members.push(member); record(state, ctx, 'members', 'create', member);
    });
  },
  async updateWorkspace(ctx: Context, name: string, defaultScope: Scope, sharingEnabled: boolean) {
    return mutate(ctx, state => { if (memberOf(state, ctx).role !== 'master_admin') throw new Error('Somente o Master configura o compartilhamento.'); if (!name.trim() || name.length > 100) throw new Error('Informe um nome de até 100 caracteres.'); const before = { ...state.workspace }; state.workspace = { ...before, name: name.trim(), defaultScope, sharingEnabled }; record(state, ctx, 'workspace', 'update', state.workspace, before); });
  },
  async preferences(ctx: Context, preferences: WalletState['preferences']) {
    return mutate(ctx, state => { if (memberOf(state, ctx).role !== 'master_admin') throw new Error('Somente o Master configura as notificações da família.');
      if (![preferences.invoiceDays, preferences.recurrenceDays, preferences.installmentDays, preferences.incomeDays].every(n => Number.isInteger(n) && n >= 0 && n <= 30) || preferences.attachmentMaxMB < 1 || preferences.attachmentMaxMB > 25) throw new Error('Antecedência: 0 a 30 dias. Anexos: 1 a 25 MB.');
      const before = state.preferences; state.preferences = preferences; record(state, ctx, 'preferences', 'update', { ...preferences, id: state.id }, before);
    });
  },
  async markNoticeRead(ctx: Context, id: string) { return mutate(ctx, state => { const notice = state.notices.find(n => n.id === id); if (notice) { requireRead(state, ctx, notice); notice.read = true; } }); },
  async attachments(ctx: Context, transactionId: string) {
    await auth.requireUser(ctx.user.id); const state = await db.wallets.get(ctx.workspaceId); if (!state) throw new Error('Família não encontrada.');
    const tx = state.transactions.find(t => t.id === transactionId); if (!tx) throw new Error('Lançamento não encontrado.'); requireRead(state, ctx, tx);
    if (tx.scope === 'shared' && !hasCapability(state, ctx, 'attachments.read')) throw new Error('Sem permissão para visualizar anexos.');
    return db.attachments.where('transactionId').equals(transactionId).toArray();
  },
  async addAttachment(ctx: Context, transactionId: string, file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type) || file.size === 0) throw new Error('Use JPEG, PNG, WebP ou PDF válido.');
    const bytes = await file.arrayBuffer(), signature = new Uint8Array(bytes).slice(0, 12);
    const magic = String.fromCharCode(...signature);
    const valid = file.type === 'application/pdf' ? magic.startsWith('%PDF-') : file.type === 'image/png' ? signature[0] === 137 && magic.slice(1, 4) === 'PNG' : file.type === 'image/jpeg' ? signature[0] === 255 && signature[1] === 216 : magic.startsWith('RIFF') && magic.slice(8, 12) === 'WEBP';
    if (!valid) throw new Error('O conteúdo do arquivo não corresponde ao formato informado.');
    const checksum = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    return mutate(ctx, async state => {
      const tx = state.transactions.find(t => t.id === transactionId); if (!tx) throw new Error('Lançamento não encontrado.');
      requireWrite(state, ctx, tx, writeCapability('transactions', tx, ctx));
      if (file.size > state.preferences.attachmentMaxMB * 1024 * 1024) throw new Error(`O limite é ${state.preferences.attachmentMaxMB} MB por arquivo.`);
      const attachment: Attachment = { ...base(state.id, tx.ownerUserId, tx.scope), transactionId, fileName: file.name.slice(0, 200), mimeType: file.type, size: file.size, blob: new Blob([bytes], { type: file.type }), checksum };
      await db.attachments.add(attachment); const { blob: _blob, ...metadata } = attachment; record(state, ctx, 'attachments', 'create', metadata); return attachment.id;
    });
  },
  async removeAttachment(ctx: Context, id: string) { return mutate(ctx, async state => { const attachment = await db.attachments.get(id); if (!attachment || attachment.workspaceId !== state.id) throw new Error('Anexo não encontrado.'); requireWrite(state, ctx, attachment, writeCapability('transactions', attachment, ctx)); await db.attachments.delete(id); const { blob: _blob, ...metadata } = attachment; record(state, ctx, 'attachments', 'delete', metadata); }); },
  async refresh(ctx: Context, through = addMonths(today(), 2)) {
    return mutate(ctx, async state => {
      for (const trash of state.trash.filter(t => Date.parse(t.purgeAt) <= Date.now() && canRead(state, ctx, t.snapshot))) {
        await db.attachments.where('transactionId').equals(trash.snapshot.id).delete(); state.trash = state.trash.filter(t => t.id !== trash.id); record(state, ctx, trash.kind, 'purge', trash.snapshot);
      }
      const keys = new Set(state.occurrenceKeys);
      for (const recurrence of state.recurrences.filter(r => r.active && canRead(state, ctx, r))) {
        // Another user's recurring data must not be mutated by a read-only member.
        if (recurrence.scope === 'shared' && !hasCapability(state, ctx, 'catalog.manage') && recurrence.ownerUserId !== ctx.user.id) continue;
        if (recurrence.scope === 'shared' && !hasCapability(state, ctx, 'shared.create')) continue;
        for (const date of recurrenceDates(recurrence, through)) {
          const key = `${recurrence.id}:${date}`; if (keys.has(key)) continue;
          const invoice = recurrence.cardId ? ensureInvoice(state, ctx, recurrence.cardId, date, recurrence.scope) : undefined;
          if (invoice?.paidAt) continue;
          const tx: Transaction = { ...base(state.id, recurrence.ownerUserId, recurrence.scope), name: recurrence.name, amount: recurrence.amount, type: recurrence.type, status: recurrence.autoConfirm && date <= today() ? 'confirmed' : 'forecast', transactionDate: date, competenceDate: invoice?.dueDate ?? date, categoryId: recurrence.categoryId, personId: recurrence.personId, accountId: recurrence.accountId, cardId: recurrence.cardId, notes: recurrence.notes, paymentMode: 'recurring', recurrenceId: recurrence.id, occurrenceKey: key, invoiceId: invoice?.id };
          state.transactions.push(tx); keys.add(key); record(state, ctx, 'transactions', 'create', tx);
        }
        if (recurrence.autoConfirm) for (const tx of state.transactions.filter(t => t.recurrenceId === recurrence.id && t.status === 'forecast' && t.transactionDate <= today())) { const before = { ...tx }; Object.assign(tx, touch(tx, ctx), { status: 'confirmed' }); record(state, ctx, 'transactions', 'status_change', tx, before); }
        const upcoming = nextOccurrence(recurrence, addDays(today(), -1));
        if (recurrence.endDate && upcoming > recurrence.endDate) {
          const before = { ...recurrence };
          Object.assign(recurrence, touch(recurrence, ctx), { active: false, nextOccurrenceDate: recurrence.endDate });
          record(state, ctx, 'recurrences', 'status_change', recurrence, before);
        } else if (recurrence.nextOccurrenceDate !== upcoming) {
          const before = { ...recurrence };
          Object.assign(recurrence, touch(recurrence, ctx), { nextOccurrenceDate: upcoming });
          record(state, ctx, 'recurrences', 'update', recurrence, before);
        }
      }
      state.occurrenceKeys = [...keys];
      generateNotices(state, ctx);
    });
  },
};

function generateNotices(state: WalletState, ctx: Context) {
  if (!state.preferences.notificationsEnabled) return;
  const p = state.preferences, date = today();
  function add(id: string, type: WalletState['notices'][number]['type'], title: string, detail: string, entity: Base) {
    if (!p.noticeTypes.includes(type) || state.notices.some(n => n.id === id) || !canRead(state, ctx, entity)) return;
    state.notices.push({ id, type, title, detail, entityId: entity.id, date, read: false, ownerUserId: entity.ownerUserId, scope: entity.scope });
  }
  for (const invoice of state.invoices.filter(i => !i.paidAt && state.transactions.some(t => t.invoiceId === i.id && t.status !== 'cancelled'))) {
    const card = state.cards.find(c => c.id === invoice.cardId);
    if (invoice.dueDate < date) add(`overdue:${invoice.id}`, 'overdue', 'Fatura vencida', `${card?.name}: vencimento ${invoice.dueDate}`, invoice);
    else if (invoice.dueDate <= addDays(date, p.invoiceDays)) add(`invoice:${invoice.id}`, 'invoice', 'Fatura próxima do vencimento', `${card?.name}: ${invoice.dueDate}`, invoice);
  }
  for (const tx of state.transactions.filter(t => t.status === 'forecast' || t.status === 'pending' || (t.installmentGroupId && !state.invoices.find(i => i.id === t.invoiceId)?.paidAt))) {
    const type = tx.type === 'income' ? 'income' : tx.installmentGroupId ? 'installment' : 'recurrence';
    const days = type === 'income' ? p.incomeDays : type === 'installment' ? p.installmentDays : p.recurrenceDays;
    if (tx.competenceDate >= date && tx.competenceDate <= addDays(date, days)) add(`${type}:${tx.id}`, type, type === 'income' ? 'Recebimento esperado' : type === 'installment' ? 'Parcela chegando' : 'Conta prevista', `${tx.name}: ${tx.competenceDate}`, tx);
  }
  for (const b of state.budgets.filter(b => b.active && canRead(state, ctx, b))) {
    const usage = budgetUsage(b, state.transactions.filter(t => canRead(state, ctx, t)));
    for (const threshold of usage.reached) add(`budget:${b.id}:${b.month}:${threshold}`, 'budget', `Orçamento em ${threshold}%`, `${b.name}: ${usage.percent}% utilizado`, b);
  }
}
