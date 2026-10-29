import { expect, request, test, type APIRequestContext, type APIResponse, type Page, type Response } from '@playwright/test';
import { mkdirSync } from 'node:fs';

export const DEMO_PASSWORD = 'DressMyWound-Demo-2026';
export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';
const SHOTS = 'artifacts';
mkdirSync(SHOTS, { recursive: true });

export async function shot(page: Page, name: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Signs in through the real sign-in screen of the app. */
export async function signInMobile(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto('/sign-in');
  await byId(page, 'sign-in-email').fill(email);
  await byId(page, 'sign-in-password').fill(password);
  await submitSignIn(page, 'sign-in-submit');
}

/**
 * The whole suite reaches the API from one IP, so it meets the real per-IP limits (5 sign-ins and
 * 5 sign-ups per minute, 300 requests per minute — kept on). Like a well-behaved client or a
 * patient person, a refused (429) attempt is repeated after the server's Retry-After instead of
 * the limits being weakened for tests.
 */
async function waitOutRateLimit(res: APIResponse | Response): Promise<void> {
  const headers = res.headers();
  const waitSeconds = Math.min(Number(headers['x-retry-after'] ?? headers['retry-after']) + 1 || 61, 65);
  test.info().setTimeout(test.info().timeout + (waitSeconds + 10) * 1000);
  await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
}

export function honourRateLimits(ctx: APIRequestContext): APIRequestContext {
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'fetch'] as const) {
    const send = ctx[method].bind(ctx) as (...args: unknown[]) => Promise<APIResponse>;
    Object.assign(ctx, {
      [method]: async (...args: unknown[]) => {
        let res = await send(...args);
        for (let attempt = 0; res.status() === 429 && attempt < 3; attempt++) {
          await waitOutRateLimit(res);
          res = await send(...args);
        }
        return res;
      },
    });
  }
  return ctx;
}

/** Submits a sign-in form (app or console) and, if sign-in is throttled, waits and submits again. */
export async function submitSignIn(page: Page, submitTestId: string) {
  for (let attempt = 0; ; attempt++) {
    const answer = page.waitForResponse((r) => r.url().includes('/sign-in/email') && r.request().method() === 'POST');
    await byId(page, submitTestId).click();
    const res = await answer;
    if (res.status() !== 429 || attempt >= 2) return;
    await waitOutRateLimit(res);
  }
}

/** Talks to the API directly (setup only) with a trusted Origin, keeping cookies per context. */
export async function apiSession(email: string, password: string, opts: { signUp?: boolean; name?: string } = {}) {
  const ctx = honourRateLimits(await request.newContext({ baseURL: API_URL, extraHTTPHeaders: { origin: 'http://localhost:8081' } }));
  const path = opts.signUp ? '/api/auth/sign-up/email' : '/api/auth/sign-in/email';
  const res = await ctx.post(path, { data: opts.signUp ? { email, password, name: opts.name ?? 'E2E User' } : { email, password } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return ctx;
}

export function unique(prefix: string) {
  return `${prefix}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@e2e.ghayarly.test`;
}

/** React Navigation keeps inactive tab/stack screens mounted on web; target only what is visible. */
export function byId(page: Page, id: string) {
  return page.getByTestId(id).filter({ visible: true }).first();
}

/** Accepts the current terms + privacy (and optionally health-data) consents through the API. */
export async function grantConsentsApi(ctx: Awaited<ReturnType<typeof apiSession>>, healthData = false) {
  const state = await (await ctx.get('/v1/me/consents')).json();
  const wanted = ['TERMS_OF_SERVICE', 'PRIVACY_POLICY', ...(healthData ? ['HEALTH_DATA_PROCESSING'] : [])];
  const consents = (state.consents as { type: string; currentVersion: string }[])
    .filter((c) => wanted.includes(c.type))
    .map((c) => ({ type: c.type, version: c.currentVersion, granted: true }));
  const res = await ctx.post('/v1/me/consents', { data: { consents, source: 'web', locale: 'en' } });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** The account holder's own profile, with the details onboarding requires (governorate, city, mobile). */
export async function createSelfProfile(api: Awaited<ReturnType<typeof apiSession>>, displayName: string, phone = '+201000000777') {
  const existing = ((await (await api.get('/v1/patients')).json()) as { id: string; relationship: string }[]).find((p) => p.relationship === 'SELF');
  let id = existing?.id;
  if (!id) {
    const created = await api.post('/v1/patients', {
      data: { displayName, dateOfBirth: '1990-05-05', sex: 'FEMALE', relationship: 'SELF', consentBasis: 'SELF', consentAttested: true, consentStatementVersion: 'v1' },
    });
    if (!created.ok()) throw new Error(`self profile: ${await created.text()}`);
    id = (await created.json()).id as string;
  }
  const updated = await api.patch(`/v1/patients/${id}`, { data: { governorate: 'CAIRO', city: 'Nasr City', phone } });
  if (!updated.ok()) throw new Error(`self profile details: ${await updated.text()}`);
  return id as string;
}

type Api = Awaited<ReturnType<typeof apiSession>>;
/** A TetraSol product on sale (synthetic E2E fixture): drafted and published by the admin, content approved by the reviewer. */
export async function liveProduct(admin: Api, reviewer: Api, tag: string) {
  const slug = `e2e-${tag}-${Date.now().toString(36)}`;
  const nameEn = `TetraSol E2E ${tag}`;
  const created = await admin.post('/v1/admin/catalog/products', {
    data: { slug, brand: 'TetraSol', nameAr: `تتراسول تجربة ${tag}`, nameEn, summaryAr: 'منتج اختبار مُصطنع', summaryEn: 'Synthetic E2E test product', descriptionAr: 'منتج اختبار مُصطنع.', descriptionEn: 'Synthetic E2E test product.', usageAr: 'ضع طبقة رقيقة مرة يوميًا.', usageEn: 'Apply a thin layer once a day.', approvedUsesAr: '', approvedUsesEn: '', warningsAr: 'للاستخدام الخارجي فقط.', warningsEn: 'For external use only.' },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const id = (await created.json()).id as string;
  expect((await admin.post(`/v1/admin/catalog/products/${id}/variants`, { data: { sku: slug.toUpperCase().slice(0, 40), labelAr: 'عبوة', labelEn: 'Pack', pricePiasters: 9900 } })).ok()).toBeTruthy();
  const approved = await reviewer.post(`/v1/admin/catalog/products/${id}/approve`, { data: { approvalReference: 'E2E-SYNTHETIC-REF' } });
  expect(approved.ok(), await approved.text()).toBeTruthy();
  expect((await admin.post(`/v1/admin/catalog/products/${id}/publication`, { data: { status: 'PUBLISHED' } })).ok()).toBeTruthy();
  return { id, slug, nameEn };
}

/** An official indication written by the admin and approved by the clinical reviewer. */
export async function approvedIndication(admin: Api, reviewer: Api, productId: string) {
  const created = await admin.post('/v1/admin/product-knowledge/entries', {
    data: { productId, kind: 'INDICATION', topic: 'pressure-ulcers', titleAr: 'قرح الفراش السطحية', titleEn: 'Superficial pressure ulcers', bodyAr: 'للمساعدة في العناية بقرح الفراش السطحية تحت إشراف ممرض (اختبار).', bodyEn: 'Helps care for superficial pressure ulcers under a nurse’s supervision (E2E fixture).', evidenceReference: 'E2E synthetic label, section 4.1' },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const id = (await created.json()).id as string;
  expect((await admin.post(`/v1/admin/product-knowledge/entries/${id}/submit`, { data: {} })).ok()).toBeTruthy();
  const ok = await reviewer.post(`/v1/admin/product-knowledge/entries/${id}/approve`, { data: { note: 'E2E fixture approval' } });
  expect(ok.ok(), await ok.text()).toBeTruthy();
  return id;
}

/** Takes an E2E product off sale (archived) so repeated runs do not fill the store. */
export async function archiveProduct(admin: Api, productId: string) {
  await admin.post(`/v1/admin/catalog/products/${productId}/publication`, { data: { status: 'UNPUBLISHED' } });
  await admin.post(`/v1/admin/catalog/products/${productId}/publication`, { data: { status: 'ARCHIVED' } });
}

export const WOUND_CONSENT_VERSION = '2026-10-draft';
/** Wound registry: no wound permission, no wound data, no active share (idempotent; test data only). */
export async function woundCleanSlate(api: Api, patientId: string) {
  for (const purpose of ['SCAN', 'RESEARCH', 'PRESENTATION']) {
    const r = await api.post(`/v1/patients/${patientId}/wound-permissions`, { data: { purpose, action: 'WITHDRAW', version: WOUND_CONSENT_VERSION } });
    expect(r.ok(), await r.text()).toBeTruthy();
  }
  expect((await api.post(`/v1/patients/${patientId}/wounds/delete-all`, { data: {} })).ok()).toBeTruthy();
  for (const s of (await (await api.get(`/v1/patients/${patientId}/care-shares`)).json()) as { id: string; status: string }[]) {
    if (s.status === 'ACTIVE') await api.post(`/v1/care-shares/${s.id}/revoke`, { data: {} });
  }
}

/** A synthetic photo drawn in the browser (a colour pattern — never a real wound or person). */
export async function syntheticJpeg(page: Page, hue: number): Promise<Buffer> {
  const dataUrl = await page.evaluate((h) => {
    const c = document.createElement('canvas');
    c.width = 800;
    c.height = 600;
    const g = c.getContext('2d')!;
    for (let y = 0; y < 600; y += 20)
      for (let x = 0; x < 800; x += 20) {
        g.fillStyle = `hsl(${(h + x / 8 + y / 6) % 360}, 45%, ${35 + ((x + y) / 20) % 30}%)`;
        g.fillRect(x, y, 20, 20);
      }
    return c.toDataURL('image/jpeg', 0.9);
  }, hue);
  return Buffer.from(dataUrl.split(',')[1]!, 'base64');
}
