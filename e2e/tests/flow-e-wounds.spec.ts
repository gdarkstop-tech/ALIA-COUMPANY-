import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { apiSession, createSelfProfile, DEMO_PASSWORD, shot, syntheticJpeg, WOUND_CONSENT_VERSION as V, woundCleanSlate } from './helpers';

const TESTER = 'wound.tester@demo.ghayarly.test';
const CLINICIAN = 'clinician.tester@demo.ghayarly.test';
const PRESENTER = 'wound.presenter@demo.ghayarly.test';
const APPROVER = 'wound.approver@demo.ghayarly.test';
const RESEARCHER = 'wound.researcher@demo.ghayarly.test';
const REVIEWER = 'wound.reviewer@demo.ghayarly.test';
const ADMIN = 'admin.demo@demo.ghayarly.test';
type Api = Awaited<ReturnType<typeof apiSession>>;

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByTestId('admin-email').fill(email);
  await page.getByTestId('admin-password').fill(DEMO_PASSWORD);
  await page.getByTestId('admin-submit').click();
  await expect(page.getByTestId('nav-wounds')).toBeVisible();
}

async function axe(page: Page, name: string) {
  await page.waitForTimeout(800);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`);
  expect(blocking, `${name}: axe`).toEqual([]);
}

/**
 * Flow E-W — Wound Intelligence Registry console, pre-launch: every wound flag stays OFF, so the
 * seeded INTERNAL_TEST staff work on the internal tester's test data only. Presentation: nominate
 * → prepare → the person approves that exact version → a different approver checks it → export of
 * that version only. Research: build → clinical quality review → freeze. Administrators see counts
 * only. Withdrawal closes the presentation at once.
 */
test.describe('Flow E-W — wound registry console (internal test data only)', () => {
  let tester: Api;
  let patientId = '';
  let caseId = '';
  let presentationId = '';
  let datasetId = '';

  test.beforeAll(async ({ browser }) => {
    tester = await apiSession(TESTER, DEMO_PASSWORD);
    patientId = await createSelfProfile(tester, 'Wound Internal Tester');
    await woundCleanSlate(tester, patientId);
    const grant = async (data: object) => {
      const r = await tester.post(`/v1/patients/${patientId}/wound-permissions`, { data: { action: 'GRANT', version: V, ...data } });
      expect(r.ok(), await r.text()).toBeTruthy();
    };
    await grant({ purpose: 'SCAN' });
    await grant({ purpose: 'RESEARCH', scope: { purposes: ['HEALING_TRAJECTORIES', 'PRODUCT_OUTCOMES'], recipients: ['DMW_CLINICAL_RESEARCH'] } });
    await grant({ purpose: 'PRESENTATION', scope: { audiences: ['INTERNAL_TRAINING'], organizations: ['ALIA_GROUP'] } });
    const cs = await tester.post('/v1/wounds', { data: { patientId, label: 'Right heel (E2E)', bodySite: 'HEEL', bodySide: 'RIGHT', reportedCategory: 'DIABETIC_FOOT' } });
    expect(cs.ok(), await cs.text()).toBeTruthy();
    caseId = (await cs.json()).id;
    const page = await browser.newPage();
    for (const [daysAgo, hue] of [[10, 30], [3, 210]] as const) {
      const up = await tester.post(`/v1/wounds/${caseId}/images`, { data: { contentType: 'image/jpeg', dataBase64: (await syntheticJpeg(page, hue)).toString('base64'), capturedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString() } });
      expect(up.ok(), await up.text()).toBeTruthy();
    }
    await page.close();
    // The clinician confirms type and outcome through a share that includes wounds.
    const clinician = await apiSession(CLINICIAN, DEMO_PASSWORD);
    const me = await (await clinician.get('/v1/me')).json();
    const share = await tester.post('/v1/care-shares', { data: { patientId, providerUserId: me.user.id, days: 7, aiAllowed: false } });
    expect(share.ok(), await share.text()).toBeTruthy();
    expect((await tester.post(`/v1/care-shares/${(await share.json()).id}/wounds`, { data: { allowed: true } })).ok()).toBeTruthy();
    expect((await clinician.post(`/v1/wounds/${caseId}/clinical`, { data: { category: 'DIABETIC_FOOT', diabetes: 'YES' } })).ok()).toBeTruthy();
    expect((await clinician.post(`/v1/wounds/${caseId}/outcome`, { data: { outcome: 'IMPROVING', on: new Date().toISOString().slice(0, 10) } })).ok()).toBeTruthy();
  });

  test.afterAll(async () => {
    if (datasetId) await (await apiSession(RESEARCHER, DEMO_PASSWORD)).post(`/v1/admin/wounds/datasets/${datasetId}/retire`, { data: {} });
    if (patientId) await woundCleanSlate(tester, patientId);
  });

  test('EW1 — counts-only overview; nominate and prepare an exact version for the person', async ({ page }) => {
    await login(page, PRESENTER);
    await page.getByTestId('nav-wounds').click();
    await expect(page.getByTestId('wound-counts-only')).toBeVisible();
    await expect(page.getByTestId('wound-overview')).toBeVisible();
    await expect(page.locator('main img')).toHaveCount(0);
    for (const k of ['wound.registry', 'wound.research_export', 'wound.presentation_export']) await expect(page.getByTestId(`wound-flag-${k}`)).toHaveText(`${k}: OFF`);
    await axe(page, 'registry overview');

    await page.getByTestId('wound-tab-presentations').click();
    await expect(page.getByTestId('presentation-candidates')).toBeVisible();
    await expect(page.getByText('Wound Internal Tester')).toHaveCount(0);
    await page.getByTestId('presentation-candidate').first().getByTestId('presentation-nominate').click();
    await expect(page.getByTestId('presentation-prepare')).toBeVisible();
    presentationId = page.url().split('/').pop()!;
    await expect(page.getByTestId('presentation-permitted')).toContainText('INTERNAL_TRAINING');
    await page.getByTestId('prepare-title').fill('Diabetic foot ulcer — two-week follow-up');
    await page.getByTestId('prepare-summary-en').fill('A heel ulcer followed with regular dressing changes; the outcome shown is the one confirmed by the clinician.');
    await page.getByTestId('prepare-summary-ar').fill('قرحة في الكعب تمت متابعتها مع تغيير الضماد بانتظام؛ النتيجة المعروضة هي التي أكدها المختص.');
    // Text that could point to the person (a word of their name) is refused by the server.
    await page.getByTestId('prepare-scope').fill('Training for the Internal Tester team only');
    const photos = page.getByTestId('prepare-photo');
    await expect(photos).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      const p = photos.nth(i);
      await expect(p.locator('img')).toBeVisible();
      await p.getByTestId('prepare-include').check();
      await p.getByTestId('prepare-caption-en').fill(`Follow-up photo ${i + 1}`);
      await p.getByTestId('prepare-caption-ar').fill(`صورة متابعة ${i + 1}`);
    }
    await axe(page, 'prepare presentation');
    await page.getByTestId('prepare-send').click();
    await expect(page.getByTestId('wound-error')).toHaveAttribute('data-code', 'PRESENTATION_TEXT_IDENTIFIES');
    await expect(page.getByTestId('wound-error')).toContainText('could identify the person');
    await page.getByTestId('prepare-scope').fill('Nurse training sessions at Alia Group only');
    await page.getByTestId('prepare-send').click();
    await expect(page.getByTestId('presentation-status')).toHaveText('Awaiting the person');
    await expect(page.getByTestId('presentation-awaiting')).toBeVisible();
    await shot(page, 'EW01-presentation-prepared');
  });

  test('EW2 — the person approves that version; the preparer cannot be the second approver', async ({ page }) => {
    const requests = (await (await tester.get(`/v1/patients/${patientId}/wound-presentations`)).json()) as { id: string; requestHash: string; images: unknown[] }[];
    const req = requests.find((r) => r.id === presentationId)!;
    expect(req.images).toHaveLength(2);
    expect((await tester.post(`/v1/wound-presentations/${presentationId}/decision`, { data: { decision: 'APPROVE', requestHash: req.requestHash } })).ok()).toBeTruthy();

    await login(page, PRESENTER);
    await page.goto(`/wounds/presentations/${presentationId}`);
    await expect(page.getByTestId('presentation-status')).toHaveText('Person approved — needs second approval');
    await expect(page.getByTestId('approve-same-person')).toBeVisible();
    await expect(page.getByTestId('approve-submit')).toBeDisabled();
  });

  test('EW3 — a second approver checks de-identification; only the approved version is exported', async ({ page }) => {
    await login(page, APPROVER);
    await page.goto(`/wounds/presentations/${presentationId}`);
    await expect(page.getByTestId('presentation-version')).toBeVisible();
    await expect(page.getByTestId('version-photo')).toHaveCount(2);
    for (const k of ['noFace', 'noIdentifyingMarks', 'noJewelleryOrTattoos', 'noBackgroundDetails', 'noNamesDatesOrNumbers', 'outcomeClinicianConfirmed']) await page.getByTestId(`check-${k}`).check();
    await expect(page.getByTestId('approve-submit')).toBeDisabled();
    await page.getByTestId('check-noEfficacyClaims').check();
    await page.getByTestId('approve-submit').click();
    await expect(page.getByTestId('presentation-status')).toHaveText('Approved');
    await expect(page.getByTestId('presentation-export-state')).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByTestId('export-pdf').click();
    const file = await (await download).path();
    const pdf = readFileSync(file);
    expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect(pdf.toString('latin1')).not.toContain('Wound Internal Tester');
    await expect(page.getByTestId('export-history')).toContainText('PDF');
    await axe(page, 'approved presentation');
    await shot(page, 'EW02-presentation-approved');
  });

  test('EW4 — research: build, clinical quality review, freeze; analytics are aggregates only', async ({ page, browser }) => {
    await login(page, RESEARCHER);
    await page.getByTestId('nav-wounds').click();
    await page.getByTestId('wound-tab-research').click();
    const name = `E2E healing ${Date.now().toString(36)}`;
    await page.getByTestId('dataset-name').fill(name);
    await page.getByTestId('dataset-purpose').selectOption('HEALING_TRAJECTORIES');
    await page.getByTestId('dataset-recipient').selectOption('DMW_CLINICAL_RESEARCH');
    await page.getByTestId('dataset-create').click();
    await page.getByTestId(`wound-dataset-${name}`).getByRole('link').click();
    await expect(page.getByTestId('wound-dataset-detail')).toBeVisible();
    datasetId = page.url().split('/').pop()!;
    await page.getByTestId('dataset-build').click();
    await expect(page.getByTestId('dataset-built')).toBeVisible();
    const item = page.locator('[data-testid^="research-item-"]').first();
    await expect(item).toBeVisible();
    await expect(page.getByText('Wound Internal Tester')).toHaveCount(0);
    await expect(item.getByTestId('research-item-snapshot')).not.toContainText(caseId);

    // A different person — a clinical reviewer — accepts the item.
    const reviewerPage = await browser.newPage({ baseURL: page.url().split('/wounds')[0] });
    await login(reviewerPage, REVIEWER);
    await reviewerPage.goto(`/wounds/research/${datasetId}`);
    await reviewerPage.locator('[data-testid^="research-item-"]').first().getByTestId('research-accept').click();
    await expect(reviewerPage.locator('[data-testid^="research-item-"]').first().getByTestId('research-item-status')).toHaveText('Accepted');
    await reviewerPage.close();

    await page.reload();
    await page.getByTestId('dataset-approval').fill('TEST-ONLY — E2E, not an ethics approval');
    await page.getByTestId('dataset-retention').fill(new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10));
    await page.getByTestId('dataset-freeze').click();
    await expect(page.getByTestId('dataset-status')).toHaveText('Frozen');

    await page.getByTestId('wound-tab-outcomes').click();
    await expect(page.getByTestId('research-analytics')).toBeVisible();
    await expect(page.getByTestId('outcomes-note')).toBeVisible();
    await expect(page.locator('main img')).toHaveCount(0);
    await axe(page, 'outcomes and analytics');
    await shot(page, 'EW03-research-analytics');
  });

  test('EW5 — an administrator sees counts only: no presentation, research or photo access', async ({ page }) => {
    await login(page, ADMIN);
    await page.getByTestId('nav-wounds').click();
    await expect(page.getByTestId('wound-overview')).toBeVisible();
    await expect(page.getByTestId('wound-tab-presentations')).toHaveCount(0);
    await expect(page.getByTestId('wound-tab-outcomes')).toHaveCount(0);
    await page.goto('/wounds/presentations');
    await expect(page.getByTestId('wound-no-permission')).toBeVisible();
    const admin = await apiSession(ADMIN, DEMO_PASSWORD);
    expect((await admin.get(`/v1/admin/wounds/presentations/${presentationId}`)).status()).toBe(403);
    // The demo administrator is also a clinical reviewer, but never sees test-data datasets.
    expect([403, 404]).toContain((await admin.get(`/v1/admin/wounds/datasets/${datasetId}`)).status());
    expect((await admin.get(`/v1/wounds/${caseId}`)).status()).toBe(404);
  });

  test('EW6 — the person withdraws presentations: the approved case closes and cannot be exported', async ({ page }) => {
    expect((await tester.post(`/v1/patients/${patientId}/wound-permissions`, { data: { purpose: 'PRESENTATION', action: 'WITHDRAW', version: V } })).ok()).toBeTruthy();
    await login(page, APPROVER);
    await page.goto(`/wounds/presentations/${presentationId}`);
    await expect(page.getByTestId('presentation-status')).toHaveText('Withdrawn');
    await expect(page.getByTestId('presentation-export')).toHaveCount(0);
    const approver = await apiSession(APPROVER, DEMO_PASSWORD);
    const refused = await approver.post(`/v1/admin/wounds/presentations/${presentationId}/export`, { data: { format: 'PDF' } });
    expect(refused.status()).not.toBe(200);
    expect((await refused.json()).error.code).toBe('PRESENTATION_NOT_APPROVED');
    await shot(page, 'EW04-presentation-withdrawn');
  });
});
