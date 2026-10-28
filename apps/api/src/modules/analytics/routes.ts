/**
 * Health readings, calculated trends and grounded AI summaries (migration 0022, ADR 0012).
 *
 * Readings follow the health-entry rules (RLS, consent, derived provenance, entered-in-error).
 * Trends are computed by shared deterministic code from readings and CONFIRMED lab results only.
 * A summary goes through every gateway gate; the model sees only numbered calculated facts and its
 * answer is rejected unless every number is in the facts it cites and it makes no judgement.
 */
import {
  buildHealthFacts,
  checkHealthSummary,
  createHealthSummaryBody,
  createObservationBody,
  labSeriesKey,
  OBSERVATION_KINDS,
  OBSERVATION_SPEC,
  seriesStats,
  type HealthAnalytics,
  type HealthFact,
  type HealthSeries,
  type HealthSummary,
  type HealthSummaryContent,
  type HealthSummaryStatus,
  type LabRangeStatus,
  type Observation,
  type SeriesPoint,
} from '@ghayarly/shared';
import { and, asc, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Tx } from '../../db/client';
import { healthObservations, healthSummaries, labResults, userProfiles } from '../../db/schema';
import { AiProviderError, configuredProviders, type AiProviderCode, type AiResult } from '../../integrations/ai';
import { AppError, notFound } from '../../lib/errors';
import { inContext, requirePrincipal, type Principal } from '../../lib/principal';
import { sessionKey } from '../../lib/rateLimitKey';
import { parse } from '../../lib/validate';
import { allowance, preferences, providerArray } from '../ai/routes';
import { endUserRefFor, SUMMARY_POLICY_VERSION } from '../ai/safety';
import { healthSummaryRequest } from './summary';

const ROUTE = 'patient.health_summary';
const idParam = z.object({ id: z.string().uuid() });
const DAY = 86_400_000;

type Candidate = { provider: AiProviderCode; modelId: string; effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' };
type Reservation = { reservation_id: string; candidates: Candidate[]; max_output_tokens: number };

const observationDto = (r: typeof healthObservations.$inferSelect): Observation => ({
  id: r.id,
  patientId: r.patientId,
  kind: r.kind,
  value: r.value,
  value2: r.value2,
  unit: r.unit,
  context: r.context as Observation['context'],
  measuredAt: r.measuredAt,
  note: r.note,
  provenance: r.provenance,
  createdAt: r.createdAt,
});

const summaryDto = (r: typeof healthSummaries.$inferSelect): HealthSummary => ({
  id: r.id,
  patientId: r.patientId,
  status: r.status as HealthSummary['status'],
  periodDays: r.periodDays,
  language: r.language as 'ar' | 'en',
  facts: r.facts as HealthFact[],
  content: (r.content as HealthSummaryContent | null) ?? null,
  createdAt: r.createdAt,
  simulated: r.provider === 'SIMULATED',
});

/** Readings and confirmed lab values of a profile over a period, as series with calculated statistics. */
export async function buildAnalytics(tx: Tx, patientId: string, days: number): Promise<HealthAnalytics> {
  const since = new Date(Date.now() - days * DAY);
  const obs = await tx
    .select()
    .from(healthObservations)
    .where(and(eq(healthObservations.patientId, patientId), eq(healthObservations.status, 'ACTIVE'), gte(healthObservations.measuredAt, since.toISOString())))
    .orderBy(asc(healthObservations.measuredAt))
    .limit(5000);
  // Only results the person confirmed, with a plain number (bounds such as "< 5" have none).
  const labs = await tx
    .select()
    .from(labResults)
    .where(and(eq(labResults.patientId, patientId), eq(labResults.reviewStatus, 'CONFIRMED'), isNotNull(labResults.valueNumeric), gte(labResults.observedOn, since.toISOString().slice(0, 10))))
    .orderBy(asc(labResults.observedOn), asc(labResults.createdAt))
    .limit(5000);

  const series: HealthSeries[] = [];
  for (const kind of OBSERVATION_KINDS) {
    const points: SeriesPoint[] = obs.filter((o) => o.kind === kind).map((o) => ({ id: o.id, value: o.value, value2: o.value2, at: o.measuredAt, provenance: o.provenance }));
    if (points.length) series.push({ key: `VITAL:${kind}`, source: 'VITAL', kind, label: OBSERVATION_SPEC[kind].label, unit: OBSERVATION_SPEC[kind].unit, points, stats: seriesStats(points), printedRange: null });
  }
  const groups = new Map<string, typeof labs>();
  for (const l of labs.filter((x) => x.observedOn)) {
    const k = labSeriesKey(l.testName, l.unit);
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  for (const [key, rows] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const latest = rows[rows.length - 1]!;
    const points: SeriesPoint[] = rows.map((l) => ({ id: l.id, value: l.valueNumeric!, value2: null, at: `${l.observedOn}T00:00:00.000Z`, provenance: l.provenance as SeriesPoint['provenance'] }));
    series.push({
      key,
      source: 'LAB',
      kind: null,
      label: latest.testName,
      unit: latest.unit ?? '',
      points,
      stats: seriesStats(points),
      printedRange: { text: latest.referenceText, low: latest.referenceLow, high: latest.referenceHigh, latestStatus: latest.rangeStatus as LabRangeStatus },
    });
  }
  return { patientId, periodDays: days, generatedAt: new Date().toISOString(), series };
}

export async function analyticsRoutes(app: FastifyInstance) {
  const { ai, env } = app.services;

  async function summaryStatus(request: FastifyRequest, principal: Principal): Promise<HealthSummaryStatus> {
    return inContext(request, principal, async (tx) => {
      const r = await tx.execute<{ feature_on: boolean; internal_test: boolean; consented: boolean; route_on: boolean; eligible: number; eligible_free: number; budget_ok: boolean }>(
        sql`select * from app.ai_route_status(${ROUTE}, ${providerArray(configuredProviders(ai))})`,
      );
      const s = r.rows[0];
      const health = (await tx.execute<{ ok: boolean }>(sql`select app.has_current_consent('HEALTH_DATA_PROCESSING') as ok`)).rows[0]?.ok ?? false;
      const unavailableReason: HealthSummaryStatus['unavailableReason'] =
        !s || (!s.feature_on && !s.internal_test) ? 'FEATURE_DISABLED'
        : !s.route_on || s.eligible === 0 ? 'NOT_CONFIGURED'
        : s.eligible_free === 0 && !s.budget_ok ? 'PAUSED'
        : !s.consented ? 'CONSENT_REQUIRED'
        : !health ? 'HEALTH_CONSENT_REQUIRED'
        : null;
      return { unavailableReason, allowance: unavailableReason === 'FEATURE_DISABLED' ? null : await allowance(tx, ROUTE) };
    });
  }

  // ---------------------------------------------------------------- readings
  app.get('/patients/:id/observations', async (request): Promise<Observation[]> => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    const q = parse(z.object({ kind: z.enum(OBSERVATION_KINDS).optional(), days: z.coerce.number().int().min(1).max(3650).default(90) }), request.query);
    return inContext(request, principal, async (tx) => {
      const rows = await tx
        .select()
        .from(healthObservations)
        .where(
          and(
            eq(healthObservations.patientId, id),
            eq(healthObservations.status, 'ACTIVE'),
            gte(healthObservations.measuredAt, new Date(Date.now() - q.days * DAY).toISOString()),
            ...(q.kind ? [eq(healthObservations.kind, q.kind)] : []),
          ),
        )
        .orderBy(desc(healthObservations.measuredAt))
        .limit(1000);
      return rows.map(observationDto);
    });
  });

  app.post('/patients/:id/observations', { config: { rateLimit: { max: 60, timeWindow: '1 minute', keyGenerator: sessionKey } } }, async (request, reply) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    const b = parse(createObservationBody, request.body);
    if (Date.parse(b.measuredAt) > Date.now() + 5 * 60_000) throw new AppError(422, 'MEASURED_IN_FUTURE', 'A reading cannot be in the future');
    // Provenance, recorder and status are set by the database; access by row-level security.
    const row = await inContext(request, principal, async (tx) => {
      const [r] = await tx
        .insert(healthObservations)
        .values({ patientId: id, kind: b.kind, value: b.value, value2: b.value2 ?? null, unit: OBSERVATION_SPEC[b.kind].unit, context: b.context ?? null, measuredAt: b.measuredAt, note: b.note || null, provenance: 'PATIENT_REPORTED', recordedByUserId: principal.userId })
        .returning();
      return r!;
    });
    return reply.status(201).send(observationDto(row));
  });

  app.delete('/patients/:id/observations/:observationId', async (request) => {
    const principal = await requirePrincipal(request);
    const { id, observationId } = parse(idParam.extend({ observationId: z.string().uuid() }), request.params);
    await inContext(request, principal, async (tx) => {
      const u = await tx
        .update(healthObservations)
        .set({ status: 'ENTERED_IN_ERROR' })
        .where(and(eq(healthObservations.id, observationId), eq(healthObservations.patientId, id), eq(healthObservations.status, 'ACTIVE')))
        .returning({ id: healthObservations.id });
      if (!u.length) throw notFound('Reading');
    });
    return { ok: true };
  });

  // ---------------------------------------------------------------- calculated trends
  app.get('/patients/:id/analytics', async (request): Promise<HealthAnalytics> => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    const { days } = parse(z.object({ days: z.coerce.number().pipe(z.union([z.literal(30), z.literal(90), z.literal(365)])).default(90) }), request.query);
    return inContext(request, principal, async (tx) => {
      // RLS: a profile the caller cannot view has no rows; say so instead of returning an empty chart.
      const visible = await tx.execute<{ ok: boolean }>(sql`select app.can_view_patient(${id}::uuid) as ok`);
      if (!visible.rows[0]?.ok) throw notFound('Patient');
      return buildAnalytics(tx, id, days);
    });
  });

  // ---------------------------------------------------------------- AI summaries
  app.get('/ai/health-summary', async (request) => summaryStatus(request, await requirePrincipal(request)));

  app.get('/patients/:id/health-summaries', async (request): Promise<HealthSummary[]> => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    return inContext(request, principal, async (tx) =>
      (await tx.select().from(healthSummaries).where(eq(healthSummaries.patientId, id)).orderBy(desc(healthSummaries.createdAt)).limit(10)).map(summaryDto),
    );
  });

  app.delete('/health-summaries/:id', async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    await inContext(request, principal, async (tx) => {
      const d = await tx.delete(healthSummaries).where(eq(healthSummaries.id, id)).returning({ id: healthSummaries.id });
      if (!d.length) throw notFound('Summary');
    });
    return { ok: true };
  });

  app.post('/patients/:id/health-summaries', { config: { rateLimit: { max: 6, timeWindow: '1 minute', keyGenerator: sessionKey } } }, async (request, reply) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    const { days } = parse(createHealthSummaryBody, request.body);
    const status = await summaryStatus(request, principal);
    if (status.unavailableReason) {
      const code = status.unavailableReason === 'CONSENT_REQUIRED' ? 'AI_CONSENT_REQUIRED' : status.unavailableReason === 'HEALTH_CONSENT_REQUIRED' ? 'HEALTH_DATA_CONSENT_REQUIRED' : status.unavailableReason;
      throw new AppError(status.unavailableReason.endsWith('CONSENT_REQUIRED') ? 403 : 409, code, 'AI summaries are not available');
    }

    const prep = await inContext(request, principal, async (tx) => {
      const visible = await tx.execute<{ ok: boolean }>(sql`select app.can_view_patient(${id}::uuid) as ok`);
      if (!visible.rows[0]?.ok) throw notFound('Patient');
      const facts = buildHealthFacts((await buildAnalytics(tx, id, days)).series, days);
      // Nothing to summarise: no model call, nothing counted.
      if (!facts.length) throw new AppError(422, 'NOTHING_TO_SUMMARISE', 'There are no readings or confirmed results in this period');
      const prefs = await preferences(tx, principal.userId);
      const [profile] = await tx.select({ locale: userProfiles.locale }).from(userProfiles).where(eq(userProfiles.userId, principal.userId));
      const language: 'ar' | 'en' = prefs.replyLanguage === 'auto' ? (profile?.locale === 'en' ? 'en' : 'ar') : prefs.replyLanguage;
      const reservation = (await tx.execute<Reservation>(sql`select * from app.ai_reserve(${ROUTE}, 1, ${providerArray(configuredProviders(ai))}, null, ${language})`)).rows[0]!;
      const summaryId = (
        await tx.execute<{ id: string }>(sql`select app.health_summary_start(${id}::uuid, ${reservation.reservation_id}::uuid, ${days}, ${language}, ${JSON.stringify(facts)}::jsonb, ${SUMMARY_POLICY_VERSION}) as id`)
      ).rows[0]!.id;
      return { facts, language, reservation, summaryId };
    });

    // Provider call outside any transaction; one fallback on a retryable failure (another provider preferred).
    const { facts, language, reservation, summaryId } = prep;
    const base = { ...healthSummaryRequest(facts, language), maxOutputTokens: reservation.max_output_tokens, requestId: request.id, endUserRef: endUserRefFor(env.BETTER_AUTH_SECRET, principal.userId) };
    const [primary, ...rest] = reservation.candidates;
    let result: AiResult | null = null;
    let servedBy: AiProviderCode = primary!.provider;
    try {
      result = await ai[primary!.provider].complete({ ...base, model: primary!.modelId, effort: primary!.effort });
    } catch (e) {
      const fallback = e instanceof AiProviderError && e.retryable ? (rest.find((c) => c.provider !== primary!.provider) ?? rest[0]) : undefined;
      request.log.warn({ provider: primary!.provider, kind: e instanceof AiProviderError ? e.kind : 'UNKNOWN', fallback: fallback?.provider ?? null }, 'health summary failed');
      if (fallback) {
        try {
          servedBy = fallback.provider;
          result = await ai[fallback.provider].complete({ ...base, model: fallback.modelId, effort: fallback.effort });
        } catch (e2) {
          request.log.warn({ provider: servedBy, kind: e2 instanceof AiProviderError ? e2.kind : 'UNKNOWN' }, 'health summary fallback failed');
        }
      }
    }

    const asMe = <T>(fn: (tx: Tx) => Promise<T>) => inContext(request, principal, fn);
    const reload = async () => summaryDto((await asMe((tx) => tx.select().from(healthSummaries).where(eq(healthSummaries.id, summaryId))))[0]!);
    if (!result) {
      await asMe((tx) => tx.execute(sql`select app.health_summary_fail(${summaryId}::uuid, ${'PROVIDER_UNAVAILABLE'}, null, null, null, null, null)`));
      throw new AppError(503, 'AI_UNAVAILABLE', 'The summary could not be written right now. Nothing was counted against your allowance.');
    }
    const r = result;
    const u = r.usage;
    if (r.outcome === 'REFUSED') {
      await asMe((tx) => tx.execute(sql`select app.health_summary_settle(${summaryId}::uuid, ${servedBy}::app.ai_provider, ${r.servedModel}, ${u.inputTokens}, ${u.outputTokens}, ${u.cacheReadTokens}, 'REFUSED', 'REFUSED', null)`));
      return reply.status(201).send(await reload());
    }
    // The model's answer is untrusted: it must be grounded in the facts it cites and make no judgement.
    const check = checkHealthSummary(r.text, facts);
    if (!check.ok) {
      request.log.warn({ reason: check.reason }, 'health summary rejected');
      await asMe((tx) => tx.execute(sql`select app.health_summary_fail(${summaryId}::uuid, ${`INVALID_OUTPUT:${check.reason}`}, ${servedBy}::app.ai_provider, ${r.servedModel}, ${u.inputTokens}, ${u.outputTokens}, ${u.cacheReadTokens})`));
      throw new AppError(502, 'HEALTH_SUMMARY_REJECTED', 'The summary did not pass our checks and was not shown. Nothing was counted against your allowance.');
    }
    await asMe((tx) =>
      tx.execute(sql`select app.health_summary_settle(${summaryId}::uuid, ${servedBy}::app.ai_provider, ${r.servedModel}, ${u.inputTokens}, ${u.outputTokens}, ${u.cacheReadTokens}, ${r.outcome}, 'COMPLETED', ${JSON.stringify(check.content)}::jsonb)`),
    );
    return reply.status(201).send(await reload());
  });
}
