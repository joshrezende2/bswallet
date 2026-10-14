import { capabilities, type Base, type User, type WalletState, type Scope } from '../domain/types';
export const BASE_CATEGORIES = [
  ['Mercado', 'shopping', 'expense'], ['Restaurante', 'utensils', 'expense'], ['Moradia', 'home', 'expense'],
  ['Energia', 'zap', 'expense'], ['Água e gás', 'droplets', 'expense'], ['Internet e telefone', 'wifi', 'expense'],
  ['Transporte', 'bus', 'expense'], ['Combustível', 'fuel', 'expense'], ['Saúde', 'heart', 'expense'],
  ['Farmácia', 'pill', 'expense'], ['Educação', 'graduation', 'expense'], ['Filhos', 'baby', 'expense'],
  ['Cuidados com idosos', 'accessibility', 'expense'], ['Pets', 'paw', 'expense'], ['Assinaturas e streaming', 'tv', 'expense'],
  ['Lazer', 'sparkles', 'expense'], ['Viagens', 'plane', 'expense'], ['Roupas', 'shirt', 'expense'],
  ['Cuidados pessoais', 'scissors', 'expense'], ['Academia e esportes', 'dumbbell', 'expense'], ['Seguros', 'shield', 'expense'],
  ['Impostos e taxas', 'landmark', 'expense'], ['Empréstimos e dívidas', 'hand-coins', 'expense'], ['Manutenção da casa', 'wrench', 'expense'],
  ['Tecnologia', 'laptop', 'expense'], ['Presentes e doações', 'gift', 'expense'], ['Outras despesas', 'circle-ellipsis', 'expense'],
  ['Salário', 'wallet', 'income'], ['Freelance', 'briefcase', 'income'], ['Benefícios', 'badge-dollar', 'income'],
  ['Aposentadoria', 'piggy-bank', 'income'], ['Aluguel recebido', 'key', 'income'], ['Rendimentos e investimentos', 'chart', 'income'],
  ['Vendas', 'store', 'income'], ['Reembolsos', 'receipt', 'income'], ['Presentes recebidos', 'gift', 'income'], ['Outras receitas', 'circle-plus', 'income'],
] as const;
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
  for (const [name, icon, type] of BASE_CATEGORIES) {
    state.categories.push({ ...base(state.id, user.id), name, icon, type, active: true });
  }
  state.people.push({ ...base(state.id, user.id), name: user.name, linkedUserId: user.id, type: user.type, monthlySpendingLimitEnabled: false, monthlySpendingLimit: 0, allowedCategoryIds: state.categories.map(category => category.id), active: true });
  return state;
}
