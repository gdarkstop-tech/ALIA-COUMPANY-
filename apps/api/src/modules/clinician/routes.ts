/**
 * Record shares and the clinician documentation copilot (migration 0024, ADR 0013).
 *
 * A person who manages a profile shares it with one verified clinician for a limited time; the
 * clinician then reads a limited summary through additive read-only policies. With the share's AI
 * permission and the clinician's AI terms, the copilot organises the clinician's own notes into a
 * draft that a deterministic guard checks and the clinician must sign. Nothing here bypasses RLS.
 */
import {
  ageInYears,
  buildHealthFacts,
  checkClinicalDraft,
  clinicalContentSchema,
  createDraftBody,
  DOC_TYPES_BY_ROLE,
  grantShareBody,
  updateDraftBody,
  type CareShare,
  type ClinicalDocType,
  type ClinicalDraft,
  type ClinicalDraftContent,
  type ClinicianCopilotStatus,
  type ClinicianPatient,
  type ClinicianRole,
} from '@ghayarly/shared';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Tx } from '../../db/client';
import { careShares, clinicalDrafts, patientHealthEntries, providerProfiles, userProfiles } from '../../db/schema';
import { AiProviderError, configuredProviders, type AiProviderCode, type AiResult } from '../../integrations/ai';
import { AppError, notFound } from '../../lib/errors';
import { inContext, requirePrincipal, requireRole, type Principal } from '../../lib/principal';
import { sessionKey } from '../../lib/rateLimitKey';
import { parse } from '../../lib/validate';
import { allowance, providerArray } from '../ai/routes';
import { DRAFT_POLICY_VERSION, endUserRefFor } from '../ai/safety';
import { buildAnalytics } from '../analytics/routes';
import { clinicalDraftRequest, notesLanguage, type DraftContext } from './draft';

const ROUTE = 'clinician.documentation';
const idParam = z.object({ id: z.string().uuid() });

type Candidate = { provider: AiProviderCode; modelId: string; effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' };
type Reservation = { reservation_id: string; candidates: Candidate[]; max_output_tokens: number };
type Summary = { id: string; display_name: string; date_of_birth: string; sex: ClinicianPatient['sex']; blood_type: string; governorate: string | null; is_demo: boolean };

/** `locale` names the author for the person reading a signed note; the author's own views leave it out. */
const draftDto = (r: typeof clinicalDrafts.$inferSelect, locale: 'ar' | 'en' | null, forPatient = false): ClinicalDraft => ({
  id: r.id,
  patientId: r.patientId,
  authorRole: r.authorRole as ClinicianRole,
  authorName: locale === null ? null : locale === 'en' ? r.authorNameEn : r.authorNameAr,
  docType: r.docType as ClinicalDocType,
  status: r.status as ClinicalDraft['status'],
  // The clinician's working notes stay with the clinician.
  clinicianInput: forPatient ? null : r.clinicianInput,
  content: (r.content as ClinicalDraftContent | null) ?? null,
  edited: r.edited,
  failure: forPatient ? null : r.failure,
  signedAt: r.signedAt,
  createdAt: r.createdAt,
  simulated: r.provider === 'SIMULATED',
});

async function localeOf(tx: Tx, userId: string) {
  const [p] = await tx.select({ locale: userProfiles.locale }).from(userProfiles).where(eq(userProfiles.userId, userId));
  return p?.locale === 'en' ? 'en' : 'ar';
}
async function patientSummary(tx: Tx, patientId: string): Promise<Summary> {
  const r = await tx.execute<Summary>(sql`select * from app.care_patient_summary(${patientId}::uuid)`);
  if (!r.rows[0]) throw notFound('Patient');
  return r.rows[0];
}
const ageBand = (dob: string) => {
  const a = ageInYears(dob);
  return a < 18 ? 'under 18' : `${Math.floor(a / 10) * 10}–${Math.floor(a / 10) * 10 + 9}`;
};

/** What the copilot may see besides the notes: no names, contacts or free-text notes. */
async function draftContext(tx: Tx, patientId: string, s: Summary): Promise<DraftContext> {
  const entries = await tx
    .select({ kind: patientHealthEntries.kind, title: patientHealthEntries.title })
    .from(patientHealthEntries)
    .where(and(eq(patientHealthEntries.patientId, patientId), eq(patientHealthEntries.status, 'ACTIVE')))
    .limit(100);
  const of = (k: string) => entries.filter((e) => e.kind === k).map((e) => e.title);
  const facts = buildHealthFacts((await buildAnalytics(tx, patientId, 30)).series, 30).filter((f) => f.display.kind === 'LATEST');
  return { ageBand: ageBand(s.date_of_birth), sex: s.sex === 'UNSPECIFIED' ? null : s.sex.toLowerCase(), allergies: of('ALLERGY'), conditions: of('CONDITION'), medications: of('MEDICATION'), readings: facts.map((f) => f.text) };
}

export async function clinicianRoutes(app: FastifyInstance) {
  const { ai, env } = app.services;

  // ---------------------------------------------------------------- shares (the person's side)
  function shareDtos(rows: (typeof careShares.$inferSelect)[], locale: 'ar' | 'en'): CareShare[] {
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      patientId: r.patientId,
      providerUserId: r.providerUserId,
      providerName: locale === 'en' ? r.providerNameEn : r.providerNameAr,
      providerType: r.providerType as ClinicianRole,
      aiAllowed: r.aiAllowed,
      status: r.status === 'ACTIVE' && Date.parse(r.expiresAt) <= now ? 'EXPIRED' : (r.status as CareShare['status']),
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    }));
  }

  app.post('/care-shares', { config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator: sessionKey } } }, async (request, reply) => {
    const principal = await requirePrincipal(request);
    const b = parse(grantShareBody, request.body);
    const share = await inContext(request, principal, async (tx) => {
      const id = (await tx.execute<{ id: string }>(sql`select app.care_share_grant(${b.patientId}::uuid, ${b.providerUserId}, ${b.days}, ${b.aiAllowed}) as id`)).rows[0]!.id;
      const rows = await tx.select().from(careShares).where(eq(careShares.id, id));
      return shareDtos(rows, await localeOf(tx, principal.userId))[0]!;
    });
    return reply.status(201).send(share);
  });

  app.get('/patients/:id/care-shares', async (request): Promise<CareShare[]> => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    return inContext(request, principal, async (tx) => {
      const rows = await tx.select().from(careShares).where(eq(careShares.patientId, id)).orderBy(desc(careShares.createdAt)).limit(50);
      return shareDtos(rows, await localeOf(tx, principal.userId));
    });
  });

  app.post('/care-shares/:id/revoke', async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    await inContext(request, principal, (tx) => tx.execute(sql`select app.care_share_revoke(${id}::uuid)`));
    return { ok: true };
  });

  /** Signed notes about a profile, for the people who manage it (drafts are never shown). */
  app.get('/patients/:id/clinical-notes', async (request): Promise<ClinicalDraft[]> => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    return inContext(request, principal, async (tx) => {
      const rows = await tx.select().from(clinicalDrafts).where(and(eq(clinicalDrafts.patientId, id), eq(clinicalDrafts.status, 'SIGNED'))).orderBy(desc(clinicalDrafts.signedAt)).limit(100);
      const locale = await localeOf(tx, principal.userId);
      return rows.map((r) => draftDto(r, locale, true));
    });
  });

  // ---------------------------------------------------------------- the clinician's side
  async function clinicianType(tx: Tx, userId: string): Promise<ClinicianRole | null> {
    const [p] = await tx.select({ type: providerProfiles.providerType, status: providerProfiles.verificationStatus }).from(providerProfiles).where(eq(providerProfiles.userId, userId));
    return p && p.status === 'APPROVED' ? (p.type as ClinicianRole) : null;
  }

  async function copilotStatus(request: FastifyRequest, principal: Principal): Promise<ClinicianCopilotStatus> {
    return inContext(request, principal, async (tx) => {
      const role = await clinicianType(tx, principal.userId);
      if (!role) return { unavailableReason: 'NOT_VERIFIED', allowance: null, role: null };
      const r = await tx.execute<{ feature_on: boolean; internal_test: boolean; consented: boolean; route_on: boolean; eligible: number; eligible_free: number; budget_ok: boolean }>(
        sql`select * from app.ai_route_status(${ROUTE}, ${providerArray(configuredProviders(ai))})`,
      );
      const s = r.rows[0];
      const unavailableReason: ClinicianCopilotStatus['unavailableReason'] =
        !s || (!s.feature_on && !s.internal_test) ? 'FEATURE_DISABLED'
        : !s.route_on || s.eligible === 0 ? 'NOT_CONFIGURED'
        : s.eligible_free === 0 && !s.budget_ok ? 'PAUSED'
        : !s.consented ? 'CLINICIAN_TERMS_REQUIRED'
        : null;
      return { unavailableReason, allowance: unavailableReason === 'FEATURE_DISABLED' ? null : await allowance(tx, ROUTE), role };
    });
  }

  app.get('/ai/clinician-copilot', async (request) => copilotStatus(request, await requireRole(request, 'DOCTOR', 'NURSE')));

  app.get('/clinician/patients', async (request): Promise<ClinicianPatient[]> => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    return inContext(request, principal, async (tx) => {
      // Only shares that are live AND usable (approved clinician, active account) appear.
      const rows = await tx
        .select()
        .from(careShares)
        .where(and(eq(careShares.providerUserId, principal.userId), eq(careShares.status, 'ACTIVE'), gt(careShares.expiresAt, new Date().toISOString()), sql`app.has_care_access(${careShares.patientId})`))
        .orderBy(desc(careShares.createdAt))
        .limit(200);
      const out: ClinicianPatient[] = [];
      for (const r of rows) {
        const s = await patientSummary(tx, r.patientId);
        out.push({ shareId: r.id, patientId: r.patientId, displayName: s.display_name, ageYears: ageInYears(s.date_of_birth), sex: s.sex, bloodType: s.blood_type === 'UNKNOWN' ? null : s.blood_type, governorate: s.governorate, isDemo: s.is_demo, aiAllowed: r.aiAllowed, expiresAt: r.expiresAt });
      }
      return out;
    });
  });

  app.get('/clinician/patients/:id', async (request) => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    const { id } = parse(idParam, request.params);
    return inContext(request, principal, async (tx) => {
      const s = await patientSummary(tx, id); // NOT_FOUND without a live share
      const [share] = await tx.select().from(careShares).where(and(eq(careShares.patientId, id), eq(careShares.providerUserId, principal.userId), eq(careShares.status, 'ACTIVE')));
      const entries = await tx
        .select({ id: patientHealthEntries.id, kind: patientHealthEntries.kind, title: patientHealthEntries.title, provenance: patientHealthEntries.provenance })
        .from(patientHealthEntries)
        .where(and(eq(patientHealthEntries.patientId, id), eq(patientHealthEntries.status, 'ACTIVE')))
        .limit(200);
      const drafts = await tx.select().from(clinicalDrafts).where(and(eq(clinicalDrafts.patientId, id), eq(clinicalDrafts.authorUserId, principal.userId))).orderBy(desc(clinicalDrafts.createdAt)).limit(50);
      const patient: ClinicianPatient = { shareId: share!.id, patientId: id, displayName: s.display_name, ageYears: ageInYears(s.date_of_birth), sex: s.sex, bloodType: s.blood_type === 'UNKNOWN' ? null : s.blood_type, governorate: s.governorate, isDemo: s.is_demo, aiAllowed: share!.aiAllowed, expiresAt: share!.expiresAt };
      await tx.execute(sql`select app.write_audit('clinician.record.viewed', 'patient', ${id}, ${id}::uuid, '{}'::jsonb)`);
      return { patient, entries, analytics: await buildAnalytics(tx, id, 90), drafts: drafts.filter((d) => d.status !== 'DISCARDED').map((d) => draftDto(d, null)) };
    });
  });

  app.post('/clinician/patients/:id/drafts', { config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: sessionKey } } }, async (request, reply) => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    const { id } = parse(idParam, request.params);
    const b = parse(createDraftBody, request.body);
    const status = await copilotStatus(request, principal);
    if (status.unavailableReason) {
      const consent = status.unavailableReason === 'CLINICIAN_TERMS_REQUIRED';
      throw new AppError(consent ? 403 : 409, consent ? 'AI_CLINICAL_TERMS_REQUIRED' : status.unavailableReason, 'The documentation assistant is not available');
    }

    const prep = await inContext(request, principal, async (tx) => {
      const role = (await clinicianType(tx, principal.userId))!;
      if (!DOC_TYPES_BY_ROLE[role].includes(b.docType)) throw new AppError(403, 'DOCUMENT_TYPE_NOT_IN_SCOPE', 'This note type is outside your role');
      const s = await patientSummary(tx, id);
      const context = await draftContext(tx, id, s);
      const language = notesLanguage(b.notes);
      const reservation = (await tx.execute<Reservation>(sql`select * from app.ai_reserve(${ROUTE}, 1, ${providerArray(configuredProviders(ai))}, null, ${language})`)).rows[0]!;
      const draftId = (
        await tx.execute<{ id: string }>(
          sql`select app.clinical_draft_start(${id}::uuid, ${reservation.reservation_id}::uuid, ${b.docType}, ${b.notes}, ${JSON.stringify(context)}::jsonb, ${DRAFT_POLICY_VERSION}) as id`,
        )
      ).rows[0]!.id;
      return { role, context, language, reservation, draftId };
    });

    const { role, context, language, reservation, draftId } = prep;
    const base = { ...clinicalDraftRequest(b.docType, role, b.notes, context, language), maxOutputTokens: reservation.max_output_tokens, requestId: request.id, endUserRef: endUserRefFor(env.BETTER_AUTH_SECRET, principal.userId) };
    const [primary, ...rest] = reservation.candidates;
    let result: AiResult | null = null;
    let servedBy: AiProviderCode = primary!.provider;
    try {
      result = await ai[primary!.provider].complete({ ...base, model: primary!.modelId, effort: primary!.effort });
    } catch (e) {
      const fallback = e instanceof AiProviderError && e.retryable ? (rest.find((c) => c.provider !== primary!.provider) ?? rest[0]) : undefined;
      request.log.warn({ provider: primary!.provider, kind: e instanceof AiProviderError ? e.kind : 'UNKNOWN', fallback: fallback?.provider ?? null }, 'clinical draft failed');
      if (fallback) {
        try {
          servedBy = fallback.provider;
          result = await ai[fallback.provider].complete({ ...base, model: fallback.modelId, effort: fallback.effort });
        } catch (e2) {
          request.log.warn({ provider: servedBy, kind: e2 instanceof AiProviderError ? e2.kind : 'UNKNOWN' }, 'clinical draft fallback failed');
        }
      }
    }

    const asMe = <T>(fn: (tx: Tx) => Promise<T>) => inContext(request, principal, fn);
    const reload = async () => draftDto((await asMe((tx) => tx.select().from(clinicalDrafts).where(eq(clinicalDrafts.id, draftId))))[0]!, null);
    if (!result) {
      await asMe((tx) => tx.execute(sql`select app.clinical_draft_fail(${draftId}::uuid, ${'PROVIDER_UNAVAILABLE'}, null, null, null, null, null)`));
      throw new AppError(503, 'AI_UNAVAILABLE', 'The draft could not be written right now. Nothing was counted.');
    }
    const r = result;
    const u = r.usage;
    if (r.outcome === 'REFUSED') {
      await asMe((tx) => tx.execute(sql`select app.clinical_draft_settle(${draftId}::uuid, ${servedBy}::app.ai_provider, ${r.servedModel}, ${u.inputTokens}, ${u.outputTokens}, ${u.cacheReadTokens}, 'REFUSED', null)`));
      return reply.status(201).send(await reload());
    }
    // Untrusted output: shape, doses and clinician-only terms are checked against the clinician's notes.
    const check = checkClinicalDraft(b.docType, r.text, b.notes, context.medications);
    if (!check.ok) {
      request.log.warn({ reason: check.reason }, 'clinical draft rejected');
      await asMe((tx) => tx.execute(sql`select app.clinical_draft_fail(${draftId}::uuid, ${`INVALID_OUTPUT:${check.reason}`}, ${servedBy}::app.ai_provider, ${r.servedModel}, ${u.inputTokens}, ${u.outputTokens}, ${u.cacheReadTokens})`));
      throw new AppError(502, 'CLINICAL_DRAFT_REJECTED', 'The draft added something that was not in your notes, so it was not shown. Nothing was counted.');
    }
    await asMe((tx) => tx.execute(sql`select app.clinical_draft_settle(${draftId}::uuid, ${servedBy}::app.ai_provider, ${r.servedModel}, ${u.inputTokens}, ${u.outputTokens}, ${u.cacheReadTokens}, ${r.outcome}, ${JSON.stringify(check.content)}::jsonb)`));
    return reply.status(201).send(await reload());
  });

  app.get('/clinician/drafts/:id', async (request): Promise<ClinicalDraft> => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    const { id } = parse(idParam, request.params);
    return inContext(request, principal, async (tx) => {
      const [d] = await tx.select().from(clinicalDrafts).where(and(eq(clinicalDrafts.id, id), eq(clinicalDrafts.authorUserId, principal.userId)));
      if (!d) throw notFound('Draft');
      return draftDto(d, null);
    });
  });

  /** The clinician saves edits, signs (then the note is frozen and visible to the person), or discards. */
  app.post('/clinician/drafts/:id', async (request): Promise<ClinicalDraft> => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    const { id } = parse(idParam, request.params);
    const b = parse(updateDraftBody, request.body);
    return inContext(request, principal, async (tx) => {
      const [d] = await tx.select().from(clinicalDrafts).where(and(eq(clinicalDrafts.id, id), eq(clinicalDrafts.authorUserId, principal.userId)));
      if (!d) throw notFound('Draft');
      let content: ClinicalDraftContent | null = null;
      if (b.action !== 'DISCARD') {
        const parsed = clinicalContentSchema(d.docType as ClinicalDocType).safeParse(b.content ?? d.content);
        if (!parsed.success) throw new AppError(400, 'VALIDATION_FAILED', 'The note does not match its sections');
        content = parsed.data as ClinicalDraftContent;
      }
      await tx.execute(sql`select app.clinical_draft_update(${id}::uuid, ${b.action}, ${content ? JSON.stringify(content) : null}::jsonb)`);
      const [updated] = await tx.select().from(clinicalDrafts).where(eq(clinicalDrafts.id, id));
      return draftDto(updated!, null);
    });
  });
}
