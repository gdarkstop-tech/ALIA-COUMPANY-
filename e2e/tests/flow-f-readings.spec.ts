import { expect, test } from '@playwright/test';
import { apiSession, byId, createSelfProfile, DEMO_PASSWORD, grantConsentsApi, shot, signInMobile } from './helpers';

const TESTER = 'ai.tester@demo.ghayarly.test';
const ADMIN = 'admin.demo@demo.ghayarly.test';
type Candidate = { id: string; tier: string; modelId: string };
type Route = { key: string; enabled: boolean; candidates: Candidate[] };
const ymd = (daysAgo: number) => {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Flow F7 — Readings and trends. Readings are entered through the app; the calculated figures are
 * shown apart from the measured values; the AI summary (`ai.health_summary` OFF: internal test
 * account, development simulator) is labelled and shows the calculated facts each point relied on;
 * a mistaken reading is marked and leaves the trend.
 */
test.describe('Flow F7 — readings, calculated trends and an AI summary (simulated model)', () => {
  let admin: Awaited<ReturnType<typeof apiSession>>;
  let tester: Awaited<ReturnType<typeof apiSession>>;
  let original: Route;
  let added: string[] = [];
  let patientId = '';

  const setConsent = async (type: string, granted: boolean) => {
    const state = await (await tester.get('/v1/me/consents')).json();
    const c = state.consents.find((x: { type: string }) => x.type === type);
    const res = await tester.post('/v1/me/consents', { data: { consents: [{ type, version: c.currentVersion, granted }], source: 'web', locale: 'en' } });
    expect(res.ok(), await res.text()).toBeTruthy();
  };
  const cleanUp = async () => {
    for (const o of (await (await tester.get(`/v1/patients/${patientId}/observations?days=3650`)).json()) as { id: string }[]) await tester.delete(`/v1/patients/${patientId}/observations/${o.id}`);
    for (const s of (await (await tester.get(`/v1/patients/${patientId}/health-summaries`)).json()) as { id: string }[]) await tester.delete(`/v1/health-summaries/${s.id}`);
  };

  test.beforeAll(async () => {
    admin = await apiSession(ADMIN, DEMO_PASSWORD);
    tester = await apiSession(TESTER, DEMO_PASSWORD);
    const cc = await (await admin.get('/v1/admin/ai/control-centre')).json();
    original = cc.routes.find((r: Route) => r.key === 'patient.health_summary');
    const simulated = cc.models.find((m: { provider: string; modelId: string }) => m.provider === 'SIMULATED' && m.modelId === 'simulated-echo');
    for (const tier of ['BASIC', 'ADVANCED', 'PREMIUM']) {
      const res = await admin.post('/v1/admin/ai/routes/patient.health_summary/candidates', { data: { tier, modelId: simulated.id, priority: 1 } });
      expect(res.ok(), await res.text()).toBeTruthy();
      added.push((await res.json()).routes.find((r: Route) => r.key === 'patient.health_summary').candidates.find((c: Candidate) => c.tier === tier && c.modelId === simulated.id).id);
    }
    expect((await admin.patch('/v1/admin/ai/routes/patient.health_summary', { data: { enabled: true } })).ok()).toBeTruthy();
    await grantConsentsApi(tester, true);
    patientId = await createSelfProfile(tester, 'AI Internal Tester');
    await setConsent('AI_ASSISTANT_PROCESSING', true);
    await cleanUp();
  });

  test.afterAll(async () => {
    await cleanUp();
    for (const id of added) await admin.delete(`/v1/admin/ai/candidates/${id}`);
    added = [];
    await admin.patch('/v1/admin/ai/routes/patient.health_summary', { data: { enabled: original.enabled } });
    await setConsent('AI_ASSISTANT_PROCESSING', false);
  });

  test('record readings, see measured vs calculated, write an AI summary, mark a mistake', async ({ page }) => {
    await signInMobile(page, TESTER);
    await byId(page, 'tab-health').click();
    await byId(page, 'open-readings').click();
    await expect(byId(page, 'readings')).toBeVisible();
    await expect(byId(page, 'readings-legend')).toContainText('Calculated');

    const addBp = async (sys: string, dia: string, daysAgo: number) => {
      await byId(page, 'reading-add').click();
      await byId(page, 'reading-kind-BLOOD_PRESSURE').click();
      await byId(page, 'reading-value').fill(sys);
      await byId(page, 'reading-value2').fill(dia);
      await byId(page, 'reading-date').fill(ymd(daysAgo));
      await byId(page, 'reading-save').click();
      await expect(byId(page, 'reading-sheet')).toHaveCount(0);
    };
    await addBp('128', '82', 5);
    await addBp('142', '91', 0);

    const card = 'series-VITAL_BLOOD_PRESSURE';
    await expect(byId(page, `${card}-latest`)).toContainText('142/91');
    // Values are wrapped in left-to-right isolates (correct inside Arabic text).
    await expect(byId(page, `${card}-change`)).toContainText(/Higher than the previous reading by \W?\+14\/\+9 mmHg/);
    await expect(byId(page, `${card}-calculated`)).toContainText('2 readings');
    // Tapping the chart selects the nearest reading (the touch equivalent of a tooltip).
    await byId(page, `chart-${card.replace('series-', '')}-plot`).click({ position: { x: 60, y: 70 } });
    await expect(byId(page, `chart-${card.replace('series-', '')}-selected`)).toContainText('128/82');
    await byId(page, `${card}-table-toggle`).click();
    await expect(byId(page, `${card}-table`)).toContainText('142/91 mmHg');
    await shot(page, 'F30-readings-trend');

    // The AI summary is labelled, simulated, and shows the calculated facts behind each point.
    await expect(byId(page, 'health-summary-allowance')).toContainText('analyses left this week');
    await byId(page, 'health-summary-create').click();
    await expect(byId(page, 'health-summary-content')).toBeVisible();
    await expect(byId(page, 'health-summary-simulated')).toBeVisible();
    await expect(byId(page, 'health-summary-point-0')).toContainText(/Blood pressure: Latest \W?142\/91\W? \W?mmHg/);
    await shot(page, 'F31-readings-ai-summary');
    page.once('dialog', (d) => void d.accept());
    await byId(page, 'health-summary-delete').click();
    await expect(byId(page, 'health-summary-content')).toHaveCount(0);

    // A mistaken reading is marked (never deleted) and leaves the trend.
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Entered by mistake' }).filter({ visible: true }).first().click();
    await expect(byId(page, `${card}-latest`)).toContainText('128/82');
    await expect(byId(page, card)).toContainText('One reading — add more to see a trend.');
  });
});
