import { expect, test } from '@playwright/test';
import { byId, shot, signInMobile } from './helpers';

test.use({ locale: 'ar-EG' });

/** Arabic is the default language: the document is RTL and core screens render Arabic copy. */
test('Arabic RTL experience', async ({ page }) => {
  await page.goto('/welcome');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(byId(page, 'welcome-get-started')).toContainText('إنشاء حساب');
  await shot(page, 'R01-welcome-ar');

  await signInMobile(page, 'patient.demo@demo.ghayarly.test');
  await expect(byId(page, 'patient-home')).toBeVisible();
  await expect(byId(page, 'home-greeting')).toContainText('سلمى');
  await shot(page, 'R02-home-ar');

  // Switching to English flips direction without reload on web.
  await byId(page, 'tab-me').click();
  await byId(page, 'locale-switch-en').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await byId(page, 'locale-switch-ar').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});
