import { expect, test } from '@playwright/test';
import { API_URL, apiSession, byId, createSelfProfile, grantConsentsApi, honourRateLimits, shot, signInMobile, unique } from './helpers';

/**
 * Flow F — Privacy & account deletion (App Store 5.1.1(v) / Google Play account deletion):
 * Privacy center → pause & resume health-data consent → Delete account (password + typed
 * confirmation) → back at Welcome → the old credentials no longer work.
 */
test('Flow F — privacy center and in-app account deletion', async ({ page }) => {
  const email = unique('flow-f');
  const password = 'E2e-Password-2026';
  const api = await apiSession(email, password, { signUp: true, name: 'Privacy Tester' });
  await grantConsentsApi(api, true);
  expect((await api.post('/v1/me/roles', { data: { role: 'PATIENT' } })).ok()).toBeTruthy();
  await createSelfProfile(api, 'Privacy Tester');
  expect((await api.post('/v1/me/onboarding/complete')).ok()).toBeTruthy();

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
  const ctx = honourRateLimits(await (await import('@playwright/test')).request.newContext({ baseURL: API_URL, extraHTTPHeaders: { origin: 'http://localhost:8081' } }));
  const res = await ctx.post('/api/auth/sign-in/email', { data: { email, password } });
  expect(res.status()).toBe(401);
  expect((await res.json()).code).toBe('INVALID_EMAIL_OR_PASSWORD');
});

/** A deep link straight into the patient area must not skip the Terms / Privacy consent gate. */
test('Flow F — deep links cannot skip the consent gate', async ({ page }) => {
  const email = unique('flow-f-gate');
  const password = 'E2e-Password-2026';
  const api = await apiSession(email, password, { signUp: true, name: 'Gate Tester' });
  // Without the consents the API itself refuses to assign a role (server-side gate)…
  const blocked = await api.post('/v1/me/roles', { data: { role: 'PATIENT' } });
  expect(blocked.status()).toBe(403);
  expect((await blocked.json()).error.code).toBe('CONSENT_REQUIRED');

  await signInMobile(page, email, password);
  await expect(byId(page, 'consent-gate')).toBeVisible();
  await page.goto('/patient/health');
  await expect(byId(page, 'consent-gate')).toBeVisible();
  await expect(byId(page, 'my-health')).toHaveCount(0);
});
