import { expect, test } from '@playwright/test';
import { DEMO_PASSWORD, shot, submitSignIn } from './helpers';

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
  await submitSignIn(page, 'admin-submit');
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

  // Curated knowledge workspace.
  await page.getByTestId('ai-tab-knowledge').click();
  await expect(page.getByTestId('knowledge-new')).toBeVisible();

  // Reported answers queue (clinical reviewers and Trust & Safety).
  await page.getByTestId('ai-tab-safety').click();
  await expect(page.getByTestId('ai-reports')).toBeVisible();
  await shot(page, 'E24-ai-safety');
});

/**
 * Flow E4b — provider kill switch: the development simulator can be disabled only with a reason;
 * it then shows as DISABLED and the AI assistant has no model for anyone; re-enabling restores it.
 * (The simulator stands in for a real provider here: no real provider is configured in development.)
 */
test('Flow E4b — a provider is disabled with a reason and re-enabled', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('admin-email').fill('admin.demo@demo.ghayarly.test');
  await page.getByTestId('admin-password').fill(DEMO_PASSWORD);
  await submitSignIn(page, 'admin-submit');
  await page.getByTestId('nav-ai').click();
  await expect(page.getByTestId('ai-provider-state-SIMULATED')).toHaveAttribute('data-state', 'CONFIGURED');
  await expect(page.getByTestId('ai-provider-state-ANTHROPIC')).toHaveAttribute('data-state', 'NOT_CONFIGURED');
  await page.getByTestId('ai-provider-disable-SIMULATED').click();
  await page.getByTestId('ai-provider-disable-reason-SIMULATED').fill('E2E kill-switch drill');
  try {
    await page.getByTestId('ai-provider-disable-confirm-SIMULATED').click();
    await expect(page.getByTestId('ai-provider-state-SIMULATED')).toHaveAttribute('data-state', 'DISABLED');
    await expect(page.getByTestId('ai-provider-SIMULATED')).toContainText('E2E kill-switch drill');
    await shot(page, 'E25-ai-provider-disabled');
  } finally {
    // Always restore the simulator for the other flows.
    await page.getByTestId('ai-provider-enable-SIMULATED').click();
  }
  await expect(page.getByTestId('ai-provider-state-SIMULATED')).toHaveAttribute('data-state', 'CONFIGURED');
});
