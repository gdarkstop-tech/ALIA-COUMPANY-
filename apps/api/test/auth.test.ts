import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { clientFor, createTestServer, grantRole, ORIGIN, PASSWORD, signIn, signUp, uniqueEmail } from './helpers';

let app: FastifyInstance;

beforeAll(async () => {
  app = await createTestServer();
});
afterAll(async () => {
  await app.close();
});

describe('authentication', () => {
  it('rejects unauthenticated access to domain APIs', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/me' });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe('UNAUTHORIZED');
  });

  it('signs up, signs in and returns the profile', async () => {
    const email = uniqueEmail('signup');
    const client = await signUp(app, { email, name: 'Nour Test' });
    const me = await client.req({ method: 'GET', url: '/v1/me' });
    expect(me.status).toBe(200);
    expect(me.json.user.email).toBe(email);
    expect(me.json.roles).toEqual([]);
    expect(me.json.profile.locale).toBe('ar');

    const again = await signIn(app, email);
    expect(again.status).toBe(200);
    expect(again.cookie).toContain('ghayarly.session_token');
  });

  it('rejects a wrong password without revealing whether the account exists', async () => {
    const email = uniqueEmail('wrongpw');
    await signUp(app, { email });
    const wrong = await signIn(app, email, 'not-the-password-123');
    const unknown = await signIn(app, uniqueEmail('nobody'), 'not-the-password-123');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.code).toBe(unknown.body.code);
  });

  it('enforces a minimum password length', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: JSON.stringify({ email: uniqueEmail('short'), password: 'short1', name: 'x' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('invalidates the session on sign-out', async () => {
    const client = await signUp(app);
    const out = await app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: { origin: ORIGIN, cookie: client.cookie, 'content-type': 'application/json' }, payload: '{}' });
    expect(out.statusCode).toBe(200);
    const me = await client.req({ method: 'GET', url: '/v1/me' });
    expect(me.status).toBe(401);
  });

  it('lists and revokes device sessions', async () => {
    const email = uniqueEmail('sessions');
    const first = await signUp(app, { email });
    const second = await signIn(app, email);
    const list = await app.inject({ method: 'GET', url: '/api/auth/list-sessions', headers: { origin: ORIGIN, cookie: first.cookie } });
    const sessions = JSON.parse(list.body) as { token: string }[];
    expect(sessions.length).toBe(2);
    const secondToken = decodeURIComponent(second.cookie.split('ghayarly.session_token=')[1]!.split('.')[0]!);
    const revoke = await app.inject({
      method: 'POST',
      url: '/api/auth/revoke-session',
      headers: { origin: ORIGIN, cookie: first.cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ token: secondToken }),
    });
    expect(revoke.statusCode).toBe(200);
    expect((await clientFor(app, second.cookie).req({ method: 'GET', url: '/v1/me' })).status).toBe(401);
    expect((await first.req({ method: 'GET', url: '/v1/me' })).status).toBe(200);
  });

  it('only allows self-selection of PATIENT, DOCTOR and NURSE roles', async () => {
    const client = await signUp(app);
    expect((await client.req({ method: 'POST', url: '/v1/me/roles', body: { role: 'ADMIN' } })).status).toBe(400);
    const ok = await client.req({ method: 'POST', url: '/v1/me/roles', body: { role: 'NURSE' } });
    expect(ok.status).toBe(200);
    expect(ok.json.roles).toContain('NURSE');
    expect(ok.json.mfa.required).toBe(true);
  });

  it('signs in with a phone OTP delivered through the development outbox only', async () => {
    const phone = `+2010${Math.floor(10000000 + Math.random() * 89999999)}`;
    const send = await app.inject({
      method: 'POST',
      url: '/api/auth/phone-number/send-otp',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: JSON.stringify({ phoneNumber: phone }),
    });
    expect(send.statusCode).toBe(200);
    const outbox = app.services.messaging.outbox!.list({ to: phone, purpose: 'phone-otp' });
    expect(outbox.length).toBe(1);
    const code = outbox[0]!.body.match(/\b(\d{6})\b/)![1]!;

    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/phone-number/verify',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: JSON.stringify({ phoneNumber: phone, code: code === '000000' ? '111111' : '000000' }),
    });
    expect(bad.statusCode).toBe(400);

    const verify = await app.inject({
      method: 'POST',
      url: '/api/auth/phone-number/verify',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: JSON.stringify({ phoneNumber: phone, code }),
    });
    expect(verify.statusCode).toBe(200);
    const cookie = String(verify.headers['set-cookie']).split(';')[0]!;
    const me = await clientFor(app, cookie).req({ method: 'GET', url: '/v1/me' });
    expect(me.status).toBe(200);
    expect(me.json.user.phoneNumber).toBe(phone);
    expect(me.json.user.phoneNumberVerified).toBe(true);
  });

  it('rejects phone numbers that are not Egyptian mobiles', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/phone-number/send-otp',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: JSON.stringify({ phoneNumber: '+15551234567' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('resets a password with the emailed token and revokes old sessions', async () => {
    const email = uniqueEmail('reset');
    const client = await signUp(app, { email });
    const req = await app.inject({
      method: 'POST',
      url: '/api/auth/request-password-reset',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: JSON.stringify({ email, redirectTo: 'ghayarly://reset-password' }),
    });
    expect(req.statusCode).toBe(200);
    const mail = app.services.messaging.outbox!.list({ to: email, purpose: 'password-reset' })[0]!;
    const token = mail.body.match(/code: ([A-Za-z0-9_-]+)/)![1]!;
    const reset = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: JSON.stringify({ token, newPassword: 'Brand-New-Password-1' }),
    });
    expect(reset.statusCode).toBe(200);
    expect((await signIn(app, email, PASSWORD)).status).toBe(401);
    expect((await signIn(app, email, 'Brand-New-Password-1')).status).toBe(200);
    expect((await client.req({ method: 'GET', url: '/v1/me' })).status).toBe(401);
  });

  it('rejects cookie-authenticated requests from untrusted browser origins (CSRF)', async () => {
    const client = await signUp(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { origin: 'https://evil.example', cookie: client.cookie, 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(res.statusCode).toBe(403);
    expect((await client.req({ method: 'GET', url: '/v1/me' })).status).toBe(200);
  });
});

describe('CSRF protection on domain routes', () => {
  it('rejects state-changing /v1 requests from untrusted origins but allows native clients (no Origin)', async () => {
    const client = await signUp(app);
    const evil = await app.inject({
      method: 'POST',
      url: '/v1/me/roles',
      headers: { origin: 'https://evil.example', cookie: client.cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ role: 'PATIENT' }),
    });
    expect(evil.statusCode).toBe(403);
    expect(JSON.parse(evil.body).error.code).toBe('INVALID_ORIGIN');
    const native = await app.inject({
      method: 'POST',
      url: '/v1/me/roles',
      headers: { cookie: client.cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ role: 'PATIENT' }),
    });
    expect(native.statusCode).toBe(200);
  });
});

describe('MFA enforcement for privileged roles', () => {
  it('blocks staff endpoints without two-factor when enforcement is required', async () => {
    const strict = await createTestServer({ MFA_ENFORCEMENT: 'required' });
    try {
      const staff = await signUp(strict);
      await grantRole(staff.userId, 'CLINICAL_REVIEWER');
      const res = await clientFor(strict, staff.cookie).req({ method: 'GET', url: '/v1/admin/verification-queue' });
      expect(res.status).toBe(403);
      expect(res.json.error.code).toBe('MFA_REQUIRED');
    } finally {
      await strict.close();
    }
  });
});

describe('production configuration guard', () => {
  it('refuses to boot production with demo mode, dev tools, or MFA in warn mode', () => {
    expect(() => loadEnv({ ...process.env, NODE_ENV: 'production', DEMO_MODE: 'true' })).toThrow(/unsafe production configuration/);
    expect(() =>
      loadEnv({ ...process.env, NODE_ENV: 'production', DEMO_MODE: 'false', DEV_TOOLS_ENABLED: 'false', MFA_ENFORCEMENT: 'warn', AUTH_REQUIRE_EMAIL_VERIFICATION: 'true', DATABASE_URL_OWNER: '' }),
    ).toThrow(/MFA_ENFORCEMENT/);
  });
});
