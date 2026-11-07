import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { withContext } from '../src/db/client';
import { maskRecipient, normalizePhone } from '../src/notifications/phone';
import {
  createDeliveryProviders,
  createSmtpProvider,
  createTwilioProvider,
  createVonageProvider,
  DeliveryError,
  twilioSignature,
  verifyTwilioSignature,
  type DeliveryProviders,
  type EmailProvider,
  type SmsProvider,
} from '../src/notifications/providers';
import { NotificationRateLimited, NotificationUnavailable, Notifier } from '../src/notifications/service';
import { render } from '../src/notifications/templates';
import { DevOutbox } from '../src/integrations/messaging';
import { buildServer } from '../src/server';
import { createTestServer, grantRole, ownerPool, PASSWORD, signUp, type Client } from './helpers';

/**
 * ADR 0020. Every provider here is a LOCAL MOCK (an in-process HTTP or SMTP server). These tests
 * prove request formats, error classification, signatures and the delivery state machine; they do
 * not prove that a real Twilio / Vonage / mail account accepts the messages — that needs the
 * company's credentials and sender identities (see docs/release/SIGNING_AND_SECRETS.md).
 */

const owner = ownerPool();
afterAll(() => owner.end());
const silent = { warn: () => undefined };

// ------------------------------------------------------------------ helpers
type Seen = { method: string; url: string; headers: IncomingMessage['headers']; body: string };
async function mockHttp(handler: (req: Seen) => { status: number; json: unknown }): Promise<{ url: string; seen: Seen[]; close: () => Promise<void> }> {
  const seen: Seen[] = [];
  const server: Server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const s = { method: req.method!, url: req.url!, headers: req.headers, body };
    seen.push(s);
    const r = handler(s);
    res.writeHead(r.status, { 'content-type': 'application/json' }).end(JSON.stringify(r.json));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, close: () => new Promise((r) => server.close(() => r())) };
}

type Behaviour = 'ok' | 'transient' | 'permanent';
function fakeSms(name: string, plan: Behaviour[] | Behaviour, sent: { provider: string; to: string; body: string }[]): SmsProvider {
  let i = 0;
  return {
    name,
    async send(m) {
      const b = Array.isArray(plan) ? (plan[i++] ?? plan.at(-1)!) : plan;
      if (b === 'transient') throw new DeliveryError('TRANSIENT', `${name.toUpperCase()}_BUSY`);
      if (b === 'permanent') throw new DeliveryError('PERMANENT', `${name.toUpperCase()}_INVALID_NUMBER`);
      sent.push({ provider: name, to: m.to, body: m.body });
      return { providerMessageId: `${name}-${sent.length}-${Math.random().toString(36).slice(2, 8)}` };
    },
  };
}
function fakeEmail(name: string, sent: { to: string; subject: string; text: string; html: string }[]): EmailProvider {
  return {
    name,
    async send(m) {
      sent.push({ to: m.to, subject: m.subject, text: m.text, html: m.html });
      return { providerMessageId: `<${sent.length}@mock>` };
    },
  };
}
const providers = (email: EmailProvider[], sms: SmsProvider[]): DeliveryProviders => ({
  email,
  sms,
  mode: { email: email.length ? 'CONFIGURED' : 'NOT_CONFIGURED', sms: sms.length ? 'CONFIGURED' : 'NOT_CONFIGURED' },
});
const uniquePhone = () => `+2010${Math.floor(10000000 + Math.random() * 89999999)}`;
const row = async (where: string, args: unknown[]) => (await owner.query(`select * from app.notifications where ${where} order by created_at desc limit 1`, args)).rows[0];

// ------------------------------------------------------------------ pure units
describe('phone numbers (E.164, SMS country allow-list)', () => {
  it('normalises Egyptian mobiles written locally or internationally', () => {
    for (const input of ['01012345678', '+201012345678', '00201012345678', '+20 101 234 5678']) {
      expect(normalizePhone(input, { allowedCountries: ['EG'] })).toEqual({ ok: true, e164: '+201012345678', country: 'EG', mobile: true });
    }
  });
  it('accepts international numbers only for countries SMS may be sent to', () => {
    expect(normalizePhone('+44 7400 123456', { allowedCountries: ['EG'] })).toEqual({ ok: false, reason: 'COUNTRY_NOT_ALLOWED' });
    expect(normalizePhone('+44 7400 123456', { allowedCountries: ['EG', 'GB'] })).toMatchObject({ ok: true, e164: '+447400123456', country: 'GB' });
    expect(normalizePhone('+966 50 123 4567', { allowedCountries: ['EG', 'SA'] })).toMatchObject({ ok: true, e164: '+966501234567', country: 'SA' });
  });
  it('rejects invalid numbers and landlines (no SMS to fixed lines)', () => {
    expect(normalizePhone('12345', { allowedCountries: ['EG'] })).toEqual({ ok: false, reason: 'INVALID' });
    expect(normalizePhone('+20 10 123', { allowedCountries: ['EG'] })).toEqual({ ok: false, reason: 'INVALID' });
    expect(normalizePhone('02 2345 6789', { allowedCountries: ['EG'] })).toEqual({ ok: false, reason: 'NOT_MOBILE' });
  });
  it('masks recipients for logs and operator screens', () => {
    expect(maskRecipient('+201012345678')).toBe('+20•••••678');
    expect(maskRecipient('mona@example.com')).toBe('m•••@example.com');
  });
});

describe('templates', () => {
  it('renders Arabic right-to-left and escapes HTML in variables', () => {
    const r = render('booking.confirmed', 'ar', { provider: 'د. <b>منى</b>', type: 'كشف', date: '2026-12-01', time: '10:00', reference: 'BK-1' });
    expect(r.subject).toContain('تم تأكيد موعدك');
    expect(r.html).toContain('dir="rtl"');
    expect(r.html).toContain('&lt;b&gt;');
    expect(r.html).not.toContain('<b>');
    expect(r.sms).toContain('BK-1');
  });
  it('sign-in messages are bilingual; a missing variable is a programming error', () => {
    const r = render('auth.phone_otp', 'both', { code: '123456' });
    expect(r.sms).toMatch(/رمز التحقق 123456/);
    expect(r.sms).toMatch(/your code is 123456/);
    expect(() => render('booking.reminder', 'en', { provider: 'x' })).toThrow(/missing/);
  });
});

describe('Twilio request signatures', () => {
  // Known-answer vectors from Twilio's own library tests (twilio-node spec/validation.spec.js).
  const token = '12345';
  const params = { CallSid: 'CA1234567890ABCDE', Caller: '+14158675309', Digits: '1234', From: '+14158675309', To: '+18005551212' };
  const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
  it('matches the official test vectors', () => {
    expect(twilioSignature(token, url, params)).toBe('RSOYDt4T1cUTdK1PDd93/VVr8B8=');
    expect(verifyTwilioSignature(token, url, params, 'RSOYDt4T1cUTdK1PDd93/VVr8B8=')).toBe(true);
    expect(verifyTwilioSignature(token, url, params, 'kvajT1Ptam85bY51eRf/AJRuM3w=')).toBe(true); // signed with :443
    expect(verifyTwilioSignature(token, url.replace('.com', '.com:1234'), params, 'RSOYDt4T1cUTdK1PDd93/VVr8B8=')).toBe(true);
    expect(verifyTwilioSignature(token, url.replace('https', 'http').replace('.com', '.com:1234'), params, 'Zmvh+3yNM1Phv2jhDCwEM3q5ebU=')).toBe(true);
    expect(verifyTwilioSignature(token, url.replace('https', 'http'), params, '0ZXoZLH/DfblKGATFgpif+LLRf4=')).toBe(true); // signed with :80
  });
  it('rejects tampered parameters, another token, or a missing header', () => {
    expect(verifyTwilioSignature(token, url, { ...params, To: '+18005551213' }, 'RSOYDt4T1cUTdK1PDd93/VVr8B8=')).toBe(false);
    expect(verifyTwilioSignature('54321', url, params, 'RSOYDt4T1cUTdK1PDd93/VVr8B8=')).toBe(false);
    expect(verifyTwilioSignature(token, url, params, undefined)).toBe(false);
    expect(verifyTwilioSignature(token, url, params, 'short')).toBe(false);
  });
});

// ------------------------------------------------------------------ adapters against local mocks
describe('SMS adapters (local mock HTTP servers, not the real providers)', () => {
  it('Twilio: form fields, Basic auth, status callback; error classification', async () => {
    const mock = await mockHttp((r) => {
      const to = new URLSearchParams(r.body).get('To');
      if (to === '+201000000001') return { status: 400, json: { code: 21211, message: 'invalid To' } };
      if (to === '+201000000002') return { status: 429, json: { code: 20429, message: 'too many requests' } };
      return { status: 201, json: { sid: 'SM0123456789abcdef0123456789abcdef', status: 'queued' } };
    });
    try {
      const sid = `AC${'a'.repeat(32)}`;
      const p = createTwilioProvider({ accountSid: sid, authToken: 'tok-0123456789abcdef', messagingServiceSid: `MG${'b'.repeat(32)}`, statusCallback: 'https://api.example.test/v1/webhooks/twilio/status', baseUrl: mock.url });
      expect(await p.send({ to: '+201012345678', body: 'غير لي: رمز التحقق 123456' })).toEqual({ providerMessageId: 'SM0123456789abcdef0123456789abcdef' });
      const req = mock.seen[0]!;
      expect(req.url).toBe(`/2010-04-01/Accounts/${sid}/Messages.json`);
      expect(req.headers.authorization).toBe(`Basic ${Buffer.from(`${sid}:tok-0123456789abcdef`).toString('base64')}`);
      const form = new URLSearchParams(req.body);
      expect(form.get('To')).toBe('+201012345678');
      expect(form.get('MessagingServiceSid')).toBe(`MG${'b'.repeat(32)}`);
      expect(form.get('From')).toBeNull();
      expect(form.get('StatusCallback')).toBe('https://api.example.test/v1/webhooks/twilio/status');
      expect(form.get('Body')).toBe('غير لي: رمز التحقق 123456');
      await expect(p.send({ to: '+201000000001', body: 'x' })).rejects.toMatchObject({ kind: 'PERMANENT', code: 'TWILIO_21211' });
      await expect(p.send({ to: '+201000000002', body: 'x' })).rejects.toMatchObject({ kind: 'TRANSIENT', code: 'TWILIO_20429' });
    } finally {
      await mock.close();
    }
    const down = createTwilioProvider({ accountSid: `AC${'a'.repeat(32)}`, authToken: 'tok-0123456789abcdef', from: '+15005550006', baseUrl: 'http://127.0.0.1:1', timeoutMs: 2000 });
    await expect(down.send({ to: '+201012345678', body: 'x' })).rejects.toMatchObject({ kind: 'TRANSIENT', code: 'TWILIO_UNREACHABLE' });
  });

  it('Vonage: Unicode for Arabic, number without "+", status codes classified', async () => {
    const mock = await mockHttp((r) => {
      const to = new URLSearchParams(r.body).get('to');
      if (to === '201000000003') return { status: 200, json: { 'message-count': '1', messages: [{ status: '3', 'error-text': 'Invalid to' }] } };
      if (to === '201000000004') return { status: 200, json: { 'message-count': '1', messages: [{ status: '1', 'error-text': 'Throttled' }] } };
      return { status: 200, json: { 'message-count': '1', messages: [{ to, 'message-id': '0A0000000123ABCD1', status: '0' }] } };
    });
    try {
      const p = createVonageProvider({ apiKey: 'key12345', apiSecret: 'secret1234', from: 'DressMyWnd', callback: 'https://api.example.test/v1/webhooks/vonage/dlr/t', baseUrl: mock.url });
      expect(await p.send({ to: '+201012345678', body: 'غير لي: رمز التحقق 123456' })).toEqual({ providerMessageId: '0A0000000123ABCD1' });
      const form = new URLSearchParams(mock.seen[0]!.body);
      expect(mock.seen[0]!.url).toBe('/sms/json');
      expect(form.get('to')).toBe('201012345678');
      expect(form.get('type')).toBe('unicode');
      expect(form.get('callback')).toBe('https://api.example.test/v1/webhooks/vonage/dlr/t');
      expect(form.get('api_secret')).toBeNull(); // credentials only in the Authorization header
      await p.send({ to: '+201012345679', body: 'Dress My Wound: your code is 123456.' });
      expect(new URLSearchParams(mock.seen[1]!.body).get('type')).toBeNull();
      await expect(p.send({ to: '+201000000003', body: 'x' })).rejects.toMatchObject({ kind: 'PERMANENT', code: 'VONAGE_3' });
      await expect(p.send({ to: '+201000000004', body: 'x' })).rejects.toMatchObject({ kind: 'TRANSIENT', code: 'VONAGE_1' });
    } finally {
      await mock.close();
    }
  });
});

describe('SMTP adapter (in-process SMTP server, not a real mail service)', () => {
  let smtp: SMTPServer;
  let port: number;
  const received: { from: string; to: string[]; raw: string }[] = [];
  beforeAll(async () => {
    smtp = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      logger: false,
      onRcptTo(address, _session, cb) {
        if (address.address.startsWith('nobody@')) return cb(Object.assign(new Error('5.1.1 Mailbox unavailable: user unknown'), { responseCode: 550 }));
        cb();
      },
      onData(stream, session, cb) {
        let raw = '';
        stream.on('data', (c: Buffer) => (raw += c.toString('utf8')));
        stream.on('end', () => {
          received.push({ from: (session.envelope.mailFrom as { address: string }).address, to: session.envelope.rcptTo.map((r) => r.address), raw });
          cb();
        });
      },
    });
    smtp.listen(0, '127.0.0.1');
    await once(smtp.server, 'listening');
    port = (smtp.server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => smtp.close(() => r())));

  it('delivers text and HTML parts from the configured sender', async () => {
    const p = createSmtpProvider('smtp', `smtp://127.0.0.1:${port}`, 'Dress My Wound <no-reply@example.test>', { requireTls: false });
    const c = render('booking.reminder', 'en', { provider: 'Dr. Mona', type: 'clinic visit', date: '2026-12-01', time: '10:00' });
    const r = await p.send({ to: 'patient@example.test', subject: c.subject, text: c.text, html: c.html });
    expect(r.providerMessageId).toMatch(/@/);
    const mail = received.at(-1)!;
    expect(mail.from).toBe('no-reply@example.test');
    expect(mail.to).toEqual(['patient@example.test']);
    expect(mail.raw).toMatch(/Subject: =\?UTF-8\?Q\?Appointment_reminder/);
    expect(mail.raw).toMatch(/text\/plain/);
    expect(mail.raw).toMatch(/text\/html/);
  });

  it('classifies an unknown mailbox as permanent and an unreachable server as transient', async () => {
    const p = createSmtpProvider('smtp', `smtp://127.0.0.1:${port}`, 'no-reply@example.test', { requireTls: false });
    await expect(p.send({ to: 'nobody@example.test', subject: 's', text: 't', html: '<p>t</p>' })).rejects.toMatchObject({ kind: 'PERMANENT', code: 'SMTP_550' });
    const down = createSmtpProvider('smtp', 'smtp://127.0.0.1:1', 'no-reply@example.test', { requireTls: false, timeoutMs: 2000 });
    await expect(down.send({ to: 'patient@example.test', subject: 's', text: 't', html: '<p>t</p>' })).rejects.toMatchObject({ kind: 'TRANSIENT' });
  });

  it('refuses plaintext SMTP when TLS is required (production)', async () => {
    const p = createSmtpProvider('smtp', `smtp://127.0.0.1:${port}`, 'no-reply@example.test', { requireTls: true, timeoutMs: 2000 });
    await expect(p.send({ to: 'patient@example.test', subject: 's', text: 't', html: '<p>t</p>' })).rejects.toBeInstanceOf(DeliveryError);
  });
});

describe('provider wiring', () => {
  const base = { ...process.env, API_PUBLIC_URL: 'https://api.example.test' };
  it('nothing is configured without credentials AND a sender identity', () => {
    const env = loadEnv({ ...base, DEV_TOOLS_ENABLED: 'false', SMS_PROVIDERS: 'twilio,vonage', TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`, TWILIO_AUTH_TOKEN: 'tok-0123456789abcdef', VONAGE_API_KEY: 'key12345', EMAIL_SMTP_URL: 'smtp://mail.example.test:587' });
    const d = createDeliveryProviders(env, null, () => undefined);
    expect(d.mode).toEqual({ email: 'NOT_CONFIGURED', sms: 'NOT_CONFIGURED' });
    expect(d.email).toEqual([]);
    expect(d.sms).toEqual([]);
  });
  it('real providers follow the configured failover order; the dev outbox is never added next to them', () => {
    const env = loadEnv({
      ...base,
      SMS_PROVIDERS: 'vonage,twilio',
      TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
      TWILIO_AUTH_TOKEN: 'tok-0123456789abcdef',
      TWILIO_FROM: '+15005550006',
      VONAGE_API_KEY: 'key12345',
      VONAGE_API_SECRET: 'secret1234',
      VONAGE_FROM: 'DressMyWnd',
      EMAIL_SMTP_URL: 'smtp://mail.example.test:587',
      EMAIL_FROM: 'no-reply@example.test',
    });
    const d = createDeliveryProviders(env, new DevOutbox(), () => undefined);
    expect(d.sms.map((p) => p.name)).toEqual(['vonage', 'twilio']);
    expect(d.email.map((p) => p.name)).toEqual(['smtp']);
    expect(d.mode).toEqual({ email: 'CONFIGURED', sms: 'CONFIGURED' });
  });
  it('the development adapter exists only with DEV_TOOLS_ENABLED outside production', () => {
    const dev = createDeliveryProviders(loadEnv({ ...base, DEV_TOOLS_ENABLED: 'true' }), new DevOutbox(), () => undefined);
    expect(dev.mode).toEqual({ email: 'DEV_ADAPTER', sms: 'DEV_ADAPTER' });
    const off = createDeliveryProviders(loadEnv({ ...base, DEV_TOOLS_ENABLED: 'false' }), new DevOutbox(), () => undefined);
    expect(off.mode).toEqual({ email: 'NOT_CONFIGURED', sms: 'NOT_CONFIGURED' });
  });
  it('the development adapter never prints message contents (codes stay out of logs)', async () => {
    const lines: string[] = [];
    const d = createDeliveryProviders(loadEnv({ ...base, DEV_TOOLS_ENABLED: 'true' }), new DevOutbox(), (l) => lines.push(l));
    await d.sms[0]!.send({ to: '+201012345678', body: 'your code is 482913', purpose: 'auth.phone_otp' });
    await d.email[0]!.send({ to: 'a@example.test', subject: 'Reset', text: 'https://app/reset-password/SECRET', html: '', purpose: 'auth.password_reset' });
    expect(lines.join('\n')).not.toMatch(/482913|SECRET|201012345678/);
  });
});

// ------------------------------------------------------------------ outbox, worker and receipts (database)
describe('delivery queue and worker', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await createTestServer();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await owner.query("update app.notifications set status = 'CANCELLED' where status in ('QUEUED', 'SENDING')");
  });
  const queue = (n: Notifier, req: Parameters<Notifier['queue']>[1]) => withContext(app.services.db, { userId: null, demoMode: false }, (tx) => n.queue(tx, req));
  const due = (id: string) => owner.query("update app.notifications set next_attempt_at = now() - interval '1 second' where id = $1", [id]);

  it('a queued message is delivered once and recorded as SENT, idempotent per dedupe key', async () => {
    const sent: { to: string; subject: string; text: string; html: string }[] = [];
    const n = new Notifier(app.services.db, providers([fakeEmail('smtp', sent)], []), silent);
    const key = `test:${Math.random()}:confirmed`;
    const req = { channel: 'EMAIL' as const, to: 'patient@example.test', purpose: 'booking.confirmed' as const, locale: 'ar' as const, vars: { provider: 'د. منى', type: 'كشف', date: '2026-12-01', time: '10:00', reference: 'BK-7' }, dedupeKey: key };
    await queue(n, req);
    await queue(n, req);
    expect((await owner.query('select count(*)::int as n from app.notifications where dedupe_key = $1', [key])).rows[0].n).toBe(1);
    expect(await n.processDue()).toBe(1);
    expect(await n.processDue()).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.html).toContain('dir="rtl"');
    const r = await row('dedupe_key = $1', [key]);
    expect(r).toMatchObject({ status: 'SENT', provider: 'smtp', attempts: 1, last_error: null });
    expect(r.provider_message_id).toBe('<1@mock>');
  });

  it('fails over to the next provider on a transient error', async () => {
    const sent: { provider: string; to: string; body: string }[] = [];
    const n = new Notifier(app.services.db, providers([], [fakeSms('twilio', 'transient', sent), fakeSms('vonage', 'ok', sent)]), silent);
    const to = uniquePhone();
    await queue(n, { channel: 'SMS', to, purpose: 'booking.reminder', locale: 'en', vars: { provider: 'Dr. Mona', type: 'clinic', date: '2026-12-01', time: '10:00' } });
    await n.processDue();
    expect(sent).toEqual([expect.objectContaining({ provider: 'vonage', to })]);
    expect(await row('recipient = $1', [to])).toMatchObject({ status: 'SENT', provider: 'vonage' });
  });

  it('retries transient failures with backoff, then gives up as FAILED', async () => {
    const sent: { provider: string; to: string; body: string }[] = [];
    const n = new Notifier(app.services.db, providers([], [fakeSms('twilio', 'transient', sent)]), silent);
    const to = uniquePhone();
    await queue(n, { channel: 'SMS', to, purpose: 'order.status', locale: 'ar', vars: { reference: 'OR-1', status: 'تم الشحن' } });
    await n.processDue();
    let r = await row('recipient = $1', [to]);
    expect(r).toMatchObject({ status: 'QUEUED', attempts: 1, last_error: 'TWILIO_BUSY', provider: 'twilio' });
    const wait = (new Date(r.next_attempt_at).getTime() - Date.now()) / 1000;
    expect(wait).toBeGreaterThan(50);
    expect(wait).toBeLessThan(70);
    expect(await n.processDue()).toBe(0); // not due yet
    for (let i = 2; i <= 5; i++) {
      await due(r.id);
      await n.processDue();
    }
    r = await row('recipient = $1', [to]);
    expect(r).toMatchObject({ status: 'FAILED', attempts: 5 });
    expect(sent).toHaveLength(0);
  });

  it('a permanent failure is UNDELIVERABLE at once and not retried', async () => {
    const n = new Notifier(app.services.db, providers([], [fakeSms('twilio', 'permanent', []), fakeSms('vonage', 'ok', [])]), silent);
    const to = uniquePhone();
    await queue(n, { channel: 'SMS', to, purpose: 'payment.failed', locale: 'en', vars: { reference: 'OR-2' } });
    await n.processDue();
    expect(await row('recipient = $1', [to])).toMatchObject({ status: 'UNDELIVERABLE', attempts: 1, last_error: 'TWILIO_INVALID_NUMBER' });
  });

  it('without a configured provider nothing is sent and no attempt is spent', async () => {
    const n = new Notifier(app.services.db, providers([], []), silent);
    const to = uniquePhone();
    await queue(n, { channel: 'SMS', to, purpose: 'payment.refunded', locale: 'en', vars: { reference: 'OR-3', amount: 'EGP 10.00' } });
    await n.processDue();
    expect(await row('recipient = $1', [to])).toMatchObject({ status: 'QUEUED', attempts: 0, last_error: 'NOT_CONFIGURED' });
  });

  it('expired, cancelled and future messages are not sent', async () => {
    const sent: { provider: string; to: string; body: string }[] = [];
    const n = new Notifier(app.services.db, providers([], [fakeSms('twilio', 'ok', sent)]), silent);
    const [a, b, c] = [uniquePhone(), uniquePhone(), uniquePhone()];
    const vars = { provider: 'Dr. Mona', type: 'clinic', date: '2026-12-01', time: '10:00' };
    await queue(n, { channel: 'SMS', to: a, purpose: 'booking.reminder', locale: 'en', vars, expiresAt: new Date(Date.now() - 1000) });
    const related = { type: 'appointment', id: crypto.randomUUID() };
    await queue(n, { channel: 'SMS', to: b, purpose: 'booking.reminder', locale: 'en', vars, related });
    await withContext(app.services.db, { userId: null, demoMode: false }, (tx) => n.cancelRelated(tx, related.type, related.id, ['booking.reminder']));
    await queue(n, { channel: 'SMS', to: c, purpose: 'booking.reminder', locale: 'en', vars, sendAfter: new Date(Date.now() + 3_600_000) });
    await n.processDue();
    expect(sent).toHaveLength(0);
    expect((await row('recipient = $1', [a])).status).toBe('EXPIRED');
    expect((await row('recipient = $1', [b])).status).toBe('CANCELLED');
    expect((await row('recipient = $1', [c])).status).toBe('QUEUED');
  });

  it('two workers never deliver the same message twice', async () => {
    const sent: { provider: string; to: string; body: string }[] = [];
    const slow: SmsProvider = { name: 'twilio', send: async (m) => (await new Promise((r) => setTimeout(r, 20)), sent.push({ provider: 'twilio', to: m.to, body: m.body }), { providerMessageId: `SM${sent.length}` }) };
    const n1 = new Notifier(app.services.db, providers([], [slow]), silent);
    const n2 = new Notifier(app.services.db, providers([], [slow]), silent);
    const phones = Array.from({ length: 12 }, uniquePhone);
    for (const to of phones) await queue(n1, { channel: 'SMS', to, purpose: 'order.status', locale: 'en', vars: { reference: 'OR-4', status: 'shipped' } });
    const [x, y] = await Promise.all([n1.processDue(5), n2.processDue(5)]);
    const [z] = await Promise.all([n1.processDue(50)]);
    expect(x + y + z).toBe(12);
    expect(new Set(sent.map((s) => s.to)).size).toBe(12);
    expect(sent).toHaveLength(12);
  });

  it('secret messages: sent at once, never stored, capped per recipient, refused from the queue', async () => {
    const sent: { provider: string; to: string; body: string }[] = [];
    const n = new Notifier(app.services.db, providers([], [fakeSms('twilio', 'ok', sent)]), silent);
    const to = uniquePhone();
    for (let i = 0; i < 5; i++) await n.sendSecret({ channel: 'SMS', to, purpose: 'auth.phone_otp', vars: { code: `48291${i}` } });
    await expect(n.sendSecret({ channel: 'SMS', to, purpose: 'auth.phone_otp', vars: { code: '999999' } })).rejects.toBeInstanceOf(NotificationRateLimited);
    expect(sent).toHaveLength(5);
    const rows = (await owner.query('select status, secret, subject, body from app.notifications where recipient = $1', [to])).rows;
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.secret && r.body === null && r.subject === null && r.status === 'SENT')).toBe(true);
    expect(JSON.stringify(await owner.query("select * from app.notifications where recipient = $1", [to]).then((r) => r.rows))).not.toMatch(/48291/);
    // The database refuses a secret row with content, whatever the code does.
    await expect(owner.query("insert into app.notifications (channel, purpose, locale, recipient, secret, body) values ('SMS', 'auth.phone_otp', 'en', $1, true, 'code 1')", [to])).rejects.toThrow(/secret_never_stored/);
    await expect(withContext(app.services.db, { userId: null, demoMode: false }, (tx) => n.queue(tx, { channel: 'SMS', to, purpose: 'auth.phone_otp' as never, locale: 'en', vars: { code: '1' } }))).rejects.toThrow(/never queued/);
  });

  it('a secret message that cannot be delivered is refused, and the failure is recorded without content', async () => {
    const to = uniquePhone();
    const none = new Notifier(app.services.db, providers([], []), silent);
    await expect(none.sendSecret({ channel: 'SMS', to, purpose: 'auth.phone_otp', vars: { code: '111111' } })).rejects.toBeInstanceOf(NotificationUnavailable);
    const down = new Notifier(app.services.db, providers([], [fakeSms('twilio', 'transient', []), fakeSms('vonage', 'transient', [])]), silent);
    await expect(down.sendSecret({ channel: 'SMS', to, purpose: 'auth.phone_otp', vars: { code: '222222' } })).rejects.toBeInstanceOf(DeliveryError);
    const rows = (await owner.query('select status, last_error, provider, body from app.notifications where recipient = $1 order by created_at', [to])).rows;
    expect(rows).toEqual([
      { status: 'FAILED', last_error: 'NOT_CONFIGURED', provider: null, body: null },
      { status: 'FAILED', last_error: 'VONAGE_BUSY', provider: 'vonage', body: null },
    ]);
  });

  it('receipts never move a message backwards', async () => {
    const n = new Notifier(app.services.db, providers([], [fakeSms('twilio', 'ok', [])]), silent);
    const to = uniquePhone();
    await queue(n, { channel: 'SMS', to, purpose: 'order.status', locale: 'en', vars: { reference: 'OR-5', status: 'shipped' } });
    await n.processDue();
    const { provider_message_id: id } = await row('recipient = $1', [to]);
    expect(await n.recordReceipt('twilio', id, 'DELIVERED')).toBe(true);
    expect(await n.recordReceipt('twilio', id, 'SENT')).toBe(true);
    const r = await row('recipient = $1', [to]);
    expect(r.status).toBe('DELIVERED');
    expect(r.delivered_at).not.toBeNull();
    expect(await n.recordReceipt('vonage', id, 'DELIVERED')).toBe(false); // another provider's id space
    expect(await n.recordReceipt('twilio', 'SM-unknown', 'DELIVERED')).toBe(false);
  });

  it('message history is kept only for its retention period and removed with the account', async () => {
    const n = new Notifier(app.services.db, providers([], []), silent);
    const [old1, old2, recent] = [uniquePhone(), uniquePhone(), uniquePhone()];
    await owner.query("insert into app.notifications (channel, purpose, locale, recipient, secret, status, created_at) values ('SMS', 'auth.phone_otp', 'en', $1, true, 'SENT', now() - interval '31 days')", [old1]);
    await owner.query("insert into app.notifications (channel, purpose, locale, recipient, body, status, created_at) values ('SMS', 'order.status', 'en', $1, 'x', 'DELIVERED', now() - interval '181 days')", [old2]);
    await owner.query("insert into app.notifications (channel, purpose, locale, recipient, body, status, created_at) values ('SMS', 'order.status', 'en', $1, 'x', 'DELIVERED', now() - interval '20 days')", [recent]);
    expect(await n.applyRetention()).toBeGreaterThanOrEqual(2);
    expect(await row('recipient = $1', [old1])).toBeUndefined();
    expect(await row('recipient = $1', [old2])).toBeUndefined();
    expect(await row('recipient = $1', [recent])).toBeDefined();

    const user = await signUp(app, {});
    expect((await owner.query('select count(*)::int as n from app.notifications where recipient_user_id = $1', [user.userId])).rows[0].n).toBe(1); // verification e-mail metadata
    const del = await user.req({ method: 'POST', url: '/v1/me/account-deletion', body: { confirmation: 'delete', password: PASSWORD } });
    expect(del.status, JSON.stringify(del.json)).toBe(200);
    expect((await owner.query('select count(*)::int as n from app.notifications where recipient_user_id = $1', [user.userId])).rows[0].n).toBe(0);
  });

  it('the claim function is system-only', async () => {
    const user = await signUp(app, {});
    await expect(withContext(app.services.db, { userId: user.userId, demoMode: false }, (tx) => tx.execute(sql`select * from app.notifications_claim(1)`))).rejects.toMatchObject({ cause: expect.objectContaining({ message: 'SYSTEM_ONLY' }) });
  });
});

// ------------------------------------------------------------------ webhooks and operations endpoints
describe('delivery receipt webhooks', () => {
  const TOKEN = 'twilio-test-token-0123456789';
  const VONAGE_TOKEN = 'vonage_receipt_token_0123456789';
  let app: FastifyInstance;
  beforeAll(async () => {
    const env = loadEnv({ ...process.env, API_PUBLIC_URL: 'https://api.example.test', TWILIO_AUTH_TOKEN: TOKEN, VONAGE_WEBHOOK_TOKEN: VONAGE_TOKEN, VONAGE_API_KEY: 'key12345' });
    app = await buildServer(env, { delivery: providers([], [fakeSms('twilio', 'ok', [])]) });
    await app.ready();
  });
  afterAll(() => app.close());

  const sentMessage = async (provider: 'twilio' | 'vonage') => {
    const to = uniquePhone();
    const id = `${provider}-${crypto.randomUUID()}`;
    await owner.query("insert into app.notifications (channel, purpose, locale, recipient, body, status, provider, provider_message_id, sent_at) values ('SMS', 'order.status', 'en', $1, 'x', 'SENT', $2, $3, now())", [to, provider, id]);
    return { to, id };
  };
  const twilioPost = (params: Record<string, string>, signature?: string) =>
    app.inject({ method: 'POST', url: '/v1/webhooks/twilio/status', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(signature ? { 'x-twilio-signature': signature } : {}) }, payload: new URLSearchParams(params).toString() });

  it('Twilio: accepts a correctly signed receipt and rejects forged or replayed-with-changes ones', async () => {
    const { to, id } = await sentMessage('twilio');
    const url = 'https://api.example.test/v1/webhooks/twilio/status';
    const params = { MessageSid: id, MessageStatus: 'delivered', To: to, AccountSid: `AC${'a'.repeat(32)}` };
    expect((await twilioPost(params)).statusCode).toBe(403);
    expect((await twilioPost(params, twilioSignature('wrong-token-0123456789', url, params))).statusCode).toBe(403);
    expect((await twilioPost({ ...params, MessageStatus: 'undelivered' }, twilioSignature(TOKEN, url, params))).statusCode).toBe(403);
    expect((await row('recipient = $1', [to])).status).toBe('SENT');
    expect((await twilioPost(params, twilioSignature(TOKEN, url, params))).statusCode).toBe(204);
    expect((await row('recipient = $1', [to])).status).toBe('DELIVERED');
    // A replay of an earlier "sent" receipt does not move it backwards.
    const sentParams = { ...params, MessageStatus: 'sent' };
    expect((await twilioPost(sentParams, twilioSignature(TOKEN, url, sentParams))).statusCode).toBe(204);
    expect((await row('recipient = $1', [to])).status).toBe('DELIVERED');
  });

  it('Vonage: the secret path token (and api-key, when sent) must match; GET and POST receipts', async () => {
    const a = await sentMessage('vonage');
    expect((await app.inject({ method: 'POST', url: `/v1/webhooks/vonage/dlr/${'x'.repeat(31)}`, payload: { messageId: a.id, status: 'delivered' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/v1/webhooks/vonage/dlr/${VONAGE_TOKEN}`, payload: { messageId: a.id, status: 'delivered', 'api-key': 'someone-else' } })).statusCode).toBe(404);
    expect((await row('recipient = $1', [a.to])).status).toBe('SENT');
    expect((await app.inject({ method: 'POST', url: `/v1/webhooks/vonage/dlr/${VONAGE_TOKEN}`, payload: { messageId: a.id, status: 'failed', 'err-code': '1', 'api-key': 'key12345' } })).statusCode).toBe(204);
    expect(await row('recipient = $1', [a.to])).toMatchObject({ status: 'UNDELIVERABLE', last_error: 'VONAGE_DLR_1' });
    const b = await sentMessage('vonage');
    expect((await app.inject({ method: 'GET', url: `/v1/webhooks/vonage/dlr/${VONAGE_TOKEN}?messageId=${b.id}&status=delivered&err-code=0` })).statusCode).toBe(204);
    expect((await row('recipient = $1', [b.to])).status).toBe('DELIVERED');
  });

  it('receipt endpoints do not exist when the provider is not configured', async () => {
    const plain = await createTestServer();
    try {
      expect((await plain.inject({ method: 'POST', url: '/v1/webhooks/twilio/status', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'MessageSid=SM1&MessageStatus=delivered' })).statusCode).toBe(404);
      expect((await plain.inject({ method: 'POST', url: `/v1/webhooks/vonage/dlr/${VONAGE_TOKEN}`, payload: { messageId: '1', status: 'delivered' } })).statusCode).toBe(404);
    } finally {
      await plain.close();
    }
  });

  it('webhook routes keep JSON-only parsing elsewhere', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/me/consents', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'a=b' });
    expect(r.statusCode).toBe(415);
  });
});

describe('operations view of message delivery', () => {
  let app: FastifyInstance;
  let admin: Client;
  let commerce: Client;
  let patient: Client;
  beforeAll(async () => {
    app = await createTestServer();
    admin = await signUp(app, { name: 'Ops Admin' });
    await grantRole(admin.userId, 'ADMIN');
    commerce = await signUp(app, { name: 'Commerce' });
    await grantRole(commerce.userId, 'COMMERCE_MANAGER');
    patient = await signUp(app, { role: 'PATIENT' });
  });
  afterAll(() => app.close());

  it('only operations staff see deliveries, with masked recipients and no message contents', async () => {
    const to = uniquePhone();
    await owner.query("insert into app.notifications (channel, purpose, locale, recipient, body, status, attempts, last_error) values ('SMS', 'order.status', 'en', $1, 'Your order OR-9 is now: shipped', 'FAILED', 5, 'TWILIO_BUSY')", [to]);
    expect((await patient.req({ method: 'GET', url: '/v1/admin/ops/notifications' })).status).toBe(403);
    expect((await commerce.req({ method: 'GET', url: '/v1/admin/ops/notifications' })).status).toBe(403);
    const r = await admin.req({ method: 'GET', url: '/v1/admin/ops/notifications?status=FAILED' });
    expect(r.status).toBe(200);
    expect(r.json.delivery).toEqual({ email: 'DEV_ADAPTER', sms: 'DEV_ADAPTER' });
    const m = r.json.messages.find((x: { recipient: string }) => x.recipient === maskRecipient(to));
    expect(m).toMatchObject({ status: 'FAILED', purpose: 'order.status', last_error: 'TWILIO_BUSY' });
    expect(JSON.stringify(r.json)).not.toContain(to);
    expect(JSON.stringify(r.json)).not.toContain('OR-9');
    expect(r.json.last7Days.FAILED).toBeGreaterThanOrEqual(1);
  });

  it('a failed message can be retried by ops.manage (audited); secret or delivered ones cannot', async () => {
    const to = uniquePhone();
    const failed = (await owner.query("insert into app.notifications (channel, purpose, locale, recipient, body, status, attempts) values ('SMS', 'order.status', 'en', $1, 'x', 'FAILED', 5) returning id", [to])).rows[0].id;
    const secret = (await owner.query("insert into app.notifications (channel, purpose, locale, recipient, secret, status, attempts) values ('SMS', 'auth.phone_otp', 'en', $1, true, 'FAILED', 1) returning id", [to])).rows[0].id;
    expect((await commerce.req({ method: 'POST', url: `/v1/admin/ops/notifications/${failed}/retry` })).status).toBe(403);
    expect((await admin.req({ method: 'POST', url: `/v1/admin/ops/notifications/${secret}/retry` })).status).toBe(409);
    expect((await admin.req({ method: 'POST', url: `/v1/admin/ops/notifications/${failed}/retry` })).status).toBe(200);
    expect((await admin.req({ method: 'POST', url: `/v1/admin/ops/notifications/${failed}/retry` })).status).toBe(409);
    expect((await owner.query('select status, attempts from app.notifications where id = $1', [failed])).rows[0]).toEqual({ status: 'QUEUED', attempts: 0 });
    expect((await owner.query("select count(*)::int as n from app.audit_log where action = 'ops.notification.retry' and entity_id = $1", [failed])).rows[0].n).toBe(1);
  });

  it('application users cannot read the outbox through the database either', async () => {
    const rows = await withContext(app.services.db, { userId: patient.userId, demoMode: false }, async (tx) => (await tx.execute(sql`select count(*)::int as n from app.notifications`)).rows[0] as { n: number });
    expect(rows.n).toBe(0);
  });
});

describe('sign-in codes over the HTTP API', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await createTestServer({ SMS_ALLOWED_COUNTRIES: 'EG,SA' });
  });
  afterAll(() => app.close());
  const sendOtp = (phoneNumber: string) => app.inject({ method: 'POST', url: '/api/auth/phone-number/send-otp', headers: { origin: 'http://localhost:8081', 'content-type': 'application/json' }, payload: JSON.stringify({ phoneNumber }) });

  it('accepts allowed countries in E.164 only and caps codes per number', async () => {
    expect((await sendOtp('+447400123456')).statusCode).toBe(400);
    expect((await sendOtp('01012345678')).statusCode).toBe(400); // must already be E.164
    const sa = `+96650${Math.floor(1000000 + Math.random() * 8999999)}`;
    expect((await sendOtp(sa)).statusCode).toBe(200);
    const eg = uniquePhone();
    for (let i = 0; i < 5; i++) expect((await sendOtp(eg)).statusCode).toBe(200);
    const sixth = await sendOtp(eg);
    expect(sixth.statusCode).toBe(429);
    expect(JSON.parse(sixth.body).code).toBe('TOO_MANY_MESSAGES');
    const stored = (await owner.query('select body, subject, secret from app.notifications where recipient = $1', [eg])).rows;
    expect(stored).toHaveLength(5);
    expect(stored.every((r) => r.secret && r.body === null)).toBe(true);
  });
});
