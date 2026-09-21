import type { LocalChange } from '../domain/types';
export interface SyncResult { acknowledgedIds: string[]; conflicts: { entityId: string; localVersion: number; remoteVersion: number }[]; }
export interface RemoteChanges { cursor: string; changes: LocalChange[]; }
export interface SyncAdapter { push(changes: LocalChange[]): Promise<SyncResult>; pull(cursor?: string): Promise<RemoteChanges>; }
/** Backend intentionally disabled. Configure only against the verified Xano API spec. */
export const syncAdapter: SyncAdapter | null = null;
export const syncStatus = { mode: 'local' as const, label: 'Salvo neste dispositivo', remoteEnabled: false };
