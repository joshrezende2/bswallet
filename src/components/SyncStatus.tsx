import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../data/db';
import { isSyncing, subscribeSync, syncWallet } from '../data/sync';
import { auth } from '../data/auth';
import { xanoConfig, xanoReady } from '../data/xano/config';
import { useWallet } from './WalletContext';
import { useXanoSession } from './useXanoSession';
import { Button, Field, ErrorText } from './ui';

export function SyncStatus({ detailed = false }: { detailed?: boolean }) {
  const { ctx } = useWallet();
  const { connected, error: sessionError } = useXanoSession(ctx.user.id);
  const [online, setOnline] = useState(navigator.onLine);
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
  if (!xanoConfig.enabled) { label = 'Salvo neste dispositivo'; detail = 'Sincronização em nuvem desativada'; }
  else if (!xanoReady()) { label = 'Conexão não configurada'; detail = 'Esta versão precisa da configuração de conexão com Xano'; }
  else if (!online) { label = 'Modo offline'; detail = 'Alterações serão sincronizadas quando houver conexão'; }
  else if (!connected) { label = 'Conectar ao Xano'; detail = sessionError || 'Entre na sua conta Xano para sincronizar'; }
  else if (busy) { label = 'Sincronizando...'; }
  else if (info?.meta?.lastError === 'Existem conflitos aguardando resolução.') { label = 'Conflito de sincronização'; }
  else if (info?.meta?.lastError) { label = 'Não foi possível sincronizar'; detail = 'Seus dados continuam salvos neste dispositivo'; }
  else if (info && !info.pending && info.meta?.lastSuccessAt) { label = 'Sincronizado'; detail = 'Dados atualizados na nuvem'; }
  return <div className={`storage-status ${detailed ? 'sync-details' : ''}`} role="status"><span className={`status-dot ${!online || !connected || info?.meta?.lastError ? 'is-offline' : ''}`} /><div><strong>{label}</strong><small>{detail}</small>{detailed && info && <small>Alterações pendentes: {info.pending}</small>}{info?.meta?.lastSuccessAt ? <small>Última sincronização: {new Date(info.meta.lastSuccessAt).toLocaleString('pt-BR')}</small> : detailed && <small>Nenhuma sincronização concluída ainda</small>}{detailed && connected && info?.meta?.lastError && <small>Detalhe: {info.meta.lastError}</small>}{connected && <button className="install-button" disabled={!online || busy} onClick={() => { void syncWallet(ctx).catch(() => undefined); }}>Sincronizar</button>}{!detailed && xanoReady() && !connected && <Link className="install-button" to="/app/ajustes/sincronizacao">Conectar conta</Link>}</div></div>;
}

export function XanoConnection() {
  const { ctx, state, toast } = useWallet();
  const { connected } = useXanoSession(ctx.user.id);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form);
    setBusy(true); setError('');
    try {
      await auth.connectXano(ctx.user.id, String(data.get('password')), data.get('remember') === 'on');
      form.reset(); toast('Conta conectada. A sincronização continuará em segundo plano.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível conectar.'); }
    finally { setBusy(false); }
  }
  if (!xanoReady() || connected || state.demo) return null;
  return <form onSubmit={connect}><h3>Conectar sua conta</h3><p>Conecte {ctx.user.email} para enviar as pendências deste dispositivo. Se a conta ainda não existir no Xano, ela será criada com o mesmo identificador local.</p><Field label="Senha da conta" hint="A senha é enviada somente para autenticação no Xano e não é armazenada em texto puro."><input name="password" type="password" autoComplete="current-password" required maxLength={128} /></Field><label className="check"><input type="checkbox" name="remember" defaultChecked />Manter conectado neste dispositivo</label><ErrorText error={error} /><Button type="submit" disabled={busy}>{busy ? 'Conectando…' : 'Conectar ao Xano'}</Button></form>;
}
