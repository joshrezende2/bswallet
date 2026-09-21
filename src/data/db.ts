import Dexie, { type Table } from 'dexie';
import type { Attachment, User, WalletState } from '../domain/types';
export interface Credential { userId: string; salt: string; hash: string; iterations: number; }
export interface SessionRecord { id: string; userId: string; expiresAt: number; persistent: boolean; }
export class WalletDatabase extends Dexie {
  users!: Table<User, string>;
  credentials!: Table<Credential, string>;
  sessions!: Table<SessionRecord, string>;
  wallets!: Table<WalletState, string>;
  attachments!: Table<Attachment, string>;
  safetyBackups!: Table<{ id: string; userId: string; createdAt: string; state: WalletState; attachments: Attachment[] }, string>;
  constructor(name = 'bs-wallet-v1') {
    super(name);
    this.version(1).stores({ users: 'id, &email, &username', credentials: 'userId', sessions: 'id, userId', wallets: 'id', attachments: 'id, workspaceId, transactionId', safetyBackups: 'id, userId' });
  }
}
export const db = new WalletDatabase();
