/**
 * Wound Intelligence Registry — patient, family and clinician side (migration 0027, ADR 0015).
 *
 * Every rule lives in PostgreSQL (RLS, guard triggers, SECURITY DEFINER functions); this module
 * validates input, processes photos deterministically, writes encrypted objects and mints
 * short-lived signed links. Nothing here classifies a wound or judges healing.
 */
import { randomUUID } from 'node:crypto';
import {
  createWoundCaseBody,
  presentationDecisionBody,
  updateWoundCaseBody,
  uploadWoundImageBody,
  woundClinicalBody,
  woundConsentBody,
  woundDayNumber,
  woundFollowUpPlan,
  woundObservationBody,
  woundOutcomeBody,
  woundTreatmentBody,
  WOUND_CONSENT_PURPOSES,
  WOUND_CONSENT_STATUS,
  WOUND_CONSENT_VERSION,
  type WoundCase,
  type WoundCaseDetail,
  type WoundConsentPurpose,
  type WoundConsentState,
  type WoundImage,
  type WoundMediaLink,
  type WoundPermissions,
  type WoundPresentationView,
  type WoundSimilarCase,
} from '@ghayarly/shared';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { withContext, type Tx } from '../../db/client';
import { patients, products, woundCases, woundConsentEvents, woundImages, woundObservations, woundPresentationCases, woundPresentationImages, woundTreatments } from '../../db/schema';
import { inspectImage } from '../../lib/images';
import { signMediaLink, verifyMediaLink, type MediaKind, type MediaVariant } from '../../lib/media-links';
import { AppError, notFound, unprocessable } from '../../lib/errors';
import { enforceMfa, inContext, requirePrincipal, requireRole, type Principal } from '../../lib/principal';
import { sessionKey } from '../../lib/rateLimitKey';
import { parse } from '../../lib/validate';
import { processWoundImage, WoundImageError } from '../../lib/wound-images';

const idParam = z.object({ id: z.string().uuid() });
/** A PostgreSQL array literal (drizzle would expand a JS array into a parameter list). */
export const pgArray = (values: readonly string[]) => `{${values.map((v) => `"${v.replace(/["\\]/g, '\\$&')}"`).join(',')}}`;
const cairoDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Calendar date in Egypt (matches app.wound_local_date in the database). */
export const localDate = (iso: string | Date) => cairoDate.format(typeof iso === 'string' ? new Date(iso) : iso);

type Access = { view: boolean; edit: boolean; admin: boolean; care: boolean };
async function accessTo(tx: Tx, patientId: string): Promise<Access> {
  const r = await tx.execute<Access>(
    sql`select app.can_view_patient(${patientId}::uuid) as view, app.can_edit_patient(${patientId}::uuid) as edit,
               app.can_administer_patient(${patientId}::uuid) as admin, app.has_care_wound_access(${patientId}::uuid) as care`,
  );
  return r.rows[0]!;
}

// ---------------------------------------------------------------- permissions
export async function woundPermissions(tx: Tx, patientId: string, userId: string): Promise<WoundPermissions> {
  const [p] = await tx.select({ id: patients.id, dob: patients.dateOfBirth }).from(patients).where(eq(patients.id, patientId));
  if (!p) throw notFound('Profile');
  const minor = (Date.now() - Date.parse(p.dob)) / (365.2425 * 86_400_000) < 18;
  const consents: WoundConsentState[] = [];
  for (const purpose of WOUND_CONSENT_PURPOSES) {
    const r = (
      await tx.execute<{ active: boolean; scope: WoundConsentState['scope']; basis: string | null; version: string }>(
        sql`select app.wound_consent_active(${patientId}::uuid, ${purpose}) as active, app.wound_consent_scope(${patientId}::uuid, ${purpose}) as scope,
                   app.wound_consent_basis(${patientId}::uuid, ${purpose}) as basis, app.wound_consent_version(${purpose}) as version`,
      )
    ).rows[0]!;
    const [latest] = await tx.select().from(woundConsentEvents).where(and(eq(woundConsentEvents.patientId, patientId), eq(woundConsentEvents.purpose, purpose))).orderBy(desc(woundConsentEvents.seq)).limit(1);
    consents.push({
      purpose,
      active: r.active,
      currentVersion: r.version,
      scope: r.active ? r.scope : null,
      since: r.active && latest ? latest.createdAt : null,
      decision: r.basis ? 'ALLOWED' : purpose !== 'SCAN' && minor ? 'NOT_FOR_MINORS' : 'NOT_ALLOWED',
    });
  }
  const history = await tx.select().from(woundConsentEvents).where(eq(woundConsentEvents.patientId, patientId)).orderBy(desc(woundConsentEvents.seq)).limit(100);
  const available = (await tx.execute<{ ok: boolean }>(sql`select app.wound_feature_available('wound.registry', app.patient_is_test(${patientId}::uuid)) as ok`)).rows[0]!.ok;
  return {
    patientId,
    available,
    wordingVersion: WOUND_CONSENT_VERSION,
    wordingStatus: WOUND_CONSENT_STATUS,
    consents,
    history: history.map((e) => ({
      id: e.id,
      purpose: e.purpose as WoundConsentPurpose,
      action: e.action as 'GRANT' | 'WITHDRAW',
      version: e.version,
      scope: (e.scope as WoundConsentState['scope']) ?? null,
      basis: e.actorBasis,
      reason: e.reason,
      byMe: e.actorUserId === userId,
      at: e.createdAt,
    })),
  };
}

// ---------------------------------------------------------------- cases
type CaseRow = typeof woundCases.$inferSelect;
type ImageRow = typeof woundImages.$inferSelect;

function caseDto(c: CaseRow, imgs: ImageRow[], today: string): WoundCase {
  const first = imgs[0] ? localDate(imgs[0].capturedAt) : null;
  const plan = woundFollowUpPlan(first, c.followUpDays, imgs.map((i) => localDate(i.capturedAt)), today);
  return {
    id: c.id,
    patientId: c.patientId,
    label: c.label,
    bodySite: c.bodySite as WoundCase['bodySite'],
    bodySide: c.bodySide as WoundCase['bodySide'],
    reportedCategory: c.reportedCategory as WoundCase['reportedCategory'],
    onsetDate: c.onsetDate,
    status: c.status as WoundCase['status'],
    followUpDays: c.followUpDays,
    clinical: c.clinicalCategory && c.clinicallyReviewedAt ? { category: c.clinicalCategory as never, diabetes: (c.diabetes as never) ?? null, reviewedAt: c.clinicallyReviewedAt } : null,
    outcome: c.outcome && c.outcomeOn && c.outcomeAt ? { outcome: c.outcome as never, on: c.outcomeOn, recordedAt: c.outcomeAt } : null,
    photoCount: imgs.length,
    firstPhotoAt: imgs[0]?.capturedAt ?? null,
    lastPhotoAt: imgs.at(-1)?.capturedAt ?? null,
    nextDue: c.status === 'OPEN' ? (plan.find((p) => p.status === 'DUE') ?? plan.find((p) => p.status === 'UPCOMING') ?? null) : null,
    createdAt: c.createdAt,
  };
}

async function listCases(tx: Tx, patientId: string): Promise<WoundCase[]> {
  const cases = await tx.select().from(woundCases).where(eq(woundCases.patientId, patientId)).orderBy(desc(woundCases.createdAt)).limit(100);
  if (!cases.length) return [];
  const imgs = await tx.select().from(woundImages).where(inArray(woundImages.caseId, cases.map((c) => c.id))).orderBy(asc(woundImages.capturedAt));
  const today = localDate(new Date());
  return cases.map((c) => caseDto(c, imgs.filter((i) => i.caseId === c.id), today));
}

export async function caseDetail(tx: Tx, id: string, userId: string): Promise<WoundCaseDetail> {
  const [c] = await tx.select().from(woundCases).where(eq(woundCases.id, id));
  if (!c) throw notFound('Wound');
  const access = await accessTo(tx, c.patientId);
  // New entries need the scanning permission (A) to be active now; reading and deleting do not.
  const scanActive = (await tx.execute<{ a: boolean }>(sql`select app.wound_consent_active(${c.patientId}::uuid, 'SCAN') as a`)).rows[0]!.a;
  const imgs = await tx.select().from(woundImages).where(eq(woundImages.caseId, id)).orderBy(asc(woundImages.capturedAt));
  const obs = await tx.select().from(woundObservations).where(eq(woundObservations.caseId, id)).orderBy(asc(woundObservations.observedOn), asc(woundObservations.createdAt));
  const trs = await tx.select().from(woundTreatments).where(eq(woundTreatments.caseId, id)).orderBy(asc(woundTreatments.startedOn));
  const productIds = [...new Set(trs.map((t) => t.productId).filter((x): x is string => !!x))];
  const prods = productIds.length ? await tx.select({ id: products.id, slug: products.slug, nameAr: products.nameAr, nameEn: products.nameEn, brand: products.brand }).from(products).where(inArray(products.id, productIds)) : [];
  const today = localDate(new Date());
  const base = caseDto(c, imgs, today);
  const first = imgs[0] ? localDate(imgs[0].capturedAt) : null;
  const dayOf = (date: string) => (first ? woundDayNumber(first, date) : null);
  const recent = (at: string) => Date.now() - Date.parse(at) < 24 * 3600_000;
  const images: WoundImage[] = imgs.map((i) => ({
    id: i.id,
    caseId: i.caseId,
    capturedAt: i.capturedAt,
    capturedAtSource: i.capturedAtSource as WoundImage['capturedAtSource'],
    day: dayOf(localDate(i.capturedAt)) ?? 1,
    uploaderRole: i.uploaderRole as WoundImage['uploaderRole'],
    width: i.width,
    height: i.height,
    quality: i.quality as WoundImage['quality'],
    metadataRemoved: i.metadataRemoved,
    note: i.note,
    canDelete: access.admin || (i.uploadedByUserId === userId && recent(i.createdAt)),
  }));
  const observations = obs.map((o) => ({
    id: o.id,
    observedOn: o.observedOn,
    day: dayOf(o.observedOn),
    imageId: o.imageId,
    authorRole: o.authorRole as never,
    provenance: o.provenance as never,
    painScore: o.painScore,
    exudate: (o.exudate as never) ?? null,
    signs: o.signs as never,
    lengthMm: o.lengthMm,
    widthMm: o.widthMm,
    depthMm: o.depthMm,
    note: o.note,
    mine: o.authorUserId === userId,
  }));
  return {
    ...base,
    plan: woundFollowUpPlan(first, c.followUpDays, imgs.map((i) => localDate(i.capturedAt)), today),
    images,
    observations,
    treatments: trs.map((t) => {
      const p = prods.find((x) => x.id === t.productId);
      return {
        id: t.id,
        kind: t.kind as never,
        product: p ? { id: p.id, slug: p.slug, nameAr: p.nameAr, nameEn: p.nameEn, brand: p.brand } : null,
        description: t.description,
        frequency: t.frequency,
        startedOn: t.startedOn,
        endedOn: t.endedOn,
        recorderRole: t.recorderRole as never,
        provenance: t.provenance as never,
        mine: t.recordedByUserId === userId,
      };
    }),
    // Only what was measured, with who measured it. Area is length × width of the recorded numbers.
    measurements: observations
      .filter((o) => o.lengthMm != null || o.widthMm != null || o.painScore != null)
      .map((o) => ({
        day: o.day ?? 1,
        observedOn: o.observedOn,
        lengthMm: o.lengthMm,
        widthMm: o.widthMm,
        areaMm2: o.lengthMm != null && o.widthMm != null ? Math.round(o.lengthMm * o.widthMm * 10) / 10 : null,
        painScore: o.painScore,
        provenance: o.provenance,
      })),
    ai: { status: 'DISABLED', reason: 'NOT_VALIDATED' },
    access: { canEdit: access.edit || access.care, canAdd: (access.edit || access.care) && scanActive, scanActive, canDelete: access.admin, asClinician: access.care && !access.view },
  };
}

async function presentationViews(tx: Tx, rows: (typeof woundPresentationCases.$inferSelect)[]): Promise<WoundPresentationView[]> {
  if (!rows.length) return [];
  const imgs = await tx.select().from(woundPresentationImages).where(inArray(woundPresentationImages.presentationId, rows.map((r) => r.id))).orderBy(asc(woundPresentationImages.position));
  return rows.map((r) => ({
    id: r.id,
    status: r.status as WoundPresentationView['status'],
    caseId: r.caseId,
    title: r.title,
    summaryEn: r.summaryEn,
    summaryAr: r.summaryAr,
    audience: r.audience as never,
    organization: r.organization as never,
    scopeNote: r.scopeNote,
    validUntil: r.validUntil,
    category: r.clinicalCategory as never,
    outcome: r.clinicalOutcome as never,
    images: imgs.filter((i) => i.presentationId === r.id).map((i) => ({ imageId: i.imageId, position: i.position, day: i.day, captionEn: i.captionEn, captionAr: i.captionAr })),
    requestHash: r.requestHash,
    patientDecidedAt: r.patientDecidedAt,
    approvedAt: r.approvedAt,
    closedReason: r.closedReason,
  }));
}
export { presentationViews };

// ---------------------------------------------------------------- media links
export async function mintMediaLink(request: FastifyRequest, principal: Principal, kind: MediaKind, id: string, variant: MediaVariant): Promise<WoundMediaLink> {
  const { env, mediaKey } = request.server.services;
  const key = await inContext(request, principal, async (tx) => (await tx.execute<{ k: string | null }>(sql`select app.wound_media_key(${kind}, ${id}::uuid, ${variant}, true) as k`)).rows[0]!.k);
  if (!key) throw notFound('Photo');
  const { token, expiresAt } = signMediaLink(mediaKey, { k: kind, id, v: variant, u: principal.userId });
  return { url: `${env.API_PUBLIC_URL}/v1/wound-media?t=${token}`, expiresAt };
}

// ---------------------------------------------------------------- object purge and maintenance
/** Deletes objects whose rows are gone (system context; never as a user). */
export async function purgeStoredObjects(app: FastifyInstance): Promise<{ deleted: number; failed: number }> {
  const { db, env, objects } = app.services;
  if (objects.status === 'NOT_CONFIGURED') return { deleted: 0, failed: 0 };
  const sys = { userId: null, demoMode: env.DEMO_MODE };
  let deleted = 0;
  let failed = 0;
  for (let round = 0; round < 10; round++) {
    const keys = (await withContext(db, sys, (tx) => tx.execute<{ k: string }>(sql`select k from app.storage_purge_claim(200) as k`))).rows.map((r) => r.k);
    if (!keys.length) break;
    const done: string[] = [];
    const bad: string[] = [];
    for (const k of keys) {
      try {
        await objects.delete(k);
        done.push(k);
      } catch {
        bad.push(k);
      }
    }
    await withContext(db, sys, (tx) => tx.execute(sql`select app.storage_purge_done(${pgArray(done)}::text[], ${pgArray(bad)}::text[], ${bad.length ? 'DELETE_FAILED' : null})`));
    deleted += done.length;
    failed += bad.length;
    if (bad.length) break;
  }
  return { deleted, failed };
}

export async function runWoundMaintenance(app: FastifyInstance) {
  const { db, env } = app.services;
  type Swept = { abandonedUploads: number; abandonedResearchCopies: number; retiredDatasets: number; expiredPresentations: number };
  const swept = (await withContext(db, { userId: null, demoMode: env.DEMO_MODE }, (tx) => tx.execute<{ r: Swept }>(sql`select app.wound_maintenance() as r`))).rows[0]!.r;
  return { ...swept, purge: await purgeStoredObjects(app) };
}

export function startWoundMaintenance(app: FastifyInstance) {
  const timer = setInterval(() => {
    runWoundMaintenance(app).catch((err) => app.log.warn({ err: (err as Error).message }, 'wound maintenance failed'));
  }, 5 * 60_000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
}

const purgeSoon = (app: FastifyInstance) => {
  setImmediate(() => {
    purgeStoredObjects(app).catch((err) => app.log.warn({ err: (err as Error).message }, 'object purge failed'));
  });
};

// ---------------------------------------------------------------- routes
export async function woundRoutes(app: FastifyInstance) {
  const { objects, mediaKey, db, env } = app.services;
  const asMe = <T>(request: FastifyRequest, principal: Principal, fn: (tx: Tx) => Promise<T>) => inContext(request, principal, fn);

  app.get('/wounds/status', async (request) => {
    const principal = await requirePrincipal(request);
    const flag = await asMe(request, principal, async (tx) => (await tx.execute<{ on: boolean }>(sql`select coalesce((select enabled from app.feature_flags where key = 'ai.wound_assessment'), false) as on`)).rows[0]!.on);
    return {
      storage: objects.status,
      wordingVersion: WOUND_CONSENT_VERSION,
      wordingStatus: WOUND_CONSENT_STATUS,
      // No validated wound-analysis model exists: the AI result is never produced, simulated or not.
      ai: { status: 'DISABLED' as const, reason: flag ? ('NOT_CONFIGURED' as const) : ('NOT_VALIDATED' as const) },
    };
  });

  // ------------------------------------------------ permissions (A scanning, B research, C presentations)
  app.get('/patients/:id/wound-permissions', async (request): Promise<WoundPermissions> => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    return asMe(request, principal, (tx) => woundPermissions(tx, id, principal.userId));
  });

  app.post('/patients/:id/wound-permissions', { config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: sessionKey } } }, async (request): Promise<WoundPermissions> => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    const b = parse(woundConsentBody, request.body);
    const locale = request.headers['accept-language']?.startsWith('en') ? 'en' : 'ar';
    const out = await asMe(request, principal, async (tx) => {
      const scope = 'scope' in b ? JSON.stringify(b.scope) : '{}';
      await tx.execute(sql`select app.wound_consent_record(${id}::uuid, ${b.purpose}, ${b.action}, ${b.version}, ${scope}::jsonb, ${locale})`);
      return woundPermissions(tx, id, principal.userId);
    });
    if (b.action === 'WITHDRAW') purgeSoon(app);
    return out;
  });

  // ------------------------------------------------ cases
  app.get('/patients/:id/wounds', async (request): Promise<WoundCase[]> => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    return asMe(request, principal, async (tx) => {
      const a = await accessTo(tx, id);
      if (!a.view && !a.care) throw notFound('Profile');
      return listCases(tx, id);
    });
  });

  app.post('/wounds', { config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: sessionKey } } }, async (request, reply) => {
    const principal = await requirePrincipal(request);
    const b = parse(createWoundCaseBody, request.body);
    const detail = await asMe(request, principal, async (tx) => {
      const [c] = await tx
        .insert(woundCases)
        .values({
          patientId: b.patientId,
          createdByUserId: principal.userId,
          label: b.label,
          bodySite: b.bodySite,
          bodySide: b.bodySide,
          reportedCategory: b.reportedCategory,
          onsetDate: b.onsetDate ?? null,
          followUpDays: b.followUpDays ?? [3, 7],
          status: 'OPEN',
          testData: false, // set by the database
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .returning({ id: woundCases.id });
      return caseDetail(tx, c!.id, principal.userId);
    });
    return reply.status(201).send(detail);
  });

  app.get('/wounds/:id', async (request): Promise<WoundCaseDetail> => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    return asMe(request, principal, (tx) => caseDetail(tx, id, principal.userId));
  });

  app.patch('/wounds/:id', async (request): Promise<WoundCaseDetail> => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    const b = parse(updateWoundCaseBody, request.body);
    return asMe(request, principal, async (tx) => {
      if (Object.keys(b).length) {
        const u = await tx.update(woundCases).set(b).where(eq(woundCases.id, id)).returning({ id: woundCases.id });
        if (!u.length) throw notFound('Wound');
      }
      return caseDetail(tx, id, principal.userId);
    });
  });

  app.delete('/wounds/:id', async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    await asMe(request, principal, async (tx) => {
      const d = await tx.delete(woundCases).where(eq(woundCases.id, id)).returning({ id: woundCases.id });
      if (!d.length) throw notFound('Wound');
    });
    purgeSoon(app);
    return { ok: true };
  });

  app.post('/patients/:id/wounds/delete-all', async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    const deleted = await asMe(request, principal, async (tx) => (await tx.execute<{ n: number }>(sql`select app.wound_delete_all(${id}::uuid) as n`)).rows[0]!.n);
    purgeSoon(app);
    return { ok: true, deletedCases: deleted };
  });

  // ------------------------------------------------ photos
  app.post('/wounds/:id/images', { bodyLimit: 18 * 1024 * 1024, config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator: sessionKey } } }, async (request, reply) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    if (objects.status === 'NOT_CONFIGURED') throw new AppError(409, 'NOT_CONFIGURED', 'Photo storage is not configured');
    const b = parse(uploadWoundImageBody, request.body);
    let p: ReturnType<typeof processWoundImage>;
    try {
      p = processWoundImage(Buffer.from(b.dataBase64, 'base64'));
    } catch (e) {
      if (e instanceof WoundImageError) throw unprocessable(e.code, e.code === 'IMAGE_TOO_LARGE' ? 'Photos are limited to 12 MB' : 'Upload a JPEG or PNG photo');
      throw e;
    }
    if (p.contentType !== b.contentType) throw unprocessable('IMAGE_TYPE_INVALID', 'The file is not the declared type');
    const imageId = randomUUID();
    const capturedAt = p.cameraTakenAt ?? b.capturedAt ?? null;
    const source = p.cameraTakenAt ? 'CAMERA' : b.capturedAt ? 'DEVICE' : 'UPLOAD';
    const keys = await asMe(request, principal, async (tx) =>
      (
        await tx.execute<{ k: { originalKey: string; derivedKey: string } }>(
          sql`select app.wound_image_register(${imageId}::uuid, ${id}::uuid, ${p.contentType}, ${p.original.length}, ${p.originalSha256}, ${p.derivedSha256},
                ${p.width}, ${p.height}, ${p.derivedWidth}, ${p.derivedHeight}, ${capturedAt}::timestamptz, ${source},
                ${pgArray(p.metadataRemoved)}::text[], ${JSON.stringify(p.quality)}::jsonb, ${b.note ?? null}) as k`,
        )
      ).rows[0]!.k,
    );
    const undo = async () => {
      await Promise.allSettled([objects.delete(keys.originalKey), objects.delete(keys.derivedKey)]);
      await asMe(request, principal, (tx) => tx.execute(sql`select app.wound_image_abort(${imageId}::uuid)`)).catch(() => undefined);
    };
    try {
      await objects.put(keys.originalKey, p.original);
      await objects.put(keys.derivedKey, p.derived);
    } catch (err) {
      request.log.warn({ err: (err as Error).message }, 'wound photo storage failed');
      await undo();
      throw new AppError(503, 'STORAGE_UNAVAILABLE', 'The photo could not be stored. Nothing was saved.');
    }
    try {
      const detail = await asMe(request, principal, async (tx) => {
        await tx.execute(sql`select app.wound_image_commit(${imageId}::uuid)`);
        return caseDetail(tx, id, principal.userId);
      });
      return reply.status(201).send(detail);
    } catch (err) {
      await undo();
      throw err;
    }
  });

  app.delete('/wound-images/:id', async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    await asMe(request, principal, async (tx) => {
      const d = await tx.delete(woundImages).where(eq(woundImages.id, id)).returning({ id: woundImages.id });
      if (!d.length) throw notFound('Photo');
    });
    purgeSoon(app);
    return { ok: true };
  });

  app.post('/wound-images/:id/link', { config: { rateLimit: { max: 120, timeWindow: '1 minute', keyGenerator: sessionKey } } }, async (request): Promise<WoundMediaLink> => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    const { variant } = parse(z.object({ variant: z.enum(['derived', 'original']).default('derived') }), request.body ?? {});
    if (variant === 'original') enforceMfa(request, principal);
    return mintMediaLink(request, principal, 'vault', id, variant);
  });

  // Links for every photo of a case at once (timeline / comparison); each view is audited.
  app.post('/wounds/:id/image-links', { config: { rateLimit: { max: 60, timeWindow: '1 minute', keyGenerator: sessionKey } } }, async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    const ids = await asMe(request, principal, async (tx) => (await tx.select({ id: woundImages.id }).from(woundImages).where(eq(woundImages.caseId, id))).map((r) => r.id));
    const out: (WoundMediaLink & { imageId: string })[] = [];
    for (const imageId of ids) out.push({ imageId, ...(await mintMediaLink(request, principal, 'vault', imageId, 'derived')) });
    return out;
  });

  // The link is the credential (an image element cannot send the session); access is re-checked now, as that person.
  app.get('/wound-media', async (request, reply) => {
    const { t } = parse(z.object({ t: z.string().min(20).max(600) }), request.query);
    const claim = verifyMediaLink(mediaKey, t);
    if (!claim) throw new AppError(403, 'MEDIA_LINK_INVALID', 'This link has expired. Open the photo again from the app.');
    const key = await withContext(db, { userId: claim.u, demoMode: env.DEMO_MODE, requestId: request.id }, async (tx) => {
      const ok = (await tx.execute<{ ok: boolean }>(sql`select app.account_active(${claim.u}) as ok`)).rows[0]?.ok;
      if (!ok) return null;
      return (await tx.execute<{ k: string | null }>(sql`select app.wound_media_key(${claim.k}, ${claim.id}::uuid, ${claim.v}, false) as k`)).rows[0]!.k;
    });
    if (!key) throw new AppError(403, 'MEDIA_LINK_INVALID', 'This photo is no longer available to you.');
    const bytes = await objects.get(key);
    const type = claim.v === 'original' ? (inspectImage(bytes)?.type ?? 'application/octet-stream') : 'image/jpeg';
    return reply
      .header('content-type', type)
      .header('content-disposition', `inline; filename="wound.${type === 'image/png' ? 'png' : 'jpg'}"`)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; frame-ancestors 'none'")
      .header('cross-origin-resource-policy', 'cross-origin')
      .send(bytes);
  });

  // ------------------------------------------------ observations and treatments
  async function caseOf(tx: Tx, id: string) {
    const [c] = await tx.select({ id: woundCases.id, patientId: woundCases.patientId }).from(woundCases).where(eq(woundCases.id, id));
    if (!c) throw notFound('Wound');
    return c;
  }

  app.post('/wounds/:id/observations', async (request, reply) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    const b = parse(woundObservationBody, request.body);
    const detail = await asMe(request, principal, async (tx) => {
      const c = await caseOf(tx, id);
      await tx.insert(woundObservations).values({
        caseId: id,
        patientId: c.patientId,
        imageId: b.imageId ?? null,
        observedOn: b.observedOn,
        authorUserId: principal.userId,
        authorRole: 'PATIENT', // set by the database
        provenance: 'PATIENT_REPORTED', // set by the database
        painScore: b.painScore ?? null,
        exudate: b.exudate ?? null,
        signs: b.signs,
        lengthMm: b.lengthMm ?? null,
        widthMm: b.widthMm ?? null,
        depthMm: b.depthMm ?? null,
        note: b.note ?? null,
        createdAt: new Date().toISOString(),
      });
      return caseDetail(tx, id, principal.userId);
    });
    return reply.status(201).send(detail);
  });

  app.delete('/wound-observations/:id', async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    await asMe(request, principal, async (tx) => {
      const d = await tx.delete(woundObservations).where(eq(woundObservations.id, id)).returning({ id: woundObservations.id });
      if (!d.length) throw notFound('Observation');
    });
    return { ok: true };
  });

  app.post('/wounds/:id/treatments', async (request, reply) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    const b = parse(woundTreatmentBody, request.body);
    const detail = await asMe(request, principal, async (tx) => {
      const c = await caseOf(tx, id);
      await tx.insert(woundTreatments).values({
        caseId: id,
        patientId: c.patientId,
        kind: b.kind,
        productId: b.productId ?? null,
        description: b.description,
        frequency: b.frequency ?? null,
        startedOn: b.startedOn,
        endedOn: b.endedOn ?? null,
        recordedByUserId: principal.userId,
        recorderRole: 'PATIENT', // set by the database
        provenance: 'PATIENT_REPORTED', // set by the database
        createdAt: new Date().toISOString(),
      });
      return caseDetail(tx, id, principal.userId);
    });
    return reply.status(201).send(detail);
  });

  app.patch('/wound-treatments/:id', async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    const b = parse(z.object({ endedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), frequency: z.string().trim().max(60).nullable().optional() }), request.body);
    return asMe(request, principal, async (tx) => {
      const u = await tx.update(woundTreatments).set(b).where(eq(woundTreatments.id, id)).returning({ caseId: woundTreatments.caseId });
      if (!u.length) throw notFound('Treatment');
      return caseDetail(tx, u[0]!.caseId, principal.userId);
    });
  });

  app.delete('/wound-treatments/:id', async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    await asMe(request, principal, async (tx) => {
      const d = await tx.delete(woundTreatments).where(eq(woundTreatments.id, id)).returning({ id: woundTreatments.id });
      if (!d.length) throw notFound('Treatment');
    });
    return { ok: true };
  });

  // ------------------------------------------------ clinician only
  app.post('/wounds/:id/clinical', async (request): Promise<WoundCaseDetail> => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    enforceMfa(request, principal);
    const { id } = parse(idParam, request.params);
    const b = parse(woundClinicalBody, request.body);
    return asMe(request, principal, async (tx) => {
      await tx.execute(sql`select app.wound_case_confirm(${id}::uuid, ${b.category}, ${b.diabetes ?? null})`);
      return caseDetail(tx, id, principal.userId);
    });
  });

  app.post('/wounds/:id/outcome', async (request): Promise<WoundCaseDetail> => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    enforceMfa(request, principal);
    const { id } = parse(idParam, request.params);
    const b = parse(woundOutcomeBody, request.body);
    return asMe(request, principal, async (tx) => {
      await tx.execute(sql`select app.wound_case_outcome(${id}::uuid, ${b.outcome}, ${b.on}::date)`);
      return caseDetail(tx, id, principal.userId);
    });
  });

  app.get('/wounds/:id/similar', async (request): Promise<WoundSimilarCase[]> => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    enforceMfa(request, principal);
    const { id } = parse(idParam, request.params);
    return asMe(request, principal, async (tx) => (await tx.execute<{ r: WoundSimilarCase[] }>(sql`select app.wound_similar_cases(${id}::uuid, 10) as r`)).rows[0]!.r);
  });

  // There is no validated wound-analysis model: this answer is fixed, for real and test accounts alike.
  app.post('/wounds/:id/analyze', async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    await asMe(request, principal, (tx) => caseOf(tx, id));
    throw new AppError(409, 'FEATURE_DISABLED', 'Automatic wound analysis is not available: no method has been clinically validated.');
  });

  // ------------------------------------------------ presentation requests (the person's side)
  app.get('/patients/:id/wound-presentations', async (request): Promise<WoundPresentationView[]> => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    return asMe(request, principal, async (tx) => {
      const a = await accessTo(tx, id);
      if (!a.view) throw notFound('Profile');
      const rows = await tx.select().from(woundPresentationCases).where(eq(woundPresentationCases.patientId, id)).orderBy(desc(woundPresentationCases.updatedAt)).limit(100);
      return presentationViews(tx, rows);
    });
  });

  app.post('/wound-presentations/:id/decision', async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    const b = parse(presentationDecisionBody, request.body);
    await asMe(request, principal, (tx) => tx.execute(sql`select app.wound_presentation_decide(${id}::uuid, ${b.decision}, ${b.requestHash})`));
    return { ok: true };
  });

  app.post('/wound-presentations/:id/withdraw', async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    await asMe(request, principal, (tx) => tx.execute(sql`select app.wound_presentation_withdraw(${id}::uuid)`));
    return { ok: true };
  });
}
