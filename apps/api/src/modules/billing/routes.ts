import {
  STORE_MANAGED_STATUSES,
  appleVerifyBody,
  googleVerifyBody,
  resolvePaymentRail,
  type BillingPlan,
  type ClientPlatform,
  type Entitlement,
  type EntitlementsResponse,
  type PlanCode,
  type PlanForClient,
} from '@ghayarly/shared';
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { withContext, type Tx } from '../../db/client';
import { billingPlanOffers, billingPlans, entitlements, userProfiles } from '../../db/schema';
import type { Stores } from '../../integrations/billing';
import { AppError, forbidden, unprocessable } from '../../lib/errors';
import { getPrincipal, inContext, requirePrincipal, type Principal } from '../../lib/principal';
import { sessionKey } from '../../lib/rateLimitKey';
import { parse } from '../../lib/validate';
import { GOOGLE_NOTIFICATION_TYPES, normalizeApple, normalizeGoogle, type GoogleSubscriptionV2, type NormalizedStoreEvent } from './events';

const platformQuery = z.object({ platform: z.enum(['ios', 'android', 'web']).default('web') });
// One subscription group per store → a handful of transactions at most; every entry costs a
// signature check or a Play Developer API call, so keep the batch small.
const restoreBody = z.object({
  apple: z.array(z.string().min(20).max(20_000)).max(10).default([]),
  google: z.array(z.object({ productId: z.string().min(1).max(200), purchaseToken: z.string().min(10).max(4_000) })).max(10).default([]),
});
const perAccount = (max: number) => ({ rateLimit: { max, timeWindow: '1 minute', keyGenerator: sessionKey } });

async function loadPlans(tx: Tx): Promise<BillingPlan[]> {
  const plans = await tx.select().from(billingPlans).orderBy(asc(billingPlans.sortOrder));
  const offers = await tx.select().from(billingPlanOffers);
  return plans.map((p) => ({
    code: p.code,
    nameEn: p.nameEn,
    nameAr: p.nameAr,
    paymentClass: p.paymentClass,
    benefits: p.benefits as BillingPlan['benefits'],
    familyProfileLimit: p.familyProfileLimit,
    active: p.active,
    offers: offers
      .filter((o) => o.planCode === p.code)
      .map((o) => ({ period: o.period, referencePricePiasters: o.referencePricePiasters, appleProductId: o.appleProductId, googleProductId: o.googleProductId, googleBasePlanId: o.googleBasePlanId })),
  }));
}

/** Maps a verified store product to OUR plan via the admin-managed offer table (never trusts the client). */
async function planForProduct(tx: Tx, ev: NormalizedStoreEvent): Promise<PlanCode | null> {
  const offers = await tx.select().from(billingPlanOffers);
  const hit = offers.find((o) => (ev.source === 'APPLE' ? o.appleProductId === ev.productId : o.googleProductId === ev.productId && (!ev.basePlanId || o.googleBasePlanId === ev.basePlanId)));
  return hit && hit.planCode !== 'SILVER' ? hit.planCode : null;
}

async function accountKind(tx: Tx, userId: string): Promise<string> {
  const [row] = await tx.select({ kind: userProfiles.accountKind }).from(userProfiles).where(eq(userProfiles.userId, userId));
  return row?.kind ?? 'STANDARD';
}

/** Global flag, or a review / internal-test caller (App Review must be able to buy). */
async function subscriptionsAvailable(tx: Tx): Promise<boolean> {
  const r = await tx.execute<{ ok: boolean }>(sql`select app.store_subscriptions_available() as ok`);
  return Boolean(r.rows[0]?.ok);
}

const ACCESS_GRANTING = new Set(['ACTIVE', 'GRACE_PERIOD']);
/** Google auto-refunds purchases that are not acknowledged within 3 days — acknowledge once bound. */
async function acknowledgeIfNeeded(stores: Stores, ev: NormalizedStoreEvent, sub: GoogleSubscriptionV2, purchaseToken: string, outcome: string) {
  if ((outcome === 'APPLIED' || outcome === 'DUPLICATE') && ACCESS_GRANTING.has(ev.status) && sub.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') {
    await stores.google.acknowledge(ev.productId, purchaseToken);
  }
}

async function accountToken(tx: Tx, userId: string): Promise<string> {
  const read = () => tx.execute<{ token: string }>(sql`select app_account_token::text as token from app.billing_accounts where user_id = ${userId}`);
  let rows = (await read()).rows;
  if (!rows.length) {
    await tx.execute(sql`insert into app.billing_accounts (user_id) values (${userId}) on conflict do nothing`);
    rows = (await read()).rows;
  }
  return rows[0]!.token;
}

async function apply(tx: Tx, ev: NormalizedStoreEvent, plan: PlanCode, userId: string | null): Promise<string> {
  const res = await tx.execute<{ outcome: string }>(sql`select app.billing_apply_event(
    ${ev.source}::app.entitlement_source, ${ev.eventId}, ${ev.eventType}, ${ev.eventAt.toISOString()}::timestamptz,
    ${ev.externalRef}, ${userId}, ${plan}::app.plan_code, ${ev.productId}, ${ev.status}::app.entitlement_status,
    ${ev.expiresAt ? ev.expiresAt.toISOString() : null}::timestamptz, ${ev.autoRenew}, ${JSON.stringify({ sandbox: ev.sandbox, productId: ev.productId })}::jsonb,
    ${ev.periodStart ? ev.periodStart.toISOString() : null}::timestamptz) as outcome`);
  return res.rows[0]!.outcome;
}

/**
 * Google plan change (upgrade / downgrade): the new purchase names the one it replaces. Once the
 * new purchase is bound, the old token must stop granting access (Play keeps it "active" until
 * its own expiry otherwise). The linked token comes from the Play Developer API, never the client.
 */
async function retireReplaced(tx: Tx, ev: NormalizedStoreEvent, sub: GoogleSubscriptionV2, outcome: string): Promise<void> {
  if (ev.source !== 'GOOGLE' || !sub.linkedPurchaseToken || sub.linkedPurchaseToken === ev.externalRef) return;
  if (outcome !== 'APPLIED' && outcome !== 'DUPLICATE') return;
  await tx.execute(sql`select app.billing_retire_replaced('GOOGLE'::app.entitlement_source, ${sub.linkedPurchaseToken}, ${ev.externalRef})`);
}

async function entitlementState(tx: Tx, userId: string): Promise<EntitlementsResponse> {
  const rows = await tx.select().from(entitlements).where(eq(entitlements.userId, userId));
  const plan = await tx.execute<{ plan: PlanCode }>(sql`select app.effective_plan(${userId}) as plan`);
  const list: Entitlement[] = rows.map((r) => ({ planCode: r.planCode, source: r.source, status: r.status, productId: r.productId, expiresAt: r.expiresAt, autoRenew: r.autoRenew, lastVerifiedAt: r.lastVerifiedAt }));
  return { effectivePlan: plan.rows[0]!.plan, entitlements: list, storeManaged: list.some((e) => e.source !== 'ADMIN_GRANT' && STORE_MANAGED_STATUSES.includes(e.status)) };
}

/**
 * Client-submitted purchase: verified server-side, bound to the CALLER, and only applied when
 * (a) the purchase's account token is the caller's, (b) sandbox purchases come from review /
 * internal-test accounts in production, (c) store subscriptions are enabled (or reviewer account).
 */
async function verifyForUser(request: FastifyRequest, principal: Principal, ev: NormalizedStoreEvent, sub?: GoogleSubscriptionV2): Promise<EntitlementsResponse & { outcome: string }> {
  const { env } = request.server.services;
  return inContext(request, principal, async (tx) => {
    const kind = await accountKind(tx, principal.userId);
    const privileged = kind === 'REVIEW' || kind === 'INTERNAL_TEST';
    if (!(await subscriptionsAvailable(tx))) throw new AppError(409, 'FEATURE_DISABLED', 'Subscriptions are not available yet');
    if (ev.sandbox && env.NODE_ENV === 'production' && !privileged) throw forbidden('SANDBOX_PURCHASE_NOT_ALLOWED', 'Test purchases are only accepted for review accounts');
    const token = await accountToken(tx, principal.userId);
    if (!ev.accountToken || ev.accountToken.toLowerCase() !== token.toLowerCase()) throw forbidden('PURCHASE_ACCOUNT_MISMATCH', 'This purchase was made for a different account');
    const plan = await planForProduct(tx, ev);
    if (!plan) throw unprocessable('UNKNOWN_PRODUCT', 'This product is not a Dress My Wound plan');
    const outcome = await apply(tx, ev, plan, principal.userId);
    if (outcome === 'IGNORED_ACCOUNT_MISMATCH') throw forbidden('SUBSCRIPTION_BELONGS_TO_ANOTHER_ACCOUNT', 'This subscription is linked to another account');
    if (sub) await retireReplaced(tx, ev, sub, outcome);
    return { ...(await entitlementState(tx, principal.userId)), outcome };
  });
}

export async function billingRoutes(app: FastifyInstance) {
  const { stores, env, db } = app.services;

  app.get('/v1/billing/plans', async (request): Promise<PlanForClient[]> => {
    const { platform } = parse(platformQuery, request.query);
    const principal = await getPrincipal(request);
    return inContext(request, principal, async (tx) => {
      const plans = await loadPlans(tx);
      const enabled = await subscriptionsAvailable(tx);
      return plans
        .filter((p) => p.active)
        .map((p) => {
          const rail = p.code === 'SILVER' ? null : resolvePaymentRail(p.paymentClass, platform as ClientPlatform);
          const storeReady =
            rail === 'APPLE_IAP' ? stores.apple.status === 'CONFIGURED' && p.offers.some((o) => o.appleProductId) : rail === 'GOOGLE_PLAY_BILLING' ? stores.google.status === 'CONFIGURED' && p.offers.some((o) => o.googleProductId) : false;
          const unavailableReason = p.code === 'SILVER' ? 'FREE_PLAN' : !enabled ? 'FEATURE_DISABLED' : !storeReady ? 'STORE_NOT_CONFIGURED' : null;
          return { ...p, rail, purchasable: unavailableReason === null, unavailableReason } satisfies PlanForClient;
        });
    });
  });

  app.get('/v1/billing/account-token', async (request) => {
    const principal = await requirePrincipal(request);
    return inContext(request, principal, async (tx) => ({ appAccountToken: await accountToken(tx, principal.userId) }));
  });

  app.get('/v1/billing/entitlements', async (request) => {
    const principal = await requirePrincipal(request);
    return inContext(request, principal, (tx) => entitlementState(tx, principal.userId));
  });

  app.post('/v1/billing/apple/verify', { config: perAccount(30) }, async (request) => {
    const principal = await requirePrincipal(request);
    const body = parse(appleVerifyBody, request.body);
    const tx = await stores.apple.verifyTransaction(body.signedTransactionInfo);
    const ev = normalizeApple({ tx, now: new Date() });
    if (!ev) throw unprocessable('NOT_A_SUBSCRIPTION', 'Not an auto-renewable subscription');
    const { outcome: _outcome, ...state } = await verifyForUser(request, principal, ev);
    return state;
  });

  app.post('/v1/billing/google/verify', { config: perAccount(30) }, async (request) => {
    const principal = await requirePrincipal(request);
    const body = parse(googleVerifyBody, request.body);
    const sub = await stores.google.getSubscription(body.purchaseToken);
    const now = new Date();
    const ev = normalizeGoogle({ purchaseToken: body.purchaseToken, sub, eventId: `verify:${sub.latestOrderId ?? body.purchaseToken.slice(0, 40)}:${sub.subscriptionState}:${sub.lineItems?.[0]?.expiryTime ?? ''}`, eventType: 'CLIENT_VERIFY', eventAt: now, now });
    if (!ev || ev.productId !== body.productId) throw unprocessable('NOT_A_SUBSCRIPTION', 'Purchase is not an active subscription for this product');
    const { outcome, ...state } = await verifyForUser(request, principal, ev, sub);
    await acknowledgeIfNeeded(stores, ev, sub, body.purchaseToken, outcome);
    return state;
  });

  /** Restore Purchases: the app re-reads purchases from the store on-device; the server re-verifies each. */
  app.post('/v1/billing/restore', { config: perAccount(10) }, async (request) => {
    const principal = await requirePrincipal(request);
    const body = parse(restoreBody, request.body);
    const errors: string[] = [];
    for (const signed of new Set(body.apple)) {
      try {
        const ev = normalizeApple({ tx: await stores.apple.verifyTransaction(signed), now: new Date() });
        if (ev) await verifyForUser(request, principal, ev);
      } catch (e) {
        errors.push(e instanceof AppError ? e.code : 'VERIFY_FAILED');
      }
    }
    for (const g of new Map(body.google.map((x) => [x.purchaseToken, x])).values()) {
      try {
        const sub = await stores.google.getSubscription(g.purchaseToken);
        const now = new Date();
        const ev = normalizeGoogle({ purchaseToken: g.purchaseToken, sub, eventId: `restore:${sub.latestOrderId ?? g.purchaseToken.slice(0, 40)}:${sub.subscriptionState}`, eventType: 'RESTORE', eventAt: now, now });
        if (ev) {
          const { outcome } = await verifyForUser(request, principal, ev, sub);
          await acknowledgeIfNeeded(stores, ev, sub, g.purchaseToken, outcome);
        }
      } catch (e) {
        errors.push(e instanceof AppError ? e.code : 'VERIFY_FAILED');
      }
    }
    const state = await inContext(request, principal, (tx) => entitlementState(tx, principal.userId));
    return { ...state, restoreErrors: errors };
  });

  // ---------------------------------------------------------------- store server notifications
  /** App Store Server Notifications V2 (configure this URL in App Store Connect). */
  app.post('/webhooks/apple/app-store-notifications', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = parse(z.object({ signedPayload: z.string().min(20).max(100_000) }), request.body);
    const { notification, tx, renewal } = await stores.apple.verifyNotification(body.signedPayload);
    if (!tx) return reply.status(200).send({ ok: true, outcome: 'IGNORED_NOT_SUBSCRIPTION' });
    const ev = normalizeApple({ tx, renewal: renewal ?? undefined, notification, now: new Date() });
    if (!ev) return reply.status(200).send({ ok: true, outcome: 'IGNORED_NOT_SUBSCRIPTION' });
    const outcome = await applyServerEvent(ev);
    return reply.status(200).send({ ok: true, outcome });
  });

  /** Google Play Real-time developer notifications via authenticated Pub/Sub push. */
  app.post('/webhooks/google/rtdn', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (request, reply) => {
    await stores.google.verifyPush(request.headers.authorization);
    const push = parse(z.object({ message: z.object({ data: z.string(), messageId: z.string() }) }), request.body);
    const payload = JSON.parse(Buffer.from(push.message.data, 'base64').toString('utf8')) as {
      packageName?: string;
      eventTimeMillis?: string;
      subscriptionNotification?: { notificationType: number; purchaseToken: string };
      voidedPurchaseNotification?: { purchaseToken: string; orderId?: string; productType?: number };
      testNotification?: object;
    };
    if (payload.packageName !== env.GOOGLE_PLAY_PACKAGE_NAME) throw forbidden('WRONG_PACKAGE', 'Notification for another app');
    const token = payload.subscriptionNotification?.purchaseToken ?? payload.voidedPurchaseNotification?.purchaseToken;
    if (!token) return reply.status(200).send({ ok: true, outcome: 'IGNORED_NOT_SUBSCRIPTION' });
    // Never trust the notification body for state: fetch the authoritative subscription.
    const sub = await stores.google.getSubscription(token);
    const now = new Date();
    // A void can concern one past renewal order; only the latest order's void ends current access.
    const voided = payload.voidedPurchaseNotification;
    const ev = normalizeGoogle({
      purchaseToken: token,
      sub,
      eventId: push.message.messageId,
      eventType: payload.voidedPurchaseNotification ? 'VOIDED' : (GOOGLE_NOTIFICATION_TYPES[payload.subscriptionNotification!.notificationType] ?? 'UNKNOWN'),
      eventAt: payload.eventTimeMillis ? new Date(Number(payload.eventTimeMillis)) : now,
      now,
      voided: Boolean(voided) && (!voided!.orderId || !sub.latestOrderId || voided!.orderId === sub.latestOrderId),
    });
    if (!ev) return reply.status(200).send({ ok: true, outcome: 'IGNORED_NOT_SUBSCRIPTION' });
    const outcome = await applyServerEvent(ev, sub);
    await acknowledgeIfNeeded(stores, ev, sub, token, outcome);
    return reply.status(200).send({ ok: true, outcome });
  });

  /** Server notification: account resolved from the bound subscription or the purchase's account token. */
  async function applyServerEvent(ev: NormalizedStoreEvent, sub?: GoogleSubscriptionV2): Promise<string> {
    return withContext(db, { userId: null, demoMode: env.DEMO_MODE }, async (tx) => {
      const plan = await planForProduct(tx, ev);
      if (!plan) return 'IGNORED_UNKNOWN_PRODUCT';
      let userId: string | null = null;
      if (ev.accountToken) {
        const r = await tx.execute<{ user_id: string | null }>(sql`select app.billing_user_for_token(${ev.accountToken}) as user_id`);
        userId = r.rows[0]?.user_id ?? null;
      }
      if (ev.sandbox && env.NODE_ENV === 'production') {
        const r = await tx.execute<{ ok: boolean }>(sql`select app.billing_is_test_account(${userId ?? ''}) as ok`);
        if (!r.rows[0]?.ok) return 'IGNORED_SANDBOX';
      }
      const outcome = await apply(tx, ev, plan, userId);
      if (sub) await retireReplaced(tx, ev, sub, outcome);
      return outcome;
    });
  }
}
