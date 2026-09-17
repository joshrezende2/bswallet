export type Scope = "personal" | "shared";
export type TxType = "expense" | "income";
export type TxStatus = "forecast" | "pending" | "confirmed" | "cancelled";
export type PaymentMode = "single" | "installment" | "recurring";

export interface Base {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface Person extends Base {
  name: string;
  scope: Scope;
  monthlySpendingLimit?: number;
  active: boolean;
}

export interface Account extends Base {
  name: string;
  institution?: string;
  type: "checking" | "savings" | "digital" | "cash" | "other";
  scope: Scope;
  active: boolean;
}

export interface Card extends Base {
  name: string;
  bank: string;
  brand: string;
  last4Digits: string;
  ownerPersonId?: string;
  accountId?: string;
  totalLimit: number;
  closingDay: number;
  dueDay: number;
  scope: Scope;
  active: boolean;
  notes?: string;
}

export interface Category extends Base {
  name: string;
  icon: string;
  type: "expense" | "income" | "both";
  scope: Scope;
  active: boolean;
}

export interface Transaction extends Base {
  scope: Scope;
  type: TxType;
  status: TxStatus;
  name: string;
  amount: number; // centavos
  transactionDate: string; // YYYY-MM-DD
  competenceDate?: string;
  categoryId: string;
  personId?: string;
  accountId?: string;
  cardId?: string;
  paymentMode: PaymentMode;
  notes?: string;
  installmentGroupId?: string;
  installmentNumber?: number;
  installmentTotal?: number;
  recurrenceId?: string;
  invoiceId?: string; // `${cardId}:${YYYY-MM}`
}

export type Frequency =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "bimonthly"
  | "quarterly"
  | "semiannual"
  | "annual";

export interface Recurrence extends Base {
  type: TxType;
  name: string;
  amount: number;
  categoryId: string;
  personId?: string;
  accountId?: string;
  cardId?: string;
  frequency: Frequency;
  startDate: string;
  endDate?: string;
  nextOccurrenceDate: string;
  autoConfirm: boolean;
  scope: Scope;
  active: boolean;
}

export interface Budget extends Base {
  month: number;
  year: number;
  categoryId: string;
  personId?: string;
  limitAmount: number;
  thresholds: number[];
  scope: Scope;
  active: boolean;
}

export interface Transfer extends Base {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date: string;
  personId?: string;
  notes?: string;
  scope: Scope;
}

export interface AuditLog {
  id: string;
  entityType: string;
  entityId: string;
  action: "create" | "update" | "delete" | "restore" | "status_change";
  timestamp: string;
  summary: string;
}

export interface TrashItem {
  id: string;
  entityType: string;
  originalEntityId: string;
  snapshot: unknown;
  label: string;
  deletedAt: string;
  purgeAt: string;
}
