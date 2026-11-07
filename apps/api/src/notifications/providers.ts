import { createHmac, timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type { Env } from '../config/env';
import type { DevOutbox } from '../integrations/messaging';
import { maskRecipient } from './phone';

/**
 * Delivery providers (ADR 0020). Each one is CONFIGURED only when its credentials AND its sender
 * identity (From address / sender ID) are set; without them nothing is sent. Errors are classified:
 *   TRANSIENT — retry later or fail over to the next configured provider (network, 5xx, throttling);
 *   PERMANENT — the recipient cannot receive this message (invalid number, unknown mailbox).
 * Provider secrets are only ever placed in request headers; they are never logged or returned.
 */
export class DeliveryError extends Error {
  constructor(
    readonly kind: 'TRANSIENT' | 'PERMANENT',
    readonly code: string,
  ) {
    super(code);
    this.name = 'DeliveryError';
  }
}

export type SendResult = { providerMessageId: string | null };

export interface EmailProvider {
  readonly name: string;
  send(m: { to: string; subject: string; text: string; html: string; purpose?: string }): Promise<SendResult>;
}
export interface SmsProvider {
  readonly name: string;
  send(m: { to: string; body: string; purpose?: string }): Promise<SendResult>;
}

// ---------------------------------------------------------------- e-mail (SMTP)
/**
 * SMTP works with every transactional mail service (Amazon SES, Mailgun, SendGrid, Postmark, a
 * corporate relay). TLS is required outside development: `smtps://` (465) or STARTTLS on 587.
 */
export function createSmtpProvider(name: string, url: string, from: string, opts: { requireTls: boolean; timeoutMs?: number }): EmailProvider {
  const transport = nodemailer.createTransport({
    url,
    requireTLS: opts.requireTls,
    connectionTimeout: opts.timeoutMs ?? 10_000,
    greetingTimeout: opts.timeoutMs ?? 10_000,
    socketTimeout: opts.timeoutMs ?? 20_000,
  } as SMTPTransport.Options);
  return {
    name,
    async send(m) {
      try {
        const info = await transport.sendMail({ from, to: m.to, subject: m.subject, text: m.text, html: m.html, disableFileAccess: true, disableUrlAccess: true });
        if (info.rejected?.length) throw new DeliveryError('PERMANENT', 'SMTP_RECIPIENT_REJECTED');
        return { providerMessageId: (info.messageId ?? '').slice(0, 120) || null };
      } catch (e) {
        if (e instanceof DeliveryError) throw e;
        const code = (e as { responseCode?: number }).responseCode;
        // 5xx on a recipient = permanent (unknown mailbox, rejected); 4xx / network = try again.
        if (code && code >= 500 && code < 600 && /recipient|mailbox|user|address/i.test(String((e as Error).message))) throw new DeliveryError('PERMANENT', `SMTP_${code}`);
        throw new DeliveryError('TRANSIENT', code ? `SMTP_${code}` : 'SMTP_UNAVAILABLE');
      }
    },
  };
}

// ---------------------------------------------------------------- SMS: Twilio
const TWILIO_PERMANENT = new Set([21211, 21212, 21214, 21217, 21219, 21401, 21407, 21408, 21610, 21612, 21614]);

export function createTwilioProvider(cfg: { accountSid: string; authToken: string; from?: string; messagingServiceSid?: string; statusCallback?: string; baseUrl?: string; timeoutMs?: number }): SmsProvider {
  const base = cfg.baseUrl ?? 'https://api.twilio.com';
  const auth = `Basic ${Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64')}`;
  return {
    name: 'twilio',
    async send(m) {
      const form = new URLSearchParams({ To: m.to, Body: m.body });
      if (cfg.messagingServiceSid) form.set('MessagingServiceSid', cfg.messagingServiceSid);
      else form.set('From', cfg.from!);
      if (cfg.statusCallback) form.set('StatusCallback', cfg.statusCallback);
      let res: Response;
      try {
        res = await fetch(`${base}/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`, {
          method: 'POST',
          headers: { authorization: auth, 'content-type': 'application/x-www-form-urlencoded' },
          body: form,
          signal: AbortSignal.timeout(cfg.timeoutMs ?? 10_000),
        });
      } catch {
        throw new DeliveryError('TRANSIENT', 'TWILIO_UNREACHABLE');
      }
      const json = (await res.json().catch(() => ({}))) as { sid?: string; code?: number; status?: string };
      if (res.ok && json.sid) return { providerMessageId: json.sid };
      if (json.code && TWILIO_PERMANENT.has(json.code)) throw new DeliveryError('PERMANENT', `TWILIO_${json.code}`);
      throw new DeliveryError('TRANSIENT', `TWILIO_${json.code ?? res.status}`);
    },
  };
}

/**
 * Twilio request signature (X-Twilio-Signature): HMAC-SHA1 with the auth token over the full
 * callback URL followed by every POST parameter, sorted by name, as name+value with no separator,
 * Base64-encoded. Checked with and without the default port, as Twilio's own validator does.
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

export function verifyTwilioSignature(authToken: string, url: string, params: Record<string, string>, header: string | undefined): boolean {
  if (!header) return false;
  const u = new URL(url);
  const withoutPort = `${u.protocol}//${u.hostname}${u.pathname}${u.search}`;
  const withPort = `${u.protocol}//${u.hostname}:${u.port || (u.protocol === 'https:' ? '443' : '80')}${u.pathname}${u.search}`;
  const given = Buffer.from(header);
  return [withoutPort, withPort].some((candidate) => {
    const expected = Buffer.from(twilioSignature(authToken, candidate, params));
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
}

// ---------------------------------------------------------------- SMS: Vonage
// Status codes of the Vonage SMS API: 1 throttled, 5 internal error, 9 partner quota exceeded → retry.
const VONAGE_TRANSIENT = new Set(['1', '4', '5', '8', '9']);
const GSM_7 = /^[\n\r @£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/;

export function createVonageProvider(cfg: { apiKey: string; apiSecret: string; from: string; callback?: string; baseUrl?: string; timeoutMs?: number }): SmsProvider {
  const base = cfg.baseUrl ?? 'https://rest.nexmo.com';
  const auth = `Basic ${Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString('base64')}`;
  return {
    name: 'vonage',
    async send(m) {
      const form = new URLSearchParams({ from: cfg.from, to: m.to.replace(/^\+/, ''), text: m.body });
      // Arabic (and anything outside GSM 03.38) needs Unicode encoding.
      if (!GSM_7.test(m.body)) form.set('type', 'unicode');
      if (cfg.callback) form.set('callback', cfg.callback);
      let res: Response;
      try {
        res = await fetch(`${base}/sms/json`, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/x-www-form-urlencoded' }, body: form, signal: AbortSignal.timeout(cfg.timeoutMs ?? 10_000) });
      } catch {
        throw new DeliveryError('TRANSIENT', 'VONAGE_UNREACHABLE');
      }
      const json = (await res.json().catch(() => ({}))) as { messages?: { status?: string; 'message-id'?: string }[] };
      const first = json.messages?.[0];
      if (res.ok && first?.status === '0' && first['message-id']) return { providerMessageId: first['message-id'] };
      const status = first?.status ?? String(res.status);
      throw new DeliveryError(VONAGE_TRANSIENT.has(status) || res.status >= 500 ? 'TRANSIENT' : 'PERMANENT', `VONAGE_${status}`);
    },
  };
}

// ---------------------------------------------------------------- development outbox
/** Development only: kept in memory for the developer outbox; secret contents are never printed. */
export function createDevEmailProvider(outbox: DevOutbox, log: (line: string) => void): EmailProvider {
  return {
    name: 'dev-outbox',
    async send(m) {
      const r = outbox.push({ channel: 'email', to: m.to, subject: m.subject, body: m.text, purpose: m.purpose ?? 'email' });
      log(`[dev-outbox] email → ${maskRecipient(m.to)} — content in the developer outbox only`);
      return { providerMessageId: `dev-${r.id}` };
    },
  };
}
export function createDevSmsProvider(outbox: DevOutbox, log: (line: string) => void): SmsProvider {
  return {
    name: 'dev-outbox',
    async send(m) {
      const r = outbox.push({ channel: 'sms', to: m.to, body: m.body, purpose: m.purpose ?? 'sms' });
      log(`[dev-outbox] sms → ${maskRecipient(m.to)} — content in the developer outbox only`);
      return { providerMessageId: `dev-${r.id}` };
    },
  };
}

// ---------------------------------------------------------------- wiring
export type DeliveryProviders = { email: EmailProvider[]; sms: SmsProvider[]; mode: { email: 'CONFIGURED' | 'DEV_ADAPTER' | 'NOT_CONFIGURED'; sms: 'CONFIGURED' | 'DEV_ADAPTER' | 'NOT_CONFIGURED' } };

/**
 * Real providers in the order given by SMS_PROVIDERS (failover), only when their credentials and
 * sender identity exist. With none configured: the developer outbox when DEV_TOOLS_ENABLED (never in
 * production), otherwise NOT_CONFIGURED — and nothing is sent.
 */
export function createDeliveryProviders(env: Env, outbox: DevOutbox | null, log: (line: string) => void): DeliveryProviders {
  const prod = env.NODE_ENV === 'production';
  const email: EmailProvider[] = [];
  if (env.EMAIL_SMTP_URL && env.EMAIL_FROM) email.push(createSmtpProvider('smtp', env.EMAIL_SMTP_URL, env.EMAIL_FROM, { requireTls: prod }));
  if (env.EMAIL_SMTP_FALLBACK_URL && env.EMAIL_FROM) email.push(createSmtpProvider('smtp-fallback', env.EMAIL_SMTP_FALLBACK_URL, env.EMAIL_FROM, { requireTls: prod }));

  const sms: SmsProvider[] = [];
  const base = env.API_PUBLIC_URL.replace(/\/$/, '');
  for (const name of env.SMS_PROVIDERS.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (name === 'twilio' && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && (env.TWILIO_FROM || env.TWILIO_MESSAGING_SERVICE_SID)) {
      sms.push(createTwilioProvider({ accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, from: env.TWILIO_FROM, messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID, statusCallback: `${base}/v1/webhooks/twilio/status` }));
    }
    if (name === 'vonage' && env.VONAGE_API_KEY && env.VONAGE_API_SECRET && env.VONAGE_FROM) {
      sms.push(createVonageProvider({ apiKey: env.VONAGE_API_KEY, apiSecret: env.VONAGE_API_SECRET, from: env.VONAGE_FROM, callback: env.VONAGE_WEBHOOK_TOKEN ? `${base}/v1/webhooks/vonage/dlr/${env.VONAGE_WEBHOOK_TOKEN}` : undefined }));
    }
  }
  const dev = !prod && env.DEV_TOOLS_ENABLED && outbox;
  return {
    email: email.length ? email : dev ? [createDevEmailProvider(outbox, log)] : [],
    sms: sms.length ? sms : dev ? [createDevSmsProvider(outbox, log)] : [],
    mode: {
      email: email.length ? 'CONFIGURED' : dev ? 'DEV_ADAPTER' : 'NOT_CONFIGURED',
      sms: sms.length ? 'CONFIGURED' : dev ? 'DEV_ADAPTER' : 'NOT_CONFIGURED',
    },
  };
}
