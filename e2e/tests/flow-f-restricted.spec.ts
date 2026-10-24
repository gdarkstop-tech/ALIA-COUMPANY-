import { expect, test } from '@playwright/test';
import { apiSession, byId, DEMO_PASSWORD, grantConsentsApi, shot, signInMobile, unique } from './helpers';

/** A suspended person signing in to the app sees why, until when, and how to appeal — nothing else. */
test('Flow F — a suspended account sees the restriction screen and can appeal', async ({ page }) => {
  const email = unique('flow-f-restricted');
  const password = 'E2e-Password-2026';
  const person = await apiSession(email, password, { signUp: true, name: 'Restricted Tester' });
  await grantConsentsApi(person, true);
  expect((await person.post('/v1/me/roles', { data: { role: 'PATIENT' } })).ok()).toBeTruthy();
  const userId = (await (await person.get('/v1/me')).json()).user.id as string;

  const admin = await apiSession('admin.demo@demo.ghayarly.test', DEMO_PASSWORD);
  const res = await admin.post(`/v1/admin/users/${userId}/status`, {
    data: { action: 'SUSPEND', reason: 'SAFETY_CONCERN', publicMessage: 'Your account is paused while we check a safety report.', staffNote: 'E2E suspension for the app flow' },
  });
  expect(res.ok(), await res.text()).toBeTruthy();

  await signInMobile(page, email, password);
  await expect(byId(page, 'account-restricted')).toBeVisible();
  await expect(byId(page, 'restricted-message')).toContainText('safety report');
  // Deep links into the app do not get around it.
  await page.goto('/patient/health');
  await expect(byId(page, 'account-restricted')).toBeVisible();
  await byId(page, 'appeal-message').fill('I think this report was about someone else.');
  await byId(page, 'appeal-submit').click();
  await expect(byId(page, 'appeal-pending')).toBeVisible();
  await shot(page, 'F10-account-restricted');
});
