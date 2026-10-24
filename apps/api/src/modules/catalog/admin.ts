/**
 * Admin Console — catalogue management (/v1/admin/catalog).
 *
 * Every rule that matters is enforced by PostgreSQL (migration 0008), not only here: RLS limits
 * writes to catalogue managers, app.products_guard() forces new products into DRAFT / pending
 * review, sends edited medical text back to review and off the store, and requires a different
 * person to approve; brands must be company-owned; stock moves only through a ledger.
 */
import {
  brandBody,
  brandPatchBody,
  bundleBody,
  bundleItemsBody,
  bundlePatchBody,
  bundlePublicationBody,
  categoryBody,
  categoryPatchBody,
  discountBody,
  discountPatchBody,
  imagePatchBody,
  imageUploadBody,
  PRODUCT_IMAGE_MAX_BYTES,
  productApprovalBody,
  productCreateBody,
  productPatchBody,
  productPublicationBody,
  PUBLICATION_STATUSES,
  stockAdjustBody,
  variantBody,
  variantPatchBody,
  type AdminProduct,
  type AdminProductListItem,
  type AdminVariant,
  type Brand,
  type Bundle,
  type CatalogAnalytics,
  type Category,
  type Discount,
} from '@ghayarly/shared';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Tx } from '../../db/client';
import {
  discounts,
  productBrands,
  productBundleItems,
  productBundles,
  productCategories,
  productImages,
  products,
  productVariants,
  stockMovements,
  userProfiles,
} from '../../db/schema';
import { audit } from '../../lib/audit';
import { inspectImage } from '../../lib/images';
import { notFound, unprocessable } from '../../lib/errors';
import { inContext, requireAnyPermission, requirePermission } from '../../lib/principal';
import { parse } from '../../lib/validate';

const idParam = z.object({ id: z.string().uuid() });
const EDIT = 'catalog.tetrasol.manage' as const;
const APPROVE = 'catalog.content.approve' as const;

const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);

async function displayNames(tx: Tx, ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!wanted.length) return new Map();
  const rows = await tx.select({ id: userProfiles.userId, name: userProfiles.displayName }).from(userProfiles).where(inArray(userProfiles.userId, wanted));
  return new Map(rows.map((r) => [r.id, r.name]));
}

function listItem(p: typeof products.$inferSelect, vs: (typeof productVariants.$inferSelect)[], imageId: string | null): AdminProductListItem {
  const active = vs.filter((v) => v.active);
  return {
    id: p.id,
    slug: p.slug,
    brand: p.brand,
    nameAr: p.nameAr,
    nameEn: p.nameEn,
    categoryId: p.categoryId,
    contentStatus: p.contentStatus,
    publicationStatus: p.publicationStatus,
    isDemo: p.isDemo,
    variantCount: vs.length,
    fromPricePiasters: active.length ? Math.min(...active.map((v) => v.pricePiasters)) : null,
    lowStock: active.some((v) => v.stockStatus === 'LOW_STOCK' || v.stockStatus === 'OUT_OF_STOCK'),
    imageId,
    updatedAt: iso(p.updatedAt)!,
  };
}

function variantDto(v: typeof productVariants.$inferSelect): AdminVariant {
  return {
    id: v.id,
    sku: v.sku,
    labelAr: v.labelAr,
    labelEn: v.labelEn,
    pricePiasters: v.pricePiasters,
    stockStatus: v.stockStatus,
    stockQuantity: v.stockQuantity,
    lowStockThreshold: v.lowStockThreshold,
    active: v.active,
    sortOrder: v.sortOrder,
  };
}

async function loadProduct(tx: Tx, id: string, me: string): Promise<AdminProduct> {
  const [p] = await tx.select().from(products).where(eq(products.id, id));
  if (!p) throw notFound('Product');
  const vs = await tx.select().from(productVariants).where(eq(productVariants.productId, id)).orderBy(asc(productVariants.sortOrder), asc(productVariants.sku));
  const imgs = await tx
    .select({ id: productImages.id, contentType: productImages.contentType, width: productImages.width, height: productImages.height, altAr: productImages.altAr, altEn: productImages.altEn, sortOrder: productImages.sortOrder, bytes: sql<number>`octet_length(${productImages.bytes})::int` })
    .from(productImages)
    .where(eq(productImages.productId, id))
    .orderBy(asc(productImages.sortOrder), asc(productImages.createdAt));
  const moves = vs.length
    ? await tx.select().from(stockMovements).where(inArray(stockMovements.variantId, vs.map((v) => v.id))).orderBy(desc(stockMovements.createdAt)).limit(50)
    : [];
  const names = await displayNames(tx, [p.approvedByUserId, p.updatedByUserId, ...moves.map((m) => m.actorUserId)]);
  return {
    ...listItem(p, vs, imgs[0]?.id ?? null),
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
    regulatoryNote: p.regulatoryNote,
    sortOrder: p.sortOrder,
    approvalReference: p.approvalReference,
    approvedAt: iso(p.approvedAt),
    approvedByName: p.approvedByUserId ? (names.get(p.approvedByUserId) ?? null) : null,
    lastEditedByName: p.updatedByUserId ? (names.get(p.updatedByUserId) ?? null) : null,
    editedByMe: p.updatedByUserId === me,
    publishedAt: iso(p.publishedAt),
    archivedAt: iso(p.archivedAt),
    deletable: p.publicationStatus === 'DRAFT' && !p.publishedAt && !p.isDemo,
    variants: vs.map(variantDto),
    images: imgs,
    stockMovements: moves.map((m) => ({ id: m.id, variantId: m.variantId, delta: m.delta, quantityAfter: m.quantityAfter, reason: m.reason, note: m.note, actorName: m.actorUserId ? (names.get(m.actorUserId) ?? null) : null, createdAt: iso(m.createdAt)! })),
  };
}

async function loadBundle(tx: Tx, b: typeof productBundles.$inferSelect): Promise<Bundle> {
  const items = await tx
    .select({ i: productBundleItems, v: productVariants, p: products })
    .from(productBundleItems)
    .innerJoin(productVariants, eq(productVariants.id, productBundleItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(productBundleItems.bundleId, b.id));
  return {
    id: b.id,
    slug: b.slug,
    nameAr: b.nameAr,
    nameEn: b.nameEn,
    descriptionAr: b.descriptionAr,
    descriptionEn: b.descriptionEn,
    pricePiasters: b.pricePiasters,
    itemsValuePiasters: items.reduce((sum, { i, v }) => sum + v.pricePiasters * i.quantity, 0),
    publicationStatus: b.publicationStatus,
    items: items.map(({ i, v, p }) => ({ variantId: v.id, quantity: i.quantity, productNameAr: p.nameAr, productNameEn: p.nameEn, variantLabelAr: v.labelAr, variantLabelEn: v.labelEn, unitPricePiasters: v.pricePiasters })),
  };
}

function discountDto(d: typeof discounts.$inferSelect): Discount {
  return {
    id: d.id,
    nameAr: d.nameAr,
    nameEn: d.nameEn,
    code: d.code,
    kind: d.kind,
    value: d.value,
    scope: d.scope,
    targetId: d.targetId,
    minSubtotalPiasters: d.minSubtotalPiasters,
    startsAt: iso(d.startsAt)!,
    endsAt: iso(d.endsAt),
    active: d.active,
  };
}

export async function adminCatalogRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------ brands
  app.get('/brands', async (request): Promise<Brand[]> => {
    const principal = await requireAnyPermission(request, EDIT, 'catalog.brands.manage');
    return inContext(request, principal, async (tx) => {
      const rows = await tx.select().from(productBrands).orderBy(asc(productBrands.name));
      return rows.map((b) => ({ name: b.name, ownerEntity: b.ownerEntity, ownershipReference: b.ownershipReference, active: b.active, createdAt: iso(b.createdAt)! }));
    });
  });

  app.post('/brands', async (request, reply) => {
    const principal = await requirePermission(request, 'catalog.brands.manage');
    const body = parse(brandBody, request.body);
    await inContext(request, principal, async (tx) => {
      await tx.insert(productBrands).values({ ...body, createdByUserId: principal.userId });
      await audit(tx, { actorUserId: principal.userId, action: 'catalog.brand.created', entityType: 'brand', entityId: body.name, requestId: request.id, metadata: { ownerEntity: body.ownerEntity } });
    });
    return reply.status(201).send({ ok: true });
  });

  app.patch('/brands/:name', async (request) => {
    const principal = await requirePermission(request, 'catalog.brands.manage');
    const { name } = parse(z.object({ name: z.string().min(2).max(60) }), request.params);
    const body = parse(brandPatchBody, request.body);
    return inContext(request, principal, async (tx) => {
      const updated = await tx.update(productBrands).set(body).where(eq(productBrands.name, name)).returning({ name: productBrands.name });
      if (!updated.length) throw notFound('Brand');
      await audit(tx, { actorUserId: principal.userId, action: 'catalog.brand.updated', entityType: 'brand', entityId: name, requestId: request.id, metadata: body });
      return { ok: true };
    });
  });

  // ------------------------------------------------------------ categories
  app.get('/categories', async (request): Promise<Category[]> => {
    const principal = await requireAnyPermission(request, EDIT, APPROVE);
    return inContext(request, principal, (tx) => tx.select().from(productCategories).orderBy(asc(productCategories.sortOrder), asc(productCategories.slug)));
  });

  app.post('/categories', async (request, reply) => {
    const principal = await requirePermission(request, EDIT);
    const body = parse(categoryBody, request.body);
    const [row] = await inContext(request, principal, (tx) => tx.insert(productCategories).values(body).returning());
    return reply.status(201).send(row);
  });

  app.patch('/categories/:id', async (request) => {
    const principal = await requirePermission(request, EDIT);
    const { id } = parse(idParam, request.params);
    const body = parse(categoryPatchBody, request.body);
    const [row] = await inContext(request, principal, (tx) => tx.update(productCategories).set(body).where(eq(productCategories.id, id)).returning());
    if (!row) throw notFound('Category');
    return row;
  });

  // ------------------------------------------------------------ products
  app.get('/products', async (request): Promise<AdminProductListItem[]> => {
    const principal = await requireAnyPermission(request, EDIT, APPROVE);
    const q = parse(z.object({ status: z.enum([...PUBLICATION_STATUSES, 'PENDING_REVIEW', 'ALL']).default('ALL'), q: z.string().trim().max(80).optional() }), request.query);
    return inContext(request, principal, async (tx) => {
      const filters = [];
      if (q.status === 'PENDING_REVIEW') filters.push(eq(products.contentStatus, 'PENDING_APPROVAL'));
      else if (q.status !== 'ALL') filters.push(eq(products.publicationStatus, q.status));
      if (q.q) filters.push(or(ilike(products.nameEn, `%${q.q}%`), ilike(products.nameAr, `%${q.q}%`), ilike(products.slug, `%${q.q}%`))!);
      const rows = await tx.select().from(products).where(filters.length ? and(...filters) : undefined).orderBy(asc(products.sortOrder), asc(products.slug)).limit(500);
      const ids = rows.map((r) => r.id);
      const vs = ids.length ? await tx.select().from(productVariants).where(inArray(productVariants.productId, ids)) : [];
      const imgs = ids.length
        ? await tx.selectDistinctOn([productImages.productId], { productId: productImages.productId, id: productImages.id }).from(productImages).where(inArray(productImages.productId, ids)).orderBy(productImages.productId, asc(productImages.sortOrder), asc(productImages.createdAt))
        : [];
      const firstImage = new Map(imgs.map((i) => [i.productId, i.id]));
      return rows.map((p) => listItem(p, vs.filter((v) => v.productId === p.id), firstImage.get(p.id) ?? null));
    });
  });

  app.get('/products/:id', async (request): Promise<AdminProduct> => {
    const principal = await requireAnyPermission(request, EDIT, APPROVE);
    const { id } = parse(idParam, request.params);
    return inContext(request, principal, (tx) => loadProduct(tx, id, principal.userId));
  });

  app.post('/products', async (request, reply) => {
    const principal = await requirePermission(request, EDIT);
    const body = parse(productCreateBody, request.body);
    const product = await inContext(request, principal, async (tx) => {
      // The database forces DRAFT + PENDING_APPROVAL and records the creator, whatever is sent.
      const [row] = await tx.insert(products).values({ ...body, regulatoryNote: body.regulatoryNote ?? null }).returning({ id: products.id });
      await audit(tx, { actorUserId: principal.userId, action: 'catalog.product.created', entityType: 'product', entityId: row!.id, requestId: request.id, metadata: { slug: body.slug, brand: body.brand } });
      return loadProduct(tx, row!.id, principal.userId);
    });
    return reply.status(201).send(product);
  });

  app.patch('/products/:id', async (request) => {
    const principal = await requireAnyPermission(request, EDIT, APPROVE);
    const { id } = parse(idParam, request.params);
    const body = parse(productPatchBody, request.body);
    return inContext(request, principal, async (tx) => {
      const updated = await tx.update(products).set(body).where(eq(products.id, id)).returning({ id: products.id });
      if (!updated.length) throw notFound('Product');
      await audit(tx, { actorUserId: principal.userId, action: 'catalog.product.edited', entityType: 'product', entityId: id, requestId: request.id, metadata: { fields: Object.keys(body) } });
      return loadProduct(tx, id, principal.userId);
    });
  });

  /** Approval of exactly the current text — by someone other than its last editor (database rule). */
  app.post('/products/:id/approve', async (request) => {
    const principal = await requirePermission(request, APPROVE);
    const { id } = parse(idParam, request.params);
    const { approvalReference } = parse(productApprovalBody, request.body);
    return inContext(request, principal, async (tx) => {
      const updated = await tx.update(products).set({ contentStatus: 'APPROVED', approvalReference }).where(eq(products.id, id)).returning({ id: products.id });
      if (!updated.length) throw notFound('Product');
      return loadProduct(tx, id, principal.userId);
    });
  });

  /** Withdraws approval (e.g. new safety information): the product leaves the store at once. */
  app.post('/products/:id/withdraw-approval', async (request) => {
    const principal = await requirePermission(request, APPROVE);
    const { id } = parse(idParam, request.params);
    return inContext(request, principal, async (tx) => {
      const updated = await tx.update(products).set({ contentStatus: 'PENDING_APPROVAL', approvalReference: null }).where(eq(products.id, id)).returning({ id: products.id });
      if (!updated.length) throw notFound('Product');
      await audit(tx, { actorUserId: principal.userId, action: 'catalog.product.approval_withdrawn', entityType: 'product', entityId: id, requestId: request.id });
      return loadProduct(tx, id, principal.userId);
    });
  });

  app.post('/products/:id/publication', async (request) => {
    const principal = await requirePermission(request, EDIT);
    const { id } = parse(idParam, request.params);
    const { status } = parse(productPublicationBody, request.body);
    return inContext(request, principal, async (tx) => {
      const [p] = await tx.select({ contentStatus: products.contentStatus, isDemo: products.isDemo }).from(products).where(eq(products.id, id));
      if (!p) throw notFound('Product');
      if (status === 'PUBLISHED' && p.contentStatus !== 'APPROVED' && !p.isDemo) throw unprocessable('APPROVAL_REQUIRED', 'Only approved content can be published');
      await tx.update(products).set({ publicationStatus: status }).where(eq(products.id, id));
      return loadProduct(tx, id, principal.userId);
    });
  });

  /** Only drafts that were never published can be deleted (RLS); everything else is archived. */
  app.delete('/products/:id', async (request) => {
    const principal = await requirePermission(request, EDIT);
    const { id } = parse(idParam, request.params);
    return inContext(request, principal, async (tx) => {
      const deleted = await tx.delete(products).where(eq(products.id, id)).returning({ id: products.id, slug: products.slug });
      if (!deleted.length) throw unprocessable('ONLY_UNPUBLISHED_DRAFTS_CAN_BE_DELETED', 'Only a draft that was never published can be deleted — archive it instead');
      await audit(tx, { actorUserId: principal.userId, action: 'catalog.product.deleted', entityType: 'product', entityId: id, requestId: request.id, metadata: { slug: deleted[0]!.slug } });
      return { ok: true };
    });
  });

  // ------------------------------------------------------------ variants & stock
  app.post('/products/:id/variants', async (request, reply) => {
    const principal = await requirePermission(request, EDIT);
    const { id } = parse(idParam, request.params);
    const body = parse(variantBody, request.body);
    const product = await inContext(request, principal, async (tx) => {
      const [v] = await tx
        .insert(productVariants)
        .values({ productId: id, sku: body.sku, labelAr: body.labelAr, labelEn: body.labelEn, pricePiasters: body.pricePiasters, sortOrder: body.sortOrder, lowStockThreshold: body.lowStockThreshold, stockStatus: body.stockStatus ?? 'UNKNOWN' })
        .returning({ id: productVariants.id });
      await audit(tx, { actorUserId: principal.userId, action: 'catalog.variant.created', entityType: 'product_variant', entityId: v!.id, requestId: request.id, metadata: { sku: body.sku, pricePiasters: body.pricePiasters } });
      return loadProduct(tx, id, principal.userId);
    });
    return reply.status(201).send(product);
  });

  app.patch('/variants/:id', async (request) => {
    const principal = await requirePermission(request, EDIT);
    const { id } = parse(idParam, request.params);
    const body = parse(variantPatchBody, request.body);
    return inContext(request, principal, async (tx) => {
      const [v] = await tx.update(productVariants).set(body).where(eq(productVariants.id, id)).returning({ productId: productVariants.productId });
      if (!v) throw notFound('Variant');
      return loadProduct(tx, v.productId, principal.userId);
    });
  });

  app.post('/variants/:id/stock', async (request) => {
    const principal = await requirePermission(request, EDIT);
    const { id } = parse(idParam, request.params);
    const body = parse(stockAdjustBody, request.body);
    return inContext(request, principal, async (tx) => {
      await tx.execute(sql`select app.adjust_stock(${id}::uuid, ${body.delta}::int, ${body.reason}::app.stock_reason, ${body.note ?? null})`);
      const [v] = await tx.select({ productId: productVariants.productId }).from(productVariants).where(eq(productVariants.id, id));
      return loadProduct(tx, v!.productId, principal.userId);
    });
  });

  // ------------------------------------------------------------ images
  app.post('/products/:id/images', { bodyLimit: 3 * 1024 * 1024 }, async (request, reply) => {
    const principal = await requirePermission(request, EDIT);
    const { id } = parse(idParam, request.params);
    const body = parse(imageUploadBody, request.body);
    const bytes = Buffer.from(body.dataBase64, 'base64');
    if (bytes.length > PRODUCT_IMAGE_MAX_BYTES) throw unprocessable('IMAGE_TOO_LARGE', 'Images are limited to 2 MB');
    const info = inspectImage(bytes);
    // The declared type must match the bytes: no SVG, no polyglots, no renamed files.
    if (!info || info.type !== body.contentType) throw unprocessable('UNSUPPORTED_IMAGE', 'Upload a JPEG, PNG or WebP image');
    if (info.width && info.height && (info.width > 10_000 || info.height > 10_000)) throw unprocessable('IMAGE_TOO_LARGE', 'Image dimensions are too large');
    const product = await inContext(request, principal, async (tx) => {
      const [img] = await tx
        .insert(productImages)
        .values({ productId: id, contentType: info.type, bytes, sha256: info.sha256, width: info.width, height: info.height, altAr: body.altAr, altEn: body.altEn, sortOrder: body.sortOrder, createdByUserId: principal.userId })
        .returning({ id: productImages.id });
      await audit(tx, { actorUserId: principal.userId, action: 'catalog.image.added', entityType: 'product', entityId: id, requestId: request.id, metadata: { imageId: img!.id, sha256: info.sha256, bytes: bytes.length } });
      return loadProduct(tx, id, principal.userId);
    });
    return reply.status(201).send(product);
  });

  app.patch('/images/:id', async (request) => {
    const principal = await requirePermission(request, EDIT);
    const { id } = parse(idParam, request.params);
    const body = parse(imagePatchBody, request.body);
    return inContext(request, principal, async (tx) => {
      const [img] = await tx.update(productImages).set(body).where(eq(productImages.id, id)).returning({ productId: productImages.productId });
      if (!img) throw notFound('Image');
      return loadProduct(tx, img.productId, principal.userId);
    });
  });

  app.delete('/images/:id', async (request) => {
    const principal = await requirePermission(request, EDIT);
    const { id } = parse(idParam, request.params);
    return inContext(request, principal, async (tx) => {
      const [img] = await tx.delete(productImages).where(eq(productImages.id, id)).returning({ productId: productImages.productId });
      if (!img) throw notFound('Image');
      await audit(tx, { actorUserId: principal.userId, action: 'catalog.image.removed', entityType: 'product', entityId: img.productId, requestId: request.id, metadata: { imageId: id } });
      return loadProduct(tx, img.productId, principal.userId);
    });
  });

  // ------------------------------------------------------------ discounts
  app.get('/discounts', async (request): Promise<Discount[]> => {
    const principal = await requirePermission(request, EDIT);
    return inContext(request, principal, async (tx) => (await tx.select().from(discounts).orderBy(desc(discounts.startsAt))).map(discountDto));
  });

  app.post('/discounts', async (request, reply) => {
    const principal = await requirePermission(request, EDIT);
    const body = parse(discountBody, request.body);
    const row = await inContext(request, principal, async (tx) => {
      const [d] = await tx
        .insert(discounts)
        .values({
          nameAr: body.nameAr,
          nameEn: body.nameEn,
          code: body.code ?? null,
          kind: body.kind,
          value: body.value,
          scope: body.scope,
          targetId: body.targetId ?? null,
          minSubtotalPiasters: body.minSubtotalPiasters,
          ...(body.startsAt ? { startsAt: body.startsAt } : {}),
          endsAt: body.endsAt ?? null,
          active: body.active,
          createdByUserId: principal.userId,
        })
        .returning();
      await audit(tx, { actorUserId: principal.userId, action: 'catalog.discount.created', entityType: 'discount', entityId: d!.id, requestId: request.id, metadata: { kind: body.kind, value: body.value, scope: body.scope, active: body.active } });
      return discountDto(d!);
    });
    return reply.status(201).send(row);
  });

  app.patch('/discounts/:id', async (request) => {
    const principal = await requirePermission(request, EDIT);
    const { id } = parse(idParam, request.params);
    const body = parse(discountPatchBody, request.body);
    return inContext(request, principal, async (tx) => {
      const [d] = await tx.update(discounts).set(body).where(eq(discounts.id, id)).returning();
      if (!d) throw notFound('Discount');
      await audit(tx, { actorUserId: principal.userId, action: 'catalog.discount.updated', entityType: 'discount', entityId: id, requestId: request.id, metadata: body });
      return discountDto(d);
    });
  });

  // ------------------------------------------------------------ bundles
  app.get('/bundles', async (request): Promise<Bundle[]> => {
    const principal = await requirePermission(request, EDIT);
    return inContext(request, principal, async (tx) => {
      const rows = await tx.select().from(productBundles).orderBy(desc(productBundles.createdAt));
      return Promise.all(rows.map((b) => loadBundle(tx, b)));
    });
  });

  app.post('/bundles', async (request, reply) => {
    const principal = await requirePermission(request, EDIT);
    const body = parse(bundleBody, request.body);
    const bundle = await inContext(request, principal, async (tx) => {
      const [b] = await tx.insert(productBundles).values(body).returning();
      return loadBundle(tx, b!);
    });
    return reply.status(201).send(bundle);
  });

  app.patch('/bundles/:id', async (request) => {
    const principal = await requirePermission(request, EDIT);
    const { id } = parse(idParam, request.params);
    const body = parse(bundlePatchBody, request.body);
    return inContext(request, principal, async (tx) => {
      const [b] = await tx.update(productBundles).set(body).where(eq(productBundles.id, id)).returning();
      if (!b) throw notFound('Bundle');
      return loadBundle(tx, b);
    });
  });

  /** Replaces the items of an unpublished bundle (published bundles are locked by RLS). */
  app.put('/bundles/:id/items', async (request) => {
    const principal = await requirePermission(request, EDIT);
    const { id } = parse(idParam, request.params);
    const { items } = parse(bundleItemsBody, request.body);
    return inContext(request, principal, async (tx) => {
      const [b] = await tx.select().from(productBundles).where(eq(productBundles.id, id));
      if (!b) throw notFound('Bundle');
      if (b.publicationStatus === 'PUBLISHED') throw unprocessable('UNPUBLISH_BUNDLE_FIRST', 'Unpublish the bundle before changing its items');
      await tx.delete(productBundleItems).where(eq(productBundleItems.bundleId, id));
      await tx.insert(productBundleItems).values(items.map((i) => ({ bundleId: id, variantId: i.variantId, quantity: i.quantity })));
      return loadBundle(tx, b);
    });
  });

  app.post('/bundles/:id/publication', async (request) => {
    const principal = await requirePermission(request, EDIT);
    const { id } = parse(idParam, request.params);
    const { status } = parse(bundlePublicationBody, request.body);
    return inContext(request, principal, async (tx) => {
      const [b] = await tx.update(productBundles).set({ publicationStatus: status }).where(eq(productBundles.id, id)).returning();
      if (!b) throw notFound('Bundle');
      return loadBundle(tx, b);
    });
  });

  // ------------------------------------------------------------ analytics
  app.get('/analytics', async (request): Promise<CatalogAnalytics> => {
    const principal = await requirePermission(request, EDIT);
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), request.query);
    return inContext(request, principal, async (tx) => {
      const totals = await tx.execute<{ event_type: string; n: number; units: number; amount: number }>(sql`
        select event_type::text, count(*)::int as n, coalesce(sum(quantity), 0)::int as units, coalesce(sum(amount_piasters), 0)::bigint as amount
        from app.commerce_events where occurred_at >= now() - make_interval(days => ${days}) group by event_type`);
      const by = (t: string) => totals.rows.find((r) => r.event_type === t);
      const perProduct = await tx.execute<{ product_id: string; name_ar: string; name_en: string; views: number; carts: number; paid: number }>(sql`
        select p.id as product_id, p.name_ar, p.name_en,
               count(*) filter (where e.event_type = 'PRODUCT_VIEW')::int as views,
               count(*) filter (where e.event_type = 'ADD_TO_CART')::int as carts,
               coalesce(sum(e.quantity) filter (where e.event_type = 'ORDER_PAID'), 0)::int as paid
        from app.commerce_events e join app.products p on p.id = e.product_id
        where e.occurred_at >= now() - make_interval(days => ${days})
        group by p.id, p.name_ar, p.name_en order by views desc limit 50`);
      const low = await tx
        .select({ v: productVariants, p: products })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(and(eq(productVariants.active, true), sql`${productVariants.stockQuantity} is not null and ${productVariants.stockQuantity} <= ${productVariants.lowStockThreshold}`))
        .orderBy(asc(productVariants.stockQuantity))
        .limit(50);
      return {
        days,
        paidOrders: by('ORDER_PAID')?.n ?? 0,
        revenuePiasters: Number(by('ORDER_PAID')?.amount ?? 0) - Number(by('ORDER_REFUNDED')?.amount ?? 0),
        checkoutEnabled: app.services.payments.status === 'CONFIGURED',
        funnel: { productViews: by('PRODUCT_VIEW')?.n ?? 0, addToCart: by('ADD_TO_CART')?.n ?? 0, checkoutPreviews: by('CHECKOUT_PREVIEW')?.n ?? 0 },
        products: perProduct.rows.map((r) => ({ productId: r.product_id, nameAr: r.name_ar, nameEn: r.name_en, views: r.views, addToCart: r.carts, paidUnits: r.paid })),
        lowStock: low.map(({ v, p }) => ({ variantId: v.id, sku: v.sku, productNameEn: p.nameEn, productNameAr: p.nameAr, quantity: v.stockQuantity!, threshold: v.lowStockThreshold })),
      };
    });
  });
}
