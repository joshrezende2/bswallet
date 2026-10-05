import { auth, LocalAuthProvider } from './auth';
import { db } from './db';
import { base } from './factory';
import { walletService } from './wallet-service';
import { addMonths, today } from '../domain/finance';
import type { Context } from '../domain/types';
export async function openDemo() {
  if (!import.meta.env.DEV) throw new Error('Demonstração disponível somente em desenvolvimento.');
  const unique = crypto.randomUUID().replace(/-/g, '');
  await auth.signOut();
  const user = await new LocalAuthProvider().signUp({ name: 'Família Demo', email: `demo-${unique}@example.invalid`, username: `demo_${unique.slice(0, 20)}`, password: crypto.randomUUID() + crypto.randomUUID() });
  const state = (await db.wallets.toArray()).find(w => w.workspace.masterAdminUserId === user.id)!;
  state.demo = true; state.workspace.name = 'Família Demo';
  await db.wallets.put(state); const ctx = { user, workspaceId: state.id }; await seed(ctx); return user;
}
export async function seed(ctx: Context) {
  const state = (await db.wallets.get(ctx.workspaceId))!;
  const month = today().slice(0, 7), scope = 'shared' as const;
  const cat = (name: string) => state.categories.find(c => c.name === name)!.id;
  const personId = state.people[0].id;
  const account = await walletService.save(ctx, 'accounts', { name: 'Conta Corrente', institution: 'Banco principal', type: 'checking', scope, active: true, ownerPersonId: personId });
  const digital = await walletService.save(ctx, 'accounts', { name: 'Conta Digital', institution: 'Banco digital', type: 'digital', scope, active: true });
  await walletService.save(ctx, 'accounts', { name: 'Dinheiro', institution: '', type: 'cash', scope, active: true });
  const card = await walletService.save(ctx, 'cards', { name: 'Cartão Principal', bank: 'Banco principal', brand: 'Mastercard', last4Digits: '4821', totalLimit: 500000, closingDay: 10, dueDay: 17, scope, ownerPersonId: personId, active: true });
  await walletService.save(ctx, 'cards', { name: 'Cartão Secundário', bank: 'Banco digital', brand: 'Visa', last4Digits: '9052', totalLimit: 300000, closingDay: 25, dueDay: 2, scope, ownerPersonId: personId, active: true });
  const expenses = [
    ['Mercado da semana', 28640, 'Mercado', 16], ['Aluguel', 160000, 'Moradia', 5], ['Conta de energia', 21490, 'Moradia', 8],
    ['Abastecimento', 32000, 'Transporte', 10], ['Compras do mês', 74990, 'Mercado', 2], ['Farmácia', 14570, 'Saúde', 12],
    ['Cinema em família', 16000, 'Lazer', 14], ['Almoço de domingo', 23400, 'Restaurante', 13], ['Hortifruti', 13900, 'Mercado', 9],
    ['Transporte por app', 7000, 'Transporte', 15], ['Livraria', 20000, 'Lazer', 11],
  ] as const;
  for (const [name, amount, category, day] of expenses) await walletService.createTransaction(ctx, { name, amount, categoryId: cat(category), transactionDate: `${month}-${String(day).padStart(2, '0')}`, competenceDate: `${month}-${String(day).padStart(2, '0')}`, type: 'expense', status: 'confirmed', paymentMode: 'single', scope, accountId: account.id, personId });
  await walletService.createTransaction(ctx, { name: 'Salário', amount: 700000, categoryId: cat('Salário'), transactionDate: `${month}-05`, competenceDate: `${month}-05`, type: 'income', status: 'confirmed', paymentMode: 'single', scope, accountId: account.id, personId });
  await walletService.createTransaction(ctx, { name: 'Projeto freelance', amount: 150000, categoryId: cat('Freelance'), transactionDate: `${month}-12`, competenceDate: `${month}-12`, type: 'income', status: 'confirmed', paymentMode: 'single', scope, accountId: digital.id, personId });
  await walletService.createTransaction(ctx, { name: 'Notebook • 12 parcelas', amount: 120000, categoryId: cat('Lazer'), transactionDate: `${month}-15`, competenceDate: `${month}-15`, type: 'expense', status: 'confirmed', paymentMode: 'installment', scope, cardId: card.id, personId }, 12);
  await walletService.save(ctx, 'transfers', { name: 'Reserva na conta digital', amount: 50000, fromAccountId: account.id, toAccountId: digital.id, date: `${month}-10`, scope });
  for (const [name, categoryId, amount, limit] of [['Mercado', cat('Mercado'), 0, 150000], ['Transporte', cat('Transporte'), 0, 60000], ['Lazer', cat('Lazer'), 0, 60000]] as const) await walletService.save(ctx, 'budgets', { name, categoryId, limitAmount: limit + amount, month, thresholds: [80, 90, 100], scope, active: true });
  const next = addMonths(`${month}-05`, 1);
  await walletService.save(ctx, 'recurrences', { name: 'Salário mensal', amount: 700000, categoryId: cat('Salário'), type: 'income', scope, accountId: account.id, personId, frequency: 'monthly', customIntervalValue: 1, customIntervalUnit: 'month', startDate: next, nextOccurrenceDate: next, autoConfirm: false, active: true });
  await walletService.save(ctx, 'recurrences', { name: 'Conta de energia', amount: 21490, categoryId: cat('Moradia'), type: 'expense', scope, accountId: account.id, frequency: 'monthly', customIntervalValue: 1, customIntervalUnit: 'month', startDate: `${month}-22`, nextOccurrenceDate: `${month}-22`, autoConfirm: false, active: true });
  const [trash] = await walletService.createTransaction(ctx, { name: 'Lançamento de exemplo excluído', amount: 7990, categoryId: cat('Lazer'), transactionDate: `${month}-01`, competenceDate: `${month}-01`, type: 'expense', status: 'pending', paymentMode: 'single', scope });
  await walletService.remove(ctx, 'transactions', trash.id);
  await walletService.refresh(ctx);
}
export async function removeDemo(ctx: Context) {
  const state = await db.wallets.get(ctx.workspaceId); if (!state?.demo || state.workspace.masterAdminUserId !== ctx.user.id) throw new Error('Somente a demonstração pode ser apagada por este atalho.');
  await db.transaction('rw', [db.wallets, db.attachments, db.users, db.credentials], async () => { await db.attachments.where('workspaceId').equals(state.id).delete(); await db.wallets.delete(state.id); await db.users.delete(ctx.user.id); await db.credentials.delete(ctx.user.id); });
  await auth.signOut();
}
