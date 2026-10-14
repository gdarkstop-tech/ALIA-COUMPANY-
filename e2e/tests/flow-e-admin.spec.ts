import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiSession, DEMO_PASSWORD, shot, unique } from './helpers';

async function createSubmission(type: 'DOCTOR' | 'NURSE', nameEn: string): Promise<{ api: APIRequestContext; userId: string }> {
  const api = await apiSession(unique(`flow-e-${type.toLowerCase()}`), 'E2e-Password-2026', { signUp: true, name: nameEn });
  expect((await api.post('/v1/me/roles', { data: { role: type } })).ok()).toBeTruthy();
  const profile = await api.put('/v1/provider/me', {
    data: {
      providerType: type,
      displayNameAr: type === 'DOCTOR' ? 'د. مراجعة' : 'ممرضة مراجعة',
      displayNameEn: nameEn,
      gender: 'FEMALE',
      ...(type === 'DOCTOR' ? { specialty: 'DERMATOLOGY' } : {}),
      yearsExperience: 9,
      governorate: 'GIZA',
      city: 'Dokki',
      feePiasters: 55000,
    },
  });
  expect(profile.ok(), await profile.text()).toBeTruthy();
  const kinds = type === 'DOCTOR' ? ['NATIONAL_ID', 'MEDICAL_LICENSE', 'MEDICAL_DEGREE'] : ['NATIONAL_ID', 'NURSING_LICENSE'];
  for (const kind of kinds) {
    expect((await api.post('/v1/provider/me/credentials', { data: { kind, issuer: 'E2E Synthetic Authority', identifier: `E2E-${kind}` } })).ok()).toBeTruthy();
  }
  const submitted = await api.post('/v1/provider/me/submit', { data: {} });
  expect(submitted.ok(), await submitted.text()).toBeTruthy();
  const me = await (await api.get('/v1/me')).json();
  return { api, userId: me.user.id };
}

/**
 * Flow E — Admin: Sign in → Provider Verification Queue → Review Credential Submission →
 * Approve / Reject according to the authorized workflow (credentials first, reasons required).
 */
test('Flow E — admin reviews credentials and decides', async ({ page }) => {
  const stamp = Date.now().toString(36).toUpperCase();
  const doctor = await createSubmission('DOCTOR', `Dr. Review ${stamp}`);
  const nurse = await createSubmission('NURSE', `Nurse Review ${stamp}`);

  await page.goto('/login');
  await page.getByTestId('admin-email').fill('admin.demo@demo.ghayarly.test');
  await page.getByTestId('admin-password').fill(DEMO_PASSWORD);
  await shot(page, 'E01-admin-login');
  await page.getByTestId('admin-submit').click();
  await expect(page.getByTestId('stat-open')).toBeVisible();
  await expect(page.getByTestId('mfa-warning')).toBeVisible(); // MFA not enrolled → visible warning (enforced in production)
  await shot(page, 'E02-admin-overview');

  await page.getByTestId('nav-verification').click();
  await expect(page.getByTestId('queue-table')).toBeVisible();
  await expect(page.getByTestId(`queue-row-${doctor.userId}`)).toBeVisible();
  await shot(page, 'E03-verification-queue');

  // ---- Approve the doctor: all required credentials must be verified first.
  await page.getByTestId(`queue-row-${doctor.userId}`).click();
  await expect(page.getByTestId('submission')).toBeVisible();
  await expect(page.getByTestId('cred-MEDICAL_LICENSE')).toContainText('E2E-MEDICAL_LICENSE');
  await page.getByTestId('decision-START_REVIEW').click();
  await expect(page.getByTestId('status-badge').first()).toHaveText('Under clinical review');
  await expect(page.getByTestId('missing-credentials')).toBeVisible();
  await page.getByTestId('decision-APPROVE').click();
  await expect(page.getByTestId('decision-error')).toContainText('REQUIRED_CREDENTIALS_NOT_APPROVED');
  await shot(page, 'E04-approval-blocked');
  for (const kind of ['NATIONAL_ID', 'MEDICAL_LICENSE', 'MEDICAL_DEGREE']) {
    await page.getByTestId(`approve-cred-${kind}`).click();
    await expect(page.getByTestId(`cred-${kind}`)).toContainText('Verified');
  }
  await expect(page.getByTestId('missing-credentials')).toBeHidden();
  await page.getByTestId('decision-APPROVE').click();
  await expect(page.getByTestId('status-badge').first()).toHaveText('Verified');
  await expect(page.getByTestId('history')).toContainText('Verified');
  await shot(page, 'E05-doctor-approved');

  // The approved doctor is now discoverable by patients; the licence number is not exposed.
  const patient = await apiSession('patient.demo@demo.ghayarly.test', DEMO_PASSWORD);
  const detail = await patient.get(`/v1/providers/${doctor.userId}`);
  expect(detail.ok()).toBeTruthy();
  expect(await detail.text()).not.toContain('E2E-MEDICAL_LICENSE');
  await patient.dispose();

  // ---- Reject the nurse: a written reason is mandatory.
  await page.goto(`/verification/${encodeURIComponent(nurse.userId)}`);
  await expect(page.getByTestId('submission')).toBeVisible();
  await expect(page.getByTestId('decision-REJECT')).toBeDisabled();
  await page.getByTestId('decision-reason').fill('Nursing licence number could not be matched with the issuing authority.');
  await page.getByTestId('decision-REJECT').click();
  await expect(page.getByTestId('status-badge').first()).toHaveText('Not approved');
  await shot(page, 'E06-nurse-rejected');

  // The provider sees the decision and the reviewer's note.
  const nurseMe = await (await nurse.api.get('/v1/provider/me')).json();
  expect(nurseMe.profile.verificationStatus).toBe('REJECTED');
  expect(nurseMe.profile.verificationNote).toContain('could not be matched');

  // Every decision is in the audit log.
  await page.getByTestId('nav-audit').click();
  await expect(page.getByTestId('audit-table')).toContainText('provider.verification.approved');
  await expect(page.getByTestId('audit-table')).toContainText('provider.verification.rejected');
  await shot(page, 'E07-audit-log');

  await doctor.api.dispose();
  await nurse.api.dispose();
});
