import { expect, test, type Page } from '@playwright/test';

// The actual production bundle runs against an isolated implementation of the
// checked-in Xano contract. No fixture data or credentials reach the real server.
async function backend(page: Page) {
  const rows: Record<string, Record<string, unknown>[]> = {};
  const audits: Record<string, unknown>[] = [];
  const operations: Record<string, any>[] = [];
  let user: Record<string, unknown> | undefined;
  const control = { fail: false, unauthorized: false, hold: undefined as Promise<void> | undefined };
  await page.route('https://xano.ab1midia.com.br/**', async route => {
    const url = route.request().url();
    const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.endsWith('/auth/signup')) {
      const { password: _password, ...input } = route.request().postDataJSON();
      user = input; return reply({ authToken: 'test-token', user });
    }
    if (url.endsWith('/auth/login')) { control.unauthorized = false; return reply({ authToken: 'test-token', user }); }
    if (url.endsWith('/auth/me')) return reply(user);
    if (control.unauthorized) return reply({ message: 'Unauthorized' }, 401);
    if (control.fail) return reply({ message: 'Falha temporária simulada' }, 503);
    if (route.request().method() === 'POST') {
      const operation = route.request().postDataJSON();
      operations.push(operation);
      if (control.hold) await control.hold;
      const table = operation.table;
      rows[table] = [...(rows[table] ?? []).filter(row => row.id !== operation.entity_id), operation.record];
      audits.push({ id: operation.operation_id, entity_type: operation.entity_type, entity_id: operation.entity_id, after_data: operation.payload, timestamp: new Date().toISOString(), scope: operation.record.scope, owner_user_id: user!.id });
      return reply({ ok: true, operation_id: operation.operation_id, entity_id: operation.entity_id });
    }
    if (url.endsWith('/sync/workspaces')) return reply((rows.workspace ?? []).map(row => ({ workspace_id: row.id })));
    return reply({ ...rows, workspace: rows.workspace?.[0], members: rows.workspace_members, preferences: rows.preferences?.[0], audit_logs: audits });
  });
  return { control, operations };
}

async function signup(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await page.getByLabel('Seu nome', { exact: true }).fill('Teste Sync');
  await page.getByLabel('E-mail', { exact: true }).fill('sync@example.invalid');
  await page.getByLabel('Username', { exact: true }).fill('sync_test');
  await page.locator('input[name="password"]').fill('somente-teste-1234');
  await page.getByLabel('Confirmar senha', { exact: true }).fill('somente-teste-1234');
  await page.getByRole('button', { name: 'Criar minha carteira' }).click();
  await expect(page.getByText('Sincronizado', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Ajustes', exact: true }).click();
  await page.getByRole('link', { name: 'Sincronização', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Sincronização com Xano' })).toBeVisible();
}

async function createTransaction(page: Page, name: string) {
  await page.getByRole('button', { name: 'Adicionar lançamento', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Descrição', { exact: true }).fill(name);
  await dialog.getByLabel('Valor (R$)', { exact: true }).fill('12,34');
  await dialog.locator('select[name="categoryId"]').selectOption({ label: 'Mercado' });
  await dialog.getByRole('button', { name: 'Adicionar lançamento', exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function localWallet(page: Page) {
  return page.evaluate(() => new Promise<{ outbox: { entityId: string }[]; transactions: { id: string; name: string }[] }>((resolve, reject) => {
    const request = indexedDB.open('bs-wallet-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const query = database.transaction('wallets').objectStore('wallets').getAll();
      query.onsuccess = () => { resolve(query.result[0]); database.close(); };
    };
  }));
}

test('salva sem aguardar rede, retoma offline e reconecta sessão expirada', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const remote = await backend(page);
  await signup(page);
  let release!: () => void;
  remote.control.hold = new Promise<void>(resolve => { release = resolve; });
  await createTransaction(page, 'Compra online');
  const saved = await localWallet(page);
  const id = saved.transactions.find(tx => tx.name === 'Compra online')!.id;
  expect(saved.outbox.some(change => change.entityId === id)).toBe(true);
  await expect(page.getByText('Sincronizando...', { exact: true }).last()).toBeVisible();
  release(); remote.control.hold = undefined;
  await expect(page.getByText('Alterações pendentes: 0')).toBeVisible();
  expect(remote.operations.some(operation => operation.entity_id === id)).toBe(true);
  await context.setOffline(true);
  await createTransaction(page, 'Compra offline');
  await expect(page.getByText('Modo offline', { exact: true }).last()).toBeVisible();
  expect((await localWallet(page)).outbox).toHaveLength(1);
  await context.setOffline(false);
  await expect(page.getByText('Alterações pendentes: 0')).toBeVisible();
  remote.control.unauthorized = true;
  await page.getByRole('button', { name: 'Sincronizar', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Conectar sua conta' })).toBeVisible();
  await page.locator('input[name="password"]').fill('somente-teste-1234');
  await page.getByRole('button', { name: 'Conectar ao Xano', exact: true }).click();
  await expect(page.getByText('Sincronizado', { exact: true }).last()).toBeVisible();
  expect((await localWallet(page)).transactions).toHaveLength(2);
  expect(errors).toEqual([]);
  if (process.env.SYNC_SCREENSHOT) await page.screenshot({ path: process.env.SYNC_SCREENSHOT, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Sincronização com Xano' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('mostra falha real, conserva pendências e permite nova tentativa manual', async ({ page }) => {
  const remote = await backend(page);
  await signup(page);
  remote.control.fail = true;
  await createTransaction(page, 'Compra com falha');
  await expect(page.getByText('Não foi possível sincronizar', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('Alterações pendentes: 1')).toBeVisible();
  expect((await localWallet(page)).transactions[0].name).toBe('Compra com falha');
  remote.control.fail = false;
  await page.getByRole('button', { name: 'Sincronizar', exact: true }).last().click();
  await expect(page.getByText('Sincronizado', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('Alterações pendentes: 0')).toBeVisible();
});
