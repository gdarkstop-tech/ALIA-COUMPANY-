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
