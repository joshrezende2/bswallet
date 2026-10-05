import { clearXanoToken, setXanoToken, xanoAuth } from './client';

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
  return response.user ?? xanoAuth<RemoteUser>('/auth/me');
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

export async function xanoChangePassword(currentPassword: string, newPassword: string) {
  await xanoAuth<{ ok: boolean }>('/auth/change_password', { method: 'POST', body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) });
}

export function xanoSignOut() { clearXanoToken(); }
