import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestServer, ownerPool, signUp, type Client } from './helpers';

let app: FastifyInstance;
let shopper: Client;
let stranger: Client;
let variantId: string;
let strangerPatientId: string;

beforeAll(async () => {
  app = await createTestServer();
  const pool = ownerPool();
  try {
    const { rows } = await pool.query<{ id: string }>(
      `insert into app.products (slug, name_ar, name_en, summary_ar, summary_en, description_ar, description_en, usage_ar, usage_en, is_demo, publication_status)
       values ('demo-store-test', 'TetraSol — تجريبي', 'TetraSol — Demo', 's', 's', 'd', 'd', 'u', 'u', true, 'PUBLISHED')
       on conflict (slug) do update set name_en = excluded.name_en returning id`,
    );
    const v = await pool.query<{ id: string }>(
      `insert into app.product_variants (product_id, sku, label_ar, label_en, price_piasters, stock_status) values ($1, 'DEMO-STORE-TEST-1', 'خيار', 'Option', 12000, 'IN_STOCK')
       on conflict (sku) do update set price_piasters = excluded.price_piasters returning id`,
      [rows[0]!.id],
    );
    variantId = v.rows[0]!.id;
  } finally {
    await pool.end();
  }
  shopper = await signUp(app, { role: 'PATIENT' });
  stranger = await signUp(app, { role: 'PATIENT' });
  const created = await stranger.req({
    method: 'POST',
    url: '/v1/patients',
    body: { displayName: 'Stranger', dateOfBirth: '1980-01-01', sex: 'MALE', relationship: 'SELF', consentBasis: 'SELF', consentAttested: true, consentStatementVersion: 'v1' },
  });
  strangerPatientId = created.json.id;
});
afterAll(async () => {
  await app.close();
});

describe('TetraSol Care (Flow D)', () => {
  it('lists the catalog with demo items clearly flagged', async () => {
    const res = await shopper.req({ method: 'GET', url: '/v1/store/products' });
    const item = res.json.find((p: { slug: string }) => p.slug === 'demo-store-test');
    expect(item).toMatchObject({ isDemo: true, contentStatus: 'PENDING_APPROVAL', fromPricePiasters: 12000 });
  });

  it('shows product details with variants', async () => {
    const res = await shopper.req({ method: 'GET', url: '/v1/store/products/demo-store-test' });
    expect(res.status).toBe(200);
    expect(res.json.variants[0].id).toBe(variantId);
  });

  it('adds to cart and computes totals server-side', async () => {
    await shopper.req({ method: 'POST', url: '/v1/store/cart/items', body: { variantId, quantity: 2 } });
    const res = await shopper.req({ method: 'POST', url: '/v1/store/cart/items', body: { variantId, quantity: 1 } });
    expect(res.status).toBe(201);
    expect(res.json.lines).toHaveLength(1);
    expect(res.json.lines[0].quantity).toBe(3);
    expect(res.json.subtotalPiasters).toBe(36000);
  });

  it('cannot buy on behalf of a patient profile the shopper is not authorized for', async () => {
    const res = await shopper.req({ method: 'POST', url: '/v1/store/cart/items', body: { variantId, quantity: 1, forPatientId: strangerPatientId } });
    expect(res.status).toBe(403);
  });

  it('checkout preview is explicitly simulated while payments are not configured', async () => {
    const res = await shopper.req({ method: 'POST', url: '/v1/store/checkout/preview' });
    expect(res.status).toBe(200);
    expect(res.json.totalPiasters).toBe(36000);
    expect(res.json.payment).toEqual({ provider: 'PAYMOB', status: 'NOT_CONFIGURED', simulated: true, canPlaceRealOrder: false });
    expect(res.json.notices).toContain('PAYMENT_NOT_CONFIGURED_SIMULATION_ONLY');
    expect(res.json.notices).toContain('CONTAINS_SYNTHETIC_DEMO_ITEMS');
  });

  it('carts are private', async () => {
    const res = await stranger.req({ method: 'GET', url: '/v1/store/cart' });
    expect(res.json.lines).toHaveLength(0);
  });

  it('hides demo catalog items entirely when demo mode is off', async () => {
    const prodLike = await createTestServer({ DEMO_MODE: 'false' });
    try {
      const { clientFor } = await import('./helpers');
      const res = await clientFor(prodLike, shopper.cookie).req({ method: 'GET', url: '/v1/store/products' });
      expect(res.json.find((p: { slug: string }) => p.slug === 'demo-store-test')).toBeUndefined();
    } finally {
      await prodLike.close();
    }
  });
});

describe('system status', () => {
  it('reports unconfigured integrations honestly', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/system/status' });
    // No provider keys in the test environment: only the development simulator is available.
    expect(JSON.parse(res.body).integrations).toMatchObject({ payments: 'NOT_CONFIGURED', ai: 'DEV_ADAPTER', storage: 'NOT_CONFIGURED' });
  });
});
