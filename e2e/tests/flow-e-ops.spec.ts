import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { DEMO_PASSWORD, shot, submitSignIn } from './helpers';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByTestId('admin-email').fill(email);
  await page.getByTestId('admin-password').fill(DEMO_PASSWORD);
  await submitSignIn(page, 'admin-submit');
}

async function axe(page: Page) {
  await page.waitForTimeout(500);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
}

/**
 * Flow E-O — Operations Center (Phase 8 M6). Development data: booking and checkout are switched
 * off and no payment, e-mail or SMS provider is configured, so the console must say so instead of
 * showing invented activity. Every section renders for the administrator, in English and Arabic,
 * without serious accessibility violations; staff without operations permissions do not see it.
 */
test.describe.serial('Flow E-O — Operations Center', () => {
  test('EO1 — overview and care sections: real provider setup, honest provider states', async ({ page }) => {
    await login(page, 'admin.demo@demo.ghayarly.test');
    await page.getByTestId('nav-ops').click();
    await expect(page.getByTestId('ops-note')).toBeVisible();
    await expect(page.getByTestId('ops-overview-incidents')).toBeVisible();
    await expect(page.getByTestId('ops-overview-care')).toBeVisible();
    await expect(page.getByTestId('ops-gateway-status')).toContainText('Not configured');
    await axe(page);
    await shot(page, 'EO1-ops-overview');

    await page.getByTestId('ops-tab-schedules').click();
    await expect(page.getByTestId('ops-schedules')).toContainText('Dr. Ahmed Fathy');
    await expect(page.getByTestId('ops-schedules')).toContainText('Mariam Adel');
    await page.getByTestId('ops-schedules-type-NURSE').click();
    await expect(page.getByTestId('ops-schedules')).not.toContainText('Dr. Ahmed Fathy');
    await axe(page);
    await shot(page, 'EO1-ops-schedules');

    await page.getByTestId('ops-tab-home-visits').click();
    await expect(page.getByTestId('ops-not-emergency')).toContainText('123');
    await expect(page.getByTestId('ops-regions')).toBeVisible();
    await page.getByTestId('ops-tab-appointments').click();
    await expect(page.getByTestId('ops-appointments')).toBeVisible();
    await page.getByTestId('ops-tab-notifications').click();
    await expect(page.getByTestId('ops-delivery-providers')).toBeVisible();
    await page.getByTestId('ops-tab-incidents').click();
    await expect(page.getByTestId('ops-incidents')).toBeVisible();
  });

  test('EO2 — commerce sections: orders, delivery zones (all off), payments not configured, no reconcile', async ({ page }) => {
    await login(page, 'admin.demo@demo.ghayarly.test');
    await page.goto('/ops/orders');
    await expect(page.getByTestId('ops-orders')).toBeVisible();
    await page.getByTestId('ops-tab-delivery').click();
    await expect(page.getByTestId('ops-zone-CAIRO')).toBeVisible();
    await expect(page.getByTestId('ops-zone-active-CAIRO')).not.toBeChecked();
    await axe(page);
    await page.getByTestId('ops-tab-payments').click();
    await expect(page.getByTestId('ops-gateway-status')).toContainText('Not configured');
    await expect(page.getByTestId('ops-gateway-reason')).toContainText('keys are not set');
    await expect(page.getByTestId('ops-reconcile')).toBeDisabled();
    await expect(page.getByTestId('ops-refund-queue')).toBeVisible();
    await axe(page);
    await shot(page, 'EO2-ops-payments');
  });

  test('EO3 — Arabic, right to left', async ({ page }) => {
    await login(page, 'admin.demo@demo.ghayarly.test');
    await page.goto('/ops');
    await page.getByTestId('admin-locale').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('ops-note')).toContainText('لا تظهر هنا أي سجلات طبية');
    await page.getByTestId('ops-tab-schedules').click();
    await expect(page.getByTestId('ops-schedules')).toBeVisible();
    await axe(page);
    await shot(page, 'EO3-ops-arabic');
    await page.getByTestId('admin-locale').click();
  });

  test('EO4 — a clinical reviewer has no operations access', async ({ page }) => {
    await login(page, 'reviewer.demo@demo.ghayarly.test');
    await expect(page.getByTestId('nav-ops')).toHaveCount(0);
    await page.goto('/ops/orders');
    await expect(page.getByTestId('ops-no-permission')).toBeVisible();
    await expect(page.getByTestId('ops-orders')).toHaveCount(0);
  });
});
