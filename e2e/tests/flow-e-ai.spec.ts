import { expect, test } from '@playwright/test';
import { DEMO_PASSWORD, shot } from './helpers';

/**
 * Flow E4 — AI control centre: providers without a backend key are reported as NOT_CONFIGURED with
 * setup instructions (keys are never entered in the console), and no spending cap means paid models
 * are blocked; models are inactive, unverified and not approved for patient data; evaluation cases
 * are drafts awaiting clinical review.
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
  await expect(page.getByTestId('ai-provider-QWEN')).toContainText('AI_QWEN_API_KEY + AI_QWEN_BASE_URL');
  await expect(page.getByTestId('ai-provider-MEDGEMMA')).toContainText('NOT_CONFIGURED');
  await expect(page.getByTestId('ai-setup-instructions')).toBeVisible();
  await expect(page.getByTestId('ai-month-limit')).toContainText('Not set');
  await shot(page, 'E20-ai-control-centre');

  // Reference prices are seeded unverified and without patient-data approval, so nothing is active.
  await page.getByTestId('ai-tab-models').click();
  for (const id of ['claude-opus-5-5', 'grok-4.3', 'google/medgemma-1.5-4b-it']) {
    await expect(page.getByTestId(`ai-model-${id}`)).toContainText('Not verified');
    await expect(page.getByTestId(`ai-model-${id}`)).toContainText('Inactive');
    await expect(page.getByTestId(`ai-model-data-${id}`)).toContainText('Not approved for patient data');
  }
  await expect(page.getByTestId('ai-model-google/medgemma-1.5-4b-it')).toContainText('Medical model');
  await shot(page, 'E21-ai-models');

  // Routing explains why each candidate would be skipped for real patients.
  await page.getByTestId('ai-tab-routing').click();
  await expect(page.getByTestId('ai-candidate-BASIC-claude-opus-5-5')).toContainText('Model inactive');
  await expect(page.getByTestId('ai-candidate-BASIC-claude-opus-5-5')).toContainText('No clinical approval');
  await shot(page, 'E22-ai-routing');

  // Evaluation cases are drafts until a clinical reviewer reviews them.
  await page.getByTestId('ai-tab-evaluation').click();
  await expect(page.getByTestId('ai-case-EN-EMERG-CHEST')).toContainText('Draft');
  await expect(page.getByTestId('ai-case-AR-EMERG-CHEST')).toBeVisible();
  await shot(page, 'E23-ai-evaluation');

  // Reported answers queue (clinical reviewers and Trust & Safety).
  await page.getByTestId('ai-tab-safety').click();
  await expect(page.getByTestId('ai-reports')).toBeVisible();
  await shot(page, 'E24-ai-safety');
});
