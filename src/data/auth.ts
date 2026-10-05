import { db } from './db';
import { initialWallet } from './factory';
import type { User } from '../domain/types';
import { xanoReady } from './xano/config';
import { XanoError, clearXanoToken, getXanoSessionUserId, getXanoToken, hasXanoSession, reportXanoSessionError } from './xano/client';
import { type RemoteUser, validateXanoSession, xanoChangePassword, xanoSignIn, xanoSignOut, xanoSignUp } from './xano/auth';

export interface SignUpInput { name: string; email: string; username: string; password: string; }
export interface AuthProvider {
  signUp(input: SignUpInput): Promise<User>;
  signIn(identifier: string, password: string, remember?: boolean): Promise<User>;
  requestPasswordReset(email: string): Promise<void>;
  signOut(): Promise<void>;
  restoreSession(): Promise<User | null>;
}

const bytesToHex = (bytes: ArrayBuffer | Uint8Array) => Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const hexToBytes = (value: string) => new Uint8Array(value.match(/.{2}/g)!.map(v => parseInt(v, 16)));
async function derive(password: string, salt: string, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return bytesToHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: hexToBytes(salt), iterations, hash: 'SHA-256' }, key, 256));
}
function passwordPolicy(password: string) { if (password.length < 12 || password.length > 128) throw new Error('Use uma senha entre 12 e 128 caracteres.'); }
const online = () => typeof navigator === 'undefined' || navigator.onLine;
const cloudUsable = () => xanoReady() && online();
let activeToken: string | null = null;
function temporaryToken() { try { return sessionStorage.getItem('bs-wallet-session'); } catch { return null; } }
function writeTemporary(token: string | null) { try { token ? sessionStorage.setItem('bs-wallet-session', token) : sessionStorage.removeItem('bs-wallet-session'); } catch { /* Memory session remains available. */ } }

function normalizedSignup(input: SignUpInput) {
  const name = input.name.trim().replace(/\s+/g, ' '), email = input.email.trim().toLowerCase(), username = input.username.trim().toLowerCase();
  if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Informe seu nome e um e-mail válido.');
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error('Username: 3 a 32 letras, números, ponto, hífen ou sublinhado.');
  passwordPolicy(input.password);
  return { ...input, name, email, username };
}

function createdAt(value: string | number | undefined) {
  if (typeof value === 'string' && value) return value;
  if (typeof value === 'number') {
    const millis = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(millis); if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

export class LocalAuthProvider implements AuthProvider {
  async createSession(user: User, persistent: boolean) {
    await this.signOut();
    activeToken = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    await db.sessions.add({ id: activeToken, userId: user.id, expiresAt: Date.now() + (persistent ? 30 : 1) * 86400000, persistent });
    writeTemporary(activeToken);
    return user;
  }

  private async credential(userId: string, password: string) {
    const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(32))), iterations = 600000;
    const hash = await derive(password, salt, iterations);
    return { userId, salt, hash, iterations };
  }

  private async writeCredential(userId: string, password: string) { await db.credentials.put(await this.credential(userId, password)); }

  async signUpWithId(input: SignUpInput, id = crypto.randomUUID()) {
    const normalized = normalizedSignup(input);
    const user: User = { id, name: normalized.name, email: normalized.email, username: normalized.username, createdAt: new Date().toISOString() };
    const credential = await this.credential(user.id, normalized.password);
    await db.transaction('rw', [db.users, db.credentials, db.wallets], async () => {
      if (await db.users.where('email').equals(user.email).count() || await db.users.where('username').equals(user.username).count()) throw new Error('E-mail ou username já cadastrado neste dispositivo.');
      await db.users.add(user);
      await db.credentials.add(credential);
      await db.wallets.add(initialWallet(user));
    });
    return this.createSession(user, true);
  }

  async signUp(input: SignUpInput) { return this.signUpWithId(input); }

  async signIn(identifier: string, password: string, remember = true) {
    const normalized = identifier.trim().toLowerCase();
    const user = await db.users.where(normalized.includes('@') ? 'email' : 'username').equals(normalized).first();
    const credential = user && await db.credentials.get(user.id);
    if (!credential || await derive(password, credential.salt, credential.iterations) !== credential.hash) throw new Error('E-mail, username ou senha incorretos neste dispositivo.');
    return this.createSession(user!, remember);
  }

  async cacheRemoteUser(remote: RemoteUser, password: string, remember: boolean, usernameHint?: string) {
    let user = await db.users.get(remote.id);
    if (!user) {
      const sameEmail = await db.users.where('email').equals(remote.email.trim().toLowerCase()).first();
      if (sameEmail && sameEmail.id !== remote.id) throw new Error('A conta BS Wallet na nuvem usa um ID diferente da conta local. Faça a migração dessa conta antes de ativar a sincronização.');
      const base = (usernameHint || remote.email.split('@')[0] || 'usuario').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 24) || 'usuario';
      let username = base, suffix = 1;
      while (await db.users.where('username').equals(username).count()) username = `${base.slice(0, 24)}_${suffix++}`.slice(0, 32);
      user = { id: remote.id, name: remote.name, email: remote.email.trim().toLowerCase(), username, createdAt: createdAt(remote.created_at) };
      await db.users.add(user);
    } else if (user.name !== remote.name || user.email !== remote.email.trim().toLowerCase()) {
      user = { ...user, name: remote.name, email: remote.email.trim().toLowerCase() };
      await db.users.put(user);
    }
    await this.writeCredential(user.id, password);
    return this.createSession(user, remember);
  }

  async ensureWallet(user: User) {
    const wallets = await db.wallets.toArray();
    if (!wallets.some(wallet => wallet.members.some(member => member.userId === user.id))) await db.wallets.add(initialWallet(user));
  }

  async restoreSession() {
    const token = activeToken || temporaryToken();
    let session = token ? await db.sessions.get(token) : undefined;
    if (!session) session = (await db.sessions.toArray()).find(s => s.persistent && s.expiresAt > Date.now());
    if (!session || session.expiresAt <= Date.now()) { activeToken = null; writeTemporary(null); return null; }
    activeToken = session.id; writeTemporary(activeToken);
    return (await db.users.get(session.userId)) ?? null;
  }

  async requireUser(userId: string) { const user = await this.restoreSession(); if (!user || user.id !== userId) throw new Error('Sessão expirada. Entre novamente.'); return user; }
  async signOut() { await db.sessions.clear(); activeToken = null; writeTemporary(null); }
  async requestPasswordReset(_email: string): Promise<void> { throw new Error('A recuperação por e-mail ainda depende de um endpoint de e-mail no Xano.'); }
  async changePassword(userId: string, current: string, next: string) {
    await this.requireUser(userId); passwordPolicy(next);
    const credential = await db.credentials.get(userId);
    if (!credential || await derive(current, credential.salt, credential.iterations) !== credential.hash) throw new Error('Senha atual incorreta.');
    await this.writeCredential(userId, next);
    const user = (await db.users.get(userId))!; await this.createSession(user, true);
  }
}

function shouldFallback(error: unknown) { return error instanceof XanoError && (error.status === 0 || error.status >= 500); }

function backgroundSync(user: User, hydrate = false) {
  void import('./sync').then(async ({ syncAllForUser, hydrateUserFromXano }) => {
    if (!hasXanoSession(user.id)) return;
    if (hydrate) await hydrateUserFromXano(user);
    else await syncAllForUser(user);
  }).catch(reportXanoSessionError);
}

class HybridAuthProvider implements AuthProvider {
  private local = new LocalAuthProvider();

  async signUp(input: SignUpInput) {
    const normalized = normalizedSignup(input);
    clearXanoToken();
    if (!cloudUsable()) return this.local.signUp(normalized);
    const id = crypto.randomUUID();
    try {
      const remote = await xanoSignUp({ id, name: normalized.name, email: normalized.email, password: normalized.password }, true);
      if (remote.id !== id) throw new Error('O Xano não preservou o UUID gerado pelo BS Wallet.');
      const user = await this.local.signUpWithId(normalized, id);
      backgroundSync(user);
      return user;
    } catch (error) {
      clearXanoToken();
      reportXanoSessionError(error);
      if (shouldFallback(error)) return this.local.signUpWithId(normalized, id);
      throw error;
    }
  }

  async signIn(identifier: string, password: string, remember = true) {
    clearXanoToken();
    let localUser: User | null = null;
    let localError: unknown;
    try { localUser = await this.local.signIn(identifier, password, remember); } catch (error) { localError = error; }

    if (localUser) {
      if (cloudUsable()) {
        try {
          let remote: RemoteUser;
          try { remote = await xanoSignIn(localUser.email, password, remember); }
          catch (error) {
            if (!(error instanceof XanoError) || ![401, 403].includes(error.status)) throw error;
            remote = await xanoSignUp({ id: localUser.id, name: localUser.name, email: localUser.email, password }, remember);
          }
          if (remote.id !== localUser.id) throw new Error('A conta remota possui um UUID diferente do cadastro local.');
          backgroundSync(localUser);
        } catch (error) { clearXanoToken(); reportXanoSessionError(error); }
      }
      return localUser;
    }

    if (!cloudUsable()) throw localError;
    if (!identifier.includes('@')) throw new Error('No primeiro acesso neste dispositivo, entre com seu e-mail. O username funciona nos dispositivos em que você já entrou.');
    try {
      const remote = await xanoSignIn(identifier.trim().toLowerCase(), password, remember);
      const user = await this.local.cacheRemoteUser(remote, password, remember);
      const hasWallet = (await db.wallets.toArray()).some(wallet => wallet.members.some(member => member.userId === user.id));
      if (hasWallet) backgroundSync(user, true);
      else { const { hydrateUserFromXano } = await import('./sync'); await hydrateUserFromXano(user); }
      return user;
    } catch (error) {
      clearXanoToken(); reportXanoSessionError(error); throw error;
    }
  }

  async requestPasswordReset(email: string) { return this.local.requestPasswordReset(email); }

  async signOut() {
    xanoSignOut();
    await this.local.signOut();
  }

  async restoreSession() {
    const user = await this.local.restoreSession();
    const remoteUserId = getXanoSessionUserId();
    if (!user || (remoteUserId && remoteUserId !== user.id)) {
      clearXanoToken();
      if (user) reportXanoSessionError(new Error('A sessão de sincronização pertence a outra conta. Entre novamente no BS Wallet.'));
      return user;
    }
    if (user && cloudUsable() && getXanoToken()) {
      void validateXanoSession(user.id).then(valid => { if (valid) backgroundSync(user); }).catch(reportXanoSessionError);
    }
    return user;
  }

  async requireUser(userId: string) { return this.local.requireUser(userId); }

  async changePassword(userId: string, current: string, next: string) {
    if (xanoReady()) {
      if (!online()) throw new Error('Conecte-se à internet para alterar a senha de uma conta sincronizada.');
      if (!hasXanoSession(userId)) throw new Error('Entre novamente no BS Wallet para alterar sua senha.');
      await xanoChangePassword(current, next);
    }
    return this.local.changePassword(userId, current, next);
  }
}

export const auth = new HybridAuthProvider();
