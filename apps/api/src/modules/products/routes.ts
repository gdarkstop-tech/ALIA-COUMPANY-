/**
 * Company-product knowledge and the product keyword engine (migration 0025, ADR 0014).
 *
 * Catalogue staff (catalog.tetrasol.manage) write bilingual statements with an evidence reference
 * and propose keywords; a clinical reviewer (ai.clinical.review) who did not write them approves.
 * Only live, approved statements of products on sale ever reach the assistant or the store, and a
 * keyword can surface a product in a conversation only after its own approval (and, for a
 * condition, while its indication is approved). Nothing here bypasses RLS.
 */
import {
  productKeywordBody,
  productKnowledgeBody,
  productKnowledgePatchBody,
  type AiProductCard,
  type OfferedProduct,
  type ProductDiscoveryMatch,
  type ProductKeywordAdmin,
  type ProductKnowledgeAdmin,
  type ProductKnowledgeItem,
  type ProductKnowledgeKind,
  type ProductKnowledgeOverview,
  type ProductNameTerm,
} from '@ghayarly/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Tx } from '../../db/client';
import { aiMessageProducts, productImages, productKeywords, productKnowledge, productKnowledgeVersions, products } from '../../db/schema';
import { notFound } from '../../lib/errors';
import { inContext, requireAnyPermission, requirePermission } from '../../lib/principal';
import { parse } from '../../lib/validate';

const idParam = z.object({ id: z.string().uuid() });
const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);

const itemDto = (v: typeof productKnowledgeVersions.$inferSelect): ProductKnowledgeItem => ({
  versionId: v.id,
  kind: v.kind as ProductKnowledgeKind,
  topic: v.topic,
  titleAr: v.titleAr,
  titleEn: v.titleEn,
  bodyAr: v.bodyAr,
  bodyEn: v.bodyEn,
  version: v.version,
  approvedAt: iso(v.approvedAt)!,
});

/** Live approved statements of products the caller can see (RLS), in display order. */
export async function liveKnowledge(tx: Tx, productIds: string[]): Promise<Map<string, ProductKnowledgeItem[]>> {
  const out = new Map<string, ProductKnowledgeItem[]>();
  if (!productIds.length) return out;
  const ORDER: Record<string, number> = { INDICATION: 0, CONTRAINDICATION: 1, CLAIM: 2, FAQ: 3, EDUCATION: 4 };
  const rows = await tx
    .select()
    .from(productKnowledgeVersions)
    .where(and(inArray(productKnowledgeVersions.productId, productIds), isNull(productKnowledgeVersions.supersededAt)))
    .orderBy(asc(productKnowledgeVersions.approvedAt));
  for (const v of rows.sort((a, b) => ORDER[a.kind]! - ORDER[b.kind]!)) out.set(v.productId, [...(out.get(v.productId) ?? []), itemDto(v)]);
  return out;
}

export type ProductOffer = OfferedProduct & { slug: string; name: string; usage: string; warnings: string; statements: { kind: string; title: string; body: string }[]; indicationVersionId: string | null };

/**
 * What the assistant may use for this message (at most two products). The database decides:
 * flag (or internal test account), approved keyword, live indication, product on sale.
 */
export async function discoverProducts(tx: Tx, message: string, locale: 'ar' | 'en'): Promise<ProductOffer[]> {
  const matches = (await tx.execute<{ product_id: string; indication_version_id: string | null }>(sql`select product_id, indication_version_id from app.product_discovery(${message}, 2)`)).rows;
  if (!matches.length) return [];
  const ps = await tx.select().from(products).where(inArray(products.id, matches.map((m) => m.product_id)));
  const knowledge = await liveKnowledge(tx, ps.map((p) => p.id));
  const offers: ProductOffer[] = [];
  for (const m of matches) {
    const p = ps.find((x) => x.id === m.product_id);
    if (!p) continue;
    const ar = locale === 'ar';
    const items = (knowledge.get(p.id) ?? []).filter((k) => k.kind !== 'EDUCATION');
    // The matched indication first; FAQs are capped to keep the request small.
    const statements = [...items.filter((k) => k.versionId === m.indication_version_id), ...items.filter((k) => k.versionId !== m.indication_version_id && k.kind !== 'FAQ'), ...items.filter((k) => k.kind === 'FAQ').slice(0, 3)].map((k) => ({
      kind: k.kind,
      title: ar ? k.titleAr : k.titleEn,
      body: ar ? k.bodyAr : k.bodyEn,
    }));
    const usage = ar ? p.usageAr : p.usageEn;
    const warnings = ar ? p.warningsAr : p.warningsEn;
    const approvedText = [p.nameAr, p.nameEn, p.summaryAr, p.summaryEn, p.usageAr, p.usageEn, p.approvedUsesAr, p.approvedUsesEn, p.warningsAr, p.warningsEn, ...items.flatMap((k) => [k.titleAr, k.titleEn, k.bodyAr, k.bodyEn])].join('\n');
    offers.push({ label: offers.length ? 'P2' : 'P1', productId: p.id, brand: p.brand, approvedText, slug: p.slug, name: ar ? p.nameAr : p.nameEn, usage, warnings, statements, indicationVersionId: m.indication_version_id });
  }
  return offers;
}

/** Every company product name, approved name keyword and brand, normalised (for the answer guard). */
export async function productNameTerms(tx: Tx): Promise<ProductNameTerm[]> {
  const r = await tx.execute<{ product_id: string | null; brand: string; term: string }>(sql`select product_id, brand, term from app.product_name_terms()`);
  return r.rows.filter((t) => t.term.length >= 2).map((t) => ({ productId: t.product_id, brand: t.brand, term: t.term }));
}

/** Product cards attached to assistant messages; products no longer on sale are left out (RLS). */
export async function productCards(tx: Tx, messageIds: string[]): Promise<Map<string, AiProductCard[]>> {
  const out = new Map<string, AiProductCard[]>();
  if (!messageIds.length) return out;
  const rows = await tx
    .select({ mp: aiMessageProducts, p: products })
    .from(aiMessageProducts)
    .innerJoin(products, eq(products.id, aiMessageProducts.productId))
    .where(inArray(aiMessageProducts.messageId, messageIds))
    .orderBy(asc(aiMessageProducts.label));
  if (!rows.length) return out;
  const versionIds = rows.map((r) => r.mp.indicationVersionId).filter((v): v is string => !!v);
  const versions = versionIds.length ? await tx.select().from(productKnowledgeVersions).where(inArray(productKnowledgeVersions.id, versionIds)) : [];
  const images = await tx.select({ id: productImages.id, productId: productImages.productId }).from(productImages).where(inArray(productImages.productId, rows.map((r) => r.p.id))).orderBy(asc(productImages.sortOrder), asc(productImages.createdAt));
  for (const { mp, p } of rows) {
    const v = versions.find((x) => x.id === mp.indicationVersionId);
    out.set(mp.messageId, [
      ...(out.get(mp.messageId) ?? []),
      { label: mp.label as AiProductCard['label'], productId: p.id, slug: p.slug, nameAr: p.nameAr, nameEn: p.nameEn, summaryAr: p.summaryAr, summaryEn: p.summaryEn, warningsAr: p.warningsAr, warningsEn: p.warningsEn, imageId: images.find((i) => i.productId === p.id)?.id ?? null, indication: v ? itemDto(v) : null },
    ]);
  }
  return out;
}

// ---------------------------------------------------------------- admin DTOs
async function entryDtos(tx: Tx, rows: (typeof productKnowledge.$inferSelect)[], me: string): Promise<ProductKnowledgeAdmin[]> {
  const versions = rows.length ? await tx.select().from(productKnowledgeVersions).where(inArray(productKnowledgeVersions.entryId, rows.map((r) => r.id))).orderBy(desc(productKnowledgeVersions.version)) : [];
  return rows.map((e) => {
    const mine = versions.filter((v) => v.entryId === e.id);
    const live = mine.find((v) => !v.supersededAt);
    return {
      id: e.id,
      productId: e.productId,
      kind: e.kind as ProductKnowledgeKind,
      topic: e.topic,
      titleAr: e.titleAr,
      titleEn: e.titleEn,
      bodyAr: e.bodyAr,
      bodyEn: e.bodyEn,
      evidenceReference: e.evidenceReference,
      status: e.status as ProductKnowledgeAdmin['status'],
      editedByMe: e.editedByUserId === me,
      updatedAt: iso(e.updatedAt)!,
      live: live ? { versionId: live.id, version: live.version, approvedAt: iso(live.approvedAt)!, approvedByMe: live.approvedByUserId === me } : null,
      versions: mine.map((v) => ({ version: v.version, approvedAt: iso(v.approvedAt)!, supersededAt: iso(v.supersededAt), note: v.approvalNote })),
    };
  });
}

function keywordDtos(rows: (typeof productKeywords.$inferSelect)[], entries: ProductKnowledgeAdmin[], me: string): ProductKeywordAdmin[] {
  return rows.map((k) => {
    const ind = k.indicationId ? entries.find((e) => e.id === k.indicationId) : undefined;
    return {
      id: k.id,
      productId: k.productId,
      indicationId: k.indicationId,
      indicationTitle: ind ? ind.titleEn : null,
      term: k.term,
      locale: k.locale as 'ar' | 'en',
      variant: k.variant as ProductKeywordAdmin['variant'],
      status: k.status as ProductKeywordAdmin['status'],
      createdByMe: k.createdByUserId === me,
      approvedAt: iso(k.approvedAt),
      active: k.status === 'APPROVED' && (!k.indicationId || (!!ind?.live && ind.status !== 'RETIRED')),
    };
  });
}

async function overview(tx: Tx, productId: string, me: string): Promise<ProductKnowledgeOverview> {
  const [p] = await tx.select().from(products).where(eq(products.id, productId));
  if (!p) throw notFound('Product');
  const entries = await entryDtos(tx, await tx.select().from(productKnowledge).where(eq(productKnowledge.productId, productId)).orderBy(asc(productKnowledge.kind), asc(productKnowledge.createdAt)), me);
  const keywords = await tx.select().from(productKeywords).where(eq(productKeywords.productId, productId)).orderBy(asc(productKeywords.status), asc(productKeywords.term));
  return {
    product: { id: p.id, slug: p.slug, nameAr: p.nameAr, nameEn: p.nameEn, contentStatus: p.contentStatus, publicationStatus: p.publicationStatus, isDemo: p.isDemo },
    entries,
    keywords: keywordDtos(keywords, entries, me),
  };
}

export async function productKnowledgeRoutes(app: FastifyInstance) {
  const staff = (request: FastifyRequest) => requireAnyPermission(request, 'catalog.tetrasol.manage', 'ai.clinical.review');

  app.get('/admin/product-knowledge', async (request) => {
    const principal = await staff(request);
    return inContext(request, principal, async (tx) => {
      const ps = await tx.select().from(products).orderBy(asc(products.sortOrder), asc(products.slug));
      const counts = await tx
        .select({ productId: productKnowledge.productId, status: productKnowledge.status, n: sql<number>`count(*)::int` })
        .from(productKnowledge)
        .groupBy(productKnowledge.productId, productKnowledge.status);
      return ps.map((p) => ({
        id: p.id,
        slug: p.slug,
        nameAr: p.nameAr,
        nameEn: p.nameEn,
        contentStatus: p.contentStatus,
        publicationStatus: p.publicationStatus,
        isDemo: p.isDemo,
        approved: counts.filter((c) => c.productId === p.id && c.status === 'APPROVED').reduce((n, c) => n + c.n, 0),
        inReview: counts.filter((c) => c.productId === p.id && c.status === 'IN_REVIEW').reduce((n, c) => n + c.n, 0),
      }));
    });
  });

  app.get('/admin/product-knowledge/products/:id', async (request): Promise<ProductKnowledgeOverview> => {
    const principal = await staff(request);
    const { id } = parse(idParam, request.params);
    return inContext(request, principal, (tx) => overview(tx, id, principal.userId));
  });

  app.post('/admin/product-knowledge/entries', async (request, reply) => {
    const principal = await requirePermission(request, 'catalog.tetrasol.manage');
    const b = parse(productKnowledgeBody, request.body);
    const dto = await inContext(request, principal, async (tx) => {
      const [e] = await tx.insert(productKnowledge).values({ ...b, topic: b.topic ?? null }).returning();
      return (await entryDtos(tx, [e!], principal.userId))[0]!;
    });
    return reply.status(201).send(dto);
  });

  app.patch('/admin/product-knowledge/entries/:id', async (request) => {
    const principal = await requirePermission(request, 'catalog.tetrasol.manage');
    const { id } = parse(idParam, request.params);
    const b = parse(productKnowledgePatchBody, request.body);
    return inContext(request, principal, async (tx) => {
      // Any content change makes the working copy a draft; the approved version stays live.
      const [e] = await tx.update(productKnowledge).set(b).where(eq(productKnowledge.id, id)).returning();
      if (!e) throw notFound('Entry');
      return (await entryDtos(tx, [e], principal.userId))[0];
    });
  });

  const entryWorkflow = (fn: (tx: Tx, id: string, note: string | null) => Promise<unknown>) => async (request: FastifyRequest) => {
    const principal = await staff(request);
    const { id } = parse(idParam, request.params);
    const { note } = parse(z.object({ note: z.string().trim().max(1000).optional() }), request.body ?? {});
    return inContext(request, principal, async (tx) => {
      await fn(tx, id, note ?? null);
      const [e] = await tx.select().from(productKnowledge).where(eq(productKnowledge.id, id));
      if (!e) throw notFound('Entry');
      return (await entryDtos(tx, [e], principal.userId))[0];
    });
  };
  app.post('/admin/product-knowledge/entries/:id/submit', entryWorkflow((tx, id) => tx.execute(sql`select app.product_knowledge_submit(${id}::uuid)`)));
  app.post('/admin/product-knowledge/entries/:id/approve', entryWorkflow((tx, id, note) => tx.execute(sql`select app.product_knowledge_approve(${id}::uuid, ${note})`)));
  app.post('/admin/product-knowledge/entries/:id/retire', entryWorkflow((tx, id, note) => tx.execute(sql`select app.product_knowledge_retire(${id}::uuid, ${note})`)));

  app.post('/admin/product-knowledge/keywords', async (request, reply) => {
    const principal = await requirePermission(request, 'catalog.tetrasol.manage');
    const b = parse(productKeywordBody, request.body);
    const dto = await inContext(request, principal, async (tx) => {
      const [k] = await tx.insert(productKeywords).values({ ...b, indicationId: b.indicationId ?? null, termNormalized: '' }).returning();
      const o = await overview(tx, b.productId, principal.userId);
      return o.keywords.find((x) => x.id === k!.id)!;
    });
    return reply.status(201).send(dto);
  });

  const keywordWorkflow = (fn: (tx: Tx, id: string) => Promise<unknown>) => async (request: FastifyRequest) => {
    const principal = await staff(request);
    const { id } = parse(idParam, request.params);
    return inContext(request, principal, async (tx) => {
      await fn(tx, id);
      const [k] = await tx.select().from(productKeywords).where(eq(productKeywords.id, id));
      if (!k) throw notFound('Keyword');
      return (await overview(tx, k.productId, principal.userId)).keywords.find((x) => x.id === id);
    });
  };
  app.post('/admin/product-knowledge/keywords/:id/approve', keywordWorkflow((tx, id) => tx.execute(sql`select app.product_keyword_approve(${id}::uuid)`)));
  app.post('/admin/product-knowledge/keywords/:id/retire', keywordWorkflow((tx, id) => tx.execute(sql`select app.product_keyword_retire(${id}::uuid)`)));

  /** The keyword engine as it would run for a message (ignores the flag; staff only). */
  app.get('/admin/product-knowledge/preview', async (request): Promise<ProductDiscoveryMatch[]> => {
    const principal = await staff(request);
    const { q } = parse(z.object({ q: z.string().trim().min(2).max(2000) }), request.query);
    return inContext(request, principal, async (tx) => {
      const rows = (await tx.execute<{ product_id: string; term: string; indication_version_id: string | null }>(sql`select product_id, term, indication_version_id from app.product_discovery_preview(${q})`)).rows;
      if (!rows.length) return [];
      const ps = await tx.select().from(products).where(inArray(products.id, rows.map((r) => r.product_id)));
      const ivs = rows.some((r) => r.indication_version_id) ? await tx.select().from(productKnowledgeVersions).where(inArray(productKnowledgeVersions.id, rows.map((r) => r.indication_version_id).filter((v): v is string => !!v))) : [];
      return rows.map((r) => {
        const p = ps.find((x) => x.id === r.product_id)!;
        const v = ivs.find((x) => x.id === r.indication_version_id);
        return { productId: p.id, slug: p.slug, nameAr: p.nameAr, nameEn: p.nameEn, term: r.term, match: r.indication_version_id ? 'INDICATION' : 'PRODUCT', indication: v ? { titleAr: v.titleAr, titleEn: v.titleEn, version: v.version } : null };
      });
    });
  });
}
