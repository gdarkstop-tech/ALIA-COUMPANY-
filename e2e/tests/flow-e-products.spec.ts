import { expect, test } from '@playwright/test';
import { apiSession, approvedIndication, archiveProduct, DEMO_PASSWORD, liveProduct, shot, submitSignIn } from './helpers';

/**
 * Flow E5 — TetraSol knowledge and the keyword engine: a keyword the admin proposed is approved by a
 * different person, a clinical reviewer, in the console; the engine tester then shows which product
 * and approved indication a message would surface.
 */
test('Flow E5 — a clinical reviewer approves a proposed keyword and tests the keyword engine', async ({ page }) => {
  const admin = await apiSession('admin.demo@demo.ghayarly.test', DEMO_PASSWORD);
  const reviewer = await apiSession('reviewer.demo@demo.ghayarly.test', DEMO_PASSWORD);
  const product = await liveProduct(admin, reviewer, 'kw');
  const indication = await approvedIndication(admin, reviewer, product.id);
  const term = `pressure sore ${Date.now().toString(36)}`;
  expect((await admin.post('/v1/admin/product-knowledge/keywords', { data: { productId: product.id, indicationId: indication, term, locale: 'en', variant: 'SYNONYM' } })).ok()).toBeTruthy();

  try {
    await page.goto('/login');
    await page.getByTestId('admin-email').fill('reviewer.demo@demo.ghayarly.test');
    await page.getByTestId('admin-password').fill(DEMO_PASSWORD);
    await submitSignIn(page, 'admin-submit');
    await page.getByTestId('nav-ai').click();
    await page.getByTestId('ai-tab-products').click();
    await page.getByTestId('pk-product').selectOption(product.id);
    await expect(page.getByTestId('pk-flag-note')).toContainText('OFF');
    await expect(page.getByTestId('pk-entry-INDICATION-APPROVED')).toContainText('Superficial pressure ulcers');

    // Pending: the engine does not use it yet.
    await page.getByTestId('pk-engine-input').fill(`My father has a ${term} on his heel`);
    await page.getByTestId('pk-engine-run').click();
    await expect(page.getByTestId('pk-engine-results')).toContainText('No product would be offered');

    const row = page.getByTestId(`pk-keyword-${term}`);
    await expect(row).toContainText('Awaiting clinical review');
    await page.getByTestId(`pk-keyword-approve-${term}`).click();
    await expect(row).toContainText('Approved');
    await expect(row).toContainText('Active');

    await page.getByTestId('pk-engine-run').click();
    await expect(page.getByTestId('pk-engine-results')).toContainText(`${product.nameEn} — matched “${term}”`);
    await expect(page.getByTestId('pk-engine-results')).toContainText('Approved use: Superficial pressure ulcers (v1)');
    await shot(page, 'E22-tetrasol-knowledge');
  } finally {
    await archiveProduct(admin, product.id);
  }
});
