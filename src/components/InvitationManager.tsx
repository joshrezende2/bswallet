import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Copy, Plus } from 'lucide-react';
import { createInvite, listWorkspaceInvites, regenerateInvite, revokeInvite, type GeneratedInvite, type WorkspaceInvite } from '../data/invitations';
import { capabilities, type Capability } from '../domain/types';
import { defaultPermissions, hasCapability, memberOf } from '../domain/permissions';
import { Button, ErrorText, Field } from './ui';
import { useWallet } from './WalletContext';
import { useXanoSession } from './useXanoSession';
import { invitationDate, invitationError, useInvitationOnline } from './InvitationSupport';
import '../pages/invitations.css';

export const permissionLabels: Record<Capability, string> = { 'shared.read': 'Ver carteira compartilhada', 'shared.create': 'Criar dados compartilhados', 'transactions.editOwn': 'Editar lançamentos próprios', 'transactions.editOthers': 'Editar lançamentos de outros', 'transactions.delete': 'Excluir e restaurar itens', 'attachments.read': 'Ver comprovantes', 'catalog.manage': 'Gerenciar cadastros e recorrências', 'budgets.manage': 'Gerenciar orçamentos', 'reports.read': 'Ver e exportar relatórios', 'members.manage': 'Gerenciar membros' };

export function InvitationManager() {
  const { ctx, state } = useWallet(), actor = memberOf(state, ctx), master = actor.role === 'master_admin';
  const allowed = hasCapability(state, ctx, 'members.manage'), online = useInvitationOnline(), { connected } = useXanoSession(ctx.user.id);
  const [email, setEmail] = useState(''), [role, setRole] = useState<'member' | 'admin'>('member');
  const [permissions, setPermissions] = useState<Capability[]>(() => defaultPermissions.filter(p => master || actor.permissions.includes(p)));
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]), [generated, setGenerated] = useState<GeneratedInvite | null>(null), [busy, setBusy] = useState(''), [loading, setLoading] = useState(false), [error, setError] = useState(''), [copyStatus, setCopyStatus] = useState('');
  const linkRef = useRef<HTMLInputElement>(null);
  const link = generated ? `${window.location.origin}/convite/${encodeURIComponent(generated.token)}` : '';
  const disabled = !online || !connected || Boolean(busy);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setInvites(await listWorkspaceInvites(ctx.workspaceId)); }
    catch (e) { setError(invitationError(e)); }
    finally { setLoading(false); }
  }, [ctx.workspaceId]);
  useEffect(() => { if (allowed && online && connected) void refresh(); }, [allowed, online, connected, refresh]);
  async function create(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy('create'); setCopyStatus(''); setGenerated(null);
    try { const result = await createInvite({ workspace_id: ctx.workspaceId, email, role, permissions }); setGenerated(result); setEmail(''); await refresh(); }
    catch (e) { setError(invitationError(e)); } finally { setBusy(''); }
  }
  async function change(invite: WorkspaceInvite, regenerate: boolean) {
    setError(''); setBusy(invite.id); setCopyStatus('');
    try {
      if (regenerate) setGenerated(await regenerateInvite(invite.id));
      else { await revokeInvite(invite.id); if (generated?.invite.id === invite.id) setGenerated(null); }
      await refresh();
    } catch (e) { setError(invitationError(e)); } finally { setBusy(''); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopyStatus('Link copiado. Compartilhe com o convidado.'); }
    catch {
      linkRef.current?.focus(); linkRef.current?.select();
      try { if (document.execCommand('copy')) { setCopyStatus('Link copiado. Compartilhe com o convidado.'); return; } } catch { /* Link selecionado continua disponível para copiar manualmente. */ }
      setCopyStatus('Selecione o link e use Copiar no seu dispositivo (Ctrl+C ou toque e segure).');
    }
  }
  if (!allowed) return <p className="info-callout">Seu perfil não permite gerenciar convites.</p>;
  return <div className="invite-manager"><h3>Convidar membro</h3><p>Convide pelo e-mail da conta BS Wallet. Você poderá copiar o link e compartilhar manualmente.</p>
    {!online && <p className="info-callout">Conecte-se à internet para gerenciar convites.</p>}{!connected && <p className="info-callout">Entre novamente para conectar sua conta ao servidor e gerenciar convites.</p>}
    <form onSubmit={create}><Field label="E-mail do convidado"><input type="email" required maxLength={254} placeholder="pessoa@email.com" value={email} onChange={event => setEmail(event.target.value)} disabled={disabled} /></Field><Field label="Papel do convite"><select value={role} onChange={event => setRole(event.target.value as 'admin' | 'member')} disabled={disabled}><option value="member">Membro</option>{master && <option value="admin">Administrador</option>}</select></Field><div className="permission-list">{capabilities.map(permission => <label className="check" key={permission}><input type="checkbox" checked={permissions.includes(permission)} disabled={disabled || (!master && !actor.permissions.includes(permission))} onChange={event => setPermissions(previous => event.target.checked ? [...previous, permission] : previous.filter(item => item !== permission))} />{permissionLabels[permission]}</label>)}</div><Button type="submit" disabled={disabled}><Plus size={17} />{busy === 'create' ? 'Criando convite…' : 'Criar convite'}</Button></form>
    <ErrorText error={error} />
    {generated && <section className="invite-link-result" role="status"><h3>Convite criado</h3><p>{generated.invite.email}</p><p>Este link expira em {invitationDate(generated.invite.expires_at)}. Compartilhe somente com o convidado.</p><Field label="Link do convite"><input ref={linkRef} value={link} readOnly onFocus={event => event.currentTarget.select()} /></Field><Button variant="secondary" onClick={copy}><Copy size={17} />Copiar link</Button>{copyStatus && <p>{copyStatus}</p>}</section>}
    <h3>Convites pendentes</h3>{loading && <p role="status">Carregando convites…</p>}{!loading && !invites.some(invite => invite.status === 'pending') && <p className="muted">Nenhum convite pendente.</p>}
    {invites.filter(invite => invite.status === 'pending').map(invite => <section className="invite-item" key={invite.id}><strong>{invite.email}</strong><p>{invite.role === 'admin' ? 'Administrador' : 'Membro'} · {Date.parse(invite.expires_at) <= Date.now() ? 'Expirado' : 'Expira em'} {invitationDate(invite.expires_at)}</p><div className="detail-actions"><Button variant="secondary" disabled={disabled} onClick={() => change(invite, true)}>Gerar novo link</Button><Button variant="danger" disabled={disabled} onClick={() => change(invite, false)}>Cancelar convite</Button></div></section>)}
    {error && <Button variant="ghost" disabled={disabled || loading} onClick={() => { setError(''); void refresh(); }}>Atualizar convites</Button>}
  </div>;
}
