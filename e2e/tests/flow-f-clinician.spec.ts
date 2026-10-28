import { expect, test } from '@playwright/test';
import { apiSession, byId, createSelfProfile, DEMO_PASSWORD, grantConsentsApi, shot, signInMobile } from './helpers';

const PATIENT = 'ai.tester@demo.ghayarly.test';
const CLINICIAN = 'clinician.tester@demo.ghayarly.test';
const ADMIN = 'admin.demo@demo.ghayarly.test';
type Candidate = { id: string; tier: string; modelId: string };
type Route = { key: string; enabled: boolean; candidates: Candidate[] };
type Session = Awaited<ReturnType<typeof apiSession>>;

/**
 * Flow F8 — Record sharing and the clinician documentation copilot. An internal-test patient shares
 * their (test) record with the internal-test doctor for 7 days and allows AI help — internal-test
 * accounts only ever exchange test data; the doctor accepts the clinician terms, writes notes, gets
 * a labelled draft (`ai.clinician_copilot` OFF, development simulator), edits and signs it; the
 * patient sees the signed note, then ends the share and the doctor loses access.
 */
test.describe.serial('Flow F8 — record share, clinician draft, sign, patient sees the note (simulated model)', () => {
  let admin: Session;
  let patient: Session;
  let doctor: Session;
  let original: Route;
  let added: string[] = [];
  let patientId = '';
  let doctorId = '';

  const setConsent = async (s: Session, type: string, granted: boolean) => {
    const state = await (await s.get('/v1/me/consents')).json();
    const c = state.consents.find((x: { type: string }) => x.type === type);
    const res = await s.post('/v1/me/consents', { data: { consents: [{ type, version: c.currentVersion, granted }], source: 'web', locale: 'en' } });
    expect(res.ok(), await res.text()).toBeTruthy();
  };

  test.beforeAll(async () => {
    admin = await apiSession(ADMIN, DEMO_PASSWORD);
    patient = await apiSession(PATIENT, DEMO_PASSWORD);
    doctor = await apiSession(CLINICIAN, DEMO_PASSWORD);
    doctorId = (await (await doctor.get('/v1/me')).json()).user.id;

    const cc = await (await admin.get('/v1/admin/ai/control-centre')).json();
    original = cc.routes.find((r: Route) => r.key === 'clinician.documentation');
    const simulated = cc.models.find((m: { provider: string; modelId: string }) => m.provider === 'SIMULATED' && m.modelId === 'simulated-echo');
    for (const tier of ['BASIC', 'ADVANCED', 'PREMIUM']) {
      const res = await admin.post('/v1/admin/ai/routes/clinician.documentation/candidates', { data: { tier, modelId: simulated.id, priority: 1 } });
      expect(res.ok(), await res.text()).toBeTruthy();
      added.push((await res.json()).routes.find((r: Route) => r.key === 'clinician.documentation').candidates.find((c: Candidate) => c.tier === tier && c.modelId === simulated.id).id);
    }
    expect((await admin.patch('/v1/admin/ai/routes/clinician.documentation', { data: { enabled: true } })).ok()).toBeTruthy();

    await grantConsentsApi(patient, true);
    patientId = await createSelfProfile(patient, 'AI Internal Tester');
    // Each run starts without the clinician terms, so the doctor accepts them in the app.
    await setConsent(doctor, 'AI_CLINICAL_DOCUMENTATION', false);
  });

  test.afterAll(async () => {
    for (const s of (await (await patient.get(`/v1/patients/${patientId}/care-shares`)).json()) as { id: string; status: string }[]) {
      if (s.status === 'ACTIVE') await patient.post(`/v1/care-shares/${s.id}/revoke`, { data: {} });
    }
    for (const id of added) await admin.delete(`/v1/admin/ai/candidates/${id}`);
    added = [];
    await admin.patch('/v1/admin/ai/routes/clinician.documentation', { data: { enabled: original.enabled } });
    await setConsent(doctor, 'AI_CLINICAL_DOCUMENTATION', false);
  });

  test('the patient shares their record with a verified doctor for 7 days, with AI help allowed', async ({ page }) => {
    await signInMobile(page, PATIENT);
    await expect(byId(page, 'tab-health')).toBeVisible();
    await page.goto(`/patient/provider/${doctorId}`);
    await byId(page, 'share-record').click();
    await expect(byId(page, 'share-sheet')).toBeVisible();
    await byId(page, 'share-profile-SELF').click();
    await byId(page, 'share-days-7').click();
    await byId(page, 'share-ai-switch').click();
    await shot(page, 'F32-share-sheet');
    await byId(page, 'share-confirm').click();
    await expect(byId(page, 'share-sheet')).toHaveCount(0);

    await page.goto('/patient/shares');
    await expect(byId(page, 'shares')).toContainText('Dr. Internal Tester');
    await expect(byId(page, 'shares')).toContainText('AI drafting allowed');
  });

  test('the doctor reads the shared record, accepts the clinician terms, drafts, edits and signs a visit note', async ({ page }) => {
    await signInMobile(page, CLINICIAN);
    await byId(page, 'open-shared-records').click();
    await byId(page, 'clinician-patient-AI Internal Tester').click();
    await expect(byId(page, 'clinician-patient')).toBeVisible();
    await expect(byId(page, 'copilot-terms')).toBeVisible();
    await shot(page, 'F33-clinician-shared-record');
    await byId(page, 'copilot-terms-accept').click();
    await expect(byId(page, 'copilot-terms')).toHaveCount(0);

    await byId(page, 'draft-new').click();
    await expect(byId(page, 'draft-sheet')).toBeVisible();
    await byId(page, 'draft-type-VISIT_NOTE').click();
    await byId(page, 'draft-notes').fill('Home visit. Wound on left shin 3 cm, less redness, no discharge. Review in 5 days.');
    await byId(page, 'draft-generate').click();

    await expect(byId(page, 'draft-editor')).toBeVisible();
    await expect(byId(page, 'draft-simulated')).toBeVisible();
    await expect(byId(page, 'draft-status')).toHaveText('Draft');
    await expect(byId(page, 'draft-label')).toBeVisible();
    await byId(page, 'draft-section-plan').fill('Review in 5 days.');
    await shot(page, 'F34-clinician-draft');
    page.once('dialog', (d) => void d.accept());
    await byId(page, 'draft-sign').click();
    await expect(byId(page, 'draft-status')).toHaveText('Signed');
    await expect(byId(page, 'draft-sign')).toHaveCount(0);
  });

  test('the patient sees the signed note, ends the share, and the doctor loses access', async ({ page }) => {
    await signInMobile(page, PATIENT);
    await expect(byId(page, 'tab-health')).toBeVisible();
    await page.goto('/patient/shares');
    const notes = byId(page, 'clinical-notes');
    await expect(notes).toContainText('Visit note');
    await expect(notes).toContainText('Review in 5 days.');
    await shot(page, 'F35-patient-signed-note');

    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Stop sharing' }).filter({ visible: true }).first().click();
    await expect(byId(page, 'shares')).toContainText('Stopped');
    await expect(page.getByRole('button', { name: 'Stop sharing' }).filter({ visible: true })).toHaveCount(0);
    expect((await doctor.get(`/v1/clinician/patients/${patientId}`)).status()).toBe(404);
    const list = (await (await doctor.get('/v1/clinician/patients')).json()) as { patientId: string }[];
    expect(list.some((p) => p.patientId === patientId)).toBe(false);
  });
});
