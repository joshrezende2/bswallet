import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../data/db';
import { isSyncing, resolveSyncConflicts, subscribeSync, syncWallet } from '../data/sync';
import { xanoConfig, xanoReady } from '../data/xano/config';
import { useWallet } from './WalletContext';
import { useXanoSession } from './useXanoSession';

export function SyncStatus({ detailed = false, onLoginRequired }: { detailed?: boolean; onLoginRequired: () => void }) {
  const { ctx, state } = useWallet();
  const { connected, error: sessionError } = useXanoSession(ctx.user.id);
  const [online, setOnline] = useState(navigator.onLine);
  const [resolutionError, setResolutionError] = useState('');
  const [resolving, setResolving] = useState(false);
  const busy = useSyncExternalStore(subscribeSync, () => isSyncing(ctx.workspaceId));
  const info = useLiveQuery(async () => {
    const [wallet, meta] = await Promise.all([db.wallets.get(ctx.workspaceId), db.syncMeta.get(ctx.workspaceId)]);
    return { pending: wallet?.outbox.length ?? 0, meta };
  }, [ctx.workspaceId]);
  useEffect(() => {
    const changed = () => setOnline(navigator.onLine);
    window.addEventListener('online', changed);
    window.addEventListener('offline', changed);
    return () => { window.removeEventListener('online', changed); window.removeEventListener('offline', changed); };
  }, []);
  let label = 'Sincronização pendente', detail = 'Alterações salvas neste dispositivo';
  const hasConflict = info?.meta?.lastError === 'Existem conflitos aguardando resolução.';
  if (!xanoConfig.enabled) { label = 'Salvo neste dispositivo'; detail = 'Sincronização em nuvem desativada'; }
  else if (!online) { label = 'Modo offline'; detail = 'Alterações serão sincronizadas quando houver conexão'; }
  else if (state.demo) { label = 'Demonstração local'; detail = 'Dados fictícios salvos somente neste dispositivo'; }
  else if (!connected) { label = 'Sessão expirada'; detail = sessionError || 'Sua sessão expirou. Entre novamente para continuar sincronizando.'; }
  else if (busy) { label = 'Sincronizando...'; }
  else if (hasConflict) { label = 'Conflito de sincronização'; detail = 'Este dispositivo e a nuvem alteraram o mesmo item. Escolha qual versão deve prevalecer.'; }
  else if (info?.meta?.lastError) { label = 'Não foi possível sincronizar'; detail = 'Seus dados continuam salvos neste dispositivo'; }
  else if (info && !info.pending && info.meta?.lastSuccessAt) { label = 'Sincronizado'; detail = 'Dados atualizados na nuvem'; }
  const resolve = async (strategy: 'local' | 'remote') => {
    if (strategy === 'remote' && !window.confirm('Usar a versão da nuvem substituirá a alteração pendente deste dispositivo. Continuar?')) return;
    setResolutionError(''); setResolving(true);
    try { await resolveSyncConflicts(ctx, strategy); }
    catch (error) { setResolutionError(error instanceof Error ? error.message : 'Não foi possível resolver o conflito.'); }
    finally { setResolving(false); }
  };
  return <div className={`storage-status ${detailed ? 'sync-details' : ''}`} role="status"><span className={`status-dot ${!online || !connected || info?.meta?.lastError ? 'is-offline' : ''}`} /><div><strong>{label}</strong><small>{detail}</small>{detailed && info && <small>Alterações pendentes: {info.pending}</small>}{info?.meta?.lastSuccessAt ? <small>Última sincronização: {new Date(info.meta.lastSuccessAt).toLocaleString('pt-BR')}</small> : detailed && <small>Nenhuma sincronização concluída ainda</small>}{detailed && connected && info?.meta?.lastError && !hasConflict && <small>Detalhe: {info.meta.lastError}</small>}{detailed && hasConflict && <div className="sync-resolution"><button className="button primary" disabled={!online || busy || resolving} onClick={() => { void resolve('local'); }}>Manter deste dispositivo</button><button className="button secondary" disabled={!online || busy || resolving} onClick={() => { void resolve('remote'); }}>Usar versão da nuvem</button></div>}{resolutionError && <small className="sync-resolution-error" role="alert">{resolutionError}</small>}{connected && !hasConflict && <button className="install-button" disabled={!online || busy} onClick={() => { void syncWallet(ctx).catch(() => undefined); }}>Sincronizar</button>}{xanoReady() && !connected && !state.demo && <button className="install-button" onClick={onLoginRequired}>Entrar novamente</button>}</div></div>;
}
