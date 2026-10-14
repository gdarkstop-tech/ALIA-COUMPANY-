import { expect, test } from '@playwright/test';
import { apiSession, byId, DEMO_PASSWORD, shot, signInMobile } from './helpers';

/**
 * Flow B — Doctor: Sign in → Doctor Dashboard → View Verification State → Edit Availability →
 * Stop Accepting New Patients. Verifies persistence (reload) and that patients see the change.
 */
test('Flow B — doctor controls verification visibility and capacity', async ({ page }) => {
  await signInMobile(page, 'doctor.demo@demo.ghayarly.test');
  await expect(byId(page, 'clinician-dashboard')).toBeVisible();
  await expect(byId(page, 'verification-status-badge')).toHaveText('Verified');
  await shot(page, 'B01-doctor-dashboard');

  await byId(page, 'tab-verification').click();
  await expect(byId(page, 'verification-status')).toHaveText('Verified');
  await expect(byId(page, 'credential-MEDICAL_LICENSE')).toContainText('Verified');
  await shot(page, 'B02-verification-state');

  await byId(page, 'tab-availability').click();
  await expect(byId(page, 'availability-screen')).toBeVisible();
  // Idempotent start: make sure the doctor is accepting new patients.
  if (await byId(page, 'resume-new-patients').isVisible().catch(() => false)) {
    await byId(page, 'resume-new-patients').click();
    await expect(byId(page, 'stop-new-patients')).toBeVisible();
  }
  // Edit availability: capacity per day.
  await byId(page, 'max-daily').getByLabel('+').click();
  await byId(page, 'save-capacity').click();
  await expect(byId(page, 'toast')).toBeVisible();
  await shot(page, 'B03-availability');

  // Stop accepting new patients.
  await byId(page, 'stop-new-patients').click();
  await expect(byId(page, 'resume-new-patients')).toBeVisible();
  await expect(byId(page, 'status-EXISTING_PATIENTS_ONLY')).toHaveAttribute('aria-checked', 'true');
  await shot(page, 'B04-stopped-new-patients');

  // Persisted server-side (fresh page load).
  await page.reload();
  await byId(page, 'tab-availability').click();
  await expect(byId(page, 'resume-new-patients')).toBeVisible();

  // Patients still discover the doctor but see they are not accepting new patients.
  const patient = await apiSession('patient.demo@demo.ghayarly.test', DEMO_PASSWORD);
  const list = await (await patient.get('/v1/providers?type=DOCTOR')).json();
  const ahmed = list.find((p: { displayNameEn: string }) => p.displayNameEn === 'Dr. Ahmed Fathy');
  expect(ahmed.availabilityStatus).toBe('EXISTING_PATIENTS_ONLY');
  expect(ahmed.acceptingNewPatients).toBe(false);
  await patient.dispose();

  // Restore for repeatable runs.
  await byId(page, 'resume-new-patients').click();
  await expect(byId(page, 'stop-new-patients')).toBeVisible();
});
