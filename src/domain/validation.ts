import { z } from 'zod';
import { parseDate } from './finance';
const text = z.string().trim().min(1, 'Informe o nome.').max(160);
const optional = z.string().max(2000).optional();
const cents = z.number().int().positive('O valor deve ser maior que zero.').max(999999999999);
const date = z.string().refine(v => { try { parseDate(v); return true; } catch { return false; } }, 'Data inválida.');
const scope = z.enum(['personal', 'shared']);
const common = { name: text, scope };
const financial = { ...common, amount: cents, type: z.enum(['expense', 'income']), categoryId: text, personId: optional, accountId: optional, cardId: optional, notes: optional };
export const schemas = {
  transactions: z.object({ ...financial, status: z.enum(['forecast', 'pending', 'confirmed', 'cancelled']), transactionDate: date, competenceDate: date, paymentMode: z.enum(['single', 'installment', 'recurring']) }),
  accounts: z.object({ ...common, institution: z.string().max(160), type: z.enum(['checking', 'savings', 'digital', 'cash', 'other']), ownerPersonId: optional, active: z.boolean(), notes: optional }),
  cards: z.object({ ...common, bank: text, brand: text, last4Digits: z.string().regex(/^\d{4}$/, 'Informe somente os quatro últimos dígitos.'), totalLimit: cents, closingDay: z.number().int().min(1).max(31), dueDay: z.number().int().min(1).max(31), ownerPersonId: text, accountId: optional, additionalOfCardId: optional, active: z.boolean(), notes: optional }),
  categories: z.object({ ...common, icon: z.string().max(30), type: z.enum(['expense', 'income', 'both']), active: z.boolean() }),
  people: z.object({ ...common, linkedUserId: optional, monthlySpendingLimitEnabled: z.boolean(), monthlySpendingLimit: z.number().int().min(0).max(999999999999), allowedCategoryIds: z.array(z.string()), active: z.boolean() }),
  recurrences: z.object({ ...financial, frequency: z.enum(['weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual', 'custom']), customIntervalValue: z.number().int().min(1).max(365), customIntervalUnit: z.enum(['day', 'week', 'month', 'year']), startDate: date, endDate: date.optional().or(z.literal('')), nextOccurrenceDate: date, autoConfirm: z.boolean(), active: z.boolean() }),
  budgets: z.object({ ...common, month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), categoryId: text, personId: optional, limitAmount: cents, thresholds: z.array(z.number().int().min(1).max(100)).min(1), active: z.boolean() }),
  transfers: z.object({ ...common, fromAccountId: text, toAccountId: text, amount: cents, date, personId: optional, notes: optional }).refine(v => v.fromAccountId !== v.toAccountId, 'As contas de origem e destino devem ser diferentes.'),
};
export function validateEntity(kind: keyof typeof schemas, value: unknown) {
  const result = schemas[kind].safeParse(value);
  if (!result.success) throw new Error(result.error.issues.map(i => i.message).join(' '));
  return result.data;
}
