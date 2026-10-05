import { bindXanoSession, clearXanoToken, getXanoToken, reportXanoSessionError, setXanoToken, XanoError, xanoAuth } from './client';

export interface RemoteUser {
  id: string;
  name: string;
  email: string;
  created_at?: string | number;
  updated_at?: string | number;
  active?: boolean;
}

interface AuthResponse { authToken: string; user?: RemoteUser; }

async function userFromSession(response: AuthResponse, persistent: boolean) {
  if (!response.authToken) throw new Error('O Xano não retornou um token de autenticação.');
  setXanoToken(response.authToken, persistent);
  const user = response.user ?? await xanoAuth<RemoteUser>('/auth/me');
  if (!user?.id || user.active === false) throw new Error('A conta BS Wallet está indisponível ou inativa.');
  bindXanoSession(response.authToken, user.id);
  return user;
}

export async function xanoSignUp(input: { id: string; name: string; email: string; password: string }, persistent = true) {
  const response = await xanoAuth<AuthResponse>('/auth/signup', { method: 'POST', body: JSON.stringify(input) }, false);
  return userFromSession(response, persistent);
}

export async function xanoSignIn(email: string, password: string, persistent = true) {
  const response = await xanoAuth<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, false);
  return userFromSession(response, persistent);
}

export const xanoMe = () => xanoAuth<RemoteUser>('/auth/me');

export async function validateXanoSession(userId: string) {
  const token = getXanoToken();
  if (!token) return false;
  try {
    const user = await xanoMe();
    if (user?.id !== userId || user.active === false) throw new Error('A sessão de sincronização pertence a outra conta ou está inativa. Confirme sua conta BS Wallet.');
    bindXanoSession(token, userId);
    return true;
  } catch (error) {
    if (getXanoToken() === token) {
      if (!(error instanceof XanoError) || [401, 403].includes(error.status)) clearXanoToken();
      reportXanoSessionError(error);
    }
    return false;
  }
}

export async function xanoChangePassword(currentPassword: string, newPassword: string) {
  await xanoAuth<{ ok: boolean }>('/auth/change_password', { method: 'POST', body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) });
}

export function xanoSignOut() { clearXanoToken(); }
