import { expect, test } from '@playwright/test';
import { invitationServer, localWallets, signup } from '../helpers/invitation-server';

// Browser plugin not available: use the repository's Playwright workflow.
test('desktop usa checkboxes, protege duplicidades e registra cartão de débito na conta', async ({ browser }) => {
  test.setTimeout(90_000);
  const remote = invitationServer();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  try {
    await remote.attach(context);
    const page = await context.newPage();
    await page.goto('/');
    await signup(page, 'Teste Desktop', 'desktop@example.invalid');

    await page.goto('/app/ajustes/pessoas');
    await page.getByRole('button', { name: /Adicionar pessoa|Começar cadastro/ }).first().click();
    const personDialog = page.getByRole('dialog');
    await expect(personDialog.getByRole('group', { name: 'Categorias permitidas' })).toBeVisible();
    await expect(personDialog.locator('select[name="allowedCategoryIds"]')).toHaveCount(0);
    await expect(personDialog.getByRole('checkbox', { name: 'Mercado' })).toBeVisible();
    expect(await personDialog.locator('input[name="allowedCategoryIds"]:checked').count()).toBeGreaterThan(20);
    await expect(personDialog.getByLabel('Perfil')).toHaveValue('adult');
    await personDialog.getByLabel('Nome').fill('Pessoa removível');
    await personDialog.getByLabel('Perfil').selectOption('child');
    if (process.env.CATALOG_SCREENSHOT) await page.screenshot({ path: process.env.CATALOG_SCREENSHOT, fullPage: false });
    await personDialog.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(personDialog).toBeHidden();
    const personRow = page.locator('.catalog-row').filter({ hasText: 'Pessoa removível' });
    await expect(personRow.getByRole('button', { name: 'Excluir Pessoa removível' })).toBeEnabled();

    await page.goto('/app/ajustes/categorias');
    await page.getByRole('button', { name: /Adicionar categoria|Começar cadastro/ }).first().click();
    const categoryDialog = page.getByRole('dialog');
    expect(await categoryDialog.locator('input[name="icon"]').count()).toBeGreaterThan(20);
    await categoryDialog.getByLabel('Nome').fill(' mercado ');
    await categoryDialog.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(categoryDialog.getByRole('alert')).toContainText('Já existe uma categoria');
    await categoryDialog.getByRole('button', { name: 'Fechar' }).click();
    await page.getByRole('button', { name: /Adicionar categoria/ }).first().click();
    const newCategoryDialog = page.getByRole('dialog');
    await newCategoryDialog.getByLabel('Nome').fill('Mobilidade elétrica');
    await newCategoryDialog.getByTitle('Energia').click();
    await newCategoryDialog.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(newCategoryDialog).toBeHidden();

    await page.goto('/app/ajustes/contas');
    await page.getByRole('button', { name: /Adicionar conta|Começar cadastro/ }).first().click();
    const accountDialog = page.getByRole('dialog');
    await accountDialog.getByLabel('Nome').fill('Conta Débito');
    await accountDialog.getByLabel('Instituição').fill('Banco Teste');
    await accountDialog.getByLabel('Saldo inicial (R$)').fill('1.250,50');
    await accountDialog.getByLabel('Data do saldo inicial').fill('2026-10-01');
    await accountDialog.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(accountDialog).toBeHidden();

    await page.goto('/app/cartoes');
    await page.getByRole('button', { name: /Adicionar (primeiro )?cartão/ }).first().click();
    const cardDialog = page.getByRole('dialog');
    await cardDialog.getByLabel('Nome').fill('Cartão Débito');
    await cardDialog.getByLabel('Tipo do cartão').selectOption('debit');
    await cardDialog.getByLabel('Banco').fill('Banco Teste');
    await cardDialog.getByLabel('Últimos 4 dígitos').fill('4321');
    await cardDialog.getByLabel('Titular').selectOption({ index: 1 });
    await cardDialog.getByLabel('Conta debitada').selectOption({ label: 'Conta Débito' });
    await expect(cardDialog.getByLabel('Limite total (R$)')).toHaveCount(0);
    if (process.env.DEBIT_CARD_SCREENSHOT) await page.screenshot({ path: process.env.DEBIT_CARD_SCREENSHOT, fullPage: false });
    await cardDialog.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(cardDialog).toBeHidden();
    await expect(page.getByText('Conta debitada', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Registrar compra', exact: true }).first().click();
    const transactionDialog = page.getByRole('dialog');
    await transactionDialog.getByLabel('Descrição').fill('Compra no débito');
    await transactionDialog.getByLabel('Valor (R$)').fill('25,00');
    await transactionDialog.getByLabel('Categoria').selectOption({ label: 'Mercado' });
    await expect(transactionDialog.getByLabel('Conta debitada')).toHaveValue('Conta Débito');
    await transactionDialog.getByRole('button', { name: 'Adicionar lançamento', exact: true }).click();
    await expect(transactionDialog).toBeHidden();

    const wallets = await localWallets(page);
    const wallet = wallets[0];
    const debitCard = wallet.cards.find((current: any) => current.name === 'Cartão Débito');
    const purchase = wallet.transactions.find((current: any) => current.name === 'Compra no débito');
    const savedPerson = wallet.people.find((current: any) => current.name === 'Pessoa removível');
    const savedCategory = wallet.categories.find((current: any) => current.name === 'Mobilidade elétrica');
    const savedAccount = wallet.accounts.find((current: any) => current.name === 'Conta Débito');
    expect(savedPerson.type).toBe('child');
    expect(savedPerson.allowedCategoryIds).toContain(savedCategory.id);
    expect(savedAccount).toMatchObject({ initialBalance: 125050, initialBalanceDate: '2026-10-01' });
    expect(debitCard.cardType).toBe('debit');
    expect(purchase).toMatchObject({ cardId: debitCard.id, accountId: debitCard.accountId });
    expect(purchase.invoiceId).toBeUndefined();
  } finally {
    await context.close();
  }
});
