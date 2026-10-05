import { useEffect, useState } from 'react';
import { db } from '../data/db';
import { hydrateUserFromXano } from '../data/sync';
import { hasXanoSession } from '../data/xano/client';
import type { User } from '../domain/types';

export function useInvitationOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  return online;
}

export async function loadAcceptedWorkspace(user: User, workspaceId: string) {
  if (!navigator.onLine) throw new Error('Convite aceito. Conecte-se à internet para carregar a família.');
  if (!hasXanoSession(user.id)) throw new Error('Convite aceito. Entre novamente para carregar a família.');
  await hydrateUserFromXano(user);
  const wallet = await db.wallets.get(workspaceId);
  if (!wallet?.members.some(member => member.userId === user.id && member.status === 'active')) throw new Error('Convite aceito, mas a família ainda não foi carregada. Tente abrir a família novamente.');
}

export const invitationError = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível concluir. Tente novamente.';
export const invitationDate = (date: string) => new Date(date).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
