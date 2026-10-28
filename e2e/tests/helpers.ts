import { expect, request, test, type Page } from '@playwright/test';
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
  await byId(page, 'sign-in-submit').click();
}

/** Talks to the API directly (setup only) with a trusted Origin, keeping cookies per context. */
export async function apiSession(email: string, password: string, opts: { signUp?: boolean; name?: string } = {}) {
  const ctx = await request.newContext({ baseURL: API_URL, extraHTTPHeaders: { origin: 'http://localhost:8081' } });
  const path = opts.signUp ? '/api/auth/sign-up/email' : '/api/auth/sign-in/email';
  const send = () => ctx.post(path, { data: opts.signUp ? { email, password, name: opts.name ?? 'E2E User' } : { email, password } });
  let res = await send();
  // Every E2E sign-up comes from one IP and the API allows 5 per minute (a real control, kept on):
  // wait the window out instead of weakening it for tests.
  for (let attempt = 0; res.status() === 429 && attempt < 2; attempt++) {
    const waitSeconds = Math.min(Number(res.headers()['x-retry-after'] ?? res.headers()['retry-after']) + 1 || 61, 65);
    test.info().setTimeout(test.info().timeout + (waitSeconds + 10) * 1000);
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
    res = await send();
  }
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
