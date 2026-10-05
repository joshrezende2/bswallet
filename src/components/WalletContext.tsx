import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../data/db';
import { startAutoSync } from '../data/sync';
import { accessibleState, walletService } from '../data/wallet-service';
import { addMonths, today } from '../domain/finance';
import { hasCapability } from '../domain/permissions';
import type { Context, Scope, User, WalletState } from '../domain/types';
interface Value { ctx: Context; state: WalletState; wallets: { id: string; name: string }[]; selectWorkspace: (id: string) => void; month: string; setMonth: (month: string) => void; scope: Scope; setScope: (scope: Scope) => void; toast: (message: string) => void; run: (action: () => Promise<unknown>, success?: string) => Promise<boolean>; }
const WalletContext = createContext<Value | null>(null);
export const useWallet = () => { const value = useContext(WalletContext); if (!value) throw new Error('Família não carregada.'); return value; };
export function WalletProvider({ user, children, initialWorkspaceId = '', emptyContent }: { user: User; children: ReactNode; initialWorkspaceId?: string; emptyContent?: ReactNode }) {
  useEffect(() => startAutoSync(user), [user]);
  const [workspaceId, selectWorkspace] = useState(initialWorkspaceId), [month, setMonth] = useState(today().slice(0, 7)), [scope, setScope] = useState<Scope>('shared');
  useEffect(() => { if (initialWorkspaceId) selectWorkspace(initialWorkspaceId); }, [initialWorkspaceId]);
  const [message, toast] = useState(''), [error, setError] = useState('');
  const wallets = useLiveQuery(() => db.wallets.toArray().then(ws => ws.filter(w => w.members.some(m => m.userId === user.id && m.status === 'active'))), [user.id]);
  const selected = wallets?.find(w => w.id === workspaceId) ?? wallets?.[0];
  const ctx = useMemo<Context>(() => ({ user, workspaceId: selected?.id ?? '' }), [user, selected?.id]);
  const state = useMemo(() => selected ? accessibleState(selected, ctx) : undefined, [selected, ctx]);
  const run = useCallback(async (action: () => Promise<unknown>, success = 'Salvo no dispositivo.') => { try { await action(); if (success) toast(success); return true; } catch (e) { toast(e instanceof Error ? e.message : 'Não foi possível concluir a ação.'); return false; } }, []);
  useEffect(() => { if (!selected) return; setScope(selected.workspace.defaultScope === 'shared' && selected.workspace.sharingEnabled && hasCapability(selected, ctx, 'shared.read') ? 'shared' : 'personal'); }, [selected?.id]);
  useEffect(() => { if (!ctx.workspaceId) return; let live = true; const refresh = () => walletService.refresh(ctx, addMonths(`${month}-01`, 2)).catch(e => { if (live) setError(e.message); }); void refresh(); const timer = setInterval(refresh, 60000); return () => { live = false; clearInterval(timer); }; }, [ctx, month]);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => toast(''), 5500); return () => clearTimeout(timer); }, [message]);
  useEffect(() => { if (selected && scope === 'shared' && (!selected.workspace.sharingEnabled || !hasCapability(selected, ctx, 'shared.read'))) setScope('personal'); }, [selected, ctx, scope]);
  if (!wallets) return <div className="loading-screen"><span className="loader" />Abrindo sua carteira…</div>;
  if (!state) return <div className="loading-screen"><p>Nenhuma família disponível para sua conta. Entre novamente ou peça ao Master para reativar seu acesso.</p>{emptyContent}</div>;
  return <WalletContext.Provider value={{ ctx, state, wallets: wallets.map(w => ({ id: w.id, name: w.workspace.name })), selectWorkspace, month, setMonth, scope, setScope, toast, run }}>{error && <div className="system-error" role="alert">{error}<button onClick={() => setError('')}>Fechar</button></div>}{children}{message && <div className="toast" role="status">{message}<button onClick={() => toast('')} aria-label="Dispensar aviso">×</button></div>}</WalletContext.Provider>;
}
