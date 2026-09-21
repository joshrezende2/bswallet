export type Scope = 'personal' | 'shared';
export type Role = 'master_admin' | 'admin' | 'member';
export const capabilities = ['shared.read', 'shared.create', 'transactions.editOwn', 'transactions.editOthers', 'transactions.delete', 'attachments.read', 'catalog.manage', 'budgets.manage', 'reports.read', 'members.manage'] as const;
export type Capability = typeof capabilities[number];
export type Status = 'forecast' | 'pending' | 'confirmed' | 'cancelled';
export type Frequency = 'weekly' | 'biweekly' | 'monthly' | 'bimonthly' | 'quarterly' | 'semiannual' | 'annual' | 'custom';
export type Kind = 'transactions' | 'accounts' | 'cards' | 'categories' | 'people' | 'recurrences' | 'budgets' | 'transfers' | 'invoices' | 'installmentGroups';
export interface Base {
  id: string; workspaceId: string; ownerUserId: string; scope: Scope;
  createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
  version: number; syncStatus: 'local' | 'pending' | 'synced' | 'conflict';
}
export interface User { id: string; name: string; email: string; username: string; createdAt: string; }
export interface Member { id: string; userId: string; name: string; email: string; role: Role; permissions: Capability[]; status: 'active' | 'disabled'; }
export interface Workspace { id: string; name: string; masterAdminUserId: string; defaultScope: Scope; sharingEnabled: boolean; }
export interface Transaction extends Base {
  name: string; amount: number; type: 'expense' | 'income'; status: Status;
  transactionDate: string; competenceDate: string; categoryId: string;
  personId?: string; accountId?: string; cardId?: string; notes?: string;
  paymentMode: 'single' | 'installment' | 'recurring'; invoiceId?: string;
  installmentGroupId?: string; installmentNumber?: number; installmentTotal?: number;
  recurrenceId?: string; occurrenceKey?: string;
}
export interface Account extends Base { name: string; institution: string; type: 'checking' | 'savings' | 'digital' | 'cash' | 'other'; ownerPersonId?: string; active: boolean; notes?: string; }
export interface Card extends Base { name: string; bank: string; brand: string; last4Digits: string; totalLimit: number; closingDay: number; dueDay: number; ownerPersonId: string; accountId?: string; additionalOfCardId?: string; active: boolean; notes?: string; }
export interface Category extends Base { name: string; icon: string; type: 'expense' | 'income' | 'both'; active: boolean; }
export interface Person extends Base { name: string; linkedUserId?: string; monthlySpendingLimitEnabled: boolean; monthlySpendingLimit: number; allowedCategoryIds: string[]; active: boolean; }
export interface Recurrence extends Base {
  name: string; amount: number; type: 'expense' | 'income'; categoryId: string;
  personId?: string; accountId?: string; cardId?: string; notes?: string;
  frequency: Frequency; customIntervalValue: number; customIntervalUnit: 'day' | 'week' | 'month' | 'year';
  startDate: string; endDate?: string; nextOccurrenceDate: string; autoConfirm: boolean; active: boolean;
}
export interface Budget extends Base { name: string; month: string; categoryId: string; personId?: string; limitAmount: number; thresholds: number[]; active: boolean; }
export interface Transfer extends Base { name: string; fromAccountId: string; toAccountId: string; amount: number; date: string; personId?: string; notes?: string; }
export interface Invoice extends Base { cardId: string; cycleMonth: string; closingDate: string; dueDate: string; paidAt?: string; }
export interface InstallmentGroup extends Base { originalAmount: number; numberOfInstallments: number; cardId: string; purchaseDate: string; firstInvoiceId: string; }
export type Entity = Transaction | Account | Card | Category | Person | Recurrence | Budget | Transfer | Invoice | InstallmentGroup;
export interface AuditLog { id: string; workspaceId: string; entityType: string; entityId: string; action: string; actorUserId: string; actorName: string; timestamp: string; scope: Scope; ownerUserId: string; beforeData?: unknown; afterData?: unknown; }
export interface TrashItem { id: string; kind: Kind; snapshot: Entity; deletedAt: string; deletedBy: string; purgeAt: string; }
export interface Attachment extends Base { transactionId: string; fileName: string; mimeType: string; size: number; blob: Blob; checksum: string; }
export interface LocalChange { id: string; entityType: string; entityId: string; action: string; version: number; createdAt: string; payload: unknown; }
export type NoticeType = 'invoice' | 'overdue' | 'recurrence' | 'installment' | 'income' | 'budget';
export interface Notice { id: string; type: NoticeType; title: string; detail: string; entityId: string; date: string; read: boolean; ownerUserId: string; scope: Scope; }
export interface Preferences { notificationsEnabled: boolean; noticeTypes: NoticeType[]; invoiceDays: number; recurrenceDays: number; installmentDays: number; incomeDays: number; attachmentMaxMB: number; }
export interface WalletState {
  id: string; workspace: Workspace; members: Member[];
  transactions: Transaction[]; accounts: Account[]; cards: Card[]; categories: Category[]; people: Person[];
  recurrences: Recurrence[]; budgets: Budget[]; transfers: Transfer[]; invoices: Invoice[]; installmentGroups: InstallmentGroup[];
  audit: AuditLog[]; trash: TrashItem[]; outbox: LocalChange[]; notices: Notice[]; occurrenceKeys: string[];
  preferences: Preferences; demo: boolean;
}
export interface Context { user: User; workspaceId: string; }
export const entityKinds: Kind[] = ['transactions', 'accounts', 'cards', 'categories', 'people', 'recurrences', 'budgets', 'transfers', 'invoices', 'installmentGroups'];
export type EntityMap = { transactions: Transaction; accounts: Account; cards: Card; categories: Category; people: Person; recurrences: Recurrence; budgets: Budget; transfers: Transfer; invoices: Invoice; installmentGroups: InstallmentGroup };
