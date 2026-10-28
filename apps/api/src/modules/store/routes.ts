import {
  addCartItemBody,
  checkoutPreviewBody,
  updateCartItemBody,
  type CartLine,
  type CartResponse,
  type CheckoutPreview,
  type ProductCard,
  type ProductDetail,
  type StockStatus,
  type StoreBundle,
  type StoreCategory,
} from '@ghayarly/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Tx } from '../../db/client';
import { cartItems, patients, productBundleItems, productBundles, productCategories, productImages, products, productVariants } from '../../db/schema';
import { notFound } from '../../lib/errors';
import { getPrincipal, inContext, requirePrincipal } from '../../lib/principal';
import { parse } from '../../lib/validate';
import { liveKnowledge } from '../products/routes';

const STOCK_RANK: Record<StockStatus, number> = { IN_STOCK: 0, LOW_STOCK: 1, UNKNOWN: 2, OUT_OF_STOCK: 3 };

function bestStock(statuses: StockStatus[]): StockStatus {
  return statuses.sort((a, b) => STOCK_RANK[a] - STOCK_RANK[b])[0] ?? 'UNKNOWN';
}

/** Aggregate funnel analytics (no user identifiers); never allowed to break the customer request. */
async function recordEvent(tx: Tx, type: 'PRODUCT_VIEW' | 'ADD_TO_CART' | 'CHECKOUT_PREVIEW', e: { productId?: string | null; variantId?: string | null; bundleId?: string | null; quantity?: number; amount?: number | null }) {
  await tx.execute(sql`savepoint commerce_event`);
  try {
    await tx.execute(
      sql`select app.record_commerce_event(${type}::app.commerce_event_type, ${e.productId ?? null}::uuid, ${e.variantId ?? null}::uuid, ${e.bundleId ?? null}::uuid, ${e.quantity ?? 1}::int, ${e.amount ?? null}::int)`,
    );
    await tx.execute(sql`release savepoint commerce_event`);
  } catch {
    await tx.execute(sql`rollback to savepoint commerce_event`);
  }
}

async function firstImages(tx: Tx, productIds: string[]): Promise<Map<string, string>> {
  if (!productIds.length) return new Map();
  const rows = await tx
    .selectDistinctOn([productImages.productId], { productId: productImages.productId, id: productImages.id })
    .from(productImages)
    .where(inArray(productImages.productId, productIds))
    .orderBy(productImages.productId, asc(productImages.sortOrder), asc(productImages.createdAt));
  return new Map(rows.map((r) => [r.productId, r.id]));
}

export async function listProducts(tx: Tx): Promise<ProductCard[]> {
  // RLS returns only approved, published products of active company brands (plus clearly-flagged
  // demo items in demo mode / for review accounts).
  const rows = await tx.select().from(products).orderBy(asc(products.sortOrder), asc(products.slug));
  const variants = await tx.select().from(productVariants).where(eq(productVariants.active, true));
  const images = await firstImages(tx, rows.map((p) => p.id));
  return rows.map((p) => {
    const vs = variants.filter((v) => v.productId === p.id);
    return {
      id: p.id,
      slug: p.slug,
      nameAr: p.nameAr,
      nameEn: p.nameEn,
      summaryAr: p.summaryAr,
      summaryEn: p.summaryEn,
      fromPricePiasters: vs.length ? Math.min(...vs.map((v) => v.pricePiasters)) : null,
      stockStatus: bestStock(vs.map((v) => v.stockStatus)),
      contentStatus: p.contentStatus,
      isDemo: p.isDemo,
      categoryId: p.categoryId,
      imageId: images.get(p.id) ?? null,
    };
  });
}

type CartMeta = { line: CartLine; productId: string | null; categoryId: string | null };

async function loadCartMeta(tx: Tx, userId: string): Promise<CartMeta[]> {
  const rows = await tx
    .select({ c: cartItems, v: productVariants, p: products, b: productBundles, patientName: patients.displayName })
    .from(cartItems)
    .leftJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .leftJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(productBundles, eq(productBundles.id, cartItems.bundleId))
    .leftJoin(patients, eq(patients.id, cartItems.forPatientId))
    .where(eq(cartItems.userId, userId))
    .orderBy(asc(cartItems.createdAt));
  const out: CartMeta[] = [];
  for (const { c, v, p, b, patientName } of rows) {
    // A line whose product or bundle is no longer on sale (RLS hides it) is not priced or shown.
    if (v && p) {
      out.push({
        productId: p.id,
        categoryId: p.categoryId,
        line: {
          id: c.id,
          variantId: v.id,
          bundleId: null,
          productSlug: p.slug,
          productNameAr: p.nameAr,
          productNameEn: p.nameEn,
          variantLabelAr: v.labelAr,
          variantLabelEn: v.labelEn,
          unitPricePiasters: v.pricePiasters,
          quantity: c.quantity,
          lineTotalPiasters: v.pricePiasters * c.quantity,
          forPatientId: c.forPatientId,
          forPatientName: patientName ?? null,
          isDemo: p.isDemo,
        },
      });
    } else if (b) {
      out.push({
        productId: null,
        categoryId: null,
        line: {
          id: c.id,
          variantId: null,
          bundleId: b.id,
          productSlug: b.slug,
          productNameAr: b.nameAr,
          productNameEn: b.nameEn,
          variantLabelAr: 'باقة',
          variantLabelEn: 'Bundle',
          unitPricePiasters: b.pricePiasters,
          quantity: c.quantity,
          lineTotalPiasters: b.pricePiasters * c.quantity,
          forPatientId: c.forPatientId,
          forPatientName: patientName ?? null,
          isDemo: false,
        },
      });
    }
  }
  return out;
}

function summarise(meta: CartMeta[]): CartResponse {
  const lines = meta.map((m) => m.line);
  return { lines, subtotalPiasters: lines.reduce((sum, l) => sum + l.lineTotalPiasters, 0), itemCount: lines.reduce((sum, l) => sum + l.quantity, 0) };
}

async function loadCart(tx: Tx, userId: string): Promise<CartResponse> {
  return summarise(await loadCartMeta(tx, userId));
}

type DiscountRow = { id: string; name_ar: string; name_en: string; code: string | null; kind: 'PERCENT' | 'FIXED_AMOUNT'; value: number; scope: string; target_id: string | null; min_subtotal_piasters: number };

/** Saving one discount gives on this cart (0 when it does not apply). */
export function discountAmount(d: DiscountRow, meta: CartMeta[], subtotal: number): number {
  if (subtotal < d.min_subtotal_piasters) return 0;
  const eligible = meta
    .filter(({ line, productId, categoryId }) => {
      switch (d.scope) {
        case 'ALL':
          return true;
        case 'CATEGORY':
          return categoryId === d.target_id;
        case 'PRODUCT':
          return productId === d.target_id;
        case 'VARIANT':
          return line.variantId === d.target_id;
        case 'BUNDLE':
          return line.bundleId === d.target_id;
        default:
          return false;
      }
    })
    .reduce((sum, m) => sum + m.line.lineTotalPiasters, 0);
  if (eligible <= 0) return 0;
  return d.kind === 'PERCENT' ? Math.floor((eligible * d.value) / 100) : Math.min(d.value, eligible);
}

export async function storeRoutes(app: FastifyInstance) {
  const { payments } = app.services;

  app.get('/store/products', async (request) => {
    const principal = await requirePrincipal(request);
    return inContext(request, principal, listProducts);
  });

  app.get('/store/categories', async (request): Promise<StoreCategory[]> => {
    const principal = await requirePrincipal(request);
    return inContext(request, principal, (tx) =>
      tx
        .select({ id: productCategories.id, slug: productCategories.slug, nameAr: productCategories.nameAr, nameEn: productCategories.nameEn })
        .from(productCategories)
        .where(eq(productCategories.active, true))
        .orderBy(asc(productCategories.sortOrder), asc(productCategories.slug)),
    );
  });

  app.get('/store/products/:slug', async (request): Promise<ProductDetail> => {
    const principal = await requirePrincipal(request);
    const { slug } = parse(z.object({ slug: z.string().regex(/^[a-z0-9-]{1,80}$/) }), request.params);
    return inContext(request, principal, async (tx) => {
      const [p] = await tx.select().from(products).where(eq(products.slug, slug));
      if (!p) throw notFound('Product');
      const vs = await tx
        .select()
        .from(productVariants)
        .where(and(eq(productVariants.productId, p.id), eq(productVariants.active, true)))
        .orderBy(asc(productVariants.sortOrder));
      const images = await tx
        .select({ id: productImages.id, altAr: productImages.altAr, altEn: productImages.altEn })
        .from(productImages)
        .where(eq(productImages.productId, p.id))
        .orderBy(asc(productImages.sortOrder), asc(productImages.createdAt));
      await recordEvent(tx, 'PRODUCT_VIEW', { productId: p.id });
      return {
        id: p.id,
        slug: p.slug,
        nameAr: p.nameAr,
        nameEn: p.nameEn,
        summaryAr: p.summaryAr,
        summaryEn: p.summaryEn,
        descriptionAr: p.descriptionAr,
        descriptionEn: p.descriptionEn,
        usageAr: p.usageAr,
        usageEn: p.usageEn,
        approvedUsesAr: p.approvedUsesAr,
        approvedUsesEn: p.approvedUsesEn,
        warningsAr: p.warningsAr,
        warningsEn: p.warningsEn,
        approvalReference: p.approvalReference,
        regulatoryNote: p.regulatoryNote,
        fromPricePiasters: vs.length ? Math.min(...vs.map((v) => v.pricePiasters)) : null,
        stockStatus: bestStock(vs.map((v) => v.stockStatus)),
        contentStatus: p.contentStatus,
        isDemo: p.isDemo,
        categoryId: p.categoryId,
        imageId: images[0]?.id ?? null,
        images,
        variants: vs.map((v) => ({ id: v.id, sku: v.sku, labelAr: v.labelAr, labelEn: v.labelEn, pricePiasters: v.pricePiasters, stockStatus: v.stockStatus })),
        // Live, clinically approved statements only (official indications, contraindications, FAQs…).
        knowledge: (await liveKnowledge(tx, [p.id])).get(p.id) ?? [],
      };
    });
  });

  /**
   * Product images. Images of products on sale are public marketing material (no session needed,
   * so native <Image> can load them); unpublished ones are visible to catalogue staff only (RLS).
   * Served with their verified type, never sniffed, and with a locked-down CSP.
   */
  app.get('/store/images/:id', async (request, reply) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const principal = await getPrincipal(request);
    const img = await inContext(request, principal, async (tx) => {
      const [row] = await tx.select({ bytes: productImages.bytes, type: productImages.contentType, sha: productImages.sha256, productId: productImages.productId }).from(productImages).where(eq(productImages.id, id));
      if (!row) return null;
      const visible = await tx.execute<{ ok: boolean }>(sql`select app.product_visible(${row.productId}::uuid) as ok`);
      return { ...row, public: Boolean(visible.rows[0]?.ok) };
    });
    if (!img) throw notFound('Image');
    const etag = `"${img.sha}"`;
    reply
      .header('content-type', img.type)
      .header('etag', etag)
      .header('cache-control', img.public ? 'public, max-age=86400' : 'private, no-store')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('cross-origin-resource-policy', 'cross-origin')
      .header('content-disposition', 'inline');
    if (request.headers['if-none-match'] === etag) return reply.status(304).send();
    return reply.send(img.bytes);
  });

  app.get('/store/bundles', async (request): Promise<StoreBundle[]> => {
    const principal = await requirePrincipal(request);
    return inContext(request, principal, async (tx) => {
      // RLS: published bundles whose every item is itself on sale.
      const bundles = await tx.select().from(productBundles).where(eq(productBundles.publicationStatus, 'PUBLISHED')).orderBy(asc(productBundles.createdAt));
      if (!bundles.length) return [];
      const items = await tx
        .select({ i: productBundleItems, v: productVariants, p: products })
        .from(productBundleItems)
        .innerJoin(productVariants, eq(productVariants.id, productBundleItems.variantId))
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(inArray(productBundleItems.bundleId, bundles.map((b) => b.id)));
      return bundles.map((b) => {
        const own = items.filter(({ i }) => i.bundleId === b.id);
        return {
          id: b.id,
          slug: b.slug,
          nameAr: b.nameAr,
          nameEn: b.nameEn,
          descriptionAr: b.descriptionAr,
          descriptionEn: b.descriptionEn,
          pricePiasters: b.pricePiasters,
          itemsValuePiasters: own.reduce((sum, { i, v }) => sum + v.pricePiasters * i.quantity, 0),
          items: own.map(({ i, v, p }) => ({ productNameAr: p.nameAr, productNameEn: p.nameEn, variantLabelAr: v.labelAr, variantLabelEn: v.labelEn, quantity: i.quantity })),
        };
      });
    });
  });

  app.get('/store/cart', async (request) => {
    const principal = await requirePrincipal(request);
    return inContext(request, principal, (tx) => loadCart(tx, principal.userId));
  });

  app.post('/store/cart/items', async (request, reply) => {
    const principal = await requirePrincipal(request);
    const body = parse(addCartItemBody, request.body);
    const cart = await inContext(request, principal, async (tx) => {
      const forPatient = body.forPatientId ?? null;
      const [existing] = await tx
        .select()
        .from(cartItems)
        .where(
          and(
            eq(cartItems.userId, principal.userId),
            body.variantId ? eq(cartItems.variantId, body.variantId) : eq(cartItems.bundleId, body.bundleId!),
            forPatient ? eq(cartItems.forPatientId, forPatient) : isNull(cartItems.forPatientId),
          ),
        );
      if (existing) {
        await tx
          .update(cartItems)
          .set({ quantity: Math.min(20, existing.quantity + body.quantity) })
          .where(eq(cartItems.id, existing.id));
      } else {
        // RLS verifies: own cart, a visible variant or bundle, and an authorized patient profile.
        await tx.insert(cartItems).values({ userId: principal.userId, variantId: body.variantId ?? null, bundleId: body.bundleId ?? null, quantity: body.quantity, forPatientId: forPatient });
      }
      let productId: string | null = null;
      if (body.variantId) {
        const [v] = await tx.select({ productId: productVariants.productId }).from(productVariants).where(eq(productVariants.id, body.variantId));
        productId = v?.productId ?? null;
      }
      await recordEvent(tx, 'ADD_TO_CART', { productId, variantId: body.variantId, bundleId: body.bundleId, quantity: body.quantity });
      return loadCart(tx, principal.userId);
    });
    return reply.status(201).send(cart);
  });

  app.patch('/store/cart/items/:id', async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const body = parse(updateCartItemBody, request.body);
    return inContext(request, principal, async (tx) => {
      const updated = await tx.update(cartItems).set({ quantity: body.quantity }).where(eq(cartItems.id, id)).returning({ id: cartItems.id });
      if (!updated.length) throw notFound('Cart item');
      return loadCart(tx, principal.userId);
    });
  });

  app.delete('/store/cart/items/:id', async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    return inContext(request, principal, async (tx) => {
      await tx.delete(cartItems).where(eq(cartItems.id, id));
      return loadCart(tx, principal.userId);
    });
  });

  /**
   * Checkout preview: totals and discounts are computed server-side from current catalogue prices.
   * No order is created and no payment is attempted while the payment gateway is not configured.
   */
  app.post('/store/checkout/preview', async (request): Promise<CheckoutPreview> => {
    const principal = await requirePrincipal(request);
    const { discountCode } = parse(checkoutPreviewBody, request.body ?? {});
    const code = discountCode?.trim().toUpperCase() || null;
    const { cart, discount } = await inContext(request, principal, async (tx) => {
      const meta = await loadCartMeta(tx, principal.userId);
      const cart = summarise(meta);
      const candidates = (await tx.execute<DiscountRow>(sql`select id, name_ar, name_en, code, kind::text, value, scope::text, target_id, min_subtotal_piasters from app.applicable_discounts(${code})`)).rows;
      let best: { d: DiscountRow; amount: number } | null = null;
      for (const d of candidates) {
        const amount = discountAmount(d, meta, cart.subtotalPiasters);
        if (amount > 0 && (!best || amount > best.amount)) best = { d, amount };
      }
      if (cart.lines.length) await recordEvent(tx, 'CHECKOUT_PREVIEW', { amount: cart.subtotalPiasters - (best?.amount ?? 0) });
      return { cart, discount: best };
    });
    const configured = payments.status === 'CONFIGURED';
    const notices = ['PAYMENT_NOT_CONFIGURED_SIMULATION_ONLY'];
    if (cart.lines.some((l) => l.isDemo)) notices.push('CONTAINS_SYNTHETIC_DEMO_ITEMS');
    const discountTotal = discount?.amount ?? 0;
    return {
      lines: cart.lines,
      subtotalPiasters: cart.subtotalPiasters,
      discount: discount ? { nameAr: discount.d.name_ar, nameEn: discount.d.name_en, amountPiasters: discount.amount, code: discount.d.code } : null,
      discountCodeRejected: Boolean(code) && discount?.d.code !== code,
      deliveryFeePiasters: null,
      totalPiasters: cart.subtotalPiasters - discountTotal,
      currency: 'EGP',
      payment: { provider: payments.name, status: payments.status, simulated: !configured, canPlaceRealOrder: false },
      notices: configured ? notices.filter((n) => n !== 'PAYMENT_NOT_CONFIGURED_SIMULATION_ONLY') : notices,
    };
  });
}
