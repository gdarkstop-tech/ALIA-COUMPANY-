import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiSession, byId, createSelfProfile, DEMO_PASSWORD, shot, signInMobile, syntheticJpeg, woundCleanSlate } from './helpers';

const TESTER = 'wound.tester@demo.ghayarly.test';
const CLINICIAN = 'clinician.tester@demo.ghayarly.test';
type Api = Awaited<ReturnType<typeof apiSession>>;

/** No serious or critical WCAG 2.2 A/AA violation on the screen as rendered. */
async function axe(page: Page, name: string) {
  await page.waitForTimeout(1200);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`);
  expect(blocking, `${name}: axe`).toEqual([]);
}

async function choosePhoto(page: Page, hue: number) {
  const jpg = await syntheticJpeg(page, hue);
  const chooser = page.waitForEvent('filechooser');
  await byId(page, 'wound-choose-photo').click();
  await (await chooser).setFiles({ name: `synthetic-${hue}.jpg`, mimeType: 'image/jpeg', buffer: jpg });
}

/**
 * Flow G — Wound Scan, pre-launch. `wound.registry` stays OFF (regulated), so the seeded
 * INTERNAL_TEST account uses it on test data only. The person allows scanning (A) and leaves
 * research (B) and presentations (C) off; scanning works fully; a clinician sees the case only
 * through a share that includes wounds; withdrawing A stops new photos at once.
 */
test.describe('Flow G — Wound Scan with separate permissions (internal test account)', () => {
  let tester: Api;
  let patientId = '';
  let caseId = '';

  test.beforeAll(async () => {
    tester = await apiSession(TESTER, DEMO_PASSWORD);
    patientId = await createSelfProfile(tester, 'Wound Internal Tester');
    await woundCleanSlate(tester, patientId);
  });
  test.afterAll(async () => {
    if (patientId) await woundCleanSlate(tester, patientId);
  });

  test('G1 — allow scanning only, refuse research and presentations, scan a wound', async ({ page }) => {
    await signInMobile(page, TESTER);
    await expect(byId(page, 'tab-health')).toBeVisible();

    // Privacy Center → Wound data permissions: three separate choices, none preselected.
    await page.goto('/settings/privacy');
    await byId(page, 'open-wound-permissions-privacy').click();
    await expect(byId(page, 'wound-permissions')).toBeVisible();
    for (const p of ['SCAN', 'RESEARCH', 'PRESENTATION']) await expect(byId(page, `wound-permission-${p}-status`)).toHaveText(/off/i);
    await axe(page, 'wound permissions');
    await shot(page, 'G01-wound-permissions-none');
    await byId(page, 'wound-permission-SCAN-allow').click();
    await expect(byId(page, 'wound-permission-SCAN-status')).toHaveText(/on/i);
    // Research and presentations stay off — and that blocks nothing.
    await expect(byId(page, 'wound-permission-RESEARCH-status')).toHaveText(/off/i);
    await expect(byId(page, 'wound-permission-PRESENTATION-status')).toHaveText(/off/i);
    const perms = await (await tester.get(`/v1/patients/${patientId}/wound-permissions`)).json();
    expect(perms.consents.map((c: { purpose: string; active: boolean }) => [c.purpose, c.active])).toEqual([['SCAN', true], ['RESEARCH', false], ['PRESENTATION', false]]);

    // A new wound case, two photos through the system file picker.
    await page.goto('/patient/wounds');
    await byId(page, 'wound-add').click();
    await byId(page, 'wound-label').fill('Left heel (E2E)');
    await byId(page, 'wound-site').click();
    await byId(page, 'wound-site-option-HEEL').click();
    await byId(page, 'wound-category').click();
    await byId(page, 'wound-category-option-DIABETIC_FOOT').click();
    await byId(page, 'wound-create').click();
    await expect(byId(page, 'wound-detail')).toBeVisible();
    caseId = page.url().split('/').pop()!;
    await choosePhoto(page, 20);
    await expect(byId(page, 'wound-photo-day-1')).toBeVisible();
    await choosePhoto(page, 200);
    await expect(page.getByTestId('wound-photo-day-1').filter({ visible: true })).toHaveCount(2);
    // No AI result of any kind; the type is the person's report until a clinician confirms it.
    await expect(byId(page, 'wound-ai-off')).toBeVisible();
    await expect(byId(page, 'wound-not-reviewed')).toBeVisible();
    await axe(page, 'wound case');
    await shot(page, 'G02-wound-case');
    const detail = await (await tester.get(`/v1/wounds/${caseId}`)).json();
    expect(detail.images).toHaveLength(2);
    expect(detail.images.every((i: { metadataRemoved: string[] }) => Array.isArray(i.metadataRemoved))).toBeTruthy();
  });

  test('G2 — a clinician sees the case only through a share that includes wounds', async ({ page }) => {
    const clinician = await apiSession(CLINICIAN, DEMO_PASSWORD);
    const me = await (await clinician.get('/v1/me')).json();
    // A share without wounds: the clinician sees the profile, not the wounds.
    const share = await tester.post('/v1/care-shares', { data: { patientId, providerUserId: me.user.id, days: 7, aiAllowed: false } });
    expect(share.ok(), await share.text()).toBeTruthy();
    const shareId = (await share.json()).id as string;
    expect((await clinician.get(`/v1/wounds/${caseId}`)).status()).toBe(404);
    expect((await tester.post(`/v1/care-shares/${shareId}/wounds`, { data: { allowed: true } })).ok()).toBeTruthy();

    await signInMobile(page, CLINICIAN);
    await page.waitForURL((u) => !u.pathname.includes('sign-in'));
    await page.goto(`/clinician/patient/${patientId}`);
    await expect(byId(page, 'clinician-wounds')).toBeVisible();
    await byId(page, 'clinician-wound-Left heel (E2E)').click();
    await expect(byId(page, 'clinician-wound')).toBeVisible();
    await expect(page.getByTestId('wound-photo-day-1').filter({ visible: true })).toHaveCount(2);
    // Classification is the clinician's (never from a photo by software).
    await byId(page, 'wound-confirm-category').click();
    await byId(page, 'wound-clinical-category').click();
    await byId(page, 'wound-clinical-category-option-DIABETIC_FOOT').click();
    await byId(page, 'wound-clinical-save').click();
    await expect(byId(page, 'wound-clinical-badge')).toBeVisible();
    await shot(page, 'G03-clinician-wound');
    // Wounds switched off in the share: access ends at once.
    expect((await tester.post(`/v1/care-shares/${shareId}/wounds`, { data: { allowed: false } })).ok()).toBeTruthy();
    expect((await clinician.get(`/v1/wounds/${caseId}`)).status()).toBe(404);
  });

  test('G3 — withdrawing scanning stops new photos; the person keeps their record', async ({ page }) => {
    await signInMobile(page, TESTER);
    await expect(byId(page, 'tab-health')).toBeVisible();
    await page.goto('/patient/wounds/permissions');
    page.once('dialog', (d) => void d.accept());
    await byId(page, 'wound-permission-SCAN-withdraw').click();
    await expect(byId(page, 'wound-permission-SCAN-status')).toHaveText(/off/i);
    await page.goto(`/patient/wounds/${caseId}`);
    await expect(byId(page, 'wound-detail')).toBeVisible();
    await expect(page.getByTestId('wound-photo-day-1').filter({ visible: true })).toHaveCount(2);
    await expect(page.getByTestId('wound-choose-photo').filter({ visible: true })).toHaveCount(0);
    await expect(byId(page, 'wound-scan-off')).toBeVisible();
    const refused = await tester.post(`/v1/wounds/${caseId}/images`, { data: { contentType: 'image/jpeg', dataBase64: (await syntheticJpeg(page, 90)).toString('base64') } });
    expect(refused.status()).toBe(403);
    expect((await refused.json()).error.code).toBe('WOUND_SCAN_CONSENT_REQUIRED');
    await shot(page, 'G04-scan-withdrawn');
  });
});
