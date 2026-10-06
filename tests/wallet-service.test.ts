import { beforeEach, describe, expect, it } from 'vitest';
import { auth } from '../src/data/auth';
import { db } from '../src/data/db';
import { walletService } from '../src/data/wallet-service';
import type { Context, User } from '../src/domain/types';
import { accountBalance } from '../src/domain/finance';

let user: User;
let ctx: Context;

async function clearDatabase() {
  await Promise.all([db.users.clear(), db.credentials.clear(), db.sessions.clear(), db.wallets.clear(), db.attachments.clear(), db.safetyBackups.clear()]);
}

beforeEach(async () => {
  await auth.signOut();
  await clearDatabase();
  user = await auth.signUp({ name: 'Pessoa de Teste', email: `${crypto.randomUUID()}@example.com`, username: `user_${crypto.randomUUID().slice(0, 8)}`, password: 'uma-senha-de-teste-segura' });
  const state = (await db.wallets.toArray()).find(wallet => wallet.workspace.masterAdminUserId === user.id)!;
  ctx = { user, workspaceId: state.id };
});

describe('persistência e fluxos críticos', () => {
  it('persiste uma compra parcelada em faturas sucessivas com soma exata', async () => {
    const state = await db.wallets.get(ctx.workspaceId);
    const personId = state!.people[0].id;
    const categoryId = state!.categories.find(category => category.name === 'Lazer')!.id;
    const card = await walletService.save(ctx, 'cards', { name: 'Cartão', bank: 'Banco', brand: 'Visa', last4Digits: '1234', totalLimit: 500000, closingDay: 10, dueDay: 17, scope: 'shared', ownerPersonId: personId, active: true });
    const installments = await walletService.createTransaction(ctx, { name: 'Notebook', amount: 1000, type: 'expense', status: 'confirmed', transactionDate: '2026-01-11', competenceDate: '2026-01-11', categoryId, cardId: card.id, paymentMode: 'installment', scope: 'shared' }, 3);
    const saved = await db.wallets.get(ctx.workspaceId);
    expect(installments.map(item => item.amount)).toEqual([334, 333, 333]);
    expect(saved!.transactions.reduce((sum, item) => sum + item.amount, 0)).toBe(1000);
    expect(saved!.invoices.map(invoice => invoice.cycleMonth)).toEqual(['2026-02', '2026-03', '2026-04']);
    expect(saved!.invoices.map(invoice => invoice.dueDate)).toEqual(['2026-02-17', '2026-03-17', '2026-04-17']);
  });

  it('cria recorrências apenas uma vez ao sincronizar a base local repetidamente', async () => {
    const state = await db.wallets.get(ctx.workspaceId);
    const categoryId = state!.categories.find(category => category.name === 'Salário')!.id;
    await walletService.save(ctx, 'recurrences', { name: 'Salário', amount: 500000, type: 'income', categoryId, scope: 'shared', frequency: 'monthly', customIntervalValue: 1, customIntervalUnit: 'month', startDate: '2026-01-31', nextOccurrenceDate: '2026-01-31', autoConfirm: false, active: true });
    await walletService.refresh(ctx, '2026-03-31');
    await walletService.refresh(ctx, '2026-03-31');
    const saved = await db.wallets.get(ctx.workspaceId);
    expect(saved!.transactions.filter(item => item.recurrenceId).map(item => item.transactionDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('encerra uma recorrência depois da data final sem criar ocorrências posteriores', async () => {
    const state = await db.wallets.get(ctx.workspaceId);
    const categoryId = state!.categories.find(category => category.name === 'Salário')!.id;
    const recurrence = await walletService.save(ctx, 'recurrences', { name: 'Contrato encerrado', amount: 500000, type: 'income', categoryId, scope: 'shared', frequency: 'monthly', customIntervalValue: 1, customIntervalUnit: 'month', startDate: '2026-01-31', endDate: '2026-03-31', nextOccurrenceDate: '2026-01-31', autoConfirm: false, active: true });
    await walletService.refresh(ctx, '2026-12-31');
    const saved = await db.wallets.get(ctx.workspaceId);
    expect(saved!.transactions.filter(item => item.recurrenceId === recurrence.id).map(item => item.transactionDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(saved!.recurrences.find(item => item.id === recurrence.id)).toMatchObject({ active: false, nextOccurrenceDate: '2026-03-31' });
  });

  it('não permite alterar lançamentos de uma fatura já marcada como paga', async () => {
    const state = await db.wallets.get(ctx.workspaceId);
    const personId = state!.people[0].id;
    const categoryId = state!.categories.find(category => category.name === 'Lazer')!.id;
    const card = await walletService.save(ctx, 'cards', { name: 'Cartão protegido', bank: 'Banco', brand: 'Visa', last4Digits: '1234', totalLimit: 500000, closingDay: 10, dueDay: 17, scope: 'shared', ownerPersonId: personId, active: true });
    const [transaction] = await walletService.createTransaction(ctx, { name: 'Compra confirmada', amount: 10000, type: 'expense', status: 'confirmed', transactionDate: '2026-01-11', competenceDate: '2026-01-11', categoryId, cardId: card.id, paymentMode: 'single', scope: 'shared' });
    const invoice = (await db.wallets.get(ctx.workspaceId))!.invoices[0];
    await walletService.setInvoicePaid(ctx, invoice.id, true);
    await expect(walletService.save(ctx, 'transactions', { ...transaction, name: 'Tentativa de edição' }, transaction.id, transaction.version)).rejects.toThrow('Reabra a fatura');
  });

  it('registra transferências fora dos lançamentos financeiros', async () => {
    const accountA = await walletService.save(ctx, 'accounts', { name: 'Origem', institution: '', type: 'checking', scope: 'shared', active: true });
    const accountB = await walletService.save(ctx, 'accounts', { name: 'Destino', institution: '', type: 'digital', scope: 'shared', active: true });
    await walletService.save(ctx, 'transfers', { name: 'Reserva', amount: 5000, fromAccountId: accountA.id, toAccountId: accountB.id, date: '2026-01-05', scope: 'shared' });
    const saved = await db.wallets.get(ctx.workspaceId);
    expect(saved!.transfers).toHaveLength(1);
    expect(saved!.transactions).toHaveLength(0);
  });

  it('move o lançamento para a lixeira e restaura sem perder a auditoria', async () => {
    const state = await db.wallets.get(ctx.workspaceId);
    const categoryId = state!.categories.find(category => category.name === 'Mercado')!.id;
    const [transaction] = await walletService.createTransaction(ctx, { name: 'Mercado', amount: 1599, type: 'expense', status: 'confirmed', transactionDate: '2026-01-05', competenceDate: '2026-01-05', categoryId, paymentMode: 'single', scope: 'shared' });
    await walletService.remove(ctx, 'transactions', transaction.id);
    const trashed = await db.wallets.get(ctx.workspaceId);
    expect(trashed!.transactions).toHaveLength(0);
    expect(trashed!.trash).toHaveLength(1);
    await walletService.restore(ctx, trashed!.trash[0].id);
    const restored = await db.wallets.get(ctx.workspaceId);
    expect(restored!.transactions).toHaveLength(1);
    expect(restored!.audit.map(entry => entry.action)).toContain('restore');
  });

  it('impede categorias duplicadas sem diferenciar acentos ou maiúsculas', async () => {
    await walletService.save(ctx, 'categories', { name: 'Educação', icon: 'file', type: 'expense', scope: 'personal', active: true });
    await expect(walletService.save(ctx, 'categories', { name: ' educacao ', icon: 'file', type: 'expense', scope: 'shared', active: true })).rejects.toThrow('Já existe uma categoria');
    const saved = await db.wallets.get(ctx.workspaceId);
    expect(saved!.categories.find(category => category.name === 'Educação')?.scope).toBe('shared');
  });

  it('exclui uma pessoa sem vínculos e bloqueia quando existe outra configuração associada', async () => {
    const state = await db.wallets.get(ctx.workspaceId);
    const categoryId = state!.categories[0].id;
    const free = await walletService.save(ctx, 'people', { name: 'Sem vínculos', scope: 'shared', monthlySpendingLimitEnabled: false, monthlySpendingLimit: 0, allowedCategoryIds: [categoryId], active: true });
    await walletService.remove(ctx, 'people', free.id);
    expect((await db.wallets.get(ctx.workspaceId))!.people.some(person => person.id === free.id)).toBe(false);

    const linked = await walletService.save(ctx, 'people', { name: 'Com conta', scope: 'shared', monthlySpendingLimitEnabled: false, monthlySpendingLimit: 0, allowedCategoryIds: [], active: true });
    await walletService.save(ctx, 'accounts', { name: 'Conta da pessoa', institution: '', type: 'checking', scope: 'shared', ownerPersonId: linked.id, active: true });
    await expect(walletService.remove(ctx, 'people', linked.id)).rejects.toThrow('contas');
  });

  it('exige conta no cartão de débito e desconta compras confirmadas do saldo sem criar fatura', async () => {
    const state = await db.wallets.get(ctx.workspaceId);
    const personId = state!.people[0].id;
    const categoryId = state!.categories.find(category => category.name === 'Mercado')!.id;
    const account = await walletService.save(ctx, 'accounts', { name: 'Conta corrente', institution: 'Banco', type: 'checking', scope: 'shared', active: true });
    await expect(walletService.save(ctx, 'cards', { name: 'Débito inválido', bank: 'Banco', brand: 'Visa', last4Digits: '1111', cardType: 'debit', totalLimit: 0, closingDay: 0, dueDay: 0, scope: 'shared', ownerPersonId: personId, active: true })).rejects.toThrow('Associe');
    const card = await walletService.save(ctx, 'cards', { name: 'Débito', bank: 'Banco', brand: 'Visa', last4Digits: '2222', cardType: 'debit', totalLimit: 0, closingDay: 0, dueDay: 0, scope: 'shared', ownerPersonId: personId, accountId: account.id, active: true });
    await walletService.createTransaction(ctx, { name: 'Entrada', amount: 10000, type: 'income', status: 'confirmed', transactionDate: '2026-01-05', competenceDate: '2026-01-05', categoryId: state!.categories.find(category => category.name === 'Salário')!.id, accountId: account.id, paymentMode: 'single', scope: 'shared' });
    const [purchase] = await walletService.createTransaction(ctx, { name: 'Mercado no débito', amount: 2500, type: 'expense', status: 'confirmed', transactionDate: '2026-01-06', competenceDate: '2026-01-06', categoryId, cardId: card.id, paymentMode: 'single', scope: 'shared' });
    const saved = await db.wallets.get(ctx.workspaceId);
    expect(purchase).toMatchObject({ accountId: account.id, invoiceId: undefined });
    expect(saved!.invoices).toHaveLength(0);
    expect(accountBalance(account.id, saved!.transactions, saved!.transfers, saved!.cards)).toBe(7500);
  });
});
