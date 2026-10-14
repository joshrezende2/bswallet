import Dexie, { type Table } from 'dexie';
import type { Attachment, LocalChange, User, WalletState } from '../domain/types';
import { BASE_CATEGORIES, base } from './factory';

export interface Credential { userId: string; salt: string; hash: string; iterations: number; }
export interface SessionRecord { id: string; userId: string; expiresAt: number; persistent: boolean; }
export interface SyncConflict { entityType: string; entityId: string; localVersion: number; remoteVersion: number; }
export interface SyncMeta { id: string; bootstrapQueued: boolean; lastAttemptAt?: string; lastSuccessAt?: string; lastError?: string; localAuditEvents?: LocalChange[]; conflicts?: SyncConflict[]; }

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
    this.version(4).stores({ users: 'id, &email, &username', credentials: 'userId', sessions: 'id, userId', wallets: 'id', attachments: 'id, workspaceId, transactionId', safetyBackups: 'id, userId', syncMeta: 'id, lastSuccessAt' }).upgrade(async transaction => {
      await transaction.table<User>('users').toCollection().modify(user => { user.type ??= 'adult'; });
      await transaction.table<WalletState>('wallets').toCollection().modify(state => {
        const actorId = state.workspace.masterAdminUserId;
        const normalized = new Set(state.categories.map(category => category.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()));
        for (const [name, icon, type] of BASE_CATEGORIES) {
          const key = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
          if (normalized.has(key)) continue;
          const category = { ...base(state.id, actorId), name, icon, type, active: true };
          state.categories.push(category);
          state.outbox.push({ id: crypto.randomUUID(), entityType: 'categories', entityId: category.id, action: 'create', version: category.version, createdAt: category.createdAt, payload: category });
          normalized.add(key);
        }
        const categoryIds = state.categories.filter(category => category.active).map(category => category.id);
        state.people = state.people.map(person => ({ ...person, type: person.type ?? 'adult', allowedCategoryIds: person.allowedCategoryIds?.length ? person.allowedCategoryIds : [...categoryIds] }));
        state.accounts = state.accounts.map(account => ({ ...account, initialBalance: account.initialBalance ?? 0, initialBalanceDate: account.initialBalanceDate || undefined }));
      });
    });
  }
}

export const db = new WalletDatabase();
