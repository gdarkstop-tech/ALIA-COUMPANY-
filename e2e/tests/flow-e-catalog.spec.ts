import { expect, test } from '@playwright/test';
import { DEMO_PASSWORD, shot } from './helpers';

/**
 * Flow E2 — Admin catalogue: sign in → Catalogue → create a product draft → the console shows it
 * awaiting review, refuses to publish unapproved content, and tells the author that someone else
 * must approve what they wrote (separation of duties is enforced by the database).
 */
test('Flow E2 — admin creates a product draft that cannot be self-approved or published', async ({ page }) => {
  const slug = `e2e-product-${Date.now().toString(36)}`;
  await page.goto('/login');
  await page.getByTestId('admin-email').fill('admin.demo@demo.ghayarly.test');
  await page.getByTestId('admin-password').fill(DEMO_PASSWORD);
  await page.getByTestId('admin-submit').click();
  await page.getByTestId('nav-catalog').click();
  await expect(page.getByTestId('catalog-table')).toBeVisible();
  await shot(page, 'E10-catalog-list');

  await page.getByTestId('catalog-new').click();
  await page.locator('#slug').fill(slug);
  const fields: [string, string][] = [
    ['content-nameEn', 'E2E dressing'],
    ['content-nameAr', 'ضماد تجريبي'],
    ['content-summaryEn', 'Synthetic test product'],
    ['content-summaryAr', 'منتج اختبار مُصطنع'],
    ['content-descriptionEn', 'Created by the end-to-end suite.'],
    ['content-descriptionAr', 'أنشأته اختبارات النظام.'],
    ['content-usageEn', 'Not for use.'],
    ['content-usageAr', 'ليس للاستخدام.'],
  ];
  for (const [id, value] of fields) await page.getByTestId(id).fill(value);
  await page.getByTestId('catalog-create').click();

  await expect(page.getByTestId('approval-card')).toBeVisible();
  await expect(page.getByTestId('approval-card')).toContainText('Awaiting approval');
  await expect(page.getByTestId('edited-by-you')).toBeVisible();
  await expect(page.getByTestId('publish')).toBeDisabled();
  await shot(page, 'E11-product-draft');

  // Back in the list, the draft is filed under "Awaiting review".
  await page.getByTestId('catalog-tab-products').click();
  await page.getByTestId('catalog-filter-PENDING_REVIEW').click();
  await expect(page.getByTestId(`catalog-row-${slug}`)).toBeVisible();
});
