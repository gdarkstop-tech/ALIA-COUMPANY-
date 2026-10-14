import { expect, test } from '@playwright/test';
import { byId, shot, signInMobile } from './helpers';

/** Flow C — Nurse: Sign in → Nurse Dashboard → View Services → Change Availability → View Earnings UI. */
test('Flow C — nurse services, availability and net earnings', async ({ page }) => {
  await signInMobile(page, 'nurse.demo@demo.ghayarly.test');
  await expect(byId(page, 'clinician-dashboard')).toBeVisible();
  await expect(byId(page, 'earnings-card')).toBeVisible();
  await shot(page, 'C01-nurse-dashboard');

  // Services: toggle a service on, save, then off again (repeatable).
  await byId(page, 'tab-services').click();
  await expect(byId(page, 'services-screen')).toBeVisible();
  await expect(byId(page, 'service-WOUND_DRESSING')).toBeVisible();
  // RN-web renders <Switch> as a wrapper around a native checkbox input.
  const toggle = byId(page, 'service-toggle-CHRONIC_MONITORING').locator('input[type="checkbox"]');
  const before = await toggle.isChecked();
  await toggle.click();
  await byId(page, 'save-services').click();
  await expect(byId(page, 'toast')).toContainText('Services updated');
  await shot(page, 'C02-services');
  await toggle.click();
  expect(await toggle.isChecked()).toBe(before);
  await byId(page, 'save-services').click();

  // Change availability.
  await byId(page, 'tab-availability').click();
  await byId(page, 'status-AVAILABLE_NOW').click();
  await expect(byId(page, 'status-AVAILABLE_NOW')).toHaveAttribute('aria-checked', 'true');
  await shot(page, 'C03-nurse-availability');
  await byId(page, 'status-AVAILABLE_TODAY').click();
  await expect(byId(page, 'status-AVAILABLE_TODAY')).toHaveAttribute('aria-checked', 'true');

  // Earnings UI — net amounts; synthetic ledger is explicitly labelled.
  await byId(page, 'tab-earnings').click();
  await expect(byId(page, 'earnings-screen')).toBeVisible();
  await expect(byId(page, 'earned-today')).toContainText('2,350');
  await expect(byId(page, 'earnings-demo-notice')).toBeVisible();
  await expect(byId(page, 'earnings-available')).toContainText('8,750');
  await shot(page, 'C04-earnings');
});
