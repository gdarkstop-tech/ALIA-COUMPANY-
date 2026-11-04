import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiSession, DEMO_PASSWORD, shot, submitSignIn } from './helpers';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByTestId('admin-email').fill(email);
  await page.getByTestId('admin-password').fill(DEMO_PASSWORD);
  await submitSignIn(page, 'admin-submit');
}

/**
 * Flow E-F — AI Finance Center (ADR 0018). Development data: no real provider is configured, so
 * every cost is the simulator's (never money) and the revenue sources say they are not connected;
 * the console says what the numbers leave out and offers no way to move money. A provider invoice
 * entered by the administrator appears in the reconciliation. Other staff do not see finance.
 */
test.describe.serial('Flow E-F — AI Finance Center', () => {
  test('EF1 — administrator sees honest AI costs, budget, unconnected revenue sources and no payouts', async ({ page }) => {
    await login(page, 'admin.demo@demo.ghayarly.test');
    await page.getByTestId('nav-finance').click();
    await expect(page.getByTestId('finance-spend')).toBeVisible();
    await expect(page.getByTestId('finance-budget-state')).toHaveAttribute('data-state', /NO_BUDGET|OK|WARNING|PROJECTED_OVER|EXCEEDED/);
    for (const s of ['APP_STORE', 'GOOGLE_PLAY', 'CARD_PAYMENTS']) await expect(page.getByTestId(`finance-source-${s}`)).toContainText('Not configured');
    await expect(page.getByTestId('finance-net')).toContainText('Not calculated');
    for (const code of ['NO_STORE_PROCEEDS', 'NO_FX_CONVERSION', 'OTHER_COSTS_NOT_TRACKED', 'NO_PAYOUTS']) await expect(page.locator(`[data-code="${code}"]`)).toBeVisible();
    await expect(page.getByRole('button', { name: /payout|withdraw|transfer/i })).toHaveCount(0);
    await page.getByTestId('finance-period-7').click();
    await expect(page.getByTestId('finance-period')).toContainText('Last 7 days');
    await page.waitForTimeout(600);
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
    await shot(page, 'EF1-finance-center');
  });

  test('EF2 — a provider invoice is recorded and reconciled against metering', async ({ page }) => {
    await login(page, 'admin.demo@demo.ghayarly.test');
    await page.goto('/finance');
    const now = new Date();
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const month = `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, '0')}`;
    const ref = `E2E-INV-${Date.now().toString(36)}`;
    await page.getByTestId('finance-invoice-provider').selectOption('ANTHROPIC');
    await page.getByTestId('finance-invoice-month').fill(month);
    await page.getByTestId('finance-invoice-amount').fill('12.5');
    await page.getByTestId('finance-invoice-reference').fill(ref);
    await page.getByTestId('finance-invoice-submit').click();
    await expect(page.getByTestId('finance-invoice-saved')).toBeVisible();
    const row = page.getByTestId('finance-reconciliation-row').filter({ hasText: ref });
    await expect(row).toContainText(month);
    await expect(row).toContainText('$12.50');
    await shot(page, 'EF2-finance-reconciliation');
  });

  test('EF3 — staff without the finance permission see no finance data', async ({ page }) => {
    await login(page, 'wound.researcher@demo.ghayarly.test');
    await expect(page.getByTestId('nav-wounds')).toBeVisible();
    await expect(page.getByTestId('nav-finance')).toHaveCount(0);
    await page.goto('/finance');
    await expect(page.getByTestId('finance-no-permission')).toBeVisible();
    const researcher = await apiSession('wound.researcher@demo.ghayarly.test', DEMO_PASSWORD);
    expect((await researcher.get('/v1/admin/finance/overview')).status()).toBe(403);
  });
});
