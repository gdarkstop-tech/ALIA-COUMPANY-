import { expect, test } from '@playwright/test';
import { apiSession, byId, createSelfProfile, DEMO_PASSWORD, shot, signInMobile } from './helpers';

const TESTER = 'ai.tester@demo.ghayarly.test';
const ADMIN = 'admin.demo@demo.ghayarly.test';
const REVIEWER = 'reviewer.demo@demo.ghayarly.test';
type Candidate = { id: string; tier: string; modelId: string };
type Route = { key: string; enabled: boolean; candidates: Candidate[] };

/**
 * Flow F3 — Health assistant, pre-launch: `ai.assistant` stays OFF (regulated), so only the seeded
 * INTERNAL_TEST account can use it, and an admin routes it to the development simulator through the
 * real admin API. The tester must opt in to AI processing; emergencies get fixed guidance without
 * any model call; the conversation can be deleted.
 */
test.describe('Flow F3 — AI health assistant (internal test account, simulated model)', () => {
  let admin: Awaited<ReturnType<typeof apiSession>>;
  let tester: Awaited<ReturnType<typeof apiSession>>;
  let original: Route;
  let added: string[] = [];
  let articleId = '';

  const setAiConsent = async (granted: boolean) => {
    const state = await (await tester.get('/v1/me/consents')).json();
    const ai = state.consents.find((c: { type: string }) => c.type === 'AI_ASSISTANT_PROCESSING');
    const res = await tester.post('/v1/me/consents', { data: { consents: [{ type: ai.type, version: ai.currentVersion, granted }], source: 'web', locale: 'en' } });
    expect(res.ok(), await res.text()).toBeTruthy();
  };

  test.beforeAll(async () => {
    admin = await apiSession(ADMIN, DEMO_PASSWORD);
    tester = await apiSession(TESTER, DEMO_PASSWORD);
    const cc = await (await admin.get('/v1/admin/ai/control-centre')).json();
    original = cc.routes.find((r: Route) => r.key === 'patient.chat');
    const simulated = cc.models.find((m: { provider: string }) => m.provider === 'SIMULATED');
    // The simulator becomes the first candidate of every tier (internal test accounts only).
    for (const tier of ['BASIC', 'ADVANCED', 'PREMIUM']) {
      const res = await admin.post('/v1/admin/ai/routes/patient.chat/candidates', { data: { tier, modelId: simulated.id, priority: 1 } });
      expect(res.ok(), await res.text()).toBeTruthy();
      added.push((await res.json()).routes.find((r: Route) => r.key === 'patient.chat').candidates.find((c: Candidate) => c.tier === tier && c.modelId === simulated.id).id);
    }
    expect((await admin.patch('/v1/admin/ai/routes/patient.chat', { data: { enabled: true } })).ok()).toBeTruthy();
    // Curated knowledge: written by the admin, approved by a different clinical reviewer.
    const reviewer = await apiSession(REVIEWER, DEMO_PASSWORD);
    const created = await admin.post('/v1/admin/knowledge/articles', {
      data: { slug: `e2e-dressing-${Date.now().toString(36)}`, locale: 'en', title: 'Changing a simple dressing (E2E)', body: 'Change a simple dressing when it becomes wet, dirty or loose, or as your nurse advised.\n\nWash your hands before and after changing it.', sourcePublisher: 'DMW clinical team (synthetic E2E source)', sourceTitle: 'Test fixture' },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    articleId = (await created.json()).id;
    expect((await admin.post(`/v1/admin/knowledge/articles/${articleId}/submit`, { data: {} })).ok()).toBeTruthy();
    const approved = await reviewer.post(`/v1/admin/knowledge/articles/${articleId}/approve`, { data: { note: 'E2E fixture approval' } });
    expect(approved.ok(), await approved.text()).toBeTruthy();
    // Start from "not consented", and with a profile of their own (the home screen needs one).
    await setAiConsent(false);
    await createSelfProfile(tester, 'AI Internal Tester');
  });

  test.afterAll(async () => {
    if (articleId) await admin.post(`/v1/admin/knowledge/articles/${articleId}/retire`, { data: { note: 'E2E cleanup' } });
    for (const id of added) await admin.delete(`/v1/admin/ai/candidates/${id}`);
    added = [];
    await admin.patch('/v1/admin/ai/routes/patient.chat', { data: { enabled: original.enabled } });
    await setAiConsent(false);
  });

  test('consent, chat, emergency guidance and deletion', async ({ page }) => {
    await signInMobile(page, TESTER);
    await expect(byId(page, 'home-assistant')).toContainText('Privacy & consent');
    await byId(page, 'home-assistant').click();

    // Not consented yet: the server refuses, the app explains and links to the privacy centre.
    await expect(byId(page, 'assistant-unavailable-CONSENT_REQUIRED')).toBeVisible();
    await expect(byId(page, 'assistant-new-chat')).toHaveCount(0);
    await shot(page, 'F10-assistant-consent-required');
    await byId(page, 'assistant-open-privacy').click();
    // The switch records the consent on the server at the current document version.
    const recorded = page.waitForResponse((r) => r.url().endsWith('/v1/me/consents') && r.request().method() === 'POST');
    await byId(page, 'ai-consent-switch').click();
    expect((await recorded).ok()).toBeTruthy();
    await byId(page, 'header-back').click();

    await expect(byId(page, 'assistant-allowance')).toContainText('messages left this week');
    await byId(page, 'assistant-new-chat').click();
    await expect(byId(page, 'assistant-chat')).toBeVisible();

    await byId(page, 'assistant-input').fill('How often should a simple dressing be changed?');
    await byId(page, 'assistant-send').click();
    // The development simulator is labelled as such — never presented as a real answer.
    await expect(byId(page, 'assistant-message-assistant-SIMULATED')).toContainText('SIMULATED');
    // The approved article was retrieved and cited; the person can open the source.
    await expect(byId(page, 'assistant-citation-K1')).toContainText('Changing a simple dressing (E2E)');
    await byId(page, 'assistant-citation-K1').click();
    await expect(byId(page, 'knowledge-article')).toContainText('DMW clinical team (synthetic E2E source)');
    await shot(page, 'F13-knowledge-source');
    await byId(page, 'header-back').click();

    // Report AI response: reason, optional question sharing, confirmation; the answer shows as reported.
    await byId(page, 'assistant-report').click();
    await byId(page, 'assistant-report-reason-INACCURATE').click();
    await byId(page, 'assistant-report-send').click();
    await expect(byId(page, 'assistant-report-done')).toBeVisible();
    await shot(page, 'F12-assistant-report');
    await page.getByRole('button', { name: 'Done' }).filter({ visible: true }).first().click();
    await expect(page.getByText('Reported — thank you').filter({ visible: true }).first()).toBeVisible();

    await byId(page, 'assistant-input').fill('My father has chest pain and cannot breathe');
    await byId(page, 'assistant-send').click();
    await expect(byId(page, 'assistant-message-assistant-EMERGENCY_GUIDANCE')).toContainText('123');
    await expect(byId(page, 'assistant-call-emergency')).toBeVisible();
    await shot(page, 'F11-assistant-chat');

    await byId(page, 'assistant-delete').click();
    await byId(page, 'assistant-confirm-delete').click();
    await expect(byId(page, 'assistant-home')).toBeVisible();
  });
});
