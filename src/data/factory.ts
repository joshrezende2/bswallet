import { capabilities, type Base, type User, type WalletState, type Scope } from '../domain/types';
export function base(workspaceId: string, userId: string, scope: Scope = 'shared'): Base {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), workspaceId, ownerUserId: userId, scope, createdAt: now, createdBy: userId, updatedAt: now, updatedBy: userId, version: 1, syncStatus: 'local' };
}
export function emptyWallet(user: User): WalletState {
  const id = crypto.randomUUID();
  return { id, workspace: { id, name: `Família de ${user.name.split(' ')[0]}`, masterAdminUserId: user.id, defaultScope: 'shared', sharingEnabled: true },
    members: [{ id: crypto.randomUUID(), userId: user.id, name: user.name, email: user.email, role: 'master_admin', permissions: [...capabilities], status: 'active' }],
    transactions: [], accounts: [], cards: [], categories: [], people: [], recurrences: [], budgets: [], transfers: [], invoices: [], installmentGroups: [], audit: [], trash: [], outbox: [], notices: [], occurrenceKeys: [], demo: false,
    preferences: { notificationsEnabled: true, noticeTypes: ['invoice', 'overdue', 'recurrence', 'installment', 'income', 'budget'], invoiceDays: 3, recurrenceDays: 1, installmentDays: 3, incomeDays: 1, attachmentMaxMB: 10 },
  };
}
export function initialWallet(user: User) {
  const state = emptyWallet(user);
  for (const [name, icon, type] of [['Mercado', 'shopping', 'expense'], ['Restaurante', 'utensils', 'expense'], ['Transporte', 'car', 'expense'], ['Moradia', 'home', 'expense'], ['Saúde', 'heart', 'expense'], ['Lazer', 'sparkles', 'expense'], ['Salário', 'wallet', 'income'], ['Freelance', 'briefcase', 'income']] as const) {
    state.categories.push({ ...base(state.id, user.id), name, icon, type, active: true });
  }
  state.people.push({ ...base(state.id, user.id), name: user.name, linkedUserId: user.id, monthlySpendingLimitEnabled: false, monthlySpendingLimit: 0, allowedCategoryIds: [], active: true });
  return state;
}
