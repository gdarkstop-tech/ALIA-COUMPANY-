import { timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../lib/audit';
import { AppError, conflict, notFound } from '../lib/errors';
import { inContext, requirePermission } from '../lib/principal';
import { parse } from '../lib/validate';
import { maskRecipient } from './phone';
import { verifyTwilioSignature } from './providers';

const TWILIO_STATUS: Record<string, 'SENT' | 'DELIVERED' | 'UNDELIVERABLE' | 'FAILED'> = { sent: 'SENT', delivered: 'DELIVERED', undelivered: 'UNDELIVERABLE', failed: 'UNDELIVERABLE' };
const VONAGE_STATUS: Record<string, 'SENT' | 'DELIVERED' | 'UNDELIVERABLE' | 'FAILED'> = { accepted: 'SENT', buffered: 'SENT', delivered: 'DELIVERED', failed: 'UNDELIVERABLE', rejected: 'UNDELIVERABLE', expired: 'FAILED' };

const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Delivery receipts from providers and the operations view of message delivery (ADR 0020). */
export async function notificationRoutes(app: FastifyInstance) {
  const { env, notifier } = app.services;
  // Twilio posts receipts as form data; parsed here only (other routes stay JSON-only).
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 16 * 1024 }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.post('/webhooks/twilio/status', { config: { rateLimit: { max: 1200, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!env.TWILIO_AUTH_TOKEN) throw notFound('Endpoint');
    const params = (request.body ?? {}) as Record<string, string>;
    const url = `${env.API_PUBLIC_URL.replace(/\/$/, '')}/v1/webhooks/twilio/status`;
    if (!verifyTwilioSignature(env.TWILIO_AUTH_TOKEN, url, params, request.headers['x-twilio-signature'] as string | undefined)) {
      request.log.warn('twilio receipt with an invalid signature');
      throw new AppError(403, 'SIGNATURE_INVALID', 'Invalid signature');
    }
    const status = TWILIO_STATUS[params.MessageStatus ?? ''];
    if (status && params.MessageSid) await notifier.recordReceipt('twilio', params.MessageSid, status, params.ErrorCode ? `TWILIO_${params.ErrorCode}` : undefined);
    return reply.status(204).send();
  });

  // Vonage sends receipts as GET query parameters or as a POST body (JSON or form), per account
  // setting. They are unsigned, so the URL carries a secret token; the api-key field, when present,
  // must also match ours.
  const vonageReceipt = async (request: { params: unknown; body?: unknown; query?: unknown }) => {
    const { token } = request.params as { token: string };
    if (!env.VONAGE_WEBHOOK_TOKEN || !sameSecret(token, env.VONAGE_WEBHOOK_TOKEN)) throw notFound('Endpoint');
    const b = ((request.body && typeof request.body === 'object' ? request.body : request.query) ?? {}) as { messageId?: string; status?: string; 'err-code'?: string; 'api-key'?: string };
    if (b['api-key'] && env.VONAGE_API_KEY && b['api-key'] !== env.VONAGE_API_KEY) throw notFound('Endpoint');
    const status = VONAGE_STATUS[b.status ?? ''];
    if (status && b.messageId) await notifier.recordReceipt('vonage', String(b.messageId), status, b['err-code'] && b['err-code'] !== '0' ? `VONAGE_DLR_${b['err-code']}` : undefined);
  };
  const receiptLimit = { config: { rateLimit: { max: 1200, timeWindow: '1 minute' } } };
  app.post('/webhooks/vonage/dlr/:token', receiptLimit, async (request, reply) => {
    await vonageReceipt(request);
    return reply.status(204).send();
  });
  app.get('/webhooks/vonage/dlr/:token', receiptLimit, async (request, reply) => {
    await vonageReceipt(request);
    return reply.status(204).send();
  });

  // ------------------------------------------------------------- operations (no message contents)
  app.get('/admin/ops/notifications', async (request) => {
    const principal = await requirePermission(request, 'ops.read');
    const q = parse(z.object({ status: z.enum(['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'UNDELIVERABLE', 'EXPIRED', 'CANCELLED']).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), request.query);
    return inContext(request, principal, async (tx) => {
      const rows = (
        await tx.execute<{ id: string; channel: string; purpose: string; locale: string; recipient: string; status: string; attempts: number; last_error: string | null; provider: string | null; related_type: string | null; created_at: string; sent_at: string | null; delivered_at: string | null }>(sql`
          select id, channel, purpose, locale, recipient, status, attempts, last_error, provider, related_type, created_at::text, sent_at::text, delivered_at::text
          from app.notifications ${q.status ? sql`where status = ${q.status}::app.notification_status` : sql``} order by created_at desc limit ${q.limit}`)
      ).rows;
      const counts = (await tx.execute<{ status: string; n: number }>(sql`select status::text, count(*)::int as n from app.notifications where created_at > now() - interval '7 days' group by 1`)).rows;
      return {
        delivery: notifier.status,
        last7Days: Object.fromEntries(counts.map((c) => [c.status, c.n])),
        messages: rows.map((r) => ({ ...r, recipient: maskRecipient(r.recipient), createdAt: new Date(r.created_at).toISOString(), sentAt: r.sent_at ? new Date(r.sent_at).toISOString() : null, deliveredAt: r.delivered_at ? new Date(r.delivered_at).toISOString() : null })),
      };
    });
  });

  app.post('/admin/ops/notifications/:id/retry', async (request) => {
    const principal = await requirePermission(request, 'ops.manage');
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    return inContext(request, principal, async (tx) => {
      const r = await tx.execute(sql`
        update app.notifications set status = 'QUEUED', attempts = 0, next_attempt_at = now(), last_error = null, updated_at = clock_timestamp()
        where id = ${id}::uuid and status = 'FAILED' and not secret and (expires_at is null or expires_at > now())`);
      if (!r.rowCount) throw conflict('NOT_RETRYABLE', 'Only failed, unexpired, non-secret messages can be retried');
      await audit(tx, { actorUserId: principal.userId, action: 'ops.notification.retry', entityType: 'notification', entityId: id, requestId: request.id });
      return { ok: true };
    });
  });
}

export function startNotificationWorker(app: FastifyInstance) {
  let running = false;
  let lastRetention = 0;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    const { notifier } = app.services;
    const retention = Date.now() - lastRetention > 3_600_000 ? ((lastRetention = Date.now()), notifier.applyRetention()) : Promise.resolve(0);
    Promise.all([notifier.processDue(50), retention])
      .catch((err) => app.log.warn({ err: (err as Error).message }, 'notification worker failed'))
      .finally(() => {
        running = false;
      });
  }, 15_000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
}
