import { expect, test } from '@playwright/test';
import { apiSession, approvedIndication, archiveProduct, byId, createSelfProfile, DEMO_PASSWORD, liveProduct, shot, signInMobile } from './helpers';

const TESTER = 'ai.tester@demo.ghayarly.test';
const ADMIN = 'admin.demo@demo.ghayarly.test';
const REVIEWER = 'reviewer.demo@demo.ghayarly.test';
type Candidate = { id: string; tier: string; modelId: string };
type Route = { key: string; enabled: boolean; candidates: Candidate[] };

/**
 * Flow F9 — Controlled product discovery (`ai.product_discovery` OFF: internal test account,
 * development simulator). A clinically approved indication and keyword surface approved product
 * information next to an answer that cited it; the card links to the product page with its
 * official indications; a message with warning signs gets no product information.
 */
test.describe('Flow F9 — approved product information in the assistant (simulated model)', () => {
  let admin: Awaited<ReturnType<typeof apiSession>>;
  let tester: Awaited<ReturnType<typeof apiSession>>;
  let original: Route;
  let added: string[] = [];
  let product: { id: string; slug: string; nameEn: string };

  const setAiConsent = async (granted: boolean) => {
    const state = await (await tester.get('/v1/me/consents')).json();
    const ai = state.consents.find((c: { type: string }) => c.type === 'AI_ASSISTANT_PROCESSING');
    expect((await tester.post('/v1/me/consents', { data: { consents: [{ type: ai.type, version: ai.currentVersion, granted }], source: 'web', locale: 'en' } })).ok()).toBeTruthy();
  };

  test.beforeAll(async () => {
    admin = await apiSession(ADMIN, DEMO_PASSWORD);
    const reviewer = await apiSession(REVIEWER, DEMO_PASSWORD);
    tester = await apiSession(TESTER, DEMO_PASSWORD);
    const cc = await (await admin.get('/v1/admin/ai/control-centre')).json();
    original = cc.routes.find((r: Route) => r.key === 'patient.chat');
    const simulated = cc.models.find((m: { provider: string }) => m.provider === 'SIMULATED');
    for (const tier of ['BASIC', 'ADVANCED', 'PREMIUM']) {
      const res = await admin.post('/v1/admin/ai/routes/patient.chat/candidates', { data: { tier, modelId: simulated.id, priority: 1 } });
      expect(res.ok(), await res.text()).toBeTruthy();
      added.push((await res.json()).routes.find((r: Route) => r.key === 'patient.chat').candidates.find((c: Candidate) => c.tier === tier && c.modelId === simulated.id).id);
    }
    expect((await admin.patch('/v1/admin/ai/routes/patient.chat', { data: { enabled: true } })).ok()).toBeTruthy();

    product = await liveProduct(admin, reviewer, 'chat');
    const indication = await approvedIndication(admin, reviewer, product.id);
    const kw = await admin.post('/v1/admin/product-knowledge/keywords', { data: { productId: product.id, indicationId: indication, term: 'bedsore', locale: 'en', variant: 'SYNONYM' } });
    expect(kw.ok(), await kw.text()).toBeTruthy();
    expect((await reviewer.post(`/v1/admin/product-knowledge/keywords/${(await kw.json()).id}/approve`, { data: {} })).ok()).toBeTruthy();

    await createSelfProfile(tester, 'AI Internal Tester');
    await setAiConsent(true);
  });

  test.afterAll(async () => {
    if (product) await archiveProduct(admin, product.id);
    for (const id of added) await admin.delete(`/v1/admin/ai/candidates/${id}`);
    added = [];
    await admin.patch('/v1/admin/ai/routes/patient.chat', { data: { enabled: original.enabled } });
    await setAiConsent(false);
  });

  test('a cited, approved product card; the product page; nothing when signs need a clinician', async ({ page }) => {
    await signInMobile(page, TESTER);
    await byId(page, 'home-assistant').click();
    await byId(page, 'assistant-new-chat').click();
    await byId(page, 'assistant-input').fill('My mother has a bedsore. How do I look after it?');
    await byId(page, 'assistant-send').click();
    await expect(byId(page, 'assistant-message-assistant-SIMULATED')).toContainText('[P1]');
    const card = byId(page, 'assistant-product-P1');
    await expect(card).toContainText('Company product information');
    await expect(card).toContainText(product.nameEn);
    await expect(byId(page, 'assistant-product-P1-use')).toContainText('Superficial pressure ulcers');
    await expect(card).toContainText('not a recommendation for your situation');
    await shot(page, 'F36-assistant-product-card');

    await byId(page, 'assistant-product-P1-open').click();
    await expect(byId(page, 'product-knowledge-INDICATION')).toContainText('Superficial pressure ulcers');
    await expect(byId(page, 'product-knowledge-INDICATION')).toContainText('Approved by the clinical team');
    await shot(page, 'F37-product-official-indications');
    await byId(page, 'header-back').click();

    // Warning signs: the answer gets no product information at all.
    await byId(page, 'assistant-input').fill('Her bedsore now has pus and a bad smell. What can I put on it?');
    await byId(page, 'assistant-send').click();
    await expect(page.getByTestId('assistant-message-assistant-SIMULATED').filter({ visible: true })).toHaveCount(2);
    await expect(page.getByTestId('assistant-product-P1').filter({ visible: true })).toHaveCount(1);

    await byId(page, 'assistant-delete').click();
    await byId(page, 'assistant-confirm-delete').click();
    await expect(byId(page, 'assistant-home')).toBeVisible();
  });
});
