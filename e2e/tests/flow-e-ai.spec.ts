import { expect, test } from '@playwright/test';
import { DEMO_PASSWORD, shot } from './helpers';

/**
 * Flow E4 — AI control centre: providers without a backend key are reported as NOT_CONFIGURED with
 * setup instructions (keys are never entered in the console), and no spending cap means paid models
 * are blocked.
 */
test('Flow E4 — AI control centre reports unconfigured providers honestly', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('admin-email').fill('admin.demo@demo.ghayarly.test');
  await page.getByTestId('admin-password').fill(DEMO_PASSWORD);
  await page.getByTestId('admin-submit').click();
  await page.getByTestId('nav-ai').click();

  for (const code of ['ANTHROPIC', 'OPENAI', 'GEMINI']) {
    await expect(page.getByTestId(`ai-provider-${code}`)).toContainText('NOT_CONFIGURED');
  }
  await expect(page.getByTestId('ai-provider-ANTHROPIC')).toContainText('AI_ANTHROPIC_API_KEY');
  await expect(page.getByTestId('ai-setup-instructions')).toBeVisible();
  await expect(page.getByTestId('ai-month-limit')).toContainText('Not set');
  // Reference prices are seeded unverified, so the paid models cannot be active.
  await expect(page.getByTestId('ai-model-claude-opus-5-5')).toContainText('Not verified');
  await expect(page.getByTestId('ai-model-claude-opus-5-5')).toContainText('Inactive');
  await expect(page.getByTestId('ai-route-patient.chat')).toBeVisible();
  await shot(page, 'E20-ai-control-centre');
});
