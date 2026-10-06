import { expect, test } from '@playwright/test';
import { invitationServer, signup } from '../helpers/invitation-server';

// Browser plugin not available: use the repository's Playwright workflow.
test('formulários de criação mobile contêm a data e bloqueiam zoom apenas enquanto abertos', async ({ browser }) => {
  const remote = invitationServer();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  try {
    await remote.attach(context);
    const page = await context.newPage();
    await page.goto('/');
    await signup(page, 'Teste Mobile', 'mobile@example.invalid', true);
    await expect(page).toHaveURL(/\/app\/resumo$/);

    const initialViewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(initialViewport).not.toContain('user-scalable=no');

    await page.getByRole('button', { name: 'Adicionar lançamento', exact: true }).click();
    const transactionDialog = page.getByRole('dialog');
    const date = transactionDialog.locator('input[type="date"]');
    await expect(transactionDialog).toBeVisible();
    await expect.poll(() => page.locator('meta[name="viewport"]').getAttribute('content')).toContain('user-scalable=no');
    const bounds = await date.evaluate(element => {
      const input = element.getBoundingClientRect();
      const container = element.closest('.modal-inner')!.getBoundingClientRect();
      return { inputLeft: input.left, inputRight: input.right, containerLeft: container.left, containerRight: container.right, documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth };
    });
    expect(bounds.inputLeft).toBeGreaterThanOrEqual(bounds.containerLeft);
    expect(bounds.inputRight).toBeLessThanOrEqual(bounds.containerRight);
    expect(bounds.documentWidth).toBeLessThanOrEqual(bounds.viewportWidth);
    if (process.env.MOBILE_FORMS_SCREENSHOT) await page.screenshot({ path: process.env.MOBILE_FORMS_SCREENSHOT, fullPage: false });

    await transactionDialog.getByRole('button', { name: 'Fechar' }).click();
    await expect(transactionDialog).toBeHidden();
    await expect.poll(() => page.locator('meta[name="viewport"]').getAttribute('content')).toBe(initialViewport);

    await page.goto('/app/ajustes/pessoas');
    await page.getByRole('button', { name: /Adicionar pessoa|Começar cadastro/ }).first().click();
    const personDialog = page.getByRole('dialog');
    await expect(personDialog).toBeVisible();
    await expect.poll(() => page.locator('meta[name="viewport"]').getAttribute('content')).toContain('user-scalable=no');
    await personDialog.getByRole('button', { name: 'Fechar' }).click();
    await expect.poll(() => page.locator('meta[name="viewport"]').getAttribute('content')).toBe(initialViewport);

    await page.getByRole('button', { name: /Notificações/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await page.locator('meta[name="viewport"]').getAttribute('content')).toBe(initialViewport);
  } finally {
    await context.close();
  }
});
