import { createHash, randomUUID } from 'node:crypto';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { capabilities } from '../../src/domain/types';

// Stateful HTTP contract double shared by isolated browser contexts. This is NOT
// evidence that the deployed Xano implementation enforces these security rules.
export const API = 'https://xano.ab1midia.com.br/api:A-AE1sTc';
const AUTH = 'https://xano.ab1midia.com.br/api:iJuDN1w_';
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
type Row = Record<string, any>;
export function invitationServer() {
  const users = new Map<string, Row>(), rows: Record<string, Row[]> = {}, invites: Row[] = [], audits: Row[] = [];
  const requests: { path: string; userId?: string; data: Row }[] = [];
  const seedUser = (email: string, name = 'Maria') => { const user = { id: randomUUID(), email, name, active: true, created_at: Date.now() }; users.set(email, user); return user; };
  const member = (workspaceId: string, userId: string) => (rows.workspace_members ?? []).find(row => row.workspace_id === workspaceId && row.user_id === userId && row.active);
  const safeInvite = (item: Row) => Object.fromEntries(['id', 'workspace_id', 'email', 'role', 'permissions', 'status', 'created_at', 'updated_at', 'expires_at', 'accepted_at', 'send_count'].map(key => [key, item[key] ?? null]));
  const workspaceName = (id: string) => rows.workspace?.find(row => row.id === id)?.name ?? 'Família';
  async function attach(context: BrowserContext) {
    await context.route('https://xano.ab1midia.com.br/**', async route => {
      const request = route.request(), url = new URL(request.url());
      const path = url.pathname.replace(/^\/api:[^/]+/, '');
      const data: Row = request.postData() ? request.postDataJSON() : {};
      const token = request.headers().authorization?.replace(/^Bearer /, '');
      const user = [...users.values()].find(row => token === `test-session-${row.id}`);
      requests.push({ path, userId: user?.id, data });
      const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      const fail = (message: string, status = 403) => reply({ message }, status);
      if (path === '/auth/signup') {
        if (users.has(data.email)) return fail('Conta já cadastrada', 409);
        const created = { id: data.id, name: data.name, email: data.email.toLowerCase(), active: true, created_at: Date.now() };
        users.set(created.email, created); return reply({ authToken: `test-session-${created.id}`, user: created });
      }
      if (path === '/auth/login') { const found = users.get(String(data.email).toLowerCase()); return found ? reply({ authToken: `test-session-${found.id}`, user: found }) : fail('Credenciais inválidas', 401); }
      if (path === '/settings/last') return reply({ version: '0.1.0', published_at: Date.now(), published: true, active: true });
      if (path === '/workspace/invites/resolve') {
        const item = invites.find(invite => invite.token_hash === hash(String(data.token)) && invite.status === 'pending' && invite.expires_at > Date.now());
        return reply(item ? { valid: true, workspace_name: workspaceName(item.workspace_id), role: item.role, masked_email: `${item.email.slice(0, 2)}***@${item.email.split('@')[1]}`, expires_at: item.expires_at } : { valid: false });
      }
      if (!user) return fail('Sessão inválida', 401);
      if (path === '/auth/me') return reply(user);
      if (path.startsWith('/workspace/invites/')) {
        const action = path.split('/').at(-1);
        const item = invites.find(invite => data.token ? invite.token_hash === hash(data.token) : invite.id === data.invite_id);
        const permitted = (workspaceId: string) => { const m = member(workspaceId, user.id); return m && (m.role === 'admin_master' || (m.permissions ?? []).includes('members.manage')) ? m : undefined; };
        if (action === 'pending') return reply(invites.filter(invite => invite.email === user.email && invite.status === 'pending' && invite.expires_at > Date.now()).map(invite => ({ ...safeInvite(invite), workspace_name: workspaceName(invite.workspace_id) })));
        if (action === 'list') { const id = url.searchParams.get('workspace_id')!; return permitted(id) ? reply(invites.filter(invite => invite.workspace_id === id).map(safeInvite)) : fail('Sem permissão'); }
        if (action === 'create') {
          const inviter = permitted(data.workspace_id);
          if (!inviter) return fail('Sem permissão');
          if (!['member', 'admin'].includes(data.role) || !Array.isArray(data.permissions) || data.permissions.some((p: string) => !(capabilities as readonly string[]).includes(p))) return fail('Papel ou permissões inválidos');
          if (inviter.role !== 'admin_master' && (data.role !== 'member' || data.permissions.some((p: string) => !inviter.permissions.includes(p)))) return fail('Delegação não permitida');
          const email = String(data.email).trim().toLowerCase();
          if (email === user.email) return fail('Não convide a própria conta');
          const invitedUser = users.get(email);
          if (invitedUser && member(data.workspace_id, invitedUser.id)) return fail('Já é membro', 409);
          if (invites.some(invite => invite.workspace_id === data.workspace_id && invite.email === email && invite.status === 'pending' && invite.expires_at > Date.now())) return fail('Convite pendente já existe', 409);
          const rawToken = randomUUID() + randomUUID();
          const created = { id: randomUUID(), workspace_id: data.workspace_id, email, invited_by: user.id, role: data.role, permissions: data.permissions, status: 'pending', token_hash: hash(rawToken), created_at: Date.now(), updated_at: Date.now(), expires_at: Date.now() + 7 * 86400000, accepted_at: null, send_count: 1 };
          invites.push(created); audits.push({ action: 'invite_create', entity_id: created.id });
          return reply({ invite: safeInvite(created), token: rawToken });
        }
        if (action === 'accept' || action === 'decline') {
          if (Boolean(data.token) === Boolean(data.invite_id)) return fail('Informe token ou convite');
          if (!item || item.email !== user.email) return fail('Este convite pertence a outro e-mail.');
          if (item.status !== 'pending' || item.expires_at <= Date.now()) return fail('Convite indisponível', 410);
          if (action === 'decline') { item.status = 'declined'; audits.push({ action: 'invite_decline', entity_id: item.id }); return reply({ ok: true }); }
          if (member(item.workspace_id, user.id)) return fail('Já é membro', 409);
          const membership = { id: randomUUID(), workspace_id: item.workspace_id, user_id: user.id, role: item.role, permissions: item.permissions, active: true, joined_at: Date.now(), invited_by: item.invited_by };
          (rows.workspace_members ??= []).push(membership); item.status = 'accepted'; item.accepted_at = Date.now(); item.accepted_user_id = user.id;
          audits.push({ action: 'invite_accept', entity_id: item.id });
          return reply({ ok: true, workspace_id: item.workspace_id, membership_id: membership.id });
        }
        if (!item || !permitted(item.workspace_id)) return fail('Sem permissão');
        if (item.status !== 'pending') return fail('Convite indisponível', 410);
        if (action === 'revoke') { item.status = 'revoked'; audits.push({ action: 'invite_revoke', entity_id: item.id }); return reply({ ok: true }); }
        if (action === 'regenerate') { const rawToken = randomUUID() + randomUUID(); item.token_hash = hash(rawToken); item.expires_at = Date.now() + 7 * 86400000; item.send_count++; audits.push({ action: 'invite_regenerate', entity_id: item.id }); return reply({ invite: safeInvite(item), token: rawToken }); }
        return fail('Rota desconhecida', 404);
      }
      if (path === '/sync/workspaces') return reply((rows.workspace_members ?? []).filter(row => row.user_id === user.id && row.active));
      if (path === '/sync/bootstrap') {
        const id = url.searchParams.get('workspace_id')!;
        if (!member(id, user.id)) return fail('Não pertence ao workspace');
        const visible = (row: Row) => row.workspace_id === id && (row.scope === 'shared' || row.owner_user_id === user.id);
        return reply({ ...Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, value.filter(visible)])), workspace: rows.workspace?.find(row => row.id === id), members: rows.workspace_members?.filter(row => row.workspace_id === id), preferences: rows.preferences?.find(row => row.workspace_id === id), audit_logs: audits.filter(visible) });
      }
      if (path.startsWith('/sync/') && request.method() === 'POST') {
        const table = path.split('/').at(-1)!;
        if (!['workspace', 'workspace_members'].includes(table) && !member(data.workspace_id, user.id)) return fail('Não pertence ao workspace');
        if (data.record.scope === 'private' && data.record.owner_user_id !== user.id) return fail('Item privado');
        rows[table] = [...(rows[table] ?? []).filter(row => row.id !== data.entity_id), data.record];
        audits.push({ id: data.operation_id, workspace_id: data.workspace_id, entity_type: data.entity_type, entity_id: data.entity_id, after_data: data.payload, timestamp: Date.now(), scope: data.record.scope, owner_user_id: data.record.owner_user_id });
        return reply({ ok: true, operation_id: data.operation_id });
      }
      return fail('Rota não implementada pelo contrato de teste', 404);
    });
  }
  return { attach, seedUser, users, rows, invites, audits, requests };
}

export async function apiRequest(page: Page, path: string, data?: unknown, bearer?: string) {
  return page.evaluate(async ({ api, path, data, bearer }) => {
    const token = bearer ?? localStorage.getItem('bs-wallet-xano-token') ?? sessionStorage.getItem('bs-wallet-xano-session-token');
    const response = await fetch(`${api}${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, body: await response.json() };
  }, { api: API, path, data, bearer });
}
export async function signup(page: Page, name: string, email: string, fromInvite = false) {
  if (!fromInvite) await page.goto('/');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await page.getByLabel('Seu nome', { exact: true }).fill(name);
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Username', { exact: true }).fill(email.split('@')[0]);
  await page.locator('input[name="password"]').fill('convites-teste-1234');
  await page.getByLabel('Confirmar senha', { exact: true }).fill('convites-teste-1234');
  await page.getByRole('button', { name: 'Criar minha carteira', exact: true }).click();
  if (!fromInvite) await expect(page.getByText('Sincronizado', { exact: true }).last()).toBeVisible();
}
export async function localWallets(page: Page) {
  return page.evaluate(() => new Promise<Record<string, any>[]>((resolve, reject) => {
    const request = indexedDB.open('bs-wallet-v1'); request.onerror = () => reject(request.error);
    request.onsuccess = () => { const database = request.result; const query = database.transaction('wallets').objectStore('wallets').getAll(); query.onsuccess = () => { resolve(query.result); database.close(); }; };
  }));
}

