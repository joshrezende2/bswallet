import Dexie, { type Table } from 'dexie';
import type { Attachment, LocalChange, User, WalletState } from '../domain/types';

export interface Credential { userId: string; salt: string; hash: string; iterations: number; }
export interface SessionRecord { id: string; userId: string; expiresAt: number; persistent: boolean; }
export interface SyncMeta { id: string; bootstrapQueued: boolean; lastAttemptAt?: string; lastSuccessAt?: string; lastError?: string; localAuditEvents?: LocalChange[]; }

export class WalletDatabase extends Dexie {
  users!: Table<User, string>;
  credentials!: Table<Credential, string>;
  sessions!: Table<SessionRecord, string>;
  wallets!: Table<WalletState, string>;
  attachments!: Table<Attachment, string>;
  safetyBackups!: Table<{ id: string; userId: string; createdAt: string; state: WalletState; attachments: Attachment[] }, string>;
  syncMeta!: Table<SyncMeta, string>;

  constructor(name = 'bs-wallet-v1') {
    super(name);
    this.version(1).stores({ users: 'id, &email, &username', credentials: 'userId', sessions: 'id, userId', wallets: 'id', attachments: 'id, workspaceId, transactionId', safetyBackups: 'id, userId' });
    this.version(2).stores({ users: 'id, &email, &username', credentials: 'userId', sessions: 'id, userId', wallets: 'id', attachments: 'id, workspaceId, transactionId', safetyBackups: 'id, userId', syncMeta: 'id, lastSuccessAt' });
    this.version(3).stores({ users: 'id, &email, &username', credentials: 'userId', sessions: 'id, userId', wallets: 'id', attachments: 'id, workspaceId, transactionId', safetyBackups: 'id, userId', syncMeta: 'id, lastSuccessAt' }).upgrade(transaction => transaction.table<WalletState>('wallets').toCollection().modify(state => {
      state.categories = state.categories.map(category => ({ ...category, scope: 'shared' }));
      state.cards = state.cards.map(card => ({ ...card, cardType: card.cardType ?? 'credit' }));
    }));
  }
}

export const db = new WalletDatabase();
