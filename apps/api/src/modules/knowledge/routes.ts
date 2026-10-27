/**
 * Curated medical knowledge (migration 0016). Editors write articles; a clinical reviewer who did
 * not write the revision approves it into an immutable, cited version. Patients read only live,
 * approved versions (cited by the assistant).
 */
import { knowledgeArticleBody, type KnowledgeArticleAdmin, type KnowledgeVersion } from '@ghayarly/shared';
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Tx } from '../../db/client';
import { knowledgeArticles, knowledgeVersions } from '../../db/schema';
import { notFound } from '../../lib/errors';
import { inContext, requireAnyPermission, requirePermission, requirePrincipal } from '../../lib/principal';
import { parse } from '../../lib/validate';

const idParam = z.object({ id: z.string().uuid() });
const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);

async function articleDtos(tx: Tx, rows: (typeof knowledgeArticles.$inferSelect)[], me: string): Promise<KnowledgeArticleAdmin[]> {
  const versions = rows.length ? await tx.select().from(knowledgeVersions).where(inArray(knowledgeVersions.articleId, rows.map((r) => r.id))).orderBy(desc(knowledgeVersions.version)) : [];
  return rows.map((a) => {
    const mine = versions.filter((v) => v.articleId === a.id);
    const live = mine.find((v) => !v.supersededAt);
    return {
      id: a.id,
      slug: a.slug,
      locale: a.locale as 'ar' | 'en',
      title: a.title,
      summary: a.summary,
      body: a.body,
      topics: a.topics,
      sourcePublisher: a.sourcePublisher,
      sourceTitle: a.sourceTitle,
      sourceUrl: a.sourceUrl,
      sourceDate: a.sourceDate,
      status: a.status as KnowledgeArticleAdmin['status'],
      editedByMe: a.editedByUserId === me,
      updatedAt: iso(a.updatedAt)!,
      live: live ? { versionId: live.id, version: live.version, approvedAt: iso(live.approvedAt)!, approvedByMe: live.approvedByUserId === me } : null,
      versions: mine.map((v) => ({ version: v.version, approvedAt: iso(v.approvedAt)!, supersededAt: iso(v.supersededAt), note: v.approvalNote })),
    };
  });
}

export async function knowledgeRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------- patients: approved versions only
  app.get('/knowledge/versions/:id', async (request): Promise<KnowledgeVersion> => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    return inContext(request, principal, async (tx) => {
      // RLS: signed-in people see live versions; editors and reviewers see all.
      const [v] = await tx
        .select({ v: knowledgeVersions, slug: knowledgeArticles.slug })
        .from(knowledgeVersions)
        .leftJoin(knowledgeArticles, eq(knowledgeArticles.id, knowledgeVersions.articleId))
        .where(eq(knowledgeVersions.id, id));
      if (!v) throw notFound('Article');
      const x = v.v;
      return { id: x.id, slug: v.slug ?? '', locale: x.locale as 'ar' | 'en', version: x.version, title: x.title, summary: x.summary, body: x.body, sourcePublisher: x.sourcePublisher, sourceTitle: x.sourceTitle, sourceUrl: x.sourceUrl, sourceDate: x.sourceDate, approvedAt: iso(x.approvedAt)! };
    });
  });

  // ---------------------------------------------------------------- editors and clinical reviewers
  app.get('/admin/knowledge/articles', async (request): Promise<KnowledgeArticleAdmin[]> => {
    const principal = await requireAnyPermission(request, 'knowledge.manage', 'ai.clinical.review');
    const { status } = parse(z.object({ status: z.enum(['ALL', 'DRAFT', 'IN_REVIEW', 'APPROVED', 'RETIRED']).default('ALL') }), request.query);
    return inContext(request, principal, async (tx) => {
      const rows = await tx.select().from(knowledgeArticles).where(status === 'ALL' ? undefined : eq(knowledgeArticles.status, status)).orderBy(asc(knowledgeArticles.slug), asc(knowledgeArticles.locale));
      return articleDtos(tx, rows, principal.userId);
    });
  });

  app.post('/admin/knowledge/articles', async (request, reply) => {
    const principal = await requirePermission(request, 'knowledge.manage');
    const b = parse(knowledgeArticleBody, request.body);
    const [dto] = await inContext(request, principal, async (tx) => {
      const [a] = await tx.insert(knowledgeArticles).values({ ...b, sourceUrl: b.sourceUrl ?? null, sourceDate: b.sourceDate ?? null }).returning();
      return articleDtos(tx, [a!], principal.userId);
    });
    return reply.status(201).send(dto);
  });

  app.patch('/admin/knowledge/articles/:id', async (request) => {
    const principal = await requirePermission(request, 'knowledge.manage');
    const { id } = parse(idParam, request.params);
    const b = parse(knowledgeArticleBody.partial(), request.body);
    return inContext(request, principal, async (tx) => {
      // Any content change makes the working copy a draft; the approved version stays live.
      const [a] = await tx.update(knowledgeArticles).set(b).where(eq(knowledgeArticles.id, id)).returning();
      if (!a) throw notFound('Article');
      return (await articleDtos(tx, [a], principal.userId))[0];
    });
  });

  const workflow = async (request: Parameters<typeof requirePrincipal>[0], fn: (tx: Tx, id: string, note: string | undefined) => Promise<unknown>) => {
    const principal = await requireAnyPermission(request, 'knowledge.manage', 'ai.clinical.review');
    const { id } = parse(idParam, request.params);
    const { note } = parse(z.object({ note: z.string().trim().max(1000).optional() }), request.body ?? {});
    return inContext(request, principal, async (tx) => {
      await fn(tx, id, note);
      const [a] = await tx.select().from(knowledgeArticles).where(eq(knowledgeArticles.id, id));
      if (!a) throw notFound('Article');
      return (await articleDtos(tx, [a], principal.userId))[0];
    });
  };
  app.post('/admin/knowledge/articles/:id/submit', (request) => workflow(request, (tx, id) => tx.execute(sql`select app.knowledge_submit(${id}::uuid)`)));
  app.post('/admin/knowledge/articles/:id/approve', (request) => workflow(request, (tx, id, note) => tx.execute(sql`select app.knowledge_approve(${id}::uuid, ${note ?? null})`)));
  app.post('/admin/knowledge/articles/:id/retire', (request) => workflow(request, (tx, id, note) => tx.execute(sql`select app.knowledge_retire(${id}::uuid, ${note ?? null})`)));
}

export type KnowledgePassage = {
  versionId: string;
  title: string;
  content: string;
  locale: 'ar' | 'en';
  version: number;
  sourcePublisher: string;
  sourceTitle: string;
  sourceUrl: string | null;
  sourceDate: string | null;
};

/** Approved passages relevant to a question (one per article, best first). */
export async function retrieveKnowledge(tx: Tx, question: string, locale: 'ar' | 'en', limit = 3): Promise<KnowledgePassage[]> {
  const r = await tx.execute<{ version_id: string; title: string; content: string; locale: 'ar' | 'en'; version: number; source_publisher: string; source_title: string; source_url: string | null; source_date: string | null }>(
    sql`select * from app.knowledge_search(${question}, ${locale}, ${limit + 2})`,
  );
  const seen = new Set<string>();
  const out: KnowledgePassage[] = [];
  for (const p of r.rows) {
    if (seen.has(p.version_id)) continue;
    seen.add(p.version_id);
    out.push({ versionId: p.version_id, title: p.title, content: p.content.slice(0, 1500), locale: p.locale, version: p.version, sourcePublisher: p.source_publisher, sourceTitle: p.source_title, sourceUrl: p.source_url, sourceDate: p.source_date ? String(p.source_date).slice(0, 10) : null });
    if (out.length >= limit) break;
  }
  return out;
}
