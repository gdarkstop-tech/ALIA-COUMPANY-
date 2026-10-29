import { expect, test } from '@playwright/test';
import { apiSession, DEMO_PASSWORD, grantConsentsApi, shot, submitSignIn, unique } from './helpers';

/**
 * Flow E3 — Admin user management: find a patient → suspend with a reason, a message for the
 * person and an internal note → the person is signed out everywhere, sees only the restriction,
 * can appeal, and their records are kept.
 */
test('Flow E3 — admin suspends an account; the person is signed out and can appeal', async ({ page }) => {
  const email = unique('flow-e3');
  const password = 'E2e-Password-2026';
  const person = await apiSession(email, password, { signUp: true, name: 'Suspension Tester' });
  await grantConsentsApi(person, true);
  expect((await person.post('/v1/me/roles', { data: { role: 'PATIENT' } })).ok()).toBeTruthy();

  await page.goto('/login');
  await page.getByTestId('admin-email').fill('admin.demo@demo.ghayarly.test');
  await page.getByTestId('admin-password').fill(DEMO_PASSWORD);
  await submitSignIn(page, 'admin-submit');
  await page.getByTestId('nav-users').click();
  await page.getByTestId('users-search').fill(email);
  await page.getByTestId(`open-user-${email}`).click();
  await expect(page.getByTestId('user-summary')).toContainText(email);

  await page.getByTestId('status-action').selectOption('SUSPEND');
  await page.getByTestId('status-public').fill('Your account is paused while we review a report.');
  await page.getByTestId('status-note').fill('E2E: report reviewed by trust & safety');
  await page.getByTestId('status-apply').click();
  await expect(page.getByTestId('account-status').first()).toHaveText('Suspended');
  await expect(page.getByTestId('status-history')).toContainText('E2E: report reviewed');
  await shot(page, 'E20-user-suspended');

  // The old session is gone; signing in again shows only the restriction, and an appeal is possible.
  expect((await person.get('/v1/me')).status()).toBe(401);
  const again = await apiSession(email, password);
  const me = await (await again.get('/v1/me')).json();
  expect(me.account).toMatchObject({ status: 'SUSPENDED', publicMessage: 'Your account is paused while we review a report.' });
  expect((await again.get('/v1/patients')).status()).toBe(403);
  const appeal = await again.post('/v1/me/appeals', { data: { message: 'Please review — this was a misunderstanding.' } });
  expect(appeal.status()).toBe(201);
});
