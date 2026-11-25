import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { paymobHmac, paymobHmacString, PaymobGateway } from '../src/integrations/payments';
import { reconcilePayments, runOrderMaintenance } from '../src/modules/orders/routes';
import { buildServer } from '../src/server';
import { grantRole, ownerPool, signUp, type Client } from './helpers';

/**
 * ADR 0022. Paymob is replaced by a LOCAL MOCK of its documented endpoints (intention, auth token,
 * transaction inquiry, refund). These tests prove our side — signatures, idempotency, stock,
 * state machine, reconciliation — not that a real Paymob account accepts the requests. No real or
 * sandbox payment was made.
 */

const owner = ownerPool();
const HMAC = 'test-hmac-secret-0123456789abcdef';
let app: FastifyInstance;
let mockUrl: string;
let mock: Server;
const seen: { method: string; url: string; headers: Record<string, string | string[] | undefined>; body: string }[] = [];
// Transactions the mock "Paymob" knows about, by transaction id and by Paymob order id.
const txns = new Map<string, Record<string, unknown>>();
const byOrder = new Map<string, Record<string, unknown>>();
let refundSucceeds = true;
let nextOrder = 900000;

let customer: Client;
let other: Client;
let admin: Client;
let commerce: Client;
let variantId: string;
let scarceVariantId: string;

function transaction(o: { id: number; providerOrderId: string; amount: number; success?: boolean; pending?: boolean; isLive?: boolean; settled?: boolean; refunded?: number }) {
  return {
    id: o.id,
    pending: o.pending ?? false,
    amount_cents: o.amount,
    success: o.success ?? true,
    is_auth: false,
    is_capture: false,
    is_standalone_payment: true,
    is_voided: false,
    is_refunded: (o.refunded ?? 0) > 0,
    refunded_amount_cents: o.refunded ?? 0,
    is_3d_secure: true,
    integration_id: 4097558,
    has_parent_transaction: false,
    order: { id: Number(o.providerOrderId), merchant_order_id: null },
    created_at: '2026-11-25T10:00:00.000000',
    currency: 'EGP',
    source_data: { pan: '2346', type: 'card', sub_type: 'MasterCard' },
    error_occured: false,
    is_live: o.isLive ?? false,
    is_settled: o.settled ?? false,
    owner: 302852,
    data: { message: o.success === false ? 'Do not honour' : 'Approved' },
  };
}

async function startMock() {
  mock = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
    const send = (status: number, json: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json));
    if (req.url === '/v1/intention/' && req.method === 'POST') {
      if (req.headers.authorization !== 'Token sk_test_mockSecret123') return send(401, { detail: 'bad key' });
      const b = JSON.parse(body);
      const orderId = String(nextOrder++);
      return send(201, { id: `pi_test_${orderId}`, intention_order_id: Number(orderId), client_secret: `egy_csk_test_${orderId}`, special_reference: b.special_reference, status: 'intended' });
    }
    if (req.url === '/api/auth/tokens' && req.method === 'POST') return send(201, { token: 'auth-token-xyz' });
    const m = /^\/api\/acceptance\/transactions\/(\d+)$/.exec(req.url!);
    if (m && req.method === 'GET') {
      if (req.headers.authorization !== 'Bearer auth-token-xyz') return send(401, {});
      return txns.has(m[1]!) ? send(200, txns.get(m[1]!)) : send(404, {});
    }
    if (req.url === '/api/ecommerce/orders/transaction_inquiry' && req.method === 'POST') {
      const b = JSON.parse(body);
      return byOrder.has(String(b.order_id)) ? send(200, byOrder.get(String(b.order_id))) : send(404, { detail: 'not found' });
    }
    if (req.url === '/api/acceptance/void_refund/refund' && req.method === 'POST') {
      return refundSucceeds ? send(201, { id: 555000 + seen.length, success: true, data: { message: 'Approved' } }) : send(400, { success: false, detail: 'Refund not allowed' });
    }
    send(404, {});
  });
  mock.listen(0, '127.0.0.1');
  await once(mock, 'listening');
  mockUrl = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
}

const env = (extra: Record<string, string> = {}) =>
  loadEnv({
    ...process.env,
    API_PUBLIC_URL: 'https://api.example.test',
    PAYMOB_SECRET_KEY: 'sk_test_mockSecret123',
    PAYMOB_PUBLIC_KEY: 'pk_test_mockPublic123',
    PAYMOB_HMAC_SECRET: HMAC,
    PAYMOB_INTEGRATION_IDS: '4097558',
    PAYMOB_API_KEY: 'mock-api-key-0123456789',
    PAYMOB_BASE_URL: mockUrl,
    LOG_LEVEL: process.env.ORDERS_TEST_LOG ?? 'silent',
    ...extra,
  });

async function callback(t: Record<string, unknown>, hmac = paymobHmac(HMAC, t, 'PROCESSED')) {
  return app.inject({ method: 'POST', url: `/v1/webhooks/paymob?hmac=${hmac}`, headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ type: 'TRANSACTION', obj: t }) });
}
const delivery = { recipientName: 'Mona Ali', phone: '01012345678', governorate: 'CAIRO', city: 'Nasr City', district: 'District 7', address: '12 Abbas El Akkad St, apt 9' };
async function cart(c: Client, variant: string, quantity: number) {
  await owner.query('delete from app.cart_items where user_id = $1', [c.userId]);
  const r = await c.req({ method: 'POST', url: '/v1/store/cart/items', body: { variantId: variant, quantity } });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
}
const place = (c: Client, extra: object = {}) => c.req({ method: 'POST', url: '/v1/store/orders', body: { idempotencyKey: randomUUID(), delivery, ...extra } });
const stock = async (id: string) => (await owner.query('select stock_quantity, reserved_quantity from app.product_variants where id = $1', [id])).rows[0];
const payment = async (orderId: string) => (await owner.query('select * from app.payments where order_id = $1 order by created_at desc limit 1', [orderId])).rows[0];
async function placeAndOpen(c: Client, variant = variantId, qty = 1) {
  await cart(c, variant, qty);
  const o = await place(c);
  expect(o.status, JSON.stringify(o.json)).toBe(201);
  const pay = await c.req({ method: 'POST', url: `/v1/store/orders/${o.json.id}/pay` });
  expect(pay.status, JSON.stringify(pay.json)).toBe(200);
  const p = await payment(o.json.id);
  return { order: o.json, pay: pay.json, payment: p };
}

beforeAll(async () => {
  await startMock();
  app = await buildServer(env());
  await app.ready();
  const product = await owner.query(
    `insert into app.products (slug, name_ar, name_en, summary_ar, summary_en, description_ar, description_en, usage_ar, usage_en, is_demo, publication_status, content_status, approval_reference, approved_at)
     values ('order-test-dressing', 'ضماد', 'Test dressing', 's', 's', 'd', 'd', 'u', 'u', false, 'PUBLISHED', 'APPROVED', 'AUTOMATED TEST ONLY — not a real approval', now()) returning id`,
  );
  const pid = product.rows[0].id;
  variantId = (await owner.query(`insert into app.product_variants (product_id, sku, label_ar, label_en, price_piasters, stock_quantity) values ($1, 'ORDER-TEST-1', 'علبة', 'Box', 15000, 50) returning id`, [pid])).rows[0].id;
  scarceVariantId = (await owner.query(`insert into app.product_variants (product_id, sku, label_ar, label_en, price_piasters, stock_quantity) values ($1, 'ORDER-TEST-SCARCE', 'علبة', 'Box', 20000, 3) returning id`, [pid])).rows[0].id;
  await owner.query("update app.delivery_zones set active = true, fee_piasters = 5000, free_over_piasters = 100000 where governorate = 'CAIRO'");
  await owner.query("update app.feature_flags set enabled = true where key = 'commerce.checkout'");
  customer = await signUp(app, { role: 'PATIENT', name: 'Order Customer' });
  other = await signUp(app, { role: 'PATIENT', name: 'Other Customer' });
  admin = await signUp(app, { name: 'Finance Admin' });
  await grantRole(admin.userId, 'ADMIN');
  commerce = await signUp(app, { name: 'Commerce Staff' });
  await grantRole(commerce.userId, 'COMMERCE_MANAGER');
});
afterAll(async () => {
  await owner.query("update app.feature_flags set enabled = false where key = 'commerce.checkout'");
  await owner.query('update app.delivery_zones set active = false, fee_piasters = null, free_over_piasters = null');
  await app.close();
  await owner.end();
  await new Promise<void>((r) => mock.close(() => r()));
});
beforeEach(() => {
  refundSucceeds = true;
});

describe('Paymob signatures and configuration', () => {
  it('builds the HMAC string exactly as Paymob documents it (sample transaction from the docs)', () => {
    // developers.paymob.com → HMAC Transaction Callback: documented sample and its concatenated string.
    const sample = {
      id: 192036465, pending: false, amount_cents: 100000, success: true, is_auth: false, is_capture: false, is_standalone_payment: true, is_voided: false, is_refunded: false,
      is_3d_secure: true, integration_id: 4097558, has_parent_transaction: false, order: { id: 217503754 }, created_at: '2024-06-13T11:33:44.592345', currency: 'EGP',
      source_data: { pan: '2346', type: 'card', sub_type: 'MasterCard' }, error_occured: false, owner: 302852,
    };
    expect(paymobHmacString(sample, 'PROCESSED')).toBe('1000002024-06-13T11:33:44.592345EGPfalsefalse1920364654097558truefalsefalsefalsetruefalse217503754302852false2346MasterCardcardtrue');
    // The redirect (GET) form carries the same values as query parameters, with `order` for order.id.
    const query = { amount_cents: '100000', created_at: '2024-06-13T11:33:44.592345', currency: 'EGP', error_occured: 'false', has_parent_transaction: 'false', id: '192036465', integration_id: '4097558', is_3d_secure: 'true', is_auth: 'false', is_capture: 'false', is_refunded: 'false', is_standalone_payment: 'true', is_voided: 'false', order: '217503754', owner: '302852', pending: 'false', 'source_data.pan': '2346', 'source_data.sub_type': 'MasterCard', 'source_data.type': 'card', success: 'true' };
    expect(paymobHmacString(query, 'RESPONSE')).toBe(paymobHmacString(sample, 'PROCESSED'));
  });

  it('is NOT_CONFIGURED without credentials, with mixed test/live keys, or with live keys not yet approved', () => {
    const base = { PAYMOB_BASE_URL: 'https://accept.paymob.com', PAYMOB_CHECKOUT_URL: 'https://eg.checkout.paymob.com', PAYMOB_LIVE_APPROVED: false, PAYMOB_API_KEY: undefined };
    expect(new PaymobGateway({ ...base, PAYMOB_SECRET_KEY: undefined, PAYMOB_PUBLIC_KEY: undefined, PAYMOB_HMAC_SECRET: undefined, PAYMOB_INTEGRATION_IDS: undefined })).toMatchObject({ status: 'NOT_CONFIGURED', reason: 'MISSING_CREDENTIALS', mode: null });
    const keys = { PAYMOB_HMAC_SECRET: HMAC, PAYMOB_INTEGRATION_IDS: '1' };
    expect(new PaymobGateway({ ...base, ...keys, PAYMOB_SECRET_KEY: 'sk_live_a1', PAYMOB_PUBLIC_KEY: 'pk_test_a1' })).toMatchObject({ status: 'NOT_CONFIGURED', reason: 'KEY_MODE_MISMATCH' });
    expect(new PaymobGateway({ ...base, ...keys, PAYMOB_SECRET_KEY: 'sk_live_a1', PAYMOB_PUBLIC_KEY: 'pk_live_a1' })).toMatchObject({ status: 'NOT_CONFIGURED', reason: 'LIVE_NOT_APPROVED' });
    expect(new PaymobGateway({ ...base, ...keys, PAYMOB_SECRET_KEY: 'sk_test_a1', PAYMOB_PUBLIC_KEY: 'pk_test_a1' })).toMatchObject({ status: 'CONFIGURED', mode: 'TEST', canInquire: false });
  });
});

describe('placing orders', () => {
  it('the server prices the cart, applies the delivery zone, reserves stock and clears the cart', async () => {
    await cart(customer, variantId, 2);
    const before = await stock(variantId);
    const r = await place(customer);
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json).toMatchObject({ status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', paid: false, subtotalPiasters: 30000, deliveryFeePiasters: 5000, totalPiasters: 35000, can: { pay: true, cancel: true } });
    expect(r.json.delivery.phone).toBe('+201012345678');
    expect(r.json.reference).toMatch(/^OR-[0-9A-F]{8}$/);
    expect((await stock(variantId)).reserved_quantity).toBe(before.reserved_quantity + 2);
    expect((await customer.req({ method: 'GET', url: '/v1/store/cart' })).json.lines).toHaveLength(0);
  });

  it('a total that changed since the customer looked is refused; nothing is created', async () => {
    await cart(customer, variantId, 1);
    const r = await place(customer, { expectedTotalPiasters: 100 });
    expect(r.status).toBe(409);
    expect(r.json.error).toMatchObject({ code: 'PRICE_CHANGED', details: { detail: '20000' } });
    expect((await customer.req({ method: 'GET', url: '/v1/store/cart' })).json.lines).toHaveLength(1);
  });

  it('the same idempotency key never creates a second order', async () => {
    await cart(customer, variantId, 1);
    const key = randomUUID();
    const [a, b] = await Promise.all([
      customer.req({ method: 'POST', url: '/v1/store/orders', body: { idempotencyKey: key, delivery } }),
      customer.req({ method: 'POST', url: '/v1/store/orders', body: { idempotencyKey: key, delivery } }),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.json.id).toBe(b.json.id);
    expect((await owner.query('select count(*)::int as n from app.orders where user_id = $1 and idempotency_key = $2', [customer.userId, key])).rows[0].n).toBe(1);
  });

  it('no delivery zone, switched-off checkout or an empty cart: refused', async () => {
    await cart(customer, variantId, 1);
    expect((await place(customer, { delivery: { ...delivery, governorate: 'GIZA', city: 'Dokki' } })).json.error.code).toBe('DELIVERY_NOT_AVAILABLE');
    expect((await place(customer, { delivery: { ...delivery, phone: '+447400123456' } })).json.error.code).toBe('INVALID_PHONE');
    await owner.query("update app.feature_flags set enabled = false where key = 'commerce.checkout'");
    try {
      expect((await place(customer)).json.error.code).toBe('FEATURE_DISABLED');
    } finally {
      await owner.query("update app.feature_flags set enabled = true where key = 'commerce.checkout'");
    }
    await owner.query('delete from app.cart_items where user_id = $1', [customer.userId]);
    expect((await place(customer)).json.error.code).toBe('CART_EMPTY');
  });

  it('five customers racing for the last three units: exactly three orders, no overselling', async () => {
    const buyers = await Promise.all(Array.from({ length: 5 }, (_, i) => signUp(app, { role: 'PATIENT', name: `Buyer ${i}` })));
    for (const b of buyers) await cart(b, scarceVariantId, 1);
    const results = await Promise.all(buyers.map((b) => place(b)));
    expect(results.filter((r) => r.status === 201), JSON.stringify(results.map((r) => [r.status, r.json?.error?.code]))).toHaveLength(3);
    for (const r of results.filter((x) => x.status !== 201)) expect(r.json.error).toMatchObject({ code: 'OUT_OF_STOCK', details: { detail: 'ORDER-TEST-SCARCE' } });
    expect(await stock(scarceVariantId)).toEqual({ stock_quantity: 3, reserved_quantity: 3 });
    // The database refuses reserving more than is in stock, whatever the code does.
    await expect(owner.query('update app.product_variants set reserved_quantity = 4 where id = $1', [scarceVariantId])).rejects.toThrow(/variant_reserved_within_stock/);
  });

  it('customers see only their own orders', async () => {
    const mine = (await customer.req({ method: 'GET', url: '/v1/store/orders' })).json;
    expect(mine.length).toBeGreaterThan(0);
    expect((await other.req({ method: 'GET', url: `/v1/store/orders/${mine[0].id}` })).status).toBe(404);
    expect((await other.req({ method: 'POST', url: `/v1/store/orders/${mine[0].id}/pay` })).status).toBe(404);
    expect((await other.req({ method: 'POST', url: `/v1/store/orders/${mine[0].id}/cancel` })).status).toBe(404);
  });
});

describe('paying through Paymob (mock of the documented API)', () => {
  it('opens a hosted checkout for the server total, with the secret key only on the server side', async () => {
    const { order, pay, payment: p } = await placeAndOpen(customer, variantId, 1);
    expect(pay.checkoutUrl).toBe(`https://eg.checkout.paymob.com/?publicKey=pk_test_mockPublic123&clientSecret=egy_csk_test_${p.provider_order_id}`);
    expect(pay.mode).toBe('TEST');
    expect(JSON.stringify(pay)).not.toContain('sk_test_mockSecret123');
    const req = seen.filter((s) => s.url === '/v1/intention/').at(-1)!;
    const body = JSON.parse(req.body);
    expect(body).toMatchObject({ amount: order.totalPiasters, currency: 'EGP', payment_methods: [4097558], special_reference: order.reference, notification_url: 'https://api.example.test/v1/webhooks/paymob' });
    expect(body.items).toEqual([{ name: `TetraSol order ${order.reference}`, amount: order.totalPiasters, quantity: 1 }]);
    expect(p).toMatchObject({ status: 'PENDING', mode: 'TEST', amount_piasters: order.totalPiasters });
  });

  it('a forged or altered callback changes nothing; a valid one marks the order paid and consumes stock', async () => {
    const before = await stock(variantId);
    const { order, payment: p } = await placeAndOpen(customer, variantId, 2);
    const t = transaction({ id: 7000001, providerOrderId: p.provider_order_id, amount: order.totalPiasters });
    txns.set('7000001', t);
    expect((await callback(t, 'f'.repeat(128))).statusCode).toBe(403);
    expect((await callback({ ...t, amount_cents: 1 }, paymobHmac(HMAC, t, 'PROCESSED'))).statusCode).toBe(403);
    expect((await customer.req({ method: 'GET', url: `/v1/store/orders/${order.id}` })).json).toMatchObject({ paid: false, paymentStatus: 'PENDING' });
    const ok = await callback(t);
    expect(ok.statusCode).toBe(200);
    const after = (await customer.req({ method: 'GET', url: `/v1/store/orders/${order.id}` })).json;
    expect(after).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID', paid: true, can: { pay: false, cancel: false } });
    const s = await stock(variantId);
    expect(s.stock_quantity).toBe(before.stock_quantity - 2);
    expect(s.reserved_quantity).toBe(before.reserved_quantity);
    expect((await owner.query("select count(*)::int as n from app.notifications where related_id = $1 and purpose = 'order.confirmed'", [order.id])).rows[0].n).toBeGreaterThanOrEqual(1);
    // The transaction was re-read from Paymob before anything changed (defence in depth).
    expect(seen.some((x) => x.url === '/api/acceptance/transactions/7000001' && x.headers.authorization === 'Bearer auth-token-xyz')).toBe(true);
  });

  it('replayed callbacks are ignored, and a paid order never goes back to failed', async () => {
    const { order, payment: p } = await placeAndOpen(customer, variantId, 1);
    const t = transaction({ id: 7000002, providerOrderId: p.provider_order_id, amount: order.totalPiasters });
    txns.set('7000002', t);
    await callback(t);
    const events = async () => (await owner.query('select count(*)::int as n from app.payment_events where transaction_id = $1', ['7000002'])).rows[0].n;
    expect(await events()).toBe(1);
    expect((await callback(t)).statusCode).toBe(200);
    expect(await events()).toBe(1);
    const late = transaction({ id: 7000002, providerOrderId: p.provider_order_id, amount: order.totalPiasters, success: false });
    txns.set('7000002', late);
    await callback(late);
    expect((await customer.req({ method: 'GET', url: `/v1/store/orders/${order.id}` })).json).toMatchObject({ paymentStatus: 'PAID', paid: true });
    txns.set('7000002', t);
  });

  it('an amount or mode that does not match what we charged opens an incident and changes nothing', async () => {
    const { order, payment: p } = await placeAndOpen(customer, variantId, 1);
    const wrong = transaction({ id: 7000003, providerOrderId: p.provider_order_id, amount: order.totalPiasters - 100 });
    txns.set('7000003', wrong);
    const cb = await callback(wrong); expect(cb.statusCode, cb.body).toBe(200);
    expect((await customer.req({ method: 'GET', url: `/v1/store/orders/${order.id}` })).json.paid).toBe(false);
    const inc = await owner.query("select severity, domain from app.ops_incidents where related_id = $1 and kind = 'PAYMENT_MISMATCH'", [order.id]);
    expect(inc.rows[0]).toEqual({ severity: 'HIGH', domain: 'COMMERCE' });
    const live = transaction({ id: 7000004, providerOrderId: p.provider_order_id, amount: order.totalPiasters, isLive: true });
    txns.set('7000004', live);
    await callback(live);
    expect((await customer.req({ method: 'GET', url: `/v1/store/orders/${order.id}` })).json.paid).toBe(false);
  });

  it('a declined payment is FAILED; the customer can pay again until the order expires', async () => {
    const { order, payment: p } = await placeAndOpen(customer, variantId, 1);
    const declined = transaction({ id: 7000005, providerOrderId: p.provider_order_id, amount: order.totalPiasters, success: false });
    txns.set('7000005', declined);
    await callback(declined);
    const o = (await customer.req({ method: 'GET', url: `/v1/store/orders/${order.id}` })).json;
    expect(o).toMatchObject({ status: 'PENDING_PAYMENT', paymentStatus: 'FAILED', paid: false, can: { pay: true } });
    expect((await owner.query("select count(*)::int as n from app.notifications where related_id = $1 and purpose = 'payment.failed'", [order.id])).rows[0].n).toBeGreaterThanOrEqual(1);
    expect((await customer.req({ method: 'POST', url: `/v1/store/orders/${order.id}/pay` })).status).toBe(200);
  });

  it('unpaid orders expire and release stock; money arriving later is recorded and escalated, not hidden', async () => {
    const before = await stock(variantId);
    const { order, payment: p } = await placeAndOpen(customer, variantId, 3);
    await owner.query("update app.orders set payment_expires_at = now() - interval '1 minute' where id = $1", [order.id]);
    expect(await runOrderMaintenance(app)).toBeGreaterThanOrEqual(1);
    expect((await customer.req({ method: 'GET', url: `/v1/store/orders/${order.id}` })).json.status).toBe('EXPIRED');
    expect((await stock(variantId)).reserved_quantity).toBe(before.reserved_quantity);
    const lateSuccess = transaction({ id: 7000006, providerOrderId: p.provider_order_id, amount: order.totalPiasters });
    txns.set('7000006', lateSuccess);
    await callback(lateSuccess);
    expect((await customer.req({ method: 'GET', url: `/v1/store/orders/${order.id}` })).json).toMatchObject({ status: 'EXPIRED', paymentStatus: 'PAID' });
    expect((await owner.query("select severity from app.ops_incidents where related_id = $1 and kind = 'PAYMENT_MISMATCH'", [order.id])).rows[0].severity).toBe('HIGH');
  });

  it('the redirect page never changes an order and rejects unsigned requests', async () => {
    const { order, payment: p } = await placeAndOpen(customer, variantId, 1);
    const q = Object.fromEntries(Object.entries({ ...transaction({ id: 7000007, providerOrderId: p.provider_order_id, amount: order.totalPiasters }), order: p.provider_order_id }).filter(([, v]) => typeof v !== 'object').map(([k, v]) => [k, String(v)]));
    Object.assign(q, { 'source_data.pan': '2346', 'source_data.type': 'card', 'source_data.sub_type': 'MasterCard' });
    const hmac = paymobHmac(HMAC, q, 'RESPONSE');
    const ok = await app.inject({ method: 'GET', url: `/v1/payments/paymob/return?${new URLSearchParams({ ...q, hmac })}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain('only after the payment provider confirms');
    expect((await app.inject({ method: 'GET', url: `/v1/payments/paymob/return?${new URLSearchParams({ ...q, hmac: 'a'.repeat(128) })}` })).statusCode).toBe(400);
    expect((await customer.req({ method: 'GET', url: `/v1/store/orders/${order.id}` })).json.paid).toBe(false);
  });

  it('reconciliation finds payments whose callback never arrived, and records settlement', async () => {
    const { order, payment: p } = await placeAndOpen(customer, variantId, 1);
    await owner.query("update app.payments set created_at = now() - interval '20 minutes' where id = $1", [p.id]);
    byOrder.set(String(p.provider_order_id), transaction({ id: 7000008, providerOrderId: p.provider_order_id, amount: order.totalPiasters }));
    const r1 = await reconcilePayments(app);
    expect(r1.inquiry).toBe('AVAILABLE');
    expect(r1.applied).toBeGreaterThanOrEqual(1);
    expect((await customer.req({ method: 'GET', url: `/v1/store/orders/${order.id}` })).json).toMatchObject({ paymentStatus: 'PAID', status: 'CONFIRMED' });
    txns.set('7000008', transaction({ id: 7000008, providerOrderId: p.provider_order_id, amount: order.totalPiasters, settled: true }));
    await reconcilePayments(app);
    const settled = await payment(order.id);
    expect(settled.status).toBe('SETTLED');
    expect(settled.settled_at).not.toBeNull();
    expect((await customer.req({ method: 'GET', url: `/v1/store/orders/${order.id}` })).json).toMatchObject({ paymentStatus: 'SETTLED', paid: true });
  });
});

describe('commerce operations', () => {
  let paidOrder: { id: string; totalPiasters: number };

  beforeAll(async () => {
    const { order, payment: p } = await placeAndOpen(customer, variantId, 2);
    const t = transaction({ id: 7000100, providerOrderId: p.provider_order_id, amount: order.totalPiasters });
    txns.set('7000100', t);
    await callback(t);
    paidOrder = order;
  });

  it('commerce staff fulfil paid orders only; customers and clinicians have no access', async () => {
    expect((await customer.req({ method: 'GET', url: '/v1/admin/ops/orders' })).status).toBe(403);
    const list = await commerce.req({ method: 'GET', url: '/v1/admin/ops/orders' });
    expect(list.status).toBe(200);
    expect(list.json.orders.some((o: { id: string }) => o.id === paidOrder.id)).toBe(true);
    const unpaid = (await owner.query("select id from app.orders where status = 'PENDING_PAYMENT' limit 1")).rows[0];
    expect((await commerce.req({ method: 'POST', url: `/v1/admin/ops/orders/${unpaid.id}/fulfil`, body: { action: 'SHIP' } })).json.error.code).toBe('NOT_PAID');
    expect((await commerce.req({ method: 'POST', url: `/v1/admin/ops/orders/${paidOrder.id}/fulfil`, body: { action: 'PROCESS' } })).json.status).toBe('PROCESSING');
    const shipped = await commerce.req({ method: 'POST', url: `/v1/admin/ops/orders/${paidOrder.id}/fulfil`, body: { action: 'SHIP', trackingReference: 'BOSTA-123456' } });
    expect(shipped.json).toMatchObject({ status: 'SHIPPED', trackingReference: 'BOSTA-123456' });
    expect((await commerce.req({ method: 'POST', url: `/v1/admin/ops/orders/${paidOrder.id}/fulfil`, body: { action: 'PROCESS' } })).status).toBe(409);
    expect((await owner.query("select count(*)::int as n from app.notifications where related_id = $1 and purpose = 'order.status'", [paidOrder.id])).rows[0].n).toBeGreaterThanOrEqual(1);
    expect((await owner.query("select count(*)::int as n from app.audit_log where action = 'orders.fulfil' and entity_id = $1", [paidOrder.id])).rows[0].n).toBe(2);
    // Commerce staff never see appointments (clinical context).
    expect((await commerce.req({ method: 'GET', url: '/v1/admin/ops/appointments' })).status).toBe(403);
  });

  it('refunds: administrators only, bounded by what was paid, failures escalated', async () => {
    expect((await commerce.req({ method: 'POST', url: `/v1/admin/ops/orders/${paidOrder.id}/refunds`, body: { amountPiasters: 1000, reason: 'Damaged box' } })).status).toBe(403);
    const over = await admin.req({ method: 'POST', url: `/v1/admin/ops/orders/${paidOrder.id}/refunds`, body: { amountPiasters: paidOrder.totalPiasters + 1, reason: 'Too much' } });
    expect(over.status).toBe(409);
    expect(over.json.error.code).toBe('REFUND_EXCEEDS_PAID');
    const part = await admin.req({ method: 'POST', url: `/v1/admin/ops/orders/${paidOrder.id}/refunds`, body: { amountPiasters: 5000, reason: 'Delivery was late — fee returned' } });
    expect(part.status, JSON.stringify(part.json)).toBe(200);
    expect(part.json).toMatchObject({ paymentStatus: 'PARTIALLY_REFUNDED', refundedPiasters: 5000 });
    const sent = seen.filter((s) => s.url === '/api/acceptance/void_refund/refund').at(-1)!;
    expect(JSON.parse(sent.body)).toEqual({ transaction_id: 7000100, amount_cents: 5000 });
    expect(sent.headers.authorization).toBe('Token sk_test_mockSecret123');
    refundSucceeds = false;
    const failed = await admin.req({ method: 'POST', url: `/v1/admin/ops/orders/${paidOrder.id}/refunds`, body: { amountPiasters: 1000, reason: 'Second goodwill refund' } });
    expect(failed.json.refunds.at(-1)).toMatchObject({ status: 'FAILED' });
    expect(failed.json.refundedPiasters).toBe(5000);
    expect((await owner.query("select count(*)::int as n from app.ops_incidents where kind = 'REFUND_FAILED' and domain = 'COMMERCE'")).rows[0].n).toBeGreaterThanOrEqual(1);
    expect((await owner.query("select count(*)::int as n from app.audit_log where action like 'payments.refund.%' and entity_id = $1", [paidOrder.id])).rows[0].n).toBeGreaterThanOrEqual(3);
    // Refund queue: payments.read (commerce staff see it; customers do not).
    expect((await customer.req({ method: 'GET', url: '/v1/admin/ops/refunds' })).status).toBe(403);
    const open = await commerce.req({ method: 'GET', url: '/v1/admin/ops/refunds?status=OPEN' });
    expect(open.status).toBe(200);
    expect(open.json.some((f: { orderId: string; status: string }) => f.orderId === paidOrder.id && f.status === 'FAILED')).toBe(true);
    expect(open.json.every((f: { status: string }) => f.status !== 'SUCCEEDED')).toBe(true);
  });

  it('payments view: payments.read only; customers cannot reconcile', async () => {
    expect((await customer.req({ method: 'GET', url: '/v1/admin/ops/payments' })).status).toBe(403);
    const r = await commerce.req({ method: 'GET', url: '/v1/admin/ops/payments' });
    expect(r.status).toBe(200);
    expect(r.json.gateway).toEqual({ status: 'CONFIGURED', mode: 'TEST', reason: null, inquiry: 'AVAILABLE' });
    expect(JSON.stringify(r.json)).not.toMatch(/2346|MasterCard/); // no card details are stored or shown
    expect((await commerce.req({ method: 'POST', url: '/v1/admin/ops/payments/reconcile' })).status).toBe(403);
    expect((await admin.req({ method: 'POST', url: '/v1/admin/ops/payments/reconcile' })).status).toBe(200);
  });

  it('delivery zones are managed by commerce staff (audited)', async () => {
    expect((await customer.req({ method: 'PUT', url: '/v1/admin/ops/delivery-zones/GIZA', body: { active: true, feePiasters: 6000 } })).status).toBe(403);
    expect((await commerce.req({ method: 'PUT', url: '/v1/admin/ops/delivery-zones/GIZA', body: { active: true, feePiasters: null } })).status).toBe(422);
    expect((await commerce.req({ method: 'PUT', url: '/v1/admin/ops/delivery-zones/GIZA', body: { active: true, feePiasters: 6000, etaMinDays: 1, etaMaxDays: 3 } })).status).toBe(200);
    const preview = await customer.req({ method: 'POST', url: '/v1/store/checkout/preview', body: { governorate: 'GIZA' } });
    expect(preview.json.deliveryFeePiasters).toBe(6000);
    await commerce.req({ method: 'PUT', url: '/v1/admin/ops/delivery-zones/GIZA', body: { active: false, feePiasters: null } });
  });

  it('the payment gateway refuses to start a checkout when not configured', async () => {
    const plain = await buildServer(loadEnv({ ...process.env }));
    await plain.ready();
    try {
      expect(plain.services.payments.status).toBe('NOT_CONFIGURED');
      const r = await plain.inject({ method: 'POST', url: '/v1/webhooks/paymob?hmac=x', headers: { 'content-type': 'application/json' }, payload: '{}' });
      expect(r.statusCode).toBe(404);
    } finally {
      await plain.close();
    }
  });
});
