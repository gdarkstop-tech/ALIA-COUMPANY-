/**
 * Billing & entitlements: payment-rail classification, store event normalization, and the
 * server-side entitlement service. Store adapters are replaced by fixtures that return
 * already-"verified" payloads — the production adapters verify signatures with Apple's / Google's
 * official libraries and are NOT_CONFIGURED without credentials.
 */
import { mayLinkOutForPayment, resolvePaymentRail } from '@ghayarly/shared';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import type { AppleStore, GoogleStore, Stores } from '../src/integrations/billing';
import { AppError } from '../src/lib/errors';
import { appleStatus, googleStatus, normalizeApple, type GoogleSubscriptionV2 } from '../src/modules/billing/events';
import { buildServer } from '../src/server';
import { createTestServer, ownerPool, signUp } from './helpers';

const NOW = new Date('2026-10-14T12:00:00Z');
const DAY = 86_400_000;

describe('payment classification (Apple 3.1.1 / 3.1.3, Google Payments §3)', () => {
  it('routes physical goods, physical services and 1:1 consultations to the external gateway on every platform', () => {
    for (const p of ['ios', 'android', 'web'] as const) {
      expect(resolvePaymentRail('PHYSICAL_PRODUCT', p)).toBe('EXTERNAL_GATEWAY');
      expect(resolvePaymentRail('PHYSICAL_SERVICE', p)).toBe('EXTERNAL_GATEWAY');
      expect(resolvePaymentRail('ELIGIBLE_PERSON_TO_PERSON_SERVICE', p)).toBe('EXTERNAL_GATEWAY');
    }
  });
  it('routes digital subscriptions and features to the platform store inside the apps', () => {
    expect(resolvePaymentRail('DIGITAL_SUBSCRIPTION', 'ios')).toBe('APPLE_IAP');
    expect(resolvePaymentRail('DIGITAL_SUBSCRIPTION', 'android')).toBe('GOOGLE_PLAY_BILLING');
    expect(resolvePaymentRail('DIGITAL_FEATURE', 'ios')).toBe('APPLE_IAP');
    expect(resolvePaymentRail('DIGITAL_FEATURE', 'android')).toBe('GOOGLE_PLAY_BILLING');
  });
  it('never allows linking out to pay for digital purchases in the native apps (Egypt has no eligible programme)', () => {
    expect(mayLinkOutForPayment('DIGITAL_SUBSCRIPTION', 'ios')).toBe(false);
    expect(mayLinkOutForPayment('DIGITAL_SUBSCRIPTION', 'android')).toBe(false);
    expect(mayLinkOutForPayment('PHYSICAL_PRODUCT', 'ios')).toBe(true);
  });
});

describe('store event normalization', () => {
  it('maps Apple transaction + renewal state to access', () => {
    expect(appleStatus({ expiresDate: NOW.getTime() + DAY }, undefined, undefined, NOW).status).toBe('ACTIVE');
    expect(appleStatus({ expiresDate: NOW.getTime() - DAY }, undefined, undefined, NOW).status).toBe('EXPIRED');
    expect(appleStatus({ expiresDate: NOW.getTime() - DAY }, { isInBillingRetryPeriod: true, gracePeriodExpiresDate: NOW.getTime() + DAY }, undefined, NOW).status).toBe('GRACE_PERIOD');
    expect(appleStatus({ expiresDate: NOW.getTime() - DAY }, { isInBillingRetryPeriod: true }, undefined, NOW).status).toBe('BILLING_RETRY');
    expect(appleStatus({ expiresDate: NOW.getTime() + DAY, revocationDate: NOW.getTime() }, undefined, 'REFUND', NOW).status).toBe('REFUNDED');
    expect(appleStatus({ expiresDate: NOW.getTime() + DAY }, undefined, 'EXPIRED', NOW).status).toBe('EXPIRED');
  });
  it('maps Google subscription states (cancelled keeps paid time; on hold grants nothing)', () => {
    expect(googleStatus('SUBSCRIPTION_STATE_ACTIVE', null, NOW)).toBe('ACTIVE');
    expect(googleStatus('SUBSCRIPTION_STATE_CANCELED', new Date(NOW.getTime() + DAY), NOW)).toBe('ACTIVE');
    expect(googleStatus('SUBSCRIPTION_STATE_CANCELED', new Date(NOW.getTime() - DAY), NOW)).toBe('EXPIRED');
    expect(googleStatus('SUBSCRIPTION_STATE_IN_GRACE_PERIOD', null, NOW)).toBe('GRACE_PERIOD');
    expect(googleStatus('SUBSCRIPTION_STATE_ON_HOLD', null, NOW)).toBe('BILLING_RETRY');
    expect(googleStatus('SUBSCRIPTION_STATE_PENDING', null, NOW)).toBeNull();
    // Paused: no access, but still store-managed (the store resumes it) — never a fresh purchase.
    expect(googleStatus('SUBSCRIPTION_STATE_PAUSED', null, NOW)).toBe('PAUSED');
  });
  it('treats refund requests and declined refunds as informational, and records the billing period', () => {
    const tx = { originalTransactionId: '1', transactionId: '2', productId: 'x', purchaseDate: NOW.getTime() - DAY, expiresDate: NOW.getTime() + 29 * DAY };
    for (const notificationType of ['CONSUMPTION_REQUEST', 'REFUND_DECLINED']) {
      expect(normalizeApple({ tx, notification: { notificationType, notificationUUID: 'u', signedDate: NOW.getTime() }, now: NOW })).toBeNull();
    }
    expect(normalizeApple({ tx, now: NOW })?.periodStart?.getTime()).toBe(NOW.getTime() - DAY);
  });
  it('ignores non-subscription Apple transactions and flags sandbox purchases', () => {
    expect(normalizeApple({ tx: { originalTransactionId: '1', productId: 'x', type: 'Consumable' }, now: NOW })).toBeNull();
    const ev = normalizeApple({ tx: { originalTransactionId: '1', transactionId: '2', productId: 'x', expiresDate: NOW.getTime() + DAY, environment: 'Sandbox' }, now: NOW });
    expect(ev?.sandbox).toBe(true);
    expect(ev?.eventType).toBe('CLIENT_VERIFY');
  });

  it('never lets a transaction superseded by an upgrade restore access', () => {
    expect(normalizeApple({ tx: { originalTransactionId: '1', transactionId: '2', productId: 'x', expiresDate: NOW.getTime() + 300 * DAY, isUpgraded: true }, now: NOW })).toBeNull();
  });
});

// ---------------------------------------------------------------- service (fixture stores)
type AppleFixture = { originalTransactionId: string; transactionId: string; productId: string; purchaseDate?: number; expiresDate: number; appAccountToken?: string; environment: string; signedDate: number; revocationDate?: number; type: string };
const fixtures = new Map<string, AppleFixture>();
const notifications = new Map<string, { notificationType: string; notificationUUID: string; signedDate: number; tx: AppleFixture }>();

const fixtureApple: AppleStore = {
  status: 'CONFIGURED',
  verifyTransaction: async (signed) => {
    const f = fixtures.get(signed);
    if (!f) throw new AppError(422, 'INVALID_STORE_SIGNATURE', 'bad signature');
    return f as never;
  },
  verifyNotification: async (signed) => {
    const n = notifications.get(signed);
    if (!n) throw new AppError(422, 'INVALID_STORE_SIGNATURE', 'bad signature');
    return { notification: { notificationType: n.notificationType, notificationUUID: n.notificationUUID, signedDate: n.signedDate } as never, tx: n.tx as never, renewal: null };
  },
};
const unconfiguredGoogle: GoogleStore = {
  status: 'NOT_CONFIGURED',
  getSubscription: async () => Promise.reject(new AppError(503, 'STORE_NOT_CONFIGURED')),
  acknowledge: async () => Promise.reject(new AppError(503, 'STORE_NOT_CONFIGURED')),
  verifyPush: async () => Promise.reject(new AppError(503, 'STORE_NOT_CONFIGURED')),
};

let app: FastifyInstance;
let plain: FastifyInstance;
let owner: pg.Pool;
let appPool: pg.Pool;

beforeAll(async () => {
  app = await buildServer(loadEnv(process.env), { stores: { apple: fixtureApple, google: unconfiguredGoogle } satisfies Stores });
  await app.ready();
  plain = await createTestServer();
  owner = ownerPool();
  appPool = new pg.Pool({ connectionString: process.env.DATABASE_URL_APP });
  await owner.query(`update app.billing_plan_offers set apple_product_id = 'com.example.dmw.gold.monthly' where plan_code = 'GOLD' and period = 'MONTHLY'`);
});

afterAll(async () => {
  await owner.query(`update app.billing_plan_offers set apple_product_id = null`);
  await owner.query(`update app.feature_flags set enabled = false where key = 'billing.store_subscriptions'`);
  await owner.query(`update app.billing_plans set family_profile_limit = null where code = 'SILVER'`);
  await appPool.end();
  await owner.end();
  await plain.close();
  await app.close();
});

describe('entitlement service', () => {
  it('lists plans with the resolved rail and an honest unavailability reason', async () => {
    const res = await plain.inject({ method: 'GET', url: '/v1/billing/plans?platform=ios' });
    const plans = JSON.parse(res.body) as { code: string; rail: string | null; purchasable: boolean; unavailableReason: string | null; offers: { referencePricePiasters: number }[] }[];
    expect(plans.map((p) => p.code)).toEqual(['SILVER', 'GOLD', 'PLATINUM']);
    expect(plans[0]!.unavailableReason).toBe('FREE_PLAN');
    expect(plans[1]!.rail).toBe('APPLE_IAP');
    expect(plans[1]!.purchasable).toBe(false);
    expect(plans[1]!.offers.map((o) => o.referencePricePiasters).sort((a, b) => a - b)).toEqual([29900, 299000]);
    const android = JSON.parse((await plain.inject({ method: 'GET', url: '/v1/billing/plans?platform=android' })).body);
    expect(android[2].rail).toBe('GOOGLE_PLAY_BILLING');
  });

  it('refuses to verify anything when the store is not configured — nothing is granted', async () => {
    const c = await signUp(plain, { role: 'PATIENT' });
    const r = await c.req({ method: 'POST', url: '/v1/billing/apple/verify', body: { signedTransactionInfo: 'x'.repeat(40) } });
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe('STORE_NOT_CONFIGURED');
    const e = await c.req({ method: 'GET', url: '/v1/billing/entitlements' });
    expect(e.json.effectivePlan).toBe('SILVER');
  });

  it('review accounts can buy while subscriptions are off for everyone else (App Review)', async () => {
    const reviewer = await signUp(app, { role: 'PATIENT' });
    const regular = await signUp(app, { role: 'PATIENT' });
    await owner.query(`update app.user_profiles set account_kind = 'REVIEW' where user_id = $1`, [reviewer.userId]);
    const flags = async (c: typeof reviewer) => (await c.req({ method: 'GET', url: '/v1/system/features' })).json['billing.store_subscriptions'];
    expect(await flags(reviewer)).toBe(true);
    expect(await flags(regular)).toBe(false);
    const gold = async (c: typeof reviewer) => (await c.req({ method: 'GET', url: '/v1/billing/plans?platform=ios' })).json.find((p: { code: string }) => p.code === 'GOLD');
    expect((await gold(reviewer)).purchasable).toBe(true);
    expect((await gold(regular)).unavailableReason).toBe('FEATURE_DISABLED');
  });

  it('grants only after server verification, bound to the purchasing account; refunds revoke access', async () => {
    const buyer = await signUp(app, { role: 'PATIENT' });
    const token = (await buyer.req({ method: 'GET', url: '/v1/billing/account-token' })).json.appAccountToken as string;
    const signed = `signed-tx-${buyer.userId}`;
    fixtures.set(signed, { originalTransactionId: `otx-${buyer.userId}`, transactionId: `tx-${buyer.userId}`, productId: 'com.example.dmw.gold.monthly', expiresDate: Date.now() + 30 * DAY, appAccountToken: token, environment: 'Sandbox', signedDate: Date.now(), type: 'Auto-Renewable Subscription' });

    // Feature disabled → refused (store subscriptions not launched yet).
    const off = await buyer.req({ method: 'POST', url: '/v1/billing/apple/verify', body: { signedTransactionInfo: signed } });
    expect(off.status).toBe(409);
    expect(off.json.error.code).toBe('FEATURE_DISABLED');
    // Paid tiers must unlock what they sell: subscriptions cannot go live while a plan (Silver) has
    // no family-profile limit.
    await expect(owner.query(`update app.feature_flags set enabled = true where key = 'billing.store_subscriptions'`)).rejects.toThrow(/PLAN_FAMILY_LIMITS_REQUIRED/);
    await owner.query(`update app.billing_plans set family_profile_limit = 1 where code = 'SILVER'`);
    await owner.query(`update app.feature_flags set enabled = true where key = 'billing.store_subscriptions'`);

    // Forged / unverifiable payload → rejected.
    const forged = await buyer.req({ method: 'POST', url: '/v1/billing/apple/verify', body: { signedTransactionInfo: 'forged-'.repeat(5) } });
    expect(forged.status).toBe(422);

    const ok = await buyer.req({ method: 'POST', url: '/v1/billing/apple/verify', body: { signedTransactionInfo: signed } });
    expect(ok.status).toBe(200);
    expect(ok.json.effectivePlan).toBe('GOLD');
    expect(ok.json.storeManaged).toBe(true);

    // Another account replaying the same signed transaction gets nothing.
    const thief = await signUp(app, { role: 'PATIENT' });
    const replay = await thief.req({ method: 'POST', url: '/v1/billing/apple/verify', body: { signedTransactionInfo: signed } });
    expect(replay.status).toBe(403);
    expect(replay.json.error.code).toBe('PURCHASE_ACCOUNT_MISMATCH');
    expect((await thief.req({ method: 'GET', url: '/v1/billing/entitlements' })).json.effectivePlan).toBe('SILVER');

    // Refund notification (server-to-server) revokes access; the duplicate is a no-op.
    const refundPayload = `notif-refund-${buyer.userId}`;
    notifications.set(refundPayload, { notificationType: 'REFUND', notificationUUID: `uuid-${buyer.userId}`, signedDate: Date.now() + 1000, tx: { ...fixtures.get(signed)!, revocationDate: Date.now() } });
    const n1 = await app.inject({ method: 'POST', url: '/webhooks/apple/app-store-notifications', payload: { signedPayload: refundPayload } });
    expect(JSON.parse(n1.body).outcome).toBe('APPLIED');
    const n2 = await app.inject({ method: 'POST', url: '/webhooks/apple/app-store-notifications', payload: { signedPayload: refundPayload } });
    expect(JSON.parse(n2.body).outcome).toBe('DUPLICATE');
    const after = await buyer.req({ method: 'GET', url: '/v1/billing/entitlements' });
    expect(after.json.effectivePlan).toBe('SILVER');
    expect(after.json.entitlements[0].status).toBe('REFUNDED');

    // A stale (older) renewal event cannot resurrect a refunded subscription.
    const stalePayload = `notif-stale-${buyer.userId}`;
    notifications.set(stalePayload, { notificationType: 'DID_RENEW', notificationUUID: `uuid-stale-${buyer.userId}`, signedDate: Date.now() - 60 * DAY, tx: fixtures.get(signed)! });
    const n3 = await app.inject({ method: 'POST', url: '/webhooks/apple/app-store-notifications', payload: { signedPayload: stalePayload } });
    expect(JSON.parse(n3.body).outcome).toBe('IGNORED_STALE');
    expect((await buyer.req({ method: 'GET', url: '/v1/billing/entitlements' })).json.effectivePlan).toBe('SILVER');
  });

  it('once subscriptions are on, the family-profile limit comes from the plan', async () => {
    const c = await signUp(app, { role: 'PATIENT' });
    const member = (displayName: string, relationship: string) => ({ displayName, dateOfBirth: '1955-05-05', sex: 'FEMALE', relationship, consentBasis: 'ADULT_CONSENT_ATTESTED', consentAttested: true, consentStatementVersion: 'family-consent-v1' });
    expect((await c.req({ method: 'POST', url: '/v1/patients', body: member('Mother', 'MOTHER') })).status).toBe(201);
    const second = await c.req({ method: 'POST', url: '/v1/patients', body: member('Aunt', 'OTHER') });
    expect(second.status).toBe(422);
    expect(second.json.error.code).toBe('FAMILY_LIMIT_REACHED');
  });

  it('a newer purchase from another app account on the same Apple ID re-binds; notifications never fail on a mismatch', async () => {
    const a = await signUp(app, { role: 'PATIENT' });
    const b = await signUp(app, { role: 'PATIENT' });
    const tokenOf = async (c: typeof a) => (await c.req({ method: 'GET', url: '/v1/billing/account-token' })).json.appAccountToken as string;
    const t0 = Date.now();
    const base = { originalTransactionId: `otx-shared-${a.userId}`, productId: 'com.example.dmw.gold.monthly', expiresDate: t0 + 30 * DAY, environment: 'Sandbox', type: 'Auto-Renewable Subscription' };
    fixtures.set(`tx-a-${a.userId}`, { ...base, transactionId: `ta-${a.userId}`, appAccountToken: await tokenOf(a), signedDate: t0 - 10_000 });
    fixtures.set(`tx-b-${a.userId}`, { ...base, transactionId: `tb-${a.userId}`, appAccountToken: await tokenOf(b), signedDate: t0 });
    expect((await a.req({ method: 'POST', url: '/v1/billing/apple/verify', body: { signedTransactionInfo: `tx-a-${a.userId}` } })).json.effectivePlan).toBe('GOLD');

    const taken = await b.req({ method: 'POST', url: '/v1/billing/apple/verify', body: { signedTransactionInfo: `tx-b-${a.userId}` } });
    expect(taken.status).toBe(200);
    expect(taken.json.effectivePlan).toBe('GOLD');
    expect((await a.req({ method: 'GET', url: '/v1/billing/entitlements' })).json.effectivePlan).toBe('SILVER');

    // A late notification about A's older transaction is recorded, not thrown back at Apple.
    const late = `notif-late-${a.userId}`;
    notifications.set(late, { notificationType: 'DID_RENEW', notificationUUID: `uuid-late-${a.userId}`, signedDate: t0 - 5_000, tx: fixtures.get(`tx-a-${a.userId}`)! });
    const n = await app.inject({ method: 'POST', url: '/webhooks/apple/app-store-notifications', payload: { signedPayload: late } });
    expect(n.statusCode).toBe(200);
    expect(JSON.parse(n.body).outcome).toBe('IGNORED_ACCOUNT_MISMATCH');
    expect((await b.req({ method: 'GET', url: '/v1/billing/entitlements' })).json.effectivePlan).toBe('GOLD');
  });

  it('a refund of an earlier billing period leaves the current paid period active', async () => {
    const u = await signUp(app, { role: 'PATIENT' });
    const token = (await u.req({ method: 'GET', url: '/v1/billing/account-token' })).json.appAccountToken as string;
    const t0 = Date.now();
    const current = { originalTransactionId: `otx-period-${u.userId}`, transactionId: `cur-${u.userId}`, productId: 'com.example.dmw.gold.monthly', expiresDate: t0 + 30 * DAY, appAccountToken: token, environment: 'Sandbox', signedDate: t0, type: 'Auto-Renewable Subscription' };
    fixtures.set(`cur-${u.userId}`, current);
    expect((await u.req({ method: 'POST', url: '/v1/billing/apple/verify', body: { signedTransactionInfo: `cur-${u.userId}` } })).json.effectivePlan).toBe('GOLD');
    const refundOld = `notif-refund-old-${u.userId}`;
    notifications.set(refundOld, { notificationType: 'REFUND', notificationUUID: `uuid-refund-old-${u.userId}`, signedDate: t0 + 1_000, tx: { ...current, transactionId: `old-${u.userId}`, expiresDate: t0 - DAY, revocationDate: t0 } });
    const n = await app.inject({ method: 'POST', url: '/webhooks/apple/app-store-notifications', payload: { signedPayload: refundOld } });
    expect(JSON.parse(n.body).outcome).toBe('IGNORED_STALE');
    expect((await u.req({ method: 'GET', url: '/v1/billing/entitlements' })).json.effectivePlan).toBe('GOLD');
  });

  it('orders Apple events by billing period: a late notification about an earlier period never ends the current one', async () => {
    const u = await signUp(app, { role: 'PATIENT' });
    const token = (await u.req({ method: 'GET', url: '/v1/billing/account-token' })).json.appAccountToken as string;
    const t0 = Date.now();
    const renewal: AppleFixture = { originalTransactionId: `otx-order-${u.userId}`, transactionId: `renew-${u.userId}`, productId: 'com.example.dmw.gold.monthly', purchaseDate: t0 - DAY, expiresDate: t0 + 29 * DAY, appAccountToken: token, environment: 'Sandbox', signedDate: t0, type: 'Auto-Renewable Subscription' };
    fixtures.set(`renew-${u.userId}`, renewal);
    expect((await u.req({ method: 'POST', url: '/v1/billing/apple/verify', body: { signedTransactionInfo: `renew-${u.userId}` } })).json.effectivePlan).toBe('GOLD');
    // Apple re-delivers an EXPIRED notification about the PREVIOUS period, signed after the renewal.
    const late = `notif-expired-old-${u.userId}`;
    notifications.set(late, { notificationType: 'EXPIRED', notificationUUID: `uuid-expired-old-${u.userId}`, signedDate: t0 + 60_000, tx: { ...renewal, transactionId: `first-${u.userId}`, purchaseDate: t0 - 31 * DAY, expiresDate: t0 - DAY } });
    const n = await app.inject({ method: 'POST', url: '/webhooks/apple/app-store-notifications', payload: { signedPayload: late } });
    expect(JSON.parse(n.body).outcome).toBe('IGNORED_STALE');
    expect((await u.req({ method: 'GET', url: '/v1/billing/entitlements' })).json.effectivePlan).toBe('GOLD');
    // A refund REQUEST is informational: it neither grants nor revokes.
    const ask = `notif-consumption-${u.userId}`;
    notifications.set(ask, { notificationType: 'CONSUMPTION_REQUEST', notificationUUID: `uuid-consumption-${u.userId}`, signedDate: t0 + 120_000, tx: renewal });
    expect(JSON.parse((await app.inject({ method: 'POST', url: '/webhooks/apple/app-store-notifications', payload: { signedPayload: ask } })).body).outcome).toBe('IGNORED_NOT_SUBSCRIPTION');
    expect((await u.req({ method: 'GET', url: '/v1/billing/entitlements' })).json.effectivePlan).toBe('GOLD');
  });

  it('clients cannot write entitlements directly, even bypassing the API', async () => {
    const c = await signUp(app, { role: 'PATIENT' });
    const cl = await appPool.connect();
    try {
      await cl.query('BEGIN');
      await cl.query("select set_config('app.user_id', $1, true)", [c.userId]);
      await expect(
        cl.query(`insert into app.entitlements (user_id, plan_code, source, status, external_ref, last_event_at) values ($1, 'PLATINUM', 'APPLE', 'ACTIVE', 'fake', now())`, [c.userId]),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await cl.query('ROLLBACK');
      cl.release();
    }
  });
});

// ---------------------------------------------------------------- Google Play (fixture store)
describe('Google Play subscriptions', () => {
  const subs = new Map<string, GoogleSubscriptionV2>();
  const acknowledged: string[] = [];
  const fixtureGoogle: GoogleStore = {
    status: 'CONFIGURED',
    getSubscription: async (token) => {
      const s = subs.get(token);
      if (!s) throw new AppError(422, 'INVALID_PURCHASE_TOKEN', 'unknown token');
      return s;
    },
    acknowledge: async (_productId, token) => {
      acknowledged.push(token);
      const s = subs.get(token);
      if (s) s.acknowledgementState = 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED';
    },
    verifyPush: async (authorization) => {
      if (authorization !== 'Bearer test-push') throw new AppError(401, 'UNAUTHORIZED', 'bad push');
    },
  };
  let gapp: FastifyInstance;
  const sub = (productId: string, accountToken: string, extra: Partial<GoogleSubscriptionV2> = {}): GoogleSubscriptionV2 => ({
    subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
    latestOrderId: `GPA.${Math.random().toString(36).slice(2)}`,
    acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
    externalAccountIdentifiers: { obfuscatedExternalAccountId: accountToken },
    lineItems: [{ productId, expiryTime: new Date(Date.now() + 30 * DAY).toISOString(), autoRenewingPlan: { autoRenewEnabled: true }, offerDetails: { basePlanId: 'monthly' } }],
    ...extra,
  });
  const rtdn = (token: string, type: number, id: string) => ({
    method: 'POST' as const,
    url: '/webhooks/google/rtdn',
    headers: { authorization: 'Bearer test-push' },
    payload: { message: { messageId: id, data: Buffer.from(JSON.stringify({ packageName: 'com.example.dmw', eventTimeMillis: String(Date.now()), subscriptionNotification: { notificationType: type, purchaseToken: token } })).toString('base64') } },
  });

  beforeAll(async () => {
    gapp = await buildServer(loadEnv({ ...process.env, GOOGLE_PLAY_PACKAGE_NAME: 'com.example.dmw' }), { stores: { apple: fixtureApple, google: fixtureGoogle } satisfies Stores });
    await gapp.ready();
    await owner.query(`update app.billing_plan_offers set google_product_id = 'dmw.gold', google_base_plan_id = 'monthly' where plan_code = 'GOLD' and period = 'MONTHLY'`);
    await owner.query(`update app.billing_plan_offers set google_product_id = 'dmw.platinum', google_base_plan_id = 'monthly' where plan_code = 'PLATINUM' and period = 'MONTHLY'`);
    await owner.query(`update app.billing_plans set family_profile_limit = 1 where code = 'SILVER'`);
    await owner.query(`update app.feature_flags set enabled = true where key = 'billing.store_subscriptions'`);
  });
  afterAll(async () => {
    await owner.query(`update app.billing_plan_offers set google_product_id = null, google_base_plan_id = null`);
    await gapp.close();
  });

  it('a plan change replaces the old purchase in place: the replaced token never grants again', async () => {
    const u = await signUp(gapp, { role: 'PATIENT' });
    const token = (await u.req({ method: 'GET', url: '/v1/billing/account-token' })).json.appAccountToken as string;
    const oldToken = `g-old-${u.userId}`;
    const newToken = `g-new-${u.userId}`;
    subs.set(oldToken, sub('dmw.gold', token));
    const gold = await u.req({ method: 'POST', url: '/v1/billing/google/verify', body: { productId: 'dmw.gold', purchaseToken: oldToken } });
    expect(gold.status).toBe(200);
    expect(gold.json.effectivePlan).toBe('GOLD');
    expect(acknowledged).toContain(oldToken);

    // Upgrade through Play's replacement flow: the new purchase links the old one.
    subs.set(newToken, sub('dmw.platinum', token, { linkedPurchaseToken: oldToken }));
    const plat = await u.req({ method: 'POST', url: '/v1/billing/google/verify', body: { productId: 'dmw.platinum', purchaseToken: newToken } });
    expect(plat.json.effectivePlan).toBe('PLATINUM');
    const rows = (await owner.query(`select external_ref, status, replaced_by from app.entitlements where user_id = $1 order by created_at`, [u.userId])).rows;
    expect(rows.find((r) => r.external_ref === oldToken)).toMatchObject({ status: 'EXPIRED', replaced_by: newToken });

    // Even if Play still reported the old token as active, restoring it does not revive it.
    const restore = await u.req({ method: 'POST', url: '/v1/billing/restore', body: { google: [{ productId: 'dmw.gold', purchaseToken: oldToken }] } });
    expect(restore.status).toBe(200);
    const after = (await owner.query(`select status from app.entitlements where external_ref = $1`, [oldToken])).rows[0];
    expect(after.status).toBe('EXPIRED');
    expect(restore.json.effectivePlan).toBe('PLATINUM');
  });

  it('a paused subscription grants nothing but stays store-managed (no second purchase offered)', async () => {
    const u = await signUp(gapp, { role: 'PATIENT' });
    const token = (await u.req({ method: 'GET', url: '/v1/billing/account-token' })).json.appAccountToken as string;
    const t = `g-pause-${u.userId}`;
    subs.set(t, sub('dmw.gold', token));
    expect((await u.req({ method: 'POST', url: '/v1/billing/google/verify', body: { productId: 'dmw.gold', purchaseToken: t } })).json.effectivePlan).toBe('GOLD');
    subs.set(t, { ...subs.get(t)!, subscriptionState: 'SUBSCRIPTION_STATE_PAUSED' });
    const n = await gapp.inject(rtdn(t, 10, `msg-pause-${u.userId}`));
    expect(JSON.parse(n.body).outcome).toBe('APPLIED');
    const ent = (await u.req({ method: 'GET', url: '/v1/billing/entitlements' })).json;
    expect(ent.effectivePlan).toBe('SILVER');
    expect(ent.storeManaged).toBe(true);
    expect(ent.entitlements[0].status).toBe('PAUSED');
    // The same Pub/Sub message delivered twice is applied once.
    expect(JSON.parse((await gapp.inject(rtdn(t, 10, `msg-pause-${u.userId}`))).body).outcome).toBe('DUPLICATE');
  });

  it('rejects push notifications without the Pub/Sub token', async () => {
    const res = await gapp.inject({ ...rtdn('x'.repeat(20), 2, 'msg-unauth'), headers: { authorization: 'Bearer forged' } });
    expect(res.statusCode).toBe(401);
  });
});
