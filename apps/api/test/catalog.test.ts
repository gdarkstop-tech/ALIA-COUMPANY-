/**
 * Admin catalogue management (migration 0008): lifecycle, separation of duties for medical text,
 * company-owned brands, the stock ledger, images, discounts, bundles and funnel analytics.
 */
import { deflateSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestServer, grantRole, ownerPool, signUp, type Client } from './helpers';

let app: FastifyInstance;
let owner: pg.Pool;
let admin: Client;
let commerce: Client;
let reviewer: Client;
let patient: Client;

const run = `${Date.now().toString(36)}`;
const content = (n: string) => ({
  nameAr: `منتج ${n}`,
  nameEn: `Product ${n}`,
  summaryAr: 'ملخص',
  summaryEn: 'Summary',
  descriptionAr: 'وصف',
  descriptionEn: 'Description',
  usageAr: 'الاستخدام',
  usageEn: 'Usage',
  approvedUsesAr: 'الاستخدامات المعتمدة',
  approvedUsesEn: 'Approved uses',
  warningsAr: 'تحذيرات',
  warningsEn: 'Warnings',
});

/** A real, minimal PNG (1×1, RGBA), padded with a tEXt chunk past the 100-byte minimum. */
function png(): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('tEXt', Buffer.from('Comment\0synthetic test image for catalogue tests', 'latin1')),
    chunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 0]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function createProduct(by: Client, slug: string, extra: Record<string, unknown> = {}) {
  const res = await by.req({ method: 'POST', url: '/v1/admin/catalog/products', body: { slug, brand: 'TetraSol', ...content(slug), ...extra } });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return res.json as { id: string; contentStatus: string; publicationStatus: string; editedByMe: boolean };
}

/** Draft → approved (by the reviewer) → published (by commerce), with one priced variant. */
async function liveProduct(slug: string, price = 10_000) {
  const p = await createProduct(commerce, slug);
  const withVariant = await commerce.req({ method: 'POST', url: `/v1/admin/catalog/products/${p.id}/variants`, body: { sku: `SKU-${slug.toUpperCase()}`.slice(0, 40), labelAr: 'عبوة', labelEn: 'Pack', pricePiasters: price } });
  expect(withVariant.status).toBe(201);
  expect((await reviewer.req({ method: 'POST', url: `/v1/admin/catalog/products/${p.id}/approve`, body: { approvalReference: 'BRAND-LETTER-001' } })).status).toBe(200);
  expect((await commerce.req({ method: 'POST', url: `/v1/admin/catalog/products/${p.id}/publication`, body: { status: 'PUBLISHED' } })).status).toBe(200);
  return { id: p.id, variantId: withVariant.json.variants[0].id as string };
}

beforeAll(async () => {
  app = await createTestServer();
  owner = ownerPool();
  admin = await signUp(app);
  await grantRole(admin.userId, 'ADMIN');
  commerce = await signUp(app);
  await grantRole(commerce.userId, 'COMMERCE_MANAGER');
  reviewer = await signUp(app);
  await grantRole(reviewer.userId, 'CLINICAL_REVIEWER');
  patient = await signUp(app, { role: 'PATIENT' });
});
afterAll(async () => {
  await owner.end();
  await app.close();
});

describe('product lifecycle and approval', () => {
  it('new products start as drafts pending review, whatever the client sends', async () => {
    const p = await createProduct(commerce, `cat-new-${run}`, { contentStatus: 'APPROVED', publicationStatus: 'PUBLISHED' });
    expect(p.contentStatus).toBe('PENDING_APPROVAL');
    expect(p.publicationStatus).toBe('DRAFT');
  });

  it('only approved content can be published, and commerce managers cannot approve', async () => {
    const p = await createProduct(commerce, `cat-unapproved-${run}`);
    const publish = await commerce.req({ method: 'POST', url: `/v1/admin/catalog/products/${p.id}/publication`, body: { status: 'PUBLISHED' } });
    expect(publish.status).toBe(422);
    expect(publish.json.error.code).toBe('APPROVAL_REQUIRED');
    const approve = await commerce.req({ method: 'POST', url: `/v1/admin/catalog/products/${p.id}/approve`, body: { approvalReference: 'REF-1' } });
    expect(approve.status).toBe(403);
  });

  it('the person who edited medical text cannot approve it (separation of duties)', async () => {
    const p = await createProduct(admin, `cat-self-approve-${run}`);
    expect(p.editedByMe).toBe(true);
    const self = await admin.req({ method: 'POST', url: `/v1/admin/catalog/products/${p.id}/approve`, body: { approvalReference: 'REF-SELF' } });
    expect(self.status).toBe(403);
    expect(self.json.error.code).toBe('APPROVER_MUST_DIFFER_FROM_EDITOR');
    const other = await reviewer.req({ method: 'POST', url: `/v1/admin/catalog/products/${p.id}/approve`, body: { approvalReference: 'REF-OTHER' } });
    expect(other.status).toBe(200);
    expect(other.json.contentStatus).toBe('APPROVED');
    expect(other.json.approvalReference).toBe('REF-OTHER');
  });

  it('a published product appears in the app automatically; editing its warnings sends it back to review and off the store', async () => {
    const slug = `cat-live-${run}`;
    const { id } = await liveProduct(slug);
    const listed = await patient.req({ method: 'GET', url: '/v1/store/products' });
    expect(listed.json.some((p: { slug: string }) => p.slug === slug)).toBe(true);
    const detail = await patient.req({ method: 'GET', url: `/v1/store/products/${slug}` });
    expect(detail.json.approvedUsesEn).toBe('Approved uses');
    expect(detail.json.warningsEn).toBe('Warnings');

    const edited = await commerce.req({ method: 'PATCH', url: `/v1/admin/catalog/products/${id}`, body: { warningsEn: 'Changed warning text' } });
    expect(edited.status).toBe(200);
    expect(edited.json.contentStatus).toBe('PENDING_APPROVAL');
    expect(edited.json.publicationStatus).toBe('UNPUBLISHED');
    expect((await patient.req({ method: 'GET', url: `/v1/store/products/${slug}` })).status).toBe(404);
  });

  it('withdrawing approval takes a product off the store at once', async () => {
    const slug = `cat-withdraw-${run}`;
    const { id } = await liveProduct(slug);
    const w = await reviewer.req({ method: 'POST', url: `/v1/admin/catalog/products/${id}/withdraw-approval` });
    expect(w.json.publicationStatus).toBe('UNPUBLISHED');
    expect((await patient.req({ method: 'GET', url: `/v1/store/products/${slug}` })).status).toBe(404);
  });

  it('only never-published drafts can be deleted; published products are archived', async () => {
    const draft = await createProduct(commerce, `cat-delete-${run}`);
    expect((await commerce.req({ method: 'DELETE', url: `/v1/admin/catalog/products/${draft.id}` })).status).toBe(200);
    const { id } = await liveProduct(`cat-archive-${run}`);
    const del = await commerce.req({ method: 'DELETE', url: `/v1/admin/catalog/products/${id}` });
    expect(del.status).toBe(422);
    expect(del.json.error.code).toBe('ONLY_UNPUBLISHED_DRAFTS_CAN_BE_DELETED');
    const archived = await commerce.req({ method: 'POST', url: `/v1/admin/catalog/products/${id}/publication`, body: { status: 'ARCHIVED' } });
    expect(archived.json.publicationStatus).toBe('ARCHIVED');
    expect(archived.json.archivedAt).not.toBeNull();
    const back = await commerce.req({ method: 'POST', url: `/v1/admin/catalog/products/${id}/publication`, body: { status: 'PUBLISHED' } });
    expect(back.status).toBe(422);
    expect(back.json.error.code).toBe('RESTORE_ARCHIVED_AS_UNPUBLISHED');
  });

  it('customers and patients cannot reach the catalogue console', async () => {
    expect((await patient.req({ method: 'GET', url: '/v1/admin/catalog/products' })).status).toBe(403);
    expect((await patient.req({ method: 'POST', url: '/v1/admin/catalog/products', body: { slug: `x-${run}`, brand: 'TetraSol', ...content('x') } })).status).toBe(403);
  });
});

describe('company-owned brands', () => {
  it('a product of an unregistered brand is refused; an administrator can add a new company brand without an app update', async () => {
    const brand = `Line${run}`.slice(0, 20);
    const refused = await commerce.req({ method: 'POST', url: '/v1/admin/catalog/products', body: { slug: `cat-brand-${run}`, brand, ...content('b') } });
    expect(refused.status).toBe(422);
    expect((await commerce.req({ method: 'POST', url: '/v1/admin/catalog/brands', body: { name: brand, ownerEntity: 'Company legal entity', ownershipReference: 'TM-REG-123' } })).status).toBe(403);
    expect((await admin.req({ method: 'POST', url: '/v1/admin/catalog/brands', body: { name: brand, ownerEntity: 'Company legal entity', ownershipReference: 'TM-REG-123' } })).status).toBe(201);
    await createProduct(commerce, `cat-brand-${run}`, { brand });
  });
});

describe('variants and stock ledger', () => {
  it('stock changes only through the ledger, and the status follows the quantity', async () => {
    const { id, variantId } = await liveProduct(`cat-stock-${run}`);
    const up = await commerce.req({ method: 'POST', url: `/v1/admin/catalog/variants/${variantId}/stock`, body: { delta: 12, reason: 'INITIAL', note: 'first delivery' } });
    expect(up.status).toBe(200);
    expect(up.json.variants[0]).toMatchObject({ stockQuantity: 12, stockStatus: 'IN_STOCK' });
    const down = await commerce.req({ method: 'POST', url: `/v1/admin/catalog/variants/${variantId}/stock`, body: { delta: -9, reason: 'DAMAGE' } });
    expect(down.json.variants[0]).toMatchObject({ stockQuantity: 3, stockStatus: 'LOW_STOCK' });
    expect(down.json.stockMovements.map((m: { delta: number }) => m.delta)).toEqual([-9, 12]);
    const over = await commerce.req({ method: 'POST', url: `/v1/admin/catalog/variants/${variantId}/stock`, body: { delta: -4, reason: 'SALE' } });
    expect(over.status).toBe(422);
    expect(over.json.error.code).toBe('INSUFFICIENT_STOCK');

    // Even bypassing the API, the app role cannot set a quantity or rewrite the ledger.
    const appPool = new pg.Pool({ connectionString: process.env.DATABASE_URL_APP });
    const cl = await appPool.connect();
    try {
      await cl.query('BEGIN');
      await cl.query("select set_config('app.user_id', $1, true)", [commerce.userId]);
      await expect(cl.query('update app.product_variants set stock_quantity = 999 where id = $1', [variantId])).rejects.toThrow(/permission denied/);
    } finally {
      await cl.query('ROLLBACK');
      cl.release();
      await appPool.end();
    }
    await expect(owner.query('delete from app.stock_movements where variant_id = $1', [variantId])).rejects.toThrow();
    const price = await commerce.req({ method: 'PATCH', url: `/v1/admin/catalog/variants/${variantId}`, body: { pricePiasters: 12_500 } });
    expect(price.json.variants[0].pricePiasters).toBe(12_500);
    const audited = await owner.query("select 1 from app.audit_log where action = 'catalog.price.changed' and entity_id = $1", [variantId]);
    expect(audited.rowCount).toBe(1);
    void id;
  });
});

describe('product images', () => {
  it('accepts only real JPEG/PNG/WebP files and serves images of products on sale publicly', async () => {
    const slug = `cat-image-${run}`;
    const { id } = await liveProduct(slug);
    const bytes = png();
    const lie = await commerce.req({ method: 'POST', url: `/v1/admin/catalog/products/${id}/images`, body: { contentType: 'image/jpeg', dataBase64: bytes.toString('base64') } });
    expect(lie.status).toBe(422);
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script>${' '.repeat(120)}</svg>`);
    expect((await commerce.req({ method: 'POST', url: `/v1/admin/catalog/products/${id}/images`, body: { contentType: 'image/png', dataBase64: svg.toString('base64') } })).status).toBe(422);
    const ok = await commerce.req({ method: 'POST', url: `/v1/admin/catalog/products/${id}/images`, body: { contentType: 'image/png', dataBase64: bytes.toString('base64'), altEn: 'Pack shot', altAr: 'صورة العبوة' } });
    expect(ok.status).toBe(201);
    const img = ok.json.images[0];
    expect(img).toMatchObject({ width: 1, height: 1, contentType: 'image/png' });

    const anon = await app.inject({ method: 'GET', url: `/v1/store/images/${img.id}` });
    expect(anon.statusCode).toBe(200);
    expect(anon.headers['content-type']).toBe('image/png');
    expect(anon.headers['content-security-policy']).toContain("default-src 'none'");
    expect(Buffer.compare(anon.rawPayload, bytes)).toBe(0);
    expect((await patient.req({ method: 'GET', url: `/v1/store/products/${slug}` })).json.images[0].id).toBe(img.id);

    // Unpublished → no longer public.
    await commerce.req({ method: 'POST', url: `/v1/admin/catalog/products/${id}/publication`, body: { status: 'UNPUBLISHED' } });
    expect((await app.inject({ method: 'GET', url: `/v1/store/images/${img.id}` })).statusCode).toBe(404);
  });
});

describe('discounts and bundles', () => {
  it('applies the single best discount server-side; codes are never listable by customers', async () => {
    const { variantId } = await liveProduct(`cat-disc-${run}`, 20_000);
    const code = `SAVE${run.toUpperCase()}`.slice(0, 24).replace(/[^A-Z0-9-]/g, '');
    const created = await commerce.req({ method: 'POST', url: '/v1/admin/catalog/discounts', body: { nameAr: 'خصم', nameEn: 'Variant saver', code, kind: 'PERCENT', value: 25, scope: 'VARIANT', targetId: variantId, active: true } });
    expect(created.status).toBe(201);
    const buyer = await signUp(app, { role: 'PATIENT' });
    expect((await buyer.req({ method: 'POST', url: '/v1/store/cart/items', body: { variantId, quantity: 2 } })).status).toBe(201);
    const without = await buyer.req({ method: 'POST', url: '/v1/store/checkout/preview', body: {} });
    expect(without.json.discount).toBeNull();
    const withCode = await buyer.req({ method: 'POST', url: '/v1/store/checkout/preview', body: { discountCode: code.toLowerCase() } });
    expect(withCode.json.subtotalPiasters).toBe(40_000);
    expect(withCode.json.discount).toMatchObject({ amountPiasters: 10_000, code });
    expect(withCode.json.totalPiasters).toBe(30_000);
    expect(withCode.json.payment.canPlaceRealOrder).toBe(false);
    const wrong = await buyer.req({ method: 'POST', url: '/v1/store/checkout/preview', body: { discountCode: 'NOPE-0000' } });
    expect(wrong.json.discountCodeRejected).toBe(true);
    expect((await buyer.req({ method: 'GET', url: '/v1/admin/catalog/discounts' })).status).toBe(403);
  });

  it('a bundle publishes only when every item is on sale, and can be bought as one cart line', async () => {
    const a = await liveProduct(`cat-bundle-a-${run}`, 10_000);
    const b = await createProduct(commerce, `cat-bundle-b-${run}`);
    const bv = await commerce.req({ method: 'POST', url: `/v1/admin/catalog/products/${b.id}/variants`, body: { sku: `SKU-BB-${run}`.toUpperCase().slice(0, 40), labelAr: 'عبوة', labelEn: 'Pack', pricePiasters: 5_000 } });
    const bundle = await commerce.req({ method: 'POST', url: '/v1/admin/catalog/bundles', body: { slug: `bundle-${run}`, nameAr: 'باقة', nameEn: 'Care bundle', pricePiasters: 12_000 } });
    expect(bundle.json.publicationStatus).toBe('DRAFT');
    const items = await commerce.req({ method: 'PUT', url: `/v1/admin/catalog/bundles/${bundle.json.id}/items`, body: { items: [{ variantId: a.variantId, quantity: 1 }, { variantId: bv.json.variants[0].id, quantity: 1 }] } });
    expect(items.json.itemsValuePiasters).toBe(15_000);
    const blocked = await commerce.req({ method: 'POST', url: `/v1/admin/catalog/bundles/${bundle.json.id}/publication`, body: { status: 'PUBLISHED' } });
    expect(blocked.status).toBe(422);
    expect(blocked.json.error.code).toBe('BUNDLE_ITEMS_NOT_ON_SALE');

    await reviewer.req({ method: 'POST', url: `/v1/admin/catalog/products/${b.id}/approve`, body: { approvalReference: 'BRAND-LETTER-002' } });
    await commerce.req({ method: 'POST', url: `/v1/admin/catalog/products/${b.id}/publication`, body: { status: 'PUBLISHED' } });
    expect((await commerce.req({ method: 'POST', url: `/v1/admin/catalog/bundles/${bundle.json.id}/publication`, body: { status: 'PUBLISHED' } })).status).toBe(200);

    const listed = await patient.req({ method: 'GET', url: '/v1/store/bundles' });
    const mine = listed.json.find((x: { id: string }) => x.id === bundle.json.id);
    expect(mine).toMatchObject({ pricePiasters: 12_000, itemsValuePiasters: 15_000 });
    const buyer = await signUp(app, { role: 'PATIENT' });
    const cart = await buyer.req({ method: 'POST', url: '/v1/store/cart/items', body: { bundleId: bundle.json.id, quantity: 1 } });
    expect(cart.status).toBe(201);
    expect(cart.json.subtotalPiasters).toBe(12_000);
    expect(cart.json.lines[0]).toMatchObject({ bundleId: bundle.json.id, variantId: null });

    // Taking one item off sale hides the bundle (and its price) everywhere.
    await commerce.req({ method: 'POST', url: `/v1/admin/catalog/products/${b.id}/publication`, body: { status: 'UNPUBLISHED' } });
    expect((await patient.req({ method: 'GET', url: '/v1/store/bundles' })).json.some((x: { id: string }) => x.id === bundle.json.id)).toBe(false);
    expect((await buyer.req({ method: 'GET', url: '/v1/store/cart' })).json.lines).toHaveLength(0);
  });
});

describe('sales analytics', () => {
  it('counts real funnel events only and reports zero paid orders while checkout is disabled', async () => {
    const slug = `cat-analytics-${run}`;
    const { id } = await liveProduct(slug);
    await patient.req({ method: 'GET', url: `/v1/store/products/${slug}` });
    await patient.req({ method: 'GET', url: `/v1/store/products/${slug}` });
    const a = await commerce.req({ method: 'GET', url: '/v1/admin/catalog/analytics?days=7' });
    expect(a.status).toBe(200);
    expect(a.json.paidOrders).toBe(0);
    expect(a.json.checkoutEnabled).toBe(false);
    expect(a.json.products.find((p: { productId: string }) => p.productId === id)?.views).toBe(2);
    // Events carry no user identifiers.
    const cols = await owner.query("select column_name from information_schema.columns where table_schema = 'app' and table_name = 'commerce_events'");
    expect(cols.rows.map((r) => r.column_name)).not.toContain('user_id');
  });
});
