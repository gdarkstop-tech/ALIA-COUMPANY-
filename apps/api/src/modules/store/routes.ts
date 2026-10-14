import {
  addCartItemBody,
  updateCartItemBody,
  type CartLine,
  type CartResponse,
  type CheckoutPreview,
  type ProductCard,
  type ProductDetail,
  type StockStatus,
} from '@ghayarly/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Tx } from '../../db/client';
import { cartItems, patients, products, productVariants } from '../../db/schema';
import { notFound } from '../../lib/errors';
import { inContext, requirePrincipal } from '../../lib/principal';
import { parse } from '../../lib/validate';

const STOCK_RANK: Record<StockStatus, number> = { IN_STOCK: 0, LOW_STOCK: 1, UNKNOWN: 2, OUT_OF_STOCK: 3 };

function bestStock(statuses: StockStatus[]): StockStatus {
  return statuses.sort((a, b) => STOCK_RANK[a] - STOCK_RANK[b])[0] ?? 'UNKNOWN';
}

export async function listProducts(tx: Tx): Promise<ProductCard[]> {
  // RLS returns only brand-approved TetraSol products (plus clearly-flagged demo items in demo mode).
  const rows = await tx.select().from(products).orderBy(asc(products.sortOrder), asc(products.slug));
  const variants = await tx.select().from(productVariants).where(eq(productVariants.active, true));
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
    };
  });
}

async function loadCart(tx: Tx, userId: string): Promise<CartResponse> {
  const rows = await tx
    .select({ c: cartItems, v: productVariants, p: products, patientName: patients.displayName })
    .from(cartItems)
    .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(patients, eq(patients.id, cartItems.forPatientId))
    .where(eq(cartItems.userId, userId))
    .orderBy(asc(cartItems.createdAt));
  const lines: CartLine[] = rows.map(({ c, v, p, patientName }) => ({
    id: c.id,
    variantId: v.id,
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
  }));
  return {
    lines,
    subtotalPiasters: lines.reduce((sum, l) => sum + l.lineTotalPiasters, 0),
    itemCount: lines.reduce((sum, l) => sum + l.quantity, 0),
  };
}

export async function storeRoutes(app: FastifyInstance) {
  const { payments } = app.services;

  app.get('/store/products', async (request) => {
    const principal = await requirePrincipal(request);
    return inContext(request, principal, listProducts);
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
        approvalReference: p.approvalReference,
        regulatoryNote: p.regulatoryNote,
        fromPricePiasters: vs.length ? Math.min(...vs.map((v) => v.pricePiasters)) : null,
        stockStatus: bestStock(vs.map((v) => v.stockStatus)),
        contentStatus: p.contentStatus,
        isDemo: p.isDemo,
        variants: vs.map((v) => ({ id: v.id, sku: v.sku, labelAr: v.labelAr, labelEn: v.labelEn, pricePiasters: v.pricePiasters, stockStatus: v.stockStatus })),
      };
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
            eq(cartItems.variantId, body.variantId),
            forPatient ? eq(cartItems.forPatientId, forPatient) : isNull(cartItems.forPatientId),
          ),
        );
      if (existing) {
        await tx
          .update(cartItems)
          .set({ quantity: Math.min(20, existing.quantity + body.quantity) })
          .where(eq(cartItems.id, existing.id));
      } else {
        // RLS verifies: own cart, visible TetraSol variant, and authorized patient profile.
        await tx.insert(cartItems).values({ userId: principal.userId, variantId: body.variantId, quantity: body.quantity, forPatientId: forPatient });
      }
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
   * Checkout preview: totals are computed server-side from current catalog prices. No order is
   * created and no payment is attempted while the payment gateway is not configured.
   */
  app.post('/store/checkout/preview', async (request): Promise<CheckoutPreview> => {
    const principal = await requirePrincipal(request);
    const cart = await inContext(request, principal, (tx) => loadCart(tx, principal.userId));
    const configured = payments.status === 'CONFIGURED';
    const notices = ['PAYMENT_NOT_CONFIGURED_SIMULATION_ONLY'];
    if (cart.lines.some((l) => l.isDemo)) notices.push('CONTAINS_SYNTHETIC_DEMO_ITEMS');
    return {
      lines: cart.lines,
      subtotalPiasters: cart.subtotalPiasters,
      deliveryFeePiasters: null,
      totalPiasters: cart.subtotalPiasters,
      currency: 'EGP',
      payment: { provider: payments.name, status: payments.status, simulated: !configured, canPlaceRealOrder: false },
      notices: configured ? notices.filter((n) => n !== 'PAYMENT_NOT_CONFIGURED_SIMULATION_ONLY') : notices,
    };
  });
}
