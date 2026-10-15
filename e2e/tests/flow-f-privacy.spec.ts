import { expect, test } from '@playwright/test';
import { API_URL, apiSession, byId, grantConsentsApi, shot, signInMobile, unique } from './helpers';

/**
 * Flow F — Privacy & account deletion (App Store 5.1.1(v) / Google Play account deletion):
 * Privacy center → pause & resume health-data consent → Delete account (password + typed
 * confirmation) → back at Welcome → the old credentials no longer work.
 */
test('Flow F — privacy center and in-app account deletion', async ({ page }) => {
  const email = unique('flow-f');
  const password = 'E2e-Password-2026';
  const api = await apiSession(email, password, { signUp: true, name: 'Privacy Tester' });
  await api.post('/v1/me/roles', { data: { role: 'PATIENT' } });
  await grantConsentsApi(api, true);
  const created = await api.post('/v1/patients', {
    data: { displayName: 'Privacy Tester', dateOfBirth: '1991-02-02', sex: 'FEMALE', relationship: 'SELF', consentBasis: 'SELF', consentAttested: true, consentStatementVersion: 'v1' },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  await api.post('/v1/me/onboarding/complete');

  await signInMobile(page, email, password);
  await byId(page, 'tab-me').click();
  await byId(page, 'open-privacy').click();
  await expect(byId(page, 'privacy-center')).toBeVisible();
  await expect(byId(page, 'health-consent-switch')).toBeVisible();
  await shot(page, 'F01-privacy-center');

  // Pause health records (confirmation sheet), then resume.
  await byId(page, 'health-consent-switch').click();
  await byId(page, 'confirm-pause-health').click();
  await expect(byId(page, 'health-paused-notice')).toBeVisible();
  await shot(page, 'F02-health-paused');
  await byId(page, 'health-consent-switch').click();
  await expect(byId(page, 'health-paused-notice')).toBeHidden();

  // Legal documents are readable in-app.
  await byId(page, 'open-privacy-policy').click();
  await expect(byId(page, 'legal-privacy')).toBeVisible();
  await page.goBack();

  // Delete account.
  await byId(page, 'open-delete-account').click();
  await expect(byId(page, 'delete-account')).toBeVisible();
  await expect(byId(page, 'delete-submit')).toHaveAttribute('aria-disabled', 'true');
  await byId(page, 'delete-password').fill('wrong-password-123');
  await byId(page, 'delete-confirm').fill('delete');
  await byId(page, 'delete-submit').click();
  await expect(byId(page, 'delete-error')).toBeVisible();
  await shot(page, 'F03-delete-wrong-password');
  await byId(page, 'delete-password').fill(password);
  await byId(page, 'delete-submit').click();
  await expect(byId(page, 'welcome-screen')).toBeVisible();
  await shot(page, 'F04-deleted-back-at-welcome');

  // Old credentials are gone.
  const ctx = await (await import('@playwright/test')).request.newContext({ baseURL: API_URL, extraHTTPHeaders: { origin: 'http://localhost:8081' } });
  const res = await ctx.post('/api/auth/sign-in/email', { data: { email, password } });
  expect(res.ok()).toBeFalsy();
});
