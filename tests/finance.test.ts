import { describe, expect, it } from 'vitest';
import { addMonths, budgetUsage, categoryKey, invoiceCycle, monthlyTotals, occurrenceDate, parseMoney, recurrenceDates, splitInstallments } from '../src/domain/finance';
import type { Budget, Transaction } from '../src/domain/types';

function transaction(overrides: Partial<Transaction>): Transaction {
  return { id: crypto.randomUUID(), workspaceId: 'workspace', ownerUserId: 'user', scope: 'shared', createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'user', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'user', version: 1, syncStatus: 'local', name: 'Teste', amount: 100, type: 'expense', status: 'confirmed', transactionDate: '2026-01-10', competenceDate: '2026-01-10', categoryId: 'market', paymentMode: 'single', ...overrides };
}

describe('regras financeiras', () => {
  it('gera a mesma chave para nomes de categoria equivalentes', () => {
    expect(categoryKey('  Educação Infantil ')).toBe('educacao_infantil');
    expect(categoryKey('EDUCAÇÃO   INFANTIL')).toBe('educacao_infantil');
  });

  it('converte BRL para centavos sem arredondamento de ponto flutuante', () => {
    expect(parseMoney('R$ 1.234,56')).toBe(123456);
    expect(parseMoney('0,01')).toBe(1);
    expect(() => parseMoney('12.34')).toThrow();
    expect(() => parseMoney('-1,00')).toThrow();
  });

  it('divide parcelas preservando exatamente o valor total', () => {
    const installments = splitInstallments(1000, 3);
    expect(installments).toEqual([334, 333, 333]);
    expect(installments.reduce((sum, amount) => sum + amount, 0)).toBe(1000);
    expect(() => splitInstallments(1, 2)).toThrow();
  });

  it('atribui a compra ao ciclo correto, incluindo a compra no fechamento', () => {
    expect(invoiceCycle('2026-01-10', 10, 17)).toMatchObject({ cycleMonth: '2026-01', closingDate: '2026-01-10', dueDate: '2026-01-17' });
    expect(invoiceCycle('2026-01-11', 10, 17)).toMatchObject({ cycleMonth: '2026-02', closingDate: '2026-02-10', dueDate: '2026-02-17' });
    expect(invoiceCycle('2026-02-28', 31, 31)).toMatchObject({ cycleMonth: '2026-02', closingDate: '2026-02-28', dueDate: '2026-03-31' });
  });

  it('ancora recorrências no dia original em meses curtos e não cria datas além do fim', () => {
    const recurrence = { frequency: 'monthly' as const, startDate: '2026-01-31', customIntervalValue: 1, customIntervalUnit: 'month' as const, endDate: '2026-03-31' };
    expect(occurrenceDate(recurrence, 1)).toBe('2026-02-28');
    expect(occurrenceDate(recurrence, 2)).toBe('2026-03-31');
    expect(recurrenceDates(recurrence as never, '2026-12-31')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('separa confirmado de previsão e não consome orçamento com previsão, cancelado ou outro escopo', () => {
    const transactions = [transaction({ type: 'income', amount: 50000 }), transaction({ amount: 12000 }), transaction({ amount: 20000, status: 'forecast' }), transaction({ amount: 5000, status: 'cancelled' }), transaction({ amount: 5000, scope: 'personal' })];
    expect(monthlyTotals(transactions, '2026-01')).toMatchObject({ income: 50000, expense: 17000, balance: 33000, forecastExpense: 20000 });
    const budget: Budget = { ...transaction({}) as unknown as Budget, name: 'Mercado', month: '2026-01', categoryId: 'market', limitAmount: 20000, thresholds: [80, 90, 100], active: true };
    expect(budgetUsage(budget, transactions)).toEqual({ used: 12000, percent: 60, reached: [] });
  });
});
