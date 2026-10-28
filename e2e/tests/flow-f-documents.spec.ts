import { expect, test } from '@playwright/test';
import { API_URL, apiSession, byId, createSelfProfile, DEMO_PASSWORD, grantConsentsApi, shot, signInMobile } from './helpers';

const TESTER = 'ai.tester@demo.ghayarly.test';
const ADMIN = 'admin.demo@demo.ghayarly.test';
type Candidate = { id: string; tier: string; modelId: string };
type Route = { key: string; enabled: boolean; candidates: Candidate[] };

/** A one-page synthetic lab report (never a real record). */
function syntheticPdf(): Buffer {
  const lines = ['SYNTHETIC TEST FIXTURE - NOT A REAL PATIENT', 'Haemoglobin   13.5  g/dL      12.0 - 16.0', 'WBC           12.4  x10^9/L   4.0 - 11.0   H'];
  const content = `BT /F1 11 Tf 40 800 Td 16 TL ${lines.map((l) => `(${l}) Tj T*`).join(' ')} ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/**
 * Flow F6 — Lab reports, pre-launch: `ai.document_analysis` stays OFF (regulated), so only the
 * INTERNAL_TEST account can use it, routed by an admin to the development simulator (which never
 * reads the file and labels every row SIMULATED). The person grants the separate document consent
 * inline, checks each row (confirm / correct), opens the original through a single-use link, and
 * deletes the document; confirmed results stay in the record.
 */
test.describe('Flow F6 — lab report reading (internal test account, simulated model)', () => {
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
    for (const d of (await (await tester.get(`/v1/patients/${patientId}/documents`)).json()) as { id: string }[]) await tester.delete(`/v1/documents/${d.id}`);
  };

  test.beforeAll(async () => {
    admin = await apiSession(ADMIN, DEMO_PASSWORD);
    tester = await apiSession(TESTER, DEMO_PASSWORD);
    const cc = await (await admin.get('/v1/admin/ai/control-centre')).json();
    original = cc.routes.find((r: Route) => r.key === 'patient.document');
    const simulated = cc.models.find((m: { provider: string; modelId: string }) => m.provider === 'SIMULATED' && m.modelId === 'simulated-echo');
    for (const tier of ['BASIC', 'ADVANCED', 'PREMIUM']) {
      const res = await admin.post('/v1/admin/ai/routes/patient.document/candidates', { data: { tier, modelId: simulated.id, priority: 1 } });
      expect(res.ok(), await res.text()).toBeTruthy();
      added.push((await res.json()).routes.find((r: Route) => r.key === 'patient.document').candidates.find((c: Candidate) => c.tier === tier && c.modelId === simulated.id).id);
    }
    expect((await admin.patch('/v1/admin/ai/routes/patient.document', { data: { enabled: true } })).ok()).toBeTruthy();
    await grantConsentsApi(tester, true);
    patientId = await createSelfProfile(tester, 'AI Internal Tester');
    await setConsent('AI_ASSISTANT_PROCESSING', true);
    // Start without the document consent: the app asks for it inline.
    await setConsent('AI_DOCUMENT_PROCESSING', false);
    await cleanUp();
  });

  test.afterAll(async () => {
    await cleanUp();
    for (const id of added) await admin.delete(`/v1/admin/ai/candidates/${id}`);
    added = [];
    await admin.patch('/v1/admin/ai/routes/patient.document', { data: { enabled: original.enabled } });
    await setConsent('AI_DOCUMENT_PROCESSING', false);
    await setConsent('AI_ASSISTANT_PROCESSING', false);
  });

  test('upload, consent, read, check each row, open the original once, delete', async ({ page }) => {
    await signInMobile(page, TESTER);
    await byId(page, 'tab-health').click();
    await byId(page, 'open-documents').click();
    await expect(byId(page, 'documents')).toBeVisible();

    // Upload: the picker's file input receives a synthetic PDF.
    await byId(page, 'document-upload-open').click();
    const chooser = page.waitForEvent('filechooser');
    await byId(page, 'document-choose').click();
    await (await chooser).setFiles({ name: 'cbc-e2e.pdf', mimeType: 'application/pdf', buffer: syntheticPdf() });
    await expect(byId(page, 'document-chosen')).toContainText('cbc-e2e.pdf');
    await byId(page, 'document-title').fill('CBC (E2E)');
    await byId(page, 'document-date').fill('20260914');
    await byId(page, 'document-upload').click();
    await expect(byId(page, 'document-detail')).toBeVisible();

    // The separate document consent is asked for inline, at the current notice version.
    await expect(byId(page, 'document-ai-consent')).toBeVisible();
    await shot(page, 'F20-document-consent');
    const recorded = page.waitForResponse((r) => r.url().endsWith('/v1/me/consents') && r.request().method() === 'POST');
    await byId(page, 'document-ai-consent-allow').click();
    expect((await recorded).ok()).toBeTruthy();
    await expect(byId(page, 'document-ai-allowance')).toContainText('readings left this week');

    await byId(page, 'document-ai-read').click();
    await expect(byId(page, 'document-review')).toBeVisible();
    // The simulator is labelled; nothing it returns is presented as a real reading.
    await expect(byId(page, 'document-simulated')).toBeVisible();
    await expect(byId(page, 'lab-range-[SIMULATED] Haemoglobin')).toContainText('Within the printed range');
    await expect(byId(page, 'lab-range-[SIMULATED] White blood cells')).toContainText('Above the printed range');
    await shot(page, 'F21-document-review');

    // Confirm one row as read; correct the other (the status is recomputed from the printed range).
    await byId(page, 'lab-confirm-[SIMULATED] Haemoglobin').click();
    await expect(byId(page, 'lab-row-[SIMULATED] Haemoglobin')).toContainText('From document');
    await byId(page, 'lab-correct-[SIMULATED] White blood cells').click();
    await byId(page, 'lab-value').fill('10.5');
    await byId(page, 'lab-save').click();
    await expect(byId(page, 'lab-value-[SIMULATED] White blood cells')).toContainText('10.5');
    await expect(byId(page, 'lab-row-[SIMULATED] White blood cells')).toContainText('Corrected by you');
    await expect(byId(page, 'lab-range-[SIMULATED] White blood cells')).toContainText('Within the printed range');

    // The original opens through a single-use link; the same link does not open it again.
    const linkRes = page.waitForResponse((r) => r.url().endsWith('/view-link'));
    const viewed = page.context().waitForEvent('response', (r) => r.url().includes('/view?t='));
    await byId(page, 'document-open').click();
    const { url } = await (await linkRes).json();
    const first = await viewed;
    expect(first.status()).toBe(200);
    expect(first.headers()['content-type']).toBe('application/pdf');
    const again = await tester.get(url.replace(API_URL, ''));
    expect(again.status()).toBe(403);
    for (const p of page.context().pages()) if (p !== page) await p.close();

    // Deleting the original keeps the two confirmed results.
    page.once('dialog', (d) => void d.accept());
    await byId(page, 'document-delete').click();
    await expect(byId(page, 'documents')).toBeVisible();
    await expect(byId(page, 'lab-results')).toContainText('[SIMULATED] Haemoglobin');
    await expect(byId(page, 'lab-results')).toContainText('10.5');
    await shot(page, 'F22-documents-results');
  });
});
