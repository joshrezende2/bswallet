import { expect, test, type Page } from '@playwright/test';
import { invitationServer, signup } from '../helpers/invitation-server';

async function addTransaction(page: Page, name: string, amount: string, status: 'confirmed' | 'forecast') {
  await page.locator('header').getByRole('button', { name: 'Adicionar lançamento', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Descrição').fill(name);
  await dialog.getByLabel('Valor (R$)').fill(amount);
  await dialog.getByLabel('Categoria').selectOption({ label: 'Mercado' });
  await dialog.getByLabel('Status').selectOption(status);
  await dialog.getByRole('button', { name: 'Adicionar lançamento', exact: true }).click();
  await expect(dialog).toBeHidden();
}

// Browser plugin not available: use the repository's Playwright workflow.
test('histórico ordena pelos cabeçalhos e mostra o status junto do valor', async ({ browser }) => {
  const remote = invitationServer();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  try {
    await remote.attach(context);
    const page = await context.newPage();
    await page.goto('/');
    await signup(page, 'Teste Histórico', 'history@example.invalid', true);
    await addTransaction(page, 'Zebra', '10,00', 'confirmed');
    await addTransaction(page, 'Alfa', '20,00', 'forecast');
    await page.goto('/app/historico');

    const table = page.locator('.transaction-table');
    await expect(table.getByText('Confirmado', { exact: true })).toBeVisible();
    await expect(table.getByText('Previsão', { exact: true })).toBeVisible();
    await table.getByRole('button', { name: /Descrição/ }).click();
    await expect(table.locator('.transaction-name').first()).toContainText('Alfa');
    await table.getByRole('button', { name: /Descrição/ }).click();
    await expect(table.locator('.transaction-name').first()).toContainText('Zebra');
    await table.getByRole('button', { name: /Valor/ }).click();
    await expect(table.locator('.transaction-name').first()).toContainText('Alfa');
    await expect(table.getByRole('columnheader', { name: /Valor/ })).toHaveAttribute('aria-sort', 'descending');
    if (process.env.HISTORY_SCREENSHOT) await page.screenshot({ path: process.env.HISTORY_SCREENSHOT, fullPage: false });
  } finally {
    await context.close();
  }
});
