import { sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client';
import { withContext } from '../db/client';
import { DeliveryError, type DeliveryProviders, type EmailProvider, type SmsProvider } from './providers';
import { render, TEMPLATES, textToHtml, type Locale, type Purpose } from './templates';

/**
 * Notification service (ADR 0020).
 *  - Secret messages (sign-in codes, verification / reset links) are sent immediately, once, with
 *    provider failover; only metadata is recorded — never the code or link, in the database or logs.
 *  - Everything else is queued in the same transaction as the business event that caused it, then
 *    delivered by the worker with retries (1 min, 5 min, 15 min, 1 h, 6 h) and failover, until it
 *    is SENT, UNDELIVERABLE, FAILED, EXPIRED or CANCELLED.
 *  - Per-recipient caps stop code flooding (5 codes / hour, 10 / day per number or address).
 */
export class NotificationRateLimited extends Error {
  constructor() {
    super('Too many messages to this recipient');
    this.name = 'NotificationRateLimited';
  }
}
export class NotificationUnavailable extends Error {
  constructor(readonly channel: 'EMAIL' | 'SMS') {
    super(`${channel} delivery is not configured`);
    this.name = 'NotificationUnavailable';
  }
}

const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
const SECRET_CAPS = { hour: 5, day: 10 };
const SYSTEM = { userId: null, demoMode: false };

export type QueueRequest = {
  channel: 'EMAIL' | 'SMS';
  to: string;
  userId?: string | null;
  purpose: Exclude<Purpose, `auth.${string}`>;
  locale: Locale;
  vars: Record<string, string>;
  sendAfter?: Date;
  expiresAt?: Date;
  dedupeKey?: string;
  related?: { type: string; id: string };
};

type Row = { id: string; channel: 'EMAIL' | 'SMS'; purpose: string; locale: Locale; recipient: string; subject: string | null; body: string | null; attempts: number; max_attempts: number };

export class Notifier {
  constructor(
    private readonly db: Db,
    private readonly providers: DeliveryProviders,
    private readonly log: { warn: (o: object, m: string) => void },
  ) {}

  get status() {
    return this.providers.mode;
  }

  /** Delivers through the configured providers in order; a transient failure moves to the next one. */
  private async deliver(channel: 'EMAIL' | 'SMS', to: string, content: { subject: string; text: string; html: string; sms: string }, purpose: string) {
    const list: (EmailProvider | SmsProvider)[] = channel === 'EMAIL' ? this.providers.email : this.providers.sms;
    if (!list.length) throw new NotificationUnavailable(channel);
    let last: DeliveryError | null = null;
    for (const p of list) {
      try {
        const r = channel === 'EMAIL' ? await (p as EmailProvider).send({ to, subject: content.subject, text: content.text, html: content.html, purpose }) : await (p as SmsProvider).send({ to, body: content.sms, purpose });
        return { provider: p.name, providerMessageId: r.providerMessageId };
      } catch (e) {
        if (!(e instanceof DeliveryError)) throw e;
        if (e.kind === 'PERMANENT') throw Object.assign(e, { provider: p.name });
        last = e;
      }
    }
    throw Object.assign(last!, { provider: list.at(-1)!.name });
  }

  /** Sign-in codes and links: sent now or refused; the content is never stored or logged. */
  async sendSecret(req: { channel: 'EMAIL' | 'SMS'; to: string; userId?: string | null; purpose: Extract<Purpose, `auth.${string}`>; vars: Record<string, string> }): Promise<void> {
    const content = render(req.purpose, 'both', req.vars);
    const recent = await withContext(this.db, SYSTEM, async (tx) => (
      await tx.execute<{ hour: number; day: number }>(sql`
        select count(*) filter (where created_at > now() - interval '1 hour')::int as hour, count(*)::int as day
        from app.notifications where recipient = ${req.to} and secret and created_at > now() - interval '1 day'`)
    ).rows[0]!);
    if (recent.hour >= SECRET_CAPS.hour || recent.day >= SECRET_CAPS.day) throw new NotificationRateLimited();
    let outcome: { status: string; provider: string | null; providerMessageId: string | null; error: string | null };
    try {
      const r = await this.deliver(req.channel, req.to, content, req.purpose);
      outcome = { status: 'SENT', provider: r.provider, providerMessageId: r.providerMessageId, error: null };
    } catch (e) {
      outcome = e instanceof DeliveryError ? { status: e.kind === 'PERMANENT' ? 'UNDELIVERABLE' : 'FAILED', provider: (e as DeliveryError & { provider?: string }).provider ?? null, providerMessageId: null, error: e.code } : { status: 'FAILED', provider: null, providerMessageId: null, error: e instanceof NotificationUnavailable ? 'NOT_CONFIGURED' : 'ERROR' };
      await this.record(req, outcome);
      throw e;
    }
    await this.record(req, outcome);
  }

  private async record(req: { channel: 'EMAIL' | 'SMS'; to: string; userId?: string | null; purpose: string }, o: { status: string; provider: string | null; providerMessageId: string | null; error: string | null }) {
    await withContext(this.db, SYSTEM, (tx) =>
      tx.execute(sql`
        insert into app.notifications (channel, purpose, locale, recipient, recipient_user_id, secret, status, attempts, provider, provider_message_id, last_error, sent_at)
        values (${req.channel}::app.notification_channel, ${req.purpose}, 'en', ${req.to}, ${req.userId ?? null}, true, ${o.status}::app.notification_status, 1,
                ${o.provider}, ${o.providerMessageId}, ${o.error}, ${o.status === 'SENT' ? sql`clock_timestamp()` : null})`),
    );
  }

  /**
   * Queues a message inside the caller's transaction (so it exists only if the business change
   * commits). A repeated dedupe key is ignored.
   */
  async queue(tx: Tx, req: QueueRequest): Promise<void> {
    if (TEMPLATES[req.purpose].secret) throw new Error('Secret messages are never queued');
    const c = render(req.purpose, req.locale, req.vars);
    await tx.execute(sql`
      insert into app.notifications (channel, purpose, locale, recipient, recipient_user_id, subject, body, send_after, next_attempt_at, expires_at, related_type, related_id, dedupe_key)
      values (${req.channel}::app.notification_channel, ${req.purpose}, ${req.locale}, ${req.to}, ${req.userId ?? null},
              ${req.channel === 'EMAIL' ? c.subject : null}, ${req.channel === 'EMAIL' ? c.text : c.sms},
              ${(req.sendAfter ?? new Date()).toISOString()}::timestamptz, ${(req.sendAfter ?? new Date()).toISOString()}::timestamptz,
              ${req.expiresAt?.toISOString() ?? null}::timestamptz, ${req.related?.type ?? null}, ${req.related?.id ?? null}::uuid, ${req.dedupeKey ?? null})
      on conflict (dedupe_key) do nothing`);
  }

  /** Cancels messages not yet sent for an event that no longer happens (e.g. reminders of a cancelled appointment). */
  async cancelRelated(tx: Tx, type: string, id: string, purposes?: string[]): Promise<void> {
    await tx.execute(sql`
      update app.notifications set status = 'CANCELLED', updated_at = clock_timestamp()
      where related_type = ${type} and related_id = ${id}::uuid and status = 'QUEUED'
        ${purposes ? sql`and purpose = any(${`{${purposes.join(',')}}`}::text[])` : sql``}`);
  }

  /** Deletes message history past its retention (30 days for sign-in metadata, 180 days otherwise). */
  async applyRetention(): Promise<number> {
    return withContext(this.db, SYSTEM, async (tx) => (await tx.execute<{ n: number }>(sql`select app.notifications_retention() as n`)).rows[0]!.n);
  }

  /** One worker pass: claims due messages and delivers them. Returns how many were attempted. */
  async processDue(limit = 50): Promise<number> {
    const rows = await withContext(this.db, SYSTEM, async (tx) => (await tx.execute<Row>(sql`select id, channel, purpose, locale, recipient, subject, body, attempts, max_attempts from app.notifications_claim(${limit})`)).rows);
    for (const row of rows) {
      const body = row.body ?? '';
      const content = row.channel === 'EMAIL' ? { subject: row.subject ?? '', text: body, html: textToHtml(body, row.locale), sms: '' } : { subject: '', text: '', html: '', sms: body };
      try {
        const r = await this.deliver(row.channel, row.recipient, content, row.purpose);
        await withContext(this.db, SYSTEM, (tx) =>
          tx.execute(sql`update app.notifications set status = 'SENT', provider = ${r.provider}, provider_message_id = ${r.providerMessageId}, last_error = null, sent_at = clock_timestamp(), updated_at = clock_timestamp() where id = ${row.id}::uuid`),
        );
      } catch (e) {
        const permanent = e instanceof DeliveryError && e.kind === 'PERMANENT';
        const unavailable = e instanceof NotificationUnavailable;
        const code = e instanceof DeliveryError ? e.code : unavailable ? 'NOT_CONFIGURED' : 'ERROR';
        if (!(e instanceof DeliveryError) && !unavailable) this.log.warn({ id: row.id, err: (e as Error).name }, 'notification delivery error');
        // No provider configured: keep it queued without spending an attempt (it may expire).
        const next = unavailable ? sql`'QUEUED'::app.notification_status` : permanent ? sql`'UNDELIVERABLE'::app.notification_status` : row.attempts >= row.max_attempts ? sql`'FAILED'::app.notification_status` : sql`'QUEUED'::app.notification_status`;
        const delay = unavailable ? 15 * 60_000 : BACKOFF_MS[Math.min(row.attempts - 1, BACKOFF_MS.length - 1)]!;
        await withContext(this.db, SYSTEM, (tx) =>
          tx.execute(sql`
            update app.notifications set status = ${next}, attempts = attempts - ${unavailable ? 1 : 0}, last_error = ${code},
              provider = coalesce(${(e as { provider?: string }).provider ?? null}, provider),
              next_attempt_at = now() + make_interval(secs => ${delay / 1000}), updated_at = clock_timestamp()
            where id = ${row.id}::uuid`),
        );
      }
    }
    return rows.length;
  }

  /**
   * Delivery receipt from a provider. Receipts can arrive out of order, so a message never moves
   * backwards: DELIVERED is final, and a late "sent" does not overwrite a failure.
   */
  async recordReceipt(provider: string, providerMessageId: string, status: 'SENT' | 'DELIVERED' | 'UNDELIVERABLE' | 'FAILED', error?: string): Promise<boolean> {
    const r = await withContext(this.db, SYSTEM, (tx) =>
      tx.execute(sql`
        update app.notifications set
          status = case
            when status = 'DELIVERED' then status
            when ${status} = 'SENT' and status in ('UNDELIVERABLE', 'FAILED') then status
            else ${status}::app.notification_status end,
          delivered_at = case when ${status} = 'DELIVERED' then coalesce(delivered_at, clock_timestamp()) else delivered_at end,
          last_error = coalesce(${error ?? null}, last_error), updated_at = clock_timestamp()
        where provider = ${provider} and provider_message_id = ${providerMessageId}`),
    );
    return (r.rowCount ?? 0) > 0;
  }
}
