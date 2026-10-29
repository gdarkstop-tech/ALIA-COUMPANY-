/**
 * Wound Intelligence Registry — staff console (migration 0027, ADR 0015).
 *
 *   * wound.registry.read     — counts and status only (administrators included). No photo, ever.
 *   * wound.research.review   — clinical quality review of de-identified research items.
 *   * wound.research.access   — datasets (build, freeze, version, retire, export when allowed) and
 *                               descriptive product-outcome analytics.
 *   * wound.presentation.manage — candidates, nomination, preparation, second approval, export.
 * Exports of research data and of presentation cases stay disabled (flags OFF) until approvals.
 */
import { createHash } from 'node:crypto';
import {
  presentationApproveBody,
  presentationPrepareBody,
  presentationTextProblem,
  researchDatasetBody,
  researchFreezeBody,
  researchReviewBody,
  type WoundPresentationAudience,
  type WoundPresentationCandidate,
  type WoundPresentationOrganization,
  type WoundPresentationView,
  type WoundProductOutcomeRow,
  type WoundRegistryOverview,
  type WoundResearchDataset,
  type WoundResearchItem,
} from '@ghayarly/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Tx } from '../../db/client';
import { woundPresentationCases, woundPresentationExports, woundResearchDatasets, woundResearchExports, woundResearchImages, woundResearchItems } from '../../db/schema';
import { renderCasePdf, zipStore } from '../../lib/export-files';
import { notFound, unprocessable } from '../../lib/errors';
import { inContext, requireAnyPermission, requirePermission, type Principal } from '../../lib/principal';
import { sessionKey } from '../../lib/rateLimitKey';
import { parse } from '../../lib/validate';
import { reencodeDerived } from '../../lib/wound-images';
import { mintMediaLink, pgArray, presentationViews, purgeStoredObjects } from './routes';

const idParam = z.object({ id: z.string().uuid() });
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function datasetDtos(tx: Tx, rows: (typeof woundResearchDatasets.$inferSelect)[]): Promise<WoundResearchDataset[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  // Item rows are visible to research staff only; other readers see the dataset record without counts.
  const counts = await tx
    .select({
      datasetId: woundResearchItems.datasetId,
      items: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${woundResearchItems.qualityStatus} = 'PENDING' and ${woundResearchItems.status} = 'INCLUDED')::int`,
      accepted: sql<number>`count(*) filter (where ${woundResearchItems.qualityStatus} = 'ACCEPTED' and ${woundResearchItems.status} = 'INCLUDED')::int`,
      rejected: sql<number>`count(*) filter (where ${woundResearchItems.qualityStatus} = 'REJECTED')::int`,
      withdrawn: sql<number>`count(*) filter (where ${woundResearchItems.status} = 'WITHDRAWN')::int`,
    })
    .from(woundResearchItems)
    .where(inArray(woundResearchItems.datasetId, ids))
    .groupBy(woundResearchItems.datasetId);
  const images = await tx
    .select({ datasetId: woundResearchItems.datasetId, n: sql<number>`count(*)::int` })
    .from(woundResearchImages)
    .innerJoin(woundResearchItems, eq(woundResearchItems.id, woundResearchImages.itemId))
    .where(inArray(woundResearchItems.datasetId, ids))
    .groupBy(woundResearchItems.datasetId);
  const exports = await tx.select({ datasetId: woundResearchExports.datasetId, n: sql<number>`count(*)::int` }).from(woundResearchExports).where(inArray(woundResearchExports.datasetId, ids)).groupBy(woundResearchExports.datasetId);
  return rows.map((r) => {
    const c = counts.find((x) => x.datasetId === r.id);
    return {
      id: r.id,
      lineageId: r.lineageId,
      version: r.version,
      previousVersionId: r.previousVersionId,
      name: r.name,
      description: r.description,
      purpose: r.purpose as WoundResearchDataset['purpose'],
      recipient: r.recipient as WoundResearchDataset['recipient'],
      criteria: r.criteria as WoundResearchDataset['criteria'],
      status: r.status as WoundResearchDataset['status'],
      approvalReference: r.approvalReference,
      retentionUntil: r.retentionUntil,
      frozenAt: r.frozenAt,
      retiredAt: r.retiredAt,
      createdAt: r.createdAt,
      counts: { items: c?.items ?? 0, pending: c?.pending ?? 0, accepted: c?.accepted ?? 0, rejected: c?.rejected ?? 0, withdrawn: c?.withdrawn ?? 0, images: images.find((x) => x.datasetId === r.id)?.n ?? 0 },
      exports: exports.find((x) => x.datasetId === r.id)?.n ?? 0,
    };
  });
}

async function staffPresentationViews(tx: Tx, rows: (typeof woundPresentationCases.$inferSelect)[], userId: string): Promise<WoundPresentationView[]> {
  const views = await presentationViews(tx, rows);
  const exports = rows.length
    ? await tx.select().from(woundPresentationExports).where(inArray(woundPresentationExports.presentationId, rows.map((r) => r.id))).orderBy(desc(woundPresentationExports.exportedAt))
    : [];
  // The scope the person currently allows (C); null when the permission is no longer active.
  const scopes = rows.length
    ? (await tx.execute<{ id: string; scope: { audiences?: WoundPresentationAudience[]; organizations?: WoundPresentationOrganization[] } | null }>(
        sql`select pc.id, app.wound_consent_scope(pc.patient_id, 'PRESENTATION') as scope from app.wound_presentation_cases pc where pc.id = any(${pgArray(rows.map((r) => r.id))}::uuid[])`,
      )).rows
    : [];
  return views.map((v) => {
    const r = rows.find((x) => x.id === v.id)!;
    const scope = scopes.find((x) => x.id === v.id)?.scope;
    return {
      ...v,
      permitted: scope ? { audiences: scope.audiences ?? [], organizations: scope.organizations ?? [] } : null,
      preparedByMe: r.preparedByUserId === userId,
      nominatedByMe: r.nominatedByUserId === userId,
      exports: exports.filter((e) => e.presentationId === v.id).map((e) => ({ id: e.id, format: e.format as 'PDF' | 'IMAGE_PACKAGE', exportedAt: e.exportedAt, byMe: e.exportedByUserId === userId })),
    };
  });
}

const LABEL: Record<string, string> = {
  DIABETIC_FOOT: 'Diabetic foot ulcer', PRESSURE_ULCER: 'Pressure ulcer', SURGICAL: 'Surgical wound', BURN: 'Burn', CHRONIC: 'Chronic wound', OTHER: 'Other wound',
  HEALED: 'Healed (clinician-confirmed)', IMPROVING: 'Improving (clinician-confirmed)', NO_CHANGE: 'No change (clinician-confirmed)', WORSENED: 'Worsened (clinician-confirmed)',
  REFERRED: 'Referred (clinician-confirmed)', LOST_TO_FOLLOW_UP: 'Lost to follow-up',
  INTERNAL_TRAINING: 'Internal training', HEALTHCARE_PROFESSIONALS: 'Healthcare professionals', APPROVED_PARTNERS: 'Approved partners', EDUCATIONAL_CASE_STUDIES: 'Educational case studies',
  ALIA_GROUP: 'Alia Group', TETRASOL: 'TetraSol',
};
const USE_NOTICE =
  'De-identified case shared with the patient’s specific approval of these exact photos and this text, for the audience, organisation and purpose stated, until the date stated. ' +
  'This case is not evidence that any product or treatment caused the outcome, and must not be presented as such. Do not copy, edit or reuse outside this approval.';

export async function woundStaffRoutes(app: FastifyInstance) {
  const { objects } = app.services;
  const asMe = <T>(request: FastifyRequest, principal: Principal, fn: (tx: Tx) => Promise<T>) => inContext(request, principal, fn);

  // ------------------------------------------------ registry overview (counts only)
  app.get('/overview', async (request): Promise<WoundRegistryOverview> => {
    const principal = await requirePermission(request, 'wound.registry.read');
    const o = await asMe(request, principal, async (tx) => (await tx.execute<{ o: Omit<WoundRegistryOverview, 'storage'> }>(sql`select app.wound_registry_overview() as o`)).rows[0]!.o);
    return { ...o, storage: objects.status };
  });

  // ------------------------------------------------ research datasets
  app.get('/datasets', async (request): Promise<WoundResearchDataset[]> => {
    const principal = await requireAnyPermission(request, 'wound.research.access', 'wound.research.review', 'wound.registry.read');
    return asMe(request, principal, async (tx) => datasetDtos(tx, await tx.select().from(woundResearchDatasets).orderBy(desc(woundResearchDatasets.createdAt)).limit(200)));
  });

  app.post('/datasets', async (request, reply) => {
    const principal = await requirePermission(request, 'wound.research.access');
    const b = parse(researchDatasetBody, request.body);
    const dto = await asMe(request, principal, async (tx) => {
      const id = (await tx.execute<{ id: string }>(sql`select app.wound_research_dataset_create(${b.name}, ${b.purpose}, ${b.recipient}, ${b.description ?? null}, ${JSON.stringify(b.criteria)}::jsonb) as id`)).rows[0]!.id;
      return (await datasetDtos(tx, await tx.select().from(woundResearchDatasets).where(eq(woundResearchDatasets.id, id))))[0]!;
    });
    return reply.status(201).send(dto);
  });

  app.get('/datasets/:id', async (request): Promise<{ dataset: WoundResearchDataset; items: WoundResearchItem[] }> => {
    const principal = await requireAnyPermission(request, 'wound.research.access', 'wound.research.review');
    const { id } = parse(idParam, request.params);
    return asMe(request, principal, async (tx) => {
      const rows = await tx.select().from(woundResearchDatasets).where(eq(woundResearchDatasets.id, id));
      if (!rows.length) throw notFound('Dataset');
      const items = await tx.select().from(woundResearchItems).where(eq(woundResearchItems.datasetId, id)).orderBy(woundResearchItems.pseudonym).limit(2000);
      const imgs = items.length
        ? await tx.select().from(woundResearchImages).where(and(inArray(woundResearchImages.itemId, items.map((i) => i.id)), eq(woundResearchImages.status, 'READY'))).orderBy(woundResearchImages.day)
        : [];
      return {
        dataset: (await datasetDtos(tx, rows))[0]!,
        items: items.map((i) => ({
          id: i.id,
          pseudonym: i.pseudonym,
          snapshot: i.snapshot as Record<string, unknown>,
          status: i.status as WoundResearchItem['status'],
          qualityStatus: i.qualityStatus as WoundResearchItem['qualityStatus'],
          qualityNote: i.qualityNote,
          images: imgs.filter((x) => x.itemId === i.id).map((x) => ({ id: x.id, day: x.day })),
        })),
      };
    });
  });

  // Adds every eligible case; research copies are re-encoded from the vault derivative (no metadata).
  app.post('/datasets/:id/build', { config: { rateLimit: { max: 6, timeWindow: '1 minute', keyGenerator: sessionKey } } }, async (request) => {
    const principal = await requirePermission(request, 'wound.research.access');
    const { id } = parse(idParam, request.params);
    const copies = await asMe(request, principal, async (tx) => (await tx.execute<{ research_image_id: string; source_key: string; storage_key: string }>(sql`select * from app.wound_research_dataset_build(${id}::uuid)`)).rows);
    const ready: string[] = [];
    const hashes: string[] = [];
    const failed: string[] = [];
    for (const c of copies) {
      try {
        const bytes = reencodeDerived(await objects.get(c.source_key));
        await objects.put(c.storage_key, bytes);
        ready.push(c.research_image_id);
        hashes.push(sha256(bytes));
      } catch (err) {
        request.log.warn({ err: (err as Error).message }, 'research copy failed');
        await objects.delete(c.storage_key).catch(() => undefined);
        failed.push(c.research_image_id);
      }
    }
    await asMe(request, principal, (tx) => tx.execute(sql`select app.wound_research_images_settle(${pgArray(ready)}::uuid[], ${pgArray(hashes)}::text[], ${pgArray(failed)}::uuid[])`));
    return { copied: ready.length, failed: failed.length };
  });

  app.post('/datasets/:id/freeze', async (request) => {
    const principal = await requirePermission(request, 'wound.research.access');
    const { id } = parse(idParam, request.params);
    const b = parse(researchFreezeBody, request.body);
    await asMe(request, principal, (tx) => tx.execute(sql`select app.wound_research_dataset_freeze(${id}::uuid, ${b.approvalReference}, ${b.retentionUntil}::date)`));
    setImmediate(() => void purgeStoredObjects(app).catch(() => undefined));
    return { ok: true };
  });

  app.post('/datasets/:id/new-version', async (request, reply) => {
    const principal = await requirePermission(request, 'wound.research.access');
    const { id } = parse(idParam, request.params);
    const dto = await asMe(request, principal, async (tx) => {
      const newId = (await tx.execute<{ id: string }>(sql`select app.wound_research_dataset_new_version(${id}::uuid) as id`)).rows[0]!.id;
      return (await datasetDtos(tx, await tx.select().from(woundResearchDatasets).where(eq(woundResearchDatasets.id, newId))))[0]!;
    });
    return reply.status(201).send(dto);
  });

  app.post('/datasets/:id/retire', async (request) => {
    const principal = await requirePermission(request, 'wound.research.access');
    const { id } = parse(idParam, request.params);
    await asMe(request, principal, (tx) => tx.execute(sql`select app.wound_research_dataset_retire(${id}::uuid)`));
    setImmediate(() => void purgeStoredObjects(app).catch(() => undefined));
    return { ok: true };
  });

  // Disabled until the export flag is switched on with evidence (data-sharing agreements, approvals).
  app.post('/datasets/:id/export', { config: { rateLimit: { max: 3, timeWindow: '1 minute', keyGenerator: sessionKey } } }, async (request, reply) => {
    const principal = await requirePermission(request, 'wound.research.access');
    const { id } = parse(idParam, request.params);
    const m = await asMe(request, principal, async (tx) =>
      (await tx.execute<{ m: { dataset: Record<string, unknown>; items: { pseudonym: string; snapshot: unknown; images: { key: string; day: number; sha256: string }[] }[] } }>(sql`select app.wound_research_export_manifest(${id}::uuid) as m`)).rows[0]!.m,
    );
    const files: { name: string; data: Buffer }[] = [];
    const manifest = {
      dataset: m.dataset,
      notice: 'Pseudonymised research data. Not anonymous: handle as personal health data under the data-sharing agreement. No re-identification attempts.',
      items: m.items.map((it) => ({ pseudonym: it.pseudonym, snapshot: it.snapshot, images: it.images.map((im) => ({ file: `images/${it.pseudonym}/day-${im.day}-${im.key.slice(2, 10)}.jpg`, day: im.day, sha256: im.sha256 })) })),
    };
    for (const it of m.items) for (const im of it.images) files.push({ name: `images/${it.pseudonym}/day-${im.day}-${im.key.slice(2, 10)}.jpg`, data: await objects.get(im.key) });
    files.unshift({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') });
    return reply.header('content-type', 'application/zip').header('content-disposition', 'attachment; filename="wound-research-dataset.zip"').header('cache-control', 'no-store').send(zipStore(files));
  });

  app.post('/research-items/:id/review', async (request) => {
    const principal = await requirePermission(request, 'wound.research.review');
    const { id } = parse(idParam, request.params);
    const b = parse(researchReviewBody, request.body);
    await asMe(request, principal, (tx) => tx.execute(sql`select app.wound_research_item_review(${id}::uuid, ${b.decision}, ${b.note ?? null})`));
    return { ok: true };
  });

  app.post('/research-images/:id/link', async (request) => {
    const principal = await requireAnyPermission(request, 'wound.research.access', 'wound.research.review');
    const { id } = parse(idParam, request.params);
    return mintMediaLink(request, principal, 'research', id, 'derived');
  });

  app.get('/product-outcomes', async (request): Promise<{ rows: WoundProductOutcomeRow[]; minimumCellSize: number }> => {
    const principal = await requirePermission(request, 'wound.research.access');
    const rows = await asMe(request, principal, async (tx) => (await tx.execute<{ r: WoundProductOutcomeRow[] }>(sql`select app.wound_product_outcomes() as r`)).rows[0]!.r);
    return { rows, minimumCellSize: 5 };
  });

  // ------------------------------------------------ presentation case library
  app.get('/presentation-candidates', async (request): Promise<WoundPresentationCandidate[]> => {
    const principal = await requirePermission(request, 'wound.presentation.manage');
    return asMe(request, principal, async (tx) =>
      (await tx.execute<{ case_id: string; category: string; region: string; photo_count: number; span_days: number; outcome: string; audiences: string[]; organizations: string[] }>(sql`select * from app.wound_presentation_candidates()`)).rows.map((r) => ({
        caseId: r.case_id,
        category: r.category as never,
        region: r.region,
        photoCount: r.photo_count,
        spanDays: r.span_days,
        outcome: r.outcome as never,
        audiences: r.audiences as never,
        organizations: r.organizations as never,
      })),
    );
  });

  app.get('/cases/:id/images', async (request) => {
    const principal = await requirePermission(request, 'wound.presentation.manage');
    const { id } = parse(idParam, request.params);
    return asMe(request, principal, async (tx) =>
      (await tx.execute<{ image_id: string; day: number; width: number; height: number }>(sql`select * from app.wound_presentation_case_images(${id}::uuid)`)).rows.map((r) => ({ imageId: r.image_id, day: r.day, width: r.width, height: r.height })),
    );
  });

  app.post('/presentation-images/:id/link', async (request) => {
    const principal = await requirePermission(request, 'wound.presentation.manage');
    const { id } = parse(idParam, request.params);
    return mintMediaLink(request, principal, 'presentation', id, 'derived');
  });

  app.get('/presentations', async (request): Promise<WoundPresentationView[]> => {
    const principal = await requireAnyPermission(request, 'wound.presentation.manage');
    return asMe(request, principal, async (tx) => staffPresentationViews(tx, await tx.select().from(woundPresentationCases).orderBy(desc(woundPresentationCases.updatedAt)).limit(200), principal.userId));
  });

  app.post('/presentations', async (request, reply) => {
    const principal = await requirePermission(request, 'wound.presentation.manage');
    const { caseId } = parse(z.object({ caseId: z.string().uuid() }), request.body);
    const view = await asMe(request, principal, async (tx) => {
      const id = (await tx.execute<{ id: string }>(sql`select app.wound_presentation_nominate(${caseId}::uuid) as id`)).rows[0]!.id;
      return (await staffPresentationViews(tx, await tx.select().from(woundPresentationCases).where(eq(woundPresentationCases.id, id)), principal.userId))[0]!;
    });
    return reply.status(201).send(view);
  });

  app.get('/presentations/:id', async (request): Promise<WoundPresentationView> => {
    const principal = await requirePermission(request, 'wound.presentation.manage');
    const { id } = parse(idParam, request.params);
    return asMe(request, principal, async (tx) => {
      const rows = await tx.select().from(woundPresentationCases).where(eq(woundPresentationCases.id, id));
      if (!rows.length) throw notFound('Presentation');
      return (await staffPresentationViews(tx, rows, principal.userId))[0]!;
    });
  });

  app.post('/presentations/:id/prepare', async (request): Promise<WoundPresentationView> => {
    const principal = await requirePermission(request, 'wound.presentation.manage');
    const { id } = parse(idParam, request.params);
    const b = parse(presentationPrepareBody, request.body);
    for (const text of [b.title, b.summaryEn, b.summaryAr, b.scopeNote, ...b.images.flatMap((i) => [i.captionEn, i.captionAr])]) {
      const problem = presentationTextProblem(text);
      if (problem) throw unprocessable('PRESENTATION_CLAIM_NOT_ALLOWED', 'Presentation text may not claim that a product or treatment works', { detail: problem });
    }
    return asMe(request, principal, async (tx) => {
      await tx.execute(
        sql`select app.wound_presentation_prepare(${id}::uuid, ${b.title}, ${b.summaryEn}, ${b.summaryAr}, ${b.audience}, ${b.organization}, ${b.scopeNote}, ${b.validUntil}::date, ${JSON.stringify(b.images)}::jsonb)`,
      );
      return (await staffPresentationViews(tx, await tx.select().from(woundPresentationCases).where(eq(woundPresentationCases.id, id)), principal.userId))[0]!;
    });
  });

  app.post('/presentations/:id/approve', async (request) => {
    const principal = await requirePermission(request, 'wound.presentation.manage');
    const { id } = parse(idParam, request.params);
    const b = parse(presentationApproveBody, request.body);
    await asMe(request, principal, (tx) => tx.execute(sql`select app.wound_presentation_approve(${id}::uuid, ${JSON.stringify(b.checklist)}::jsonb)`));
    return { ok: true };
  });

  app.post('/presentations/:id/reject', async (request) => {
    const principal = await requirePermission(request, 'wound.presentation.manage');
    const { id } = parse(idParam, request.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(300) }), request.body);
    await asMe(request, principal, (tx) => tx.execute(sql`select app.wound_presentation_reject(${id}::uuid, ${reason})`));
    return { ok: true };
  });

  // Only the approved version, only while valid and permitted; disabled until the export flag is on.
  app.post('/presentations/:id/export', { config: { rateLimit: { max: 6, timeWindow: '1 minute', keyGenerator: sessionKey } } }, async (request, reply) => {
    const principal = await requirePermission(request, 'wound.presentation.manage');
    const { id } = parse(idParam, request.params);
    const { format } = parse(z.object({ format: z.enum(['PDF', 'IMAGE_PACKAGE']) }), request.body);
    type ExportData = {
      title: string; summaryEn: string; summaryAr: string; audience: string; organization: string; scope: string; validUntil: string; category: string; outcome: string;
      images: { key: string; width: number; height: number; day: number; captionEn: string; captionAr: string }[];
    };
    const d = await asMe(request, principal, async (tx) => (await tx.execute<{ d: ExportData }>(sql`select app.wound_presentation_export_data(${id}::uuid) as d`)).rows[0]!.d);
    const photos = await Promise.all(d.images.map(async (im) => ({ ...im, bytes: await objects.get(im.key) })));
    let file: Buffer;
    if (format === 'PDF') {
      file = renderCasePdf(
        d.title,
        [
          `${LABEL[d.category] ?? d.category}. Outcome: ${LABEL[d.outcome] ?? d.outcome}.`,
          d.summaryEn,
          `Audience: ${LABEL[d.audience] ?? d.audience}. Organisation: ${LABEL[d.organization] ?? d.organization}. Approved use: ${d.scope}. Valid until ${d.validUntil}.`,
          USE_NOTICE,
        ],
        photos.map((p) => ({ jpeg: p.bytes, width: p.width, height: p.height, caption: `Day ${p.day}: ${p.captionEn}` })),
      );
    } else {
      const captions = photos.map((p, i) => `${String(i + 1).padStart(2, '0')} · Day ${p.day}\nEN: ${p.captionEn}\nAR: ${p.captionAr}`).join('\n\n');
      file = zipStore([
        ...photos.map((p, i) => ({ name: `images/${String(i + 1).padStart(2, '0')}-day-${p.day}.jpg`, data: p.bytes })),
        { name: 'captions.txt', data: Buffer.from(`${d.title}\n\n${captions}\n`, 'utf8') },
        { name: 'summary.txt', data: Buffer.from(`EN\n${d.summaryEn}\n\nAR\n${d.summaryAr}\n`, 'utf8') },
        {
          name: 'USE-RESTRICTIONS.txt',
          data: Buffer.from(`${USE_NOTICE}\n\nAudience: ${LABEL[d.audience] ?? d.audience}\nOrganisation: ${LABEL[d.organization] ?? d.organization}\nApproved use: ${d.scope}\nValid until: ${d.validUntil}\nOutcome: ${LABEL[d.outcome] ?? d.outcome}\n`, 'utf8'),
        },
      ]);
    }
    const hash = sha256(file);
    await asMe(request, principal, (tx) => tx.execute(sql`select app.wound_presentation_export_record(${id}::uuid, ${format}, ${hash})`));
    return reply
      .header('content-type', format === 'PDF' ? 'application/pdf' : 'application/zip')
      .header('content-disposition', `attachment; filename="wound-case.${format === 'PDF' ? 'pdf' : 'zip'}"`)
      .header('cache-control', 'no-store')
      .header('x-content-sha256', hash)
      .send(file);
  });
}
