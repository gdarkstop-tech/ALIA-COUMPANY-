import {
  deliveryZoneBody,
  formatEgp,
  fulfilOrderBody,
  PAID_STATUSES,
  placeOrderBody,
  refundOrderBody,
  staffCancelOrderBody,
  type DeliveryZone,
  type OpsOrder,
  type OpsPayment,
  type OpsRefund,
  type Order,
  type OrderStatus,
  type PaymentStatus,
  type ReconcileResult,
  type StartPaymentResponse,
} from '@ghayarly/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { withContext, type Tx } from '../../db/client';
import { IntegrationNotConfiguredError } from '../../integrations/errors';
import { PaymentProviderError, toProviderTransaction, type PaymentGateway, type ProviderTransaction } from '../../integrations/payments';
import { audit } from '../../lib/audit';
import { AppError, fromPgError, notFound, unprocessable } from '../../lib/errors';
import { inContext, requirePermission, requirePrincipal, type Principal } from '../../lib/principal';
import { parse } from '../../lib/validate';
import { normalizePhone } from '../../notifications/phone';
import type { Notifier } from '../../notifications/service';
import type { Locale } from '../../notifications/templates';

/**
 * TetraSol orders and Paymob payments (ADR 0022). Prices, discounts, delivery fees, stock and every
 * state change are decided by the database functions of migration 0032; this module talks to the
 * customer, to commerce staff, and to Paymob.
 */
const CONFLICT_CODES = new Set(['PRICE_CHANGED', 'OUT_OF_STOCK', 'INVALID_TRANSITION', 'CANNOT_CANCEL', 'ORDER_NOT_PAYABLE', 'ALREADY_PAID', 'REFUND_EXCEEDS_PAID', 'NOTHING_TO_REFUND', 'CART_HAS_UNAVAILABLE_ITEMS']);
const SYSTEM = { userId: null, demoMode: false };
const iso = (v: string | null | undefined) => (v ? new Date(v).toISOString() : null);

async function db<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AppError) throw e;
    const mapped = fromPgError(e);
    if (mapped && CONFLICT_CODES.has(mapped.code)) throw new AppError(409, mapped.code, mapped.message, mapped.details);
    throw mapped ?? e;
  }
}

// ---------------------------------------------------------------- loading
type OrderRow = Record<string, unknown> & { id: string; user_id: string; status: OrderStatus; payment_status: PaymentStatus };

async function loadOrder(tx: Tx, id: string, detail: 'CUSTOMER' | 'STAFF'): Promise<Order> {
  const o = (await tx.execute<OrderRow>(sql`select *, created_at::text as c_at, payment_expires_at::text as exp_at from app.orders where id = ${id}::uuid`)).rows[0];
  if (!o) throw notFound('Order');
  const lines = (await tx.execute(sql`select * from app.order_items where order_id = ${id}::uuid order by name_en`)).rows as Record<string, unknown>[];
  const events = (await tx.execute(sql`select event, actor_role, status, payment_status, note, created_at::text as at from app.order_events where order_id = ${id}::uuid order by created_at`)).rows as Record<string, unknown>[];
  const payments = (await tx.execute(sql`select id, provider, mode, status, amount_piasters, refunded_piasters, transaction_id, created_at::text as c_at, settled_at::text as s_at from app.payments where order_id = ${id}::uuid order by created_at`)).rows as Record<string, unknown>[];
  const refunds = (await tx.execute(sql`select id, amount_piasters, reason, restock, status, failure_code, created_at::text as c_at from app.refunds where order_id = ${id}::uuid order by created_at`)).rows as Record<string, unknown>[];
  const expired = new Date(o.exp_at as string).getTime() <= Date.now();
  return {
    id: o.id,
    reference: o.reference as string,
    status: o.status,
    paymentStatus: o.payment_status,
    paid: PAID_STATUSES.includes(o.payment_status),
    subtotalPiasters: o.subtotal_piasters as number,
    discountPiasters: o.discount_piasters as number,
    deliveryFeePiasters: o.delivery_fee_piasters as number,
    totalPiasters: o.total_piasters as number,
    refundedPiasters: o.refunded_piasters as number,
    currency: 'EGP',
    discount: o.discount_piasters ? { code: (o.discount_code as string | null) ?? null, nameAr: (o.discount_name_ar as string | null) ?? null, nameEn: (o.discount_name_en as string | null) ?? null } : null,
    delivery: {
      recipientName: o.recipient_name as string,
      phone: o.phone as string,
      governorate: o.governorate as string,
      city: o.city as string,
      district: (o.district as string | null) ?? null,
      address: o.address as string,
      notes: (o.delivery_notes as string | null) ?? null,
    },
    paymentExpiresAt: iso(o.exp_at as string)!,
    trackingReference: (o.tracking_reference as string | null) ?? null,
    cancelReason: (o.cancel_reason as string | null) ?? null,
    isDemo: o.is_demo as boolean,
    lines: lines.map((l) => ({
      id: l.id as string,
      variantId: (l.variant_id as string | null) ?? null,
      bundleId: (l.bundle_id as string | null) ?? null,
      sku: (l.sku as string | null) ?? null,
      nameAr: l.name_ar as string,
      nameEn: l.name_en as string,
      labelAr: l.label_ar as string,
      labelEn: l.label_en as string,
      unitPricePiasters: l.unit_price_piasters as number,
      quantity: l.quantity as number,
      lineTotalPiasters: l.line_total_piasters as number,
    })),
    events: events.map((e) => ({ event: e.event as string, actorRole: e.actor_role as 'CUSTOMER', status: e.status as OrderStatus, paymentStatus: e.payment_status as PaymentStatus, note: detail === 'STAFF' ? ((e.note as string | null) ?? null) : null, at: iso(e.at as string)! })),
    payments: payments.map((p) => ({
      id: p.id as string,
      provider: 'PAYMOB',
      mode: p.mode as 'TEST',
      status: p.status as PaymentStatus,
      amountPiasters: p.amount_piasters as number,
      refundedPiasters: p.refunded_piasters as number,
      transactionId: (p.transaction_id as string | null) ?? null,
      createdAt: iso(p.c_at as string)!,
      settledAt: iso(p.s_at as string | null),
    })),
    refunds: refunds.map((f) => ({ id: f.id as string, amountPiasters: f.amount_piasters as number, reason: f.reason as string, restock: f.restock as boolean, status: f.status as 'SUCCEEDED', failureCode: (f.failure_code as string | null) ?? null, createdAt: iso(f.c_at as string)! })),
    can: {
      pay: o.status === 'PENDING_PAYMENT' && !expired && !['AUTHORIZED', 'PAID', 'SETTLED'].includes(o.payment_status),
      cancel: o.status === 'PENDING_PAYMENT' && !['AUTHORIZED', 'PAID', 'SETTLED'].includes(o.payment_status),
    },
    createdAt: iso(o.c_at as string)!,
  };
}

// ---------------------------------------------------------------- messages
const STATUS_WORD: Record<string, Record<Locale, string>> = {
  SHIPPED: { ar: 'تم الشحن', en: 'shipped' },
  DELIVERED: { ar: 'تم التسليم', en: 'delivered' },
  CANCELLED: { ar: 'أُلغي', en: 'cancelled' },
  PROCESSING: { ar: 'جارٍ التجهيز', en: 'being prepared' },
};

type OrderEventKind = 'PAID' | 'PAYMENT_FAILED' | 'STATUS' | 'REFUNDED';
export async function notifyOrder(tx: Tx, notifier: Notifier, env: Env, orderId: string, kind: OrderEventKind, extra: { status?: string; amountPiasters?: number } = {}) {
  const ctx = (await tx.execute<{ c: { reference: string; total: number; userId: string; email: string | null; phone: string; locale: string } | null }>(sql`select app.order_message_context(${orderId}::uuid) as c`)).rows[0]?.c;
  if (!ctx) return;
  const locale: Locale = ctx.locale === 'en' ? 'en' : 'ar';
  const base = { reference: ctx.reference, total: formatEgp(ctx.total, locale), amount: formatEgp(extra.amountPiasters ?? ctx.total, locale) };
  const purpose = kind === 'PAID' ? 'order.confirmed' : kind === 'PAYMENT_FAILED' ? 'payment.failed' : kind === 'REFUNDED' ? 'payment.refunded' : 'order.status';
  const vars = {
    ...base,
    payment: locale === 'ar' ? 'تم تأكيد الدفع.' : 'Your payment is confirmed.',
    status: extra.status ? (STATUS_WORD[extra.status]?.[locale] ?? extra.status) : '',
  };
  const related = { type: 'order', id: orderId };
  const phone = normalizePhone(ctx.phone, { allowedCountries: env.SMS_ALLOWED_COUNTRIES.split(',') });
  if (phone.ok) await notifier.queue(tx, { channel: 'SMS', to: phone.e164, userId: ctx.userId, purpose, locale, vars, related });
  if (ctx.email) await notifier.queue(tx, { channel: 'EMAIL', to: ctx.email, userId: ctx.userId, purpose, locale, vars, related });
}

// ---------------------------------------------------------------- verified transaction → state
type PaymentRef = { payment_id: string; order_id: string; order_reference: string; amount_piasters: number; mode: 'TEST' | 'LIVE'; status: PaymentStatus; provider_order_id: string; transaction_id: string | null };

/**
 * Applies a verified transaction. Refuses (and opens an incident) when it does not match what we
 * charged: amount, currency, Paymob order, or test/live mode.
 */
async function applyTransaction(tx: Tx, notifier: Notifier, env: Env, ref: PaymentRef, t: ProviderTransaction): Promise<'APPLIED' | 'NO_CHANGE' | 'MISMATCH'> {
  const modeMismatch = t.isLive !== null && (t.isLive ? 'LIVE' : 'TEST') !== ref.mode;
  if (t.amountPiasters !== ref.amount_piasters || t.currency !== 'EGP' || t.providerOrderId !== ref.provider_order_id || modeMismatch) {
    await tx.execute(sql`select app.payment_flag_mismatch(${ref.order_id}::uuid,
      ${`amount ${t.amountPiasters} vs ${ref.amount_piasters}; currency ${t.currency}; mode ${t.isLive === null ? '?' : t.isLive ? 'LIVE' : 'TEST'} vs ${ref.mode}`})`);
    return 'MISMATCH';
  }
  // The order's payment status before and after comes back from the definer function: the worker
  // (system context) has no read access to orders.
  const r = (
    await tx.execute<{ r: { outcome: 'APPLIED' | 'NO_CHANGE'; before: PaymentStatus; after: PaymentStatus } }>(sql`select app.payment_apply(${ref.payment_id}::uuid, ${t.id || null}, ${t.success}, ${t.pending}, ${t.isAuth}, ${t.isVoided},
      ${t.refundedPiasters}, ${t.isSettled}, ${t.message}) as r`)
  ).rows[0]!.r;
  const { outcome, before, after } = r;
  if (after !== before) {
    if ((after === 'PAID' || after === 'SETTLED') && !PAID_STATUSES.includes(before)) await notifyOrder(tx, notifier, env, ref.order_id, 'PAID');
    if (after === 'FAILED') await notifyOrder(tx, notifier, env, ref.order_id, 'PAYMENT_FAILED');
  }
  return outcome;
}

/** Re-checks open payments with Paymob's transaction inquiry (worker and operations button). */
export async function reconcilePayments(app: FastifyInstance, limit = 50): Promise<ReconcileResult> {
  const { db: database, env, notifier, payments } = app.services;
  const result: ReconcileResult = { checked: 0, applied: 0, unchanged: 0, mismatches: 0, errors: 0, inquiry: payments.canInquire ? 'AVAILABLE' : 'NOT_CONFIGURED' };
  if (!payments.canInquire) return result;
  const refs = await withContext(database, SYSTEM, async (tx) => (await tx.execute<PaymentRef>(sql`select * from app.payments_to_reconcile(${limit})`)).rows);
  for (const ref of refs) {
    result.checked++;
    try {
      const t = ref.transaction_id ? await payments.getTransaction(ref.transaction_id) : await payments.getTransactionByOrder(ref.provider_order_id);
      if (!t) {
        result.unchanged++;
        continue;
      }
      const outcome = await withContext(database, SYSTEM, (tx) => applyTransaction(tx, notifier, env, ref, t));
      if (outcome === 'APPLIED') result.applied++;
      else if (outcome === 'MISMATCH') result.mismatches++;
      else result.unchanged++;
    } catch (e) {
      result.errors++;
      app.log.warn({ err: (e as Error).message, payment: ref.payment_id }, 'payment reconciliation failed');
    }
  }
  return result;
}

export async function runOrderMaintenance(app: FastifyInstance): Promise<number> {
  return withContext(app.services.db, SYSTEM, async (tx) => (await tx.execute<{ id: string }>(sql`select app.orders_expire() as id`)).rows.length);
}

export function startOrderWorker(app: FastifyInstance) {
  let running = false;
  let lastReconcile = 0;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    const reconcile = Date.now() - lastReconcile > 10 * 60_000 ? ((lastReconcile = Date.now()), reconcilePayments(app)) : Promise.resolve(null);
    Promise.all([runOrderMaintenance(app), reconcile])
      .catch((err) => app.log.warn({ err: (err as Error).message }, 'order maintenance failed'))
      .finally(() => {
        running = false;
      });
  }, 60_000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
}

// ---------------------------------------------------------------- routes
export async function orderRoutes(app: FastifyInstance) {
  const { env, notifier, payments } = app.services;
  const idParam = z.object({ id: z.string().uuid() });
  const act = <T>(request: FastifyRequest, principal: Principal, fn: (tx: Tx) => Promise<T>) => db(() => inContext(request, principal, fn));
  const writeLimit = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };
  const gatewayReady = (g: PaymentGateway) => {
    if (g.status !== 'CONFIGURED') throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', 'Card payment is not available yet');
  };

  // ------------------------------------------------------------ customer
  app.post('/store/orders', writeLimit, async (request, reply) => {
    const principal = await requirePrincipal(request);
    const body = parse(placeOrderBody, request.body);
    gatewayReady(payments);
    const phone = normalizePhone(body.delivery.phone, { allowedCountries: ['EG'] });
    if (!phone.ok) throw unprocessable('INVALID_PHONE', 'Enter an Egyptian mobile number for delivery', { reason: phone.reason });
    const d = body.delivery;
    const order = await act(request, principal, async (tx) => {
      const id = (
        await tx.execute<{ id: string }>(sql`select app.order_place(${body.idempotencyKey}, ${body.discountCode ?? null}, ${d.recipientName}, ${phone.e164}, ${d.governorate}::app.governorate,
          ${d.city}, ${d.district ?? null}, ${d.address}, ${d.notes ?? null}, ${body.expectedTotalPiasters ?? null}) as id`)
      ).rows[0]!.id;
      return loadOrder(tx, id, 'CUSTOMER');
    });
    return reply.status(201).send(order);
  });

  app.get('/store/orders', async (request) => {
    const principal = await requirePrincipal(request);
    return inContext(request, principal, async (tx) => {
      const ids = (await tx.execute<{ id: string }>(sql`select id from app.orders where user_id = ${principal.userId} order by created_at desc limit 50`)).rows;
      return Promise.all(ids.map((r) => loadOrder(tx, r.id, 'CUSTOMER')));
    });
  });

  app.get('/store/orders/:id', async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    return inContext(request, principal, async (tx) => {
      const own = (await tx.execute(sql`select 1 from app.orders where id = ${id}::uuid and user_id = ${principal.userId}`)).rows.length;
      if (!own) throw notFound('Order');
      return loadOrder(tx, id, 'CUSTOMER');
    });
  });

  app.post('/store/orders/:id/cancel', writeLimit, async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    return act(request, principal, async (tx) => {
      const own = (await tx.execute(sql`select 1 from app.orders where id = ${id}::uuid and user_id = ${principal.userId}`)).rows.length;
      if (!own) throw notFound('Order');
      await tx.execute(sql`select app.order_cancel(${id}::uuid, null)`);
      return loadOrder(tx, id, 'CUSTOMER');
    });
  });

  /** Opens Paymob's hosted checkout for the order's server-side total. Raw card data never reaches us. */
  app.post('/store/orders/:id/pay', writeLimit, async (request): Promise<StartPaymentResponse> => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    gatewayReady(payments);
    const order = await inContext(request, principal, async (tx) => {
      const own = (await tx.execute(sql`select 1 from app.orders where id = ${id}::uuid and user_id = ${principal.userId}`)).rows.length;
      if (!own) throw notFound('Order');
      return loadOrder(tx, id, 'CUSTOMER');
    });
    if (!order.can.pay) throw new AppError(409, 'ORDER_NOT_PAYABLE', 'This order cannot be paid now');
    const [first, ...rest] = order.delivery.recipientName.split(/\s+/);
    const base = env.API_PUBLIC_URL.replace(/\/$/, '');
    let intention;
    try {
      intention = await payments.createIntention({
        reference: order.reference,
        amountPiasters: order.totalPiasters,
        // One order-level line: the payment page never lists products (no product-for-condition detail).
        items: [{ name: `TetraSol order ${order.reference}`, amountPiasters: order.totalPiasters, quantity: 1 }],
        billing: { firstName: first || 'Customer', lastName: rest.join(' ') || 'NA', phone: order.delivery.phone, email: principal.user.email.endsWith('.invalid') ? 'NA' : principal.user.email, city: order.delivery.city, street: 'NA', country: 'EG' },
        notificationUrl: `${base}/v1/webhooks/paymob`,
        redirectionUrl: `${base}/v1/payments/paymob/return`,
        expirationSeconds: Math.max(60, Math.floor((new Date(order.paymentExpiresAt).getTime() - Date.now()) / 1000)),
      });
    } catch (e) {
      if (e instanceof IntegrationNotConfiguredError) throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', 'Card payment is not available yet');
      if (e instanceof PaymentProviderError) throw new AppError(502, 'PAYMENT_PROVIDER_UNAVAILABLE', 'The payment provider did not answer. Try again shortly.');
      throw e;
    }
    const paymentId = await act(request, principal, async (tx) =>
      (await tx.execute<{ id: string }>(sql`select app.payment_open(${id}::uuid, ${payments.mode}, ${intention.intentionId}, ${intention.providerOrderId}) as id`)).rows[0]!.id,
    );
    return { orderId: id, paymentId, checkoutUrl: intention.checkoutUrl, mode: payments.mode! };
  });

  // ------------------------------------------------------------ Paymob callbacks
  /**
   * Transaction processed callback (POST, JSON, `?hmac=`). Signature first; replayed callbacks are
   * ignored; the amount, currency, order and mode must match; with an API key the transaction is
   * re-read from Paymob before anything changes.
   */
  app.post('/webhooks/paymob', { config: { rateLimit: { max: 1200, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (payments.status !== 'CONFIGURED') throw notFound('Endpoint');
    const { hmac } = (request.query ?? {}) as { hmac?: string };
    const body = (request.body ?? {}) as { type?: string; obj?: Record<string, unknown> };
    if (!body.obj || typeof body.obj !== 'object' || !payments.verifyCallbackHmac(body.obj, hmac, 'PROCESSED')) {
      request.log.warn('paymob callback with an invalid signature');
      throw new AppError(403, 'SIGNATURE_INVALID', 'Invalid signature');
    }
    if (body.type && body.type !== 'TRANSACTION') return reply.status(200).send({ ok: true, ignored: body.type });
    let t = toProviderTransaction(body.obj);
    const key = `${t.id}:${t.success}:${t.pending}:${t.isRefunded}:${t.isVoided}:${t.refundedPiasters}:${t.isSettled}`;
    const ref = await withContext(app.services.db, SYSTEM, async (tx) => (await tx.execute<PaymentRef>(sql`select * from app.payment_lookup(${t.providerOrderId})`)).rows[0]);
    if (!ref) {
      await withContext(app.services.db, SYSTEM, (tx) => tx.execute(sql`select app.payment_event_record('PAYMOB', ${key}, null, ${t.id}, 'UNKNOWN_ORDER', ${t.providerOrderId})`));
      return reply.status(200).send({ ok: true });
    }
    let verification: string | null = null;
    if (payments.canInquire) {
      try {
        const fresh = await payments.getTransaction(t.id);
        if (fresh.providerOrderId !== t.providerOrderId) verification = 'INQUIRY_ORDER_MISMATCH';
        else t = fresh;
      } catch (e) {
        verification = (e as Error).message;
      }
    }
    await withContext(app.services.db, SYSTEM, async (tx) => {
      if (verification) {
        // Left pending; the reconciliation pass checks it again with Paymob.
        await tx.execute(sql`select app.payment_event_record('PAYMOB', ${key}, ${ref.payment_id}::uuid, ${t.id}, 'VERIFICATION_FAILED', ${verification})`);
        return;
      }
      const fresh = (await tx.execute<{ ok: boolean }>(sql`select app.payment_event_record('PAYMOB', ${key}, ${ref.payment_id}::uuid, ${t.id}, 'APPLIED', null) as ok`)).rows[0]!.ok;
      if (!fresh) return; // replay of a callback already processed
      const outcome = await applyTransaction(tx, notifier, env, ref, t);
      if (outcome !== 'APPLIED') await tx.execute(sql`select app.payment_event_set_outcome('PAYMOB', ${key}, ${outcome})`);
    });
    return reply.status(200).send({ ok: true });
  });

  /** Customer redirect after checkout: shows a neutral page. It never changes an order (Paymob's guidance). */
  app.get('/payments/paymob/return', async (request, reply) => {
    const q = (request.query ?? {}) as Record<string, string>;
    const valid = payments.status === 'CONFIGURED' && payments.verifyCallbackHmac(q, q.hmac, 'RESPONSE');
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dress My Wound</title></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.6">
<h1 style="font-size:1.3rem">${valid ? 'نراجع عملية الدفع' : 'تعذّر التحقق من هذه الصفحة'}</h1>
<p>${valid ? 'عد إلى التطبيق؛ ستظهر حالة طلبك بعد تأكيد الدفع من مزوّد الدفع.' : 'عد إلى التطبيق لمعرفة حالة طلبك.'}</p>
<hr><p dir="ltr" lang="en">${valid ? 'We are confirming your payment. Return to the app — your order shows as paid only after the payment provider confirms it.' : 'This page could not be verified. Return to the app to see your order.'}</p></body></html>`;
    return reply.status(valid ? 200 : 400).header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').send(html);
  });

  // ------------------------------------------------------------ commerce operations (orders.manage)
  app.get('/admin/ops/orders', async (request) => {
    const principal = await requirePermission(request, 'orders.manage');
    const q = parse(z.object({ status: z.enum(['PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'EXPIRED']).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }), request.query);
    return inContext(request, principal, async (tx) => {
      const rows = await tx.execute(sql`select o.id, o.reference, o.status, o.payment_status, o.total_piasters, o.refunded_piasters, o.governorate::text, o.is_demo,
          o.created_at::text as c_at, o.paid_at::text as p_at, (select coalesce(sum(quantity), 0)::int from app.order_items i where i.order_id = o.id) as items
        from app.orders o ${q.status ? sql`where o.status = ${q.status}::app.order_status` : sql``} order by o.created_at desc limit ${q.limit}`);
      const counts = await tx.execute<{ status: string; n: number }>(sql`select status::text, count(*)::int as n from app.orders where created_at > now() - interval '30 days' group by 1`);
      return {
        last30Days: Object.fromEntries(counts.rows.map((c) => [c.status, c.n])),
        orders: (rows.rows as Record<string, unknown>[]).map(
          (r): OpsOrder => ({
            id: r.id as string,
            reference: r.reference as string,
            status: r.status as OrderStatus,
            paymentStatus: r.payment_status as PaymentStatus,
            totalPiasters: r.total_piasters as number,
            refundedPiasters: r.refunded_piasters as number,
            governorate: r.governorate as string,
            itemCount: r.items as number,
            isDemo: r.is_demo as boolean,
            createdAt: iso(r.c_at as string)!,
            paidAt: iso(r.p_at as string | null),
          }),
        ),
      };
    });
  });

  app.get('/admin/ops/orders/:id', async (request) => {
    const principal = await requirePermission(request, 'orders.manage');
    const { id } = parse(idParam, request.params);
    return inContext(request, principal, (tx) => loadOrder(tx, id, 'STAFF'));
  });

  app.post('/admin/ops/orders/:id/fulfil', async (request) => {
    const principal = await requirePermission(request, 'orders.manage');
    const { id } = parse(idParam, request.params);
    const body = parse(fulfilOrderBody, request.body);
    return act(request, principal, async (tx) => {
      const to = (await tx.execute<{ s: OrderStatus }>(sql`select app.order_fulfil(${id}::uuid, ${body.action}, ${body.trackingReference ?? null}) as s`)).rows[0]!.s;
      if (to === 'SHIPPED' || to === 'DELIVERED') await notifyOrder(tx, notifier, env, id, 'STATUS', { status: to });
      return loadOrder(tx, id, 'STAFF');
    });
  });

  app.post('/admin/ops/orders/:id/cancel', async (request) => {
    const principal = await requirePermission(request, 'orders.manage');
    const { id } = parse(idParam, request.params);
    const { reason } = parse(staffCancelOrderBody, request.body);
    return act(request, principal, async (tx) => {
      await tx.execute(sql`select app.order_cancel(${id}::uuid, ${reason})`);
      await notifyOrder(tx, notifier, env, id, 'STATUS', { status: 'CANCELLED' });
      return loadOrder(tx, id, 'STAFF');
    });
  });

  app.get('/admin/ops/delivery-zones', async (request): Promise<DeliveryZone[]> => {
    const principal = await requirePermission(request, 'orders.manage');
    return inContext(request, principal, async (tx) =>
      ((await tx.execute(sql`select governorate::text, active, fee_piasters, free_over_piasters, eta_min_days, eta_max_days from app.delivery_zones order by governorate`)).rows as Record<string, unknown>[]).map((z) => ({
        governorate: z.governorate as string,
        active: z.active as boolean,
        feePiasters: (z.fee_piasters as number | null) ?? null,
        freeOverPiasters: (z.free_over_piasters as number | null) ?? null,
        etaMinDays: (z.eta_min_days as number | null) ?? null,
        etaMaxDays: (z.eta_max_days as number | null) ?? null,
      })),
    );
  });

  app.put('/admin/ops/delivery-zones/:governorate', async (request) => {
    const principal = await requirePermission(request, 'orders.manage');
    const { governorate } = parse(z.object({ governorate: z.string().regex(/^[A-Z_]{3,30}$/) }), request.params);
    const b = parse(deliveryZoneBody, request.body);
    return db(() =>
      inContext(request, principal, async (tx) => {
        const r = await tx.execute(sql`update app.delivery_zones set active = ${b.active}, fee_piasters = ${b.feePiasters}, free_over_piasters = ${b.freeOverPiasters ?? null},
          eta_min_days = ${b.etaMinDays ?? null}, eta_max_days = ${b.etaMaxDays ?? null}, updated_by_user_id = ${principal.userId}, updated_at = now()
          where governorate = ${governorate}::app.governorate`);
        if (!r.rowCount) throw notFound('Governorate');
        await audit(tx, { actorUserId: principal.userId, action: 'orders.delivery_zone.update', entityType: 'delivery_zone', entityId: governorate, requestId: request.id, metadata: b });
        return { ok: true };
      }),
    );
  });

  // ------------------------------------------------------------ payments (payments.read / payments.refund)
  app.get('/admin/ops/payments', async (request) => {
    const principal = await requirePermission(request, 'payments.read');
    const q = parse(z.object({ status: z.enum(['UNPAID', 'PENDING', 'AUTHORIZED', 'PAID', 'SETTLED', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED']).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }), request.query);
    return inContext(request, principal, async (tx) => {
      const rows = await tx.execute(sql`select p.id, p.order_id, o.reference, p.mode, p.status, p.amount_piasters, p.refunded_piasters, p.transaction_id, p.provider_order_id,
          p.settled_at::text as s_at, p.last_verified_at::text as v_at, p.created_at::text as c_at
        from app.payments p join app.orders o on o.id = p.order_id ${q.status ? sql`where p.status = ${q.status}::app.payment_status` : sql``} order by p.created_at desc limit ${q.limit}`);
      const totals = await tx.execute<{ status: string; n: number; amount: number }>(sql`select status::text, count(*)::int as n, coalesce(sum(amount_piasters - refunded_piasters), 0)::int as amount
        from app.payments where created_at > now() - interval '30 days' group by 1`);
      return {
        gateway: { status: payments.status, mode: payments.mode, reason: payments.reason, inquiry: payments.canInquire ? 'AVAILABLE' : 'NOT_CONFIGURED' },
        last30Days: totals.rows,
        payments: (rows.rows as Record<string, unknown>[]).map(
          (r): OpsPayment => ({
            id: r.id as string,
            orderId: r.order_id as string,
            orderReference: r.reference as string,
            mode: r.mode as 'TEST',
            status: r.status as PaymentStatus,
            amountPiasters: r.amount_piasters as number,
            refundedPiasters: r.refunded_piasters as number,
            transactionId: (r.transaction_id as string | null) ?? null,
            providerOrderId: (r.provider_order_id as string | null) ?? null,
            settledAt: iso(r.s_at as string | null),
            lastVerifiedAt: iso(r.v_at as string | null),
            createdAt: iso(r.c_at as string)!,
          }),
        ),
      };
    });
  });

  app.get('/admin/ops/refunds', async (request): Promise<OpsRefund[]> => {
    const principal = await requirePermission(request, 'payments.read');
    const q = parse(z.object({ status: z.enum(['REQUESTED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'OPEN']).optional() }), request.query);
    return inContext(request, principal, async (tx) => {
      const where = q.status === 'OPEN' ? sql`where f.status <> 'SUCCEEDED'` : q.status ? sql`where f.status = ${q.status}` : sql``;
      const rows = await tx.execute(sql`select f.id, f.order_id, o.reference, f.amount_piasters, f.reason, f.restock, f.status, f.failure_code, f.provider_reference,
          f.created_at::text as c_at, f.updated_at::text as u_at
        from app.refunds f join app.orders o on o.id = f.order_id ${where} order by f.created_at desc limit 200`);
      return (rows.rows as Record<string, unknown>[]).map((r) => ({
        id: r.id as string,
        orderId: r.order_id as string,
        orderReference: r.reference as string,
        amountPiasters: r.amount_piasters as number,
        reason: r.reason as string,
        restock: r.restock as boolean,
        status: r.status as OpsRefund['status'],
        failureCode: (r.failure_code as string | null) ?? null,
        providerReference: (r.provider_reference as string | null) ?? null,
        createdAt: iso(r.c_at as string)!,
        updatedAt: iso(r.u_at as string)!,
      }));
    });
  });

  app.post('/admin/ops/payments/reconcile', async (request) => {
    const principal = await requirePermission(request, 'payments.refund');
    const result = await reconcilePayments(app, 100);
    await withContext(app.services.db, { userId: principal.userId, demoMode: env.DEMO_MODE }, (tx) =>
      audit(tx, { actorUserId: principal.userId, action: 'payments.reconcile', entityType: 'payments', entityId: null, requestId: request.id, metadata: result }),
    );
    return result;
  });

  app.post('/admin/ops/orders/:id/refunds', async (request) => {
    const principal = await requirePermission(request, 'payments.refund');
    const { id } = parse(idParam, request.params);
    const body = parse(refundOrderBody, request.body);
    gatewayReady(payments);
    // 1. Record the request (bounded by what was paid and not refunded) — committed first, so a
    //    refund sent to Paymob is never untracked even if this process dies mid-way.
    const pending = await act(request, principal, async (tx) => {
      const refundId = (await tx.execute<{ id: string }>(sql`select app.refund_request(${id}::uuid, ${body.amountPiasters}, ${body.reason}, ${body.restock}) as id`)).rows[0]!.id;
      const txn = (await tx.execute<{ t: string }>(sql`select p.transaction_id as t from app.refunds f join app.payments p on p.id = f.payment_id where f.id = ${refundId}::uuid`)).rows[0]!.t;
      return { refundId, transactionId: txn };
    });
    // 2. Ask Paymob. 3. Record the outcome.
    let outcome: { success: boolean; reference: string | null; message: string | null };
    try {
      outcome = await payments.refund(pending.transactionId, body.amountPiasters);
    } catch (e) {
      outcome = { success: false, reference: null, message: e instanceof PaymentProviderError ? e.code : 'ERROR' };
    }
    return act(request, principal, async (tx) => {
      await tx.execute(sql`select app.refund_settle(${pending.refundId}::uuid, ${outcome.success}, ${outcome.reference}, ${outcome.message})`);
      if (outcome.success) await notifyOrder(tx, notifier, env, id, 'REFUNDED', { amountPiasters: body.amountPiasters });
      return loadOrder(tx, id, 'STAFF');
    });
  });
}
