import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { acceptInvite, declineInvite, pendingInvites, type WorkspaceInvite } from '../data/invitations';
import type { User } from '../domain/types';
import { Button, ErrorText, Modal } from './ui';
import { useXanoSession } from './useXanoSession';
import { invitationDate, invitationError, loadAcceptedWorkspace, useInvitationOnline } from './InvitationSupport';

export function PendingInvites({ user, onAccepted }: { user: User; onAccepted: (workspaceId: string) => void }) {
  const { connected } = useXanoSession(user.id), online = useInvitationOnline(), navigate = useNavigate();
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]), [open, setOpen] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const [accepted, setAccepted] = useState<Record<string, string>>({});
  const acceptedRef = useRef<Record<string, string>>({});
  const refresh = useCallback(async () => {
    setError('');
    try {
      const pending = await pendingInvites();
      setInvites(previous => [...pending, ...previous.filter(invite => acceptedRef.current[invite.id] && !pending.some(item => item.id === invite.id))]);
    } catch (e) { setError(invitationError(e)); }
  }, []);
  useEffect(() => { if (connected && online) void refresh(); }, [connected, online, refresh]);
  async function accept(invite: WorkspaceInvite) {
    setBusy(invite.id); setError('');
    try {
      const workspaceId = accepted[invite.id] ?? (await acceptInvite({ invite_id: invite.id })).workspace_id;
      acceptedRef.current[invite.id] = workspaceId;
      setAccepted(previous => ({ ...previous, [invite.id]: workspaceId }));
      await loadAcceptedWorkspace(user, workspaceId);
      onAccepted(workspaceId); delete acceptedRef.current[invite.id]; setInvites(previous => previous.filter(item => item.id !== invite.id)); setOpen(false); navigate('/app/resumo');
    } catch (e) { setError(invitationError(e)); } finally { setBusy(''); }
  }
  async function decline(inviteId: string) {
    setBusy(inviteId); setError('');
    try { await declineInvite({ invite_id: inviteId }); setInvites(previous => previous.filter(item => item.id !== inviteId)); }
    catch (e) { setError(invitationError(e)); } finally { setBusy(''); }
  }
  if (!connected) return null;
  if (!invites.length && !error) return null;
  return <><div className="update-banner" role="status"><span>{invites.length ? `Você possui ${invites.length} convite(s) pendente(s).` : 'Não foi possível consultar seus convites.'}</span><Button variant="secondary" onClick={() => setOpen(true)}>Ver convites</Button></div>{open && <Modal title="Seus convites" onClose={() => { if (!busy) setOpen(false); }}>
    {!online && <p className="info-callout">Conecte-se à internet para gerenciar convites.</p>}<ErrorText error={error} />
    {!invites.length ? <Button disabled={!online || Boolean(busy)} onClick={refresh}>Tentar novamente</Button> : invites.map(invite => <section className="invite-item" key={invite.id}><h3>{invite.workspace_name ?? 'Família'}</h3><p>{invite.role === 'admin' ? 'Administrador' : 'Membro'} · Expira em {invitationDate(invite.expires_at)}</p>{accepted[invite.id] && <p role="status">Convite aceito. Falta carregar a família neste dispositivo.</p>}<div className="detail-actions"><Button disabled={!online || Boolean(busy)} onClick={() => accept(invite)}>{busy === invite.id ? 'Aguarde…' : accepted[invite.id] ? 'Abrir família' : 'Aceitar convite'}</Button>{!accepted[invite.id] && <Button variant="secondary" disabled={!online || Boolean(busy)} onClick={() => decline(invite.id)}>Recusar</Button>}</div></section>)}
  </Modal>}</>;
}
