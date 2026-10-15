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
import { appleStatus, googleStatus, normalizeApple } from '../src/modules/billing/events';
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
  });
  it('ignores non-subscription Apple transactions and flags sandbox purchases', () => {
    expect(normalizeApple({ tx: { originalTransactionId: '1', productId: 'x', type: 'Consumable' }, now: NOW })).toBeNull();
    const ev = normalizeApple({ tx: { originalTransactionId: '1', transactionId: '2', productId: 'x', expiresDate: NOW.getTime() + DAY, environment: 'Sandbox' }, now: NOW });
    expect(ev?.sandbox).toBe(true);
    expect(ev?.eventType).toBe('CLIENT_VERIFY');
  });
});

// ---------------------------------------------------------------- service (fixture stores)
type AppleFixture = { originalTransactionId: string; transactionId: string; productId: string; expiresDate: number; appAccountToken?: string; environment: string; signedDate: number; revocationDate?: number; type: string };
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

  it('grants only after server verification, bound to the purchasing account; refunds revoke access', async () => {
    const buyer = await signUp(app, { role: 'PATIENT' });
    const token = (await buyer.req({ method: 'GET', url: '/v1/billing/account-token' })).json.appAccountToken as string;
    const signed = `signed-tx-${buyer.userId}`;
    fixtures.set(signed, { originalTransactionId: `otx-${buyer.userId}`, transactionId: `tx-${buyer.userId}`, productId: 'com.example.dmw.gold.monthly', expiresDate: Date.now() + 30 * DAY, appAccountToken: token, environment: 'Sandbox', signedDate: Date.now(), type: 'Auto-Renewable Subscription' });

    // Feature disabled → refused (store subscriptions not launched yet).
    const off = await buyer.req({ method: 'POST', url: '/v1/billing/apple/verify', body: { signedTransactionInfo: signed } });
    expect(off.status).toBe(409);
    expect(off.json.error.code).toBe('FEATURE_DISABLED');
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
