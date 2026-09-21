import type { Budget, Card, Frequency, Invoice, Recurrence, Transaction } from './types';

export const money = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
export function parseMoney(input: string): number {
  const text = input.trim().replace(/^R\$\s*/, '').replace(/\s/g, '');
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(text)) throw new Error('Use um valor como 1.234,56.');
  const [whole, decimals = ''] = text.replace(/\./g, '').split(',');
  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > 999999999999) throw new Error('Valor fora do limite permitido.');
  return cents;
}
export const moneyInput = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
export const today = () => localDate(new Date());
export function localDate(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
export function parseDate(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Data inválida.');
  const [y, m, d] = date.split('-').map(Number);
  const value = new Date(y, m - 1, d, 12);
  if (y < 1900 || y > 2200 || localDate(value) !== date) throw new Error('Data inválida.');
  return value;
}
export const dateBR = (date: string) => parseDate(date.slice(0, 10)).toLocaleDateString('pt-BR');
export const monthLabel = (month: string) => new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(parseDate(`${month}-01`));
export function clampedDate(year: number, monthIndex: number, day: number): string {
  const base = new Date(year, monthIndex, 1, 12);
  const max = new Date(base.getFullYear(), base.getMonth() + 1, 0, 12).getDate();
  return localDate(new Date(base.getFullYear(), base.getMonth(), Math.min(day, max), 12));
}
export function addMonths(date: string, months: number, anchorDay?: number): string {
  const d = parseDate(date); return clampedDate(d.getFullYear(), d.getMonth() + months, anchorDay ?? d.getDate());
}
export function addDays(date: string, days: number): string { const d = parseDate(date); d.setDate(d.getDate() + days); return localDate(d); }
export function splitInstallments(total: number, count: number): number[] {
  if (!Number.isSafeInteger(total) || total <= 0 || !Number.isInteger(count) || count < 2 || count > 360 || total < count) throw new Error('Informe de 2 a 360 parcelas com pelo menos R$ 0,01 cada.');
  const base = Math.floor(total / count), remainder = total % count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}
export function invoiceCycle(purchaseDate: string, closingDay: number, dueDay: number, overrideMonth?: string) {
  if (![closingDay, dueDay].every(d => Number.isInteger(d) && d >= 1 && d <= 31)) throw new Error('Fechamento e vencimento devem ser de 1 a 31.');
  const date = parseDate(overrideMonth ? `${overrideMonth}-01` : purchaseDate);
  let closingDate = clampedDate(date.getFullYear(), date.getMonth(), closingDay);
  if (!overrideMonth && purchaseDate > closingDate) closingDate = clampedDate(date.getFullYear(), date.getMonth() + 1, closingDay);
  const close = parseDate(closingDate);
  let dueDate = clampedDate(close.getFullYear(), close.getMonth(), dueDay);
  if (dueDate <= closingDate) dueDate = clampedDate(close.getFullYear(), close.getMonth() + 1, dueDay);
  return { cycleMonth: closingDate.slice(0, 7), closingDate, dueDate };
}
export const financialDate = (t: Transaction) => t.competenceDate || t.transactionDate;
export function monthlyTotals(transactions: Transaction[], month: string) {
  let income = 0, expense = 0, forecastIncome = 0, forecastExpense = 0;
  for (const t of transactions) {
    if (!financialDate(t).startsWith(month) || t.status === 'cancelled') continue;
    if (t.status === 'confirmed') { if (t.type === 'income') income += t.amount; else expense += t.amount; }
    else { if (t.type === 'income') forecastIncome += t.amount; else forecastExpense += t.amount; }
  }
  return { income, expense, balance: income - expense, forecastIncome, forecastExpense };
}
export function budgetUsage(budget: Budget, transactions: Transaction[]) {
  const used = transactions.filter(t => t.scope === budget.scope && t.status === 'confirmed' && t.type === 'expense' && financialDate(t).startsWith(budget.month) && t.categoryId === budget.categoryId && (!budget.personId || t.personId === budget.personId)).reduce((sum, t) => sum + t.amount, 0);
  const percent = budget.limitAmount > 0 ? Math.floor(used * 100 / budget.limitAmount) : 0;
  return { used, percent, reached: budget.thresholds.filter(threshold => percent >= threshold) };
}
export function cardUsage(card: Card, transactions: Transaction[], invoices: Invoice[]) {
  const paid = new Set(invoices.filter(i => i.paidAt).map(i => i.id));
  const used = transactions.filter(t => t.cardId === card.id && t.status !== 'cancelled' && t.type === 'expense' && (!t.invoiceId || !paid.has(t.invoiceId))).reduce((sum, t) => sum + t.amount, 0);
  return { used, available: card.totalLimit - used, percent: card.totalLimit > 0 ? used * 100 / card.totalLimit : 0 };
}
const monthIntervals: Partial<Record<Frequency, number>> = { monthly: 1, bimonthly: 2, quarterly: 3, semiannual: 6, annual: 12 };
export function occurrenceDate(recurrence: Pick<Recurrence, 'frequency' | 'startDate' | 'customIntervalValue' | 'customIntervalUnit'>, index: number): string {
  const { frequency, startDate } = recurrence;
  if (frequency === 'weekly' || frequency === 'biweekly') return addDays(startDate, index * (frequency === 'weekly' ? 7 : 14));
  if (frequency !== 'custom') return addMonths(startDate, index * monthIntervals[frequency]!);
  const interval = recurrence.customIntervalValue;
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) throw new Error('O intervalo deve ser de 1 a 365.');
  const unit = recurrence.customIntervalUnit;
  return unit === 'month' || unit === 'year' ? addMonths(startDate, index * interval * (unit === 'year' ? 12 : 1)) : addDays(startDate, index * interval * (unit === 'week' ? 7 : 1));
}
export function recurrenceDates(recurrence: Recurrence, through: string): string[] {
  const result: string[] = [];
  for (let index = 0; index < 50000; index++) {
    const date = occurrenceDate(recurrence, index);
    if (date > through || (recurrence.endDate && date > recurrence.endDate)) return result;
    result.push(date);
  }
  throw new Error('Período da recorrência muito extenso.');
}
export function nextOccurrence(recurrence: Recurrence, after: string): string {
  for (let index = 0; index < 50000; index++) { const date = occurrenceDate(recurrence, index); if (date > after) return date; }
  throw new Error('Não foi possível calcular a próxima ocorrência.');
}
export const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
export function invoiceStatus(invoice: Invoice, now = today()): string { return invoice.paidAt ? 'Paga' : now > invoice.dueDate ? 'Vencida' : now > invoice.closingDate ? 'Fechada' : 'Aberta'; }
