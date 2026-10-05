import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { acceptInvite, declineInvite, resolveInvite, type ResolvedInvite } from '../data/invitations';
import type { User } from '../domain/types';
import { Brand, Button, ErrorText } from '../components/ui';
import { useXanoSession } from '../components/useXanoSession';
import { invitationDate, invitationError, loadAcceptedWorkspace, useInvitationOnline } from '../components/InvitationSupport';
import { AuthPage } from './AuthPage';
import './invitations.css';

export function InvitePage({ user, onLogin, onAccepted, onLogout }: { user: User | null; onLogin: (user: User) => void; onAccepted: (workspaceId: string) => void; onLogout: () => Promise<void> }) {
  const { token = '' } = useParams(), navigate = useNavigate(), online = useInvitationOnline();
  const { connected } = useXanoSession(user?.id ?? '');
  const [invite, setInvite] = useState<ResolvedInvite | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'signup' | null>(null), [acceptedWorkspace, setAcceptedWorkspace] = useState(''), [declined, setDeclined] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => { setInvite(null); setAcceptedWorkspace(''); setDeclined(false); setAuthMode(null); }, [token]);
  useEffect(() => {
    let live = true;
    setLoading(true); setError('');
    resolveInvite(token).then(result => { if (live) setInvite(result); }).catch(e => { if (live) setError(invitationError(e)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [token, attempt, online]);
  async function accept() {
    if (!user) return;
    setBusy(true); setError('');
    try {
      const workspaceId = acceptedWorkspace || (await acceptInvite({ token })).workspace_id;
      setAcceptedWorkspace(workspaceId);
      await loadAcceptedWorkspace(user, workspaceId);
      onAccepted(workspaceId); navigate('/app/resumo', { replace: true });
    } catch (e) { setError(invitationError(e)); } finally { setBusy(false); }
  }
  async function decline() {
    setBusy(true); setError('');
    try { await declineInvite({ token }); setDeclined(true); } catch (e) { setError(invitationError(e)); } finally { setBusy(false); }
  }
  if (authMode && (!user || !connected)) return <><div className="invite-auth-note"><strong>Seu convite está guardado nesta página.</strong><Button variant="ghost" onClick={() => setAuthMode(null)}>Voltar ao convite</Button></div><AuthPage initialMode={authMode} invitation onLogin={value => { onLogin(value); setAuthMode(null); }} /></>;
  return <main className="invite-page"><section className="panel settings-form invite-card"><Brand /><h1>Convite para uma família</h1>
    {!online && <p className="info-callout">Conecte-se à internet para gerenciar convites.</p>}
    {loading && !acceptedWorkspace ? <p role="status">Consultando convite…</p> : declined ? <><h2>Convite recusado</h2><p>Nenhum acesso à família foi adicionado.</p><Link className="button secondary" to="/app/resumo">Ir para minha carteira</Link></> : acceptedWorkspace ? <><h2>Convite aceito</h2><p>Seu acesso foi confirmado. Carregue a família para continuar.</p><Button disabled={busy || !online} onClick={accept}>{busy ? 'Carregando família…' : 'Abrir família'}</Button>{!connected && <Button variant="secondary" onClick={() => setAuthMode('login')}>Entrar novamente</Button>}</> : invite?.valid ? <><p>Você foi convidado para:</p><h2>{invite.workspace_name}</h2><p>{invite.role === 'admin' ? 'Administrador' : 'Membro'} · {invite.masked_email}</p><p className="muted">Expira em {invitationDate(invite.expires_at)}.</p>{user && connected ? <><p>Conectado como <strong>{user.email}</strong>. O e-mail precisa corresponder ao convite.</p><div className="detail-actions"><Button disabled={busy || !online} onClick={accept}>{busy ? 'Aguarde…' : 'Aceitar convite'}</Button><Button variant="secondary" disabled={busy || !online} onClick={decline}>Recusar</Button></div><Button variant="ghost" disabled={busy} onClick={onLogout}>Usar outra conta</Button></> : <><p>Entre com a conta do e-mail convidado ou crie sua conta para responder.</p>{user && <p className="info-callout">Sua conta está aberta somente neste dispositivo. Entre novamente para conectar ao servidor.</p>}<div className="detail-actions"><Button disabled={!online} onClick={() => setAuthMode('login')}>Entrar</Button><Button variant="secondary" disabled={!online} onClick={() => setAuthMode('signup')}>Criar conta</Button></div></>}</> : <><h2>{invite ? 'Convite indisponível' : 'Não foi possível consultar o convite'}</h2><p>{invite ? 'O link pode ter expirado, sido cancelado, substituído ou já utilizado. Peça um novo convite ao administrador.' : 'Verifique a conexão e tente novamente.'}</p><Button variant="secondary" disabled={!online} onClick={() => setAttempt(value => value + 1)}>Tentar novamente</Button><Link to="/app/resumo" className="text-button">Ir para minha carteira</Link></>}
    <ErrorText error={error} />
  </section></main>;
}
