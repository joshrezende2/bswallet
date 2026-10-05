import { expect, test, type Page } from '@playwright/test';
import { apiRequest, invitationServer, localWallets, signup } from '../helpers/invitation-server';

// Browser plugin not available: use the repository's Playwright workflow.
// Real production bundle + stateful HTTP double. These tests validate client
// integration/isolation between browsers; they do not certify Xano authorization.
async function transaction(page: Page, name: string, scope: 'shared' | 'personal') {
  await page.locator('header').getByRole('button', { name: 'Adicionar lançamento', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Descrição', { exact: true }).fill(name);
  await dialog.getByLabel('Valor (R$)', { exact: true }).fill('10,00');
  await dialog.locator('select[name="scope"]').selectOption(scope);
  await dialog.locator('select[name="categoryId"]').selectOption({ label: 'Mercado' });
  await dialog.getByRole('button', { name: 'Adicionar lançamento', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Sincronizado', { exact: true }).last()).toBeVisible();
}
async function loginAtInvite(page: Page, email: string) {
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByLabel('E-mail ou username').fill(email);
  await page.locator('input[name="password"]').fill('convites-teste-1234');
  await page.getByRole('button', { name: 'Entrar na minha carteira', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Aceitar convite', exact: true })).toBeVisible();
}

for (const recipient of ['existing', 'signup'] as const) {
  test(`dois navegadores: convite, ${recipient}, bootstrap permissões e isolamento shared/private`, async ({ browser }) => {
    test.setTimeout(90_000);
    const remote = invitationServer();
    const a = await browser.newContext({ serviceWorkers: 'block' }), b = await browser.newContext({ serviceWorkers: 'block' });
    try {
      a.setDefaultTimeout(15000); b.setDefaultTimeout(15000); await remote.attach(a); await remote.attach(b);
      const pageA = await a.newPage(), pageB = await b.newPage(), errors: string[] = [];
      pageA.on('pageerror', error => errors.push(error.message)); pageB.on('pageerror', error => errors.push(error.message));
      if (recipient === 'existing') remote.seedUser('maria@example.invalid');
      await signup(pageA, 'Joseph', 'joseph@example.invalid');
      const workspaceId = (await localWallets(pageA))[0].id;
      await transaction(pageA, 'Compra compartilhada A', 'shared');
      await transaction(pageA, 'Compra privada A', 'personal');
      await pageA.goto('/app/ajustes/membros');
      await expect(pageA.getByRole('heading', { name: 'Convidar membro', exact: true })).toBeVisible();
      await pageA.getByLabel('E-mail do convidado', { exact: true }).fill('maria@example.invalid');
      await pageA.getByRole('combobox', { name: 'Papel do convite', exact: true }).selectOption('member');
      await pageA.getByRole('button', { name: 'Criar convite', exact: true }).click();
      const link = pageA.getByLabel('Link do convite', { exact: true });
      await expect(link).toBeVisible();
      const inviteLink = await link.inputValue();
      expect(new URL(inviteLink).pathname).toMatch(/^\/convite\/.+/);
      expect(remote.invites).toHaveLength(1);
      const chosenPermissions = [...remote.invites[0].permissions];
      await pageB.goto(inviteLink);
      await expect(pageB.getByRole('heading', { name: 'Convite para uma família', exact: true })).toBeVisible();
      await expect(pageB.getByText('Você foi convidado para:', { exact: true })).toBeVisible();
      expect(remote.requests.filter(request => request.path === '/workspace/invites/resolve').at(-1)?.userId).toBeUndefined();
      if (recipient === 'existing') await loginAtInvite(pageB, 'maria@example.invalid');
      else { await signup(pageB, 'Maria', 'maria@example.invalid', true); await expect(pageB.getByRole('button', { name: 'Aceitar convite', exact: true })).toBeVisible(); }
      expect(new URL(pageB.url()).pathname).toBe(new URL(inviteLink).pathname);
      await pageB.getByRole('button', { name: 'Aceitar convite', exact: true }).click();
      await expect(pageB).toHaveURL(/\/app\/resumo$/);
      await expect(pageB.getByLabel('Família ativa')).toHaveValue(workspaceId);
      const maria = remote.users.get('maria@example.invalid')!;
      const joined = (await localWallets(pageB)).find(wallet => wallet.id === workspaceId)!;
      expect(joined.members.find((member: any) => member.userId === maria.id).permissions).toEqual(chosenPermissions);
      expect(joined.transactions.map((row: any) => row.name)).toContain('Compra compartilhada A');
      expect(joined.transactions.map((row: any) => row.name)).not.toContain('Compra privada A');
      expect(remote.rows.workspace_members.filter(row => row.workspace_id === workspaceId && row.user_id === maria.id)).toHaveLength(1);
      expect((await apiRequest(pageB, '/workspace/invites/accept', { token: new URL(inviteLink).pathname.split('/').at(-1) })).status).toBe(410);
      expect(remote.rows.workspace_members.filter(row => row.workspace_id === workspaceId && row.user_id === maria.id)).toHaveLength(1);
      await transaction(pageB, 'Compra compartilhada B', 'shared');
      await transaction(pageB, 'Compra privada B', 'personal');
      await pageA.goto('/app/ajustes/sincronizacao');
      await pageA.getByRole('button', { name: 'Sincronizar', exact: true }).last().click();
      await expect.poll(async () => (await localWallets(pageA)).find(wallet => wallet.id === workspaceId)!.transactions.map((row: any) => row.name)).toContain('Compra compartilhada B');
      expect((await localWallets(pageA)).find(wallet => wallet.id === workspaceId)!.transactions.map((row: any) => row.name)).not.toContain('Compra privada B');
      for (const page of [pageA, pageB]) {
        await expect(page).toHaveTitle(/BS Wallet/);
        await expect(page.locator('vite-error-overlay')).toHaveCount(0);
        expect(JSON.stringify(await localWallets(page))).not.toContain(remote.invites[0].token_hash);
        expect(JSON.stringify(await localWallets(page))).not.toContain(new URL(inviteLink).pathname.split('/').at(-1)!);
      }
      expect(errors).toEqual([]);
      if (process.env.INVITATIONS_SCREENSHOT) await pageB.screenshot({ path: process.env.INVITATIONS_SCREENSHOT, fullPage: true });
    } finally { await Promise.allSettled([a.close(), b.close()]); }
  });
}

test('contrato multiusuário: pending sem link, email incorreto, expiração, revogação, regeneração e escalação', async ({ browser }) => {
  test.setTimeout(90_000);
  const remote = invitationServer(), a = await browser.newContext({ serviceWorkers: 'block' }), b = await browser.newContext({ serviceWorkers: 'block' });
  try {
    a.setDefaultTimeout(15000); b.setDefaultTimeout(15000); await remote.attach(a); await remote.attach(b);
    const pageA = await a.newPage(), pageB = await b.newPage();
    await signup(pageA, 'Joseph', 'joseph@example.invalid');
    const workspaceId = (await localWallets(pageA))[0].id;
    await signup(pageB, 'Maria', 'maria@example.invalid');
    const create = async (email: string) => {
      const response = await apiRequest(pageA, '/workspace/invites/create', { workspace_id: workspaceId, email, role: 'member', permissions: ['shared.read', 'reports.read'] });
      expect(response.status).toBe(200); return response.body;
    };
    expect((await apiRequest(pageA, '/workspace/invites/create', { workspace_id: workspaceId, email: 'other@example.invalid', role: 'admin_master', permissions: [] })).status).toBe(403);
    expect((await apiRequest(pageA, '/workspace/invites/create', { workspace_id: workspaceId, email: 'other@example.invalid', role: 'member', permissions: ['invented.permission'] })).status).toBe(403);
    expect((await apiRequest(pageB, '/workspace/invites/list?workspace_id=' + workspaceId)).status).toBe(403);
    const wrong = await create('someone-else@example.invalid');
    await pageB.goto(`/convite/${wrong.token}`);
    await pageB.getByRole('button', { name: 'Aceitar convite', exact: true }).click();
    await expect(pageB.getByText('Este convite pertence a outro e-mail.', { exact: true })).toBeVisible();
    expect(await pageB.evaluate(() => localStorage.getItem('bs-wallet-xano-token'))).toBeTruthy();
    const expired = await create('expired@example.invalid');
    remote.invites.find(invite => invite.id === expired.invite.id)!.expires_at = Date.now() - 1000;
    await pageB.goto(`/convite/${expired.token}`);
    await expect(pageB.getByRole('heading', { name: 'Convite indisponível', exact: true })).toBeVisible();
    const revoked = await create('revoked@example.invalid');
    expect((await apiRequest(pageA, '/workspace/invites/revoke', { invite_id: revoked.invite.id })).status).toBe(200);
    await pageB.goto(`/convite/${revoked.token}`);
    await expect(pageB.getByRole('heading', { name: 'Convite indisponível', exact: true })).toBeVisible();
    const pending = await create('maria@example.invalid');
    const regenerated = await apiRequest(pageA, '/workspace/invites/regenerate', { invite_id: pending.invite.id });
    expect(regenerated.status).toBe(200);
    expect(regenerated.body.token).not.toBe(pending.token);
    await pageB.goto(`/convite/${pending.token}`);
    await expect(pageB.getByRole('heading', { name: 'Convite indisponível', exact: true })).toBeVisible();
    await pageB.goto('/app/resumo');
    await expect(pageB.getByRole('button', { name: 'Ver convites', exact: true })).toBeVisible();
    await pageB.getByRole('button', { name: 'Ver convites', exact: true }).click();
    await expect(pageB.getByRole('button', { name: 'Aceitar convite', exact: true })).toBeVisible();
    await pageB.getByRole('button', { name: 'Aceitar convite', exact: true }).click();
    await expect(pageB.getByLabel('Família ativa')).toHaveValue(workspaceId);
    const accepted = remote.requests.filter(request => request.path === '/workspace/invites/accept').at(-1)!;
    expect(accepted.data).toEqual({ invite_id: pending.invite.id });
    const listed = await apiRequest(pageA, '/workspace/invites/list?workspace_id=' + workspaceId);
    expect(JSON.stringify(listed.body)).not.toMatch(/token_hash|test-session|"token"/);
    expect(JSON.stringify(remote.audits)).not.toMatch(/token_hash|test-session/);
    const declined = await create('decline@example.invalid');
    const decliner = remote.seedUser('decline@example.invalid');
    expect((await apiRequest(pageB, '/workspace/invites/decline', { token: declined.token }, `test-session-${decliner.id}`)).status).toBe(200);
    expect(remote.invites.find(invite => invite.id === declined.invite.id)?.status).toBe('declined');
  } finally { await Promise.allSettled([a.close(), b.close()]); }
});



