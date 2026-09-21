import { db } from './db';
import { initialWallet } from './factory';
import type { User } from '../domain/types';

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
let activeToken: string | null = null;
function temporaryToken() { try { return sessionStorage.getItem('bs-wallet-session'); } catch { return null; } }
function writeTemporary(token: string | null) { try { token ? sessionStorage.setItem('bs-wallet-session', token) : sessionStorage.removeItem('bs-wallet-session'); } catch { /* Memory session remains available. */ } }
export class LocalAuthProvider implements AuthProvider {
  async createSession(user: User, persistent: boolean) {
    await this.signOut();
    activeToken = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    await db.sessions.add({ id: activeToken, userId: user.id, expiresAt: Date.now() + (persistent ? 30 : 1) * 86400000, persistent });
    writeTemporary(activeToken);
    return user;
  }
  async signUp(input: SignUpInput) {
    const name = input.name.trim().replace(/\s+/g, ' '), email = input.email.trim().toLowerCase(), username = input.username.trim().toLowerCase();
    if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Informe seu nome e um e-mail válido.');
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error('Username: 3 a 32 letras, números, ponto, hífen ou sublinhado.');
    passwordPolicy(input.password);
    const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(32))), iterations = 600000;
    const hash = await derive(input.password, salt, iterations);
    const user: User = { id: crypto.randomUUID(), name, email, username, createdAt: new Date().toISOString() };
    await db.transaction('rw', [db.users, db.credentials, db.wallets], async () => {
      if (await db.users.where('email').equals(email).count() || await db.users.where('username').equals(username).count()) throw new Error('E-mail ou username já cadastrado neste dispositivo.');
      await db.users.add(user); await db.credentials.add({ userId: user.id, salt, hash, iterations }); await db.wallets.add(initialWallet(user));
    });
    return this.createSession(user, true);
  }
  async signIn(identifier: string, password: string, remember = true) {
    const normalized = identifier.trim().toLowerCase();
    const user = await db.users.where(normalized.includes('@') ? 'email' : 'username').equals(normalized).first();
    const credential = user && await db.credentials.get(user.id);
    if (!credential || await derive(password, credential.salt, credential.iterations) !== credential.hash) throw new Error('E-mail, username ou senha incorretos neste dispositivo.');
    return this.createSession(user!, remember);
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
  async requestPasswordReset(_email: string): Promise<void> { throw new Error('A recuperação por e-mail depende da conexão com um provedor de autenticação. No modo local, nenhum e-mail é enviado.'); }
  async changePassword(userId: string, current: string, next: string) {
    await this.requireUser(userId); passwordPolicy(next);
    const credential = await db.credentials.get(userId);
    if (!credential || await derive(current, credential.salt, credential.iterations) !== credential.hash) throw new Error('Senha atual incorreta.');
    const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    const hash = await derive(next, salt, 600000);
    await db.credentials.put({ userId, salt, hash, iterations: 600000 });
    const user = (await db.users.get(userId))!; await this.createSession(user, true);
  }
}
export const auth = new LocalAuthProvider();
