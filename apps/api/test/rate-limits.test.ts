/**
 * Rate-limit policy (ADR 0016). Accounts are created on a server with the generous test limits;
 * the scenarios run against a second server (same database and sessions) whose limits are
 * lowered, so every layer can be driven past its threshold in a few requests:
 *  - anonymous traffic per IP, with an accurate Retry-After, not fooled by X-Forwarded-For;
 *  - signed-in traffic per account — many people behind one carrier-NAT address are not
 *    throttled together, and one person's burst does not block the others;
 *  - a per-IP ceiling over all traffic that a flood of accounts from one address cannot pass;
 *  - a per-account daily upload allowance;
 *  - Better Auth's strict sign-in / OTP / reset limits are unchanged.
 */
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderSyntheticLabPdf } from '../src/lib/documents';
import { createWindowCounter } from '../src/lib/rate-limits';
import { createTestServer, ORIGIN, signUp, type Client } from './helpers';

let setup: FastifyInstance;
let limited: FastifyInstance;
const users: Client[] = [];
const SELF = { displayName: 'Limit Tester', dateOfBirth: '1980-01-01', sex: 'FEMALE', relationship: 'SELF', consentBasis: 'SELF', consentAttested: true, consentStatementVersion: 'v1' };
const PDF = renderSyntheticLabPdf({ labName: 'Synthetic Lab', collectedOn: '2026-09-14', rows: [{ test: 'Haemoglobin', value: '9.1', unit: 'g/dL', range: '12.0 - 16.0', flag: 'L' }] });
let uploader: Client;
let uploaderPatientId = '';

beforeAll(async () => {
  setup = await createTestServer();
  for (let i = 0; i < 8; i++) users.push(await signUp(setup, { role: 'PATIENT' }));
  uploader = await signUp(setup, { role: 'PATIENT' });
  const p = await uploader.req({ method: 'POST', url: '/v1/patients', body: SELF });
  expect(p.status, JSON.stringify(p.json)).toBe(201);
  uploaderPatientId = p.json.id;
  limited = await createTestServer({ RATE_LIMIT_ANON_IP_PER_MIN: '3', RATE_LIMIT_ACCOUNT_PER_MIN: '5', RATE_LIMIT_IP_CEILING_PER_MIN: '20', UPLOADS_PER_ACCOUNT_PER_DAY: '2' });
});

afterAll(async () => {
  await limited?.close();
  await setup?.close();
});

function call(ip: string, opts: { url?: string; cookie?: string; method?: InjectOptions['method']; body?: unknown; headers?: Record<string, string> } = {}) {
  return limited.inject({
    method: opts.method ?? 'GET',
    url: opts.url ?? '/v1/me',
    remoteAddress: ip,
    headers: { origin: ORIGIN, ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...opts.headers },
    ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
  });
}

function expectThrottled(res: Awaited<ReturnType<typeof call>>, maxSeconds: number) {
  expect(res.statusCode).toBe(429);
  expect(JSON.parse(res.body).error.code).toBe('RATE_LIMITED');
  const retryAfter = Number(res.headers['retry-after']);
  expect(retryAfter).toBeGreaterThanOrEqual(1);
  expect(retryAfter).toBeLessThanOrEqual(maxSeconds);
}

describe('rate limits', () => {
  it('anonymous traffic is limited per IP with an accurate Retry-After; forged forwarding headers do not help', async () => {
    const ip = '198.51.100.10';
    for (let i = 0; i < 3; i++) expect((await call(ip, { url: '/v1/system/status' })).statusCode).toBe(200);
    expectThrottled(await call(ip, { url: '/v1/system/status' }), 60);
    // A client cannot mint a new key by claiming another address.
    expectThrottled(await call(ip, { url: '/v1/system/status', headers: { 'x-forwarded-for': '203.0.113.99', 'x-real-ip': '203.0.113.98' } }), 60);
    expect((await call('198.51.100.11', { url: '/v1/system/status' })).statusCode).toBe(200);
    // Health and readiness probes are never throttled.
    expect((await call(ip, { url: '/health' })).statusCode).toBe(200);
  });

  it('signed-in people behind one carrier-NAT address are counted per account, not per address', async () => {
    const nat = '100.64.10.1';
    const [a, b] = [users[0]!, users[1]!];
    // Ten requests from one address — over the anonymous limit of 3 — all succeed: 5 per account.
    for (let i = 0; i < 5; i++) {
      expect((await call(nat, { cookie: a.cookie })).statusCode).toBe(200);
      expect((await call(nat, { cookie: b.cookie })).statusCode).toBe(200);
    }
    // One person's sixth request is refused; it does not block anybody else.
    expectThrottled(await call(nat, { cookie: a.cookie }), 60);
    expect((await call(nat, { cookie: users[2]!.cookie })).statusCode).toBe(200);
    // Changing network does not reset an account's allowance.
    expectThrottled(await call('100.64.10.2', { cookie: a.cookie }), 60);
  });

  it('a per-IP ceiling stops one address flooding with many accounts or forged cookies', async () => {
    const ip = '192.0.2.50';
    for (const u of users.slice(3, 7)) for (let i = 0; i < 5; i++) expect((await call(ip, { cookie: u.cookie })).statusCode).toBe(200);
    // 20 requests used the ceiling: a fresh account and a forged cookie are both refused before any session lookup.
    expectThrottled(await call(ip, { cookie: users[7]!.cookie }), 60);
    expectThrottled(await call(ip, { cookie: 'ghayarly.session_token=forged' }), 60);
    expect((await call(ip, { url: '/ready' })).statusCode).not.toBe(429);
    // The account itself was never counted: from another address it works.
    expect((await call('192.0.2.51', { cookie: users[7]!.cookie })).statusCode).toBe(200);
  });

  it('uploads are capped per account per day, after validation', async () => {
    const ip = '203.0.113.20';
    const body = { patientId: uploaderPatientId, title: 'CBC', contentType: 'application/pdf', dataBase64: PDF.toString('base64'), documentDate: '2026-09-14' };
    // A refused file does not use the allowance.
    expect((await call(ip, { method: 'POST', url: '/v1/documents', cookie: uploader.cookie, body: { ...body, contentType: 'image/png' } })).statusCode).toBe(422);
    for (let i = 0; i < 2; i++) expect((await call(ip, { method: 'POST', url: '/v1/documents', cookie: uploader.cookie, body })).statusCode).toBe(201);
    const third = await call(ip, { method: 'POST', url: '/v1/documents', cookie: uploader.cookie, body });
    expectThrottled(third, 24 * 60 * 60);
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(23 * 60 * 60);
  });

  it('keeps the strict Better Auth limits for sign-in, sign-up, OTP, password reset and TOTP', () => {
    const rules = (limited.services.auth.options.rateLimit as { customRules: Record<string, { window: number; max: number }> }).customRules;
    expect(rules['/sign-in/email']).toEqual({ window: 60, max: 5 });
    expect(rules['/sign-up/email']).toEqual({ window: 60, max: 5 });
    expect(rules['/phone-number/send-otp']).toEqual({ window: 60, max: 3 });
    expect(rules['/phone-number/verify']).toEqual({ window: 60, max: 5 });
    expect(rules['/request-password-reset']).toEqual({ window: 300, max: 3 });
    expect(rules['/two-factor/verify-totp']).toEqual({ window: 60, max: 5 });
  });

  it('window counters reset after their window and keep counting locally when Redis is unavailable', async () => {
    const counter = createWindowCounter(null);
    expect((await counter.hit('k', 50)).count).toBe(1);
    const second = await counter.hit('k', 50);
    expect(second.count).toBe(2);
    expect(second.resetInMs).toBeLessThanOrEqual(50);
    await new Promise((r) => setTimeout(r, 70));
    expect((await counter.hit('k', 50)).count).toBe(1);
    // A Redis client that is not connected falls back instead of failing open.
    const broken = createWindowCounter({ status: 'end', eval: () => Promise.reject(new Error('down')) } as never);
    for (let i = 1; i <= 3; i++) expect((await broken.hit('x', 1000)).count).toBe(i);
  });
});
