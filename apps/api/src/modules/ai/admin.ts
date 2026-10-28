/**
 * AI control centre (/v1/admin/ai). Configuration only — never credentials: provider keys live in
 * the backend secret manager, and the console can only see whether each provider is configured.
 * Every change is permission-checked and audited by the database (migrations 0011, 0013).
 */
import {
  AI_METRICS,
  AI_PROVIDERS,
  aiBudgetBody,
  aiCandidateCreateBody,
  aiCandidatePatchBody,
  aiEvalCaseBody,
  aiEvalCasePatchBody,
  evalCaseProblem,
  aiEvalResultReviewBody,
  aiModelCreateBody,
  aiModelPatchBody,
  aiPlanBudgetBody,
  aiQuotaPatchBody,
  aiReportTransitionBody,
  aiRoutePatchBody,
  type AiCapability,
  type AiControlCentre,
  type AiEvalCase,
  type AiEvalChecks,
  type AiEvalResult,
  type AiEvalRun,
  type AiEvalSummary,
  type AiEvaluationOverview,
  type AiMetric,
  type AiModelAdmin,
  type AiProviderCode,
  type AiReportDetail,
  type AiReportListItem,
  type AiRouteCandidate,
} from '@ghayarly/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Tx } from '../../db/client';
import {
  aiBudget,
  aiBudgetAlerts,
  aiEvalCases,
  aiEvalResults,
  aiEvalRuns,
  aiModelRouteApprovals,
  aiModels,
  aiPlanBudgets,
  aiPlanQuotas,
  aiReportEvents,
  aiResponseReports,
  aiRoleQuotas,
  aiRouteCandidates,
  aiRoutes,
  billingPlans,
  featureFlags,
} from '../../db/schema';
import { ATTACHMENT_SUPPORT, PROVIDER_ENV_VARS } from '../../integrations/ai';
import { audit } from '../../lib/audit';
import { notFound, unprocessable } from '../../lib/errors';
import { contextFor, inContext, requireAnyPermission, requirePermission } from '../../lib/principal';
import { parse } from '../../lib/validate';
import { executeEvaluation } from './evaluation';
import { policyFor, policyVersionFor } from './safety';

const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);
const uuidParam = z.object({ id: z.string().uuid() });
const num = (v: string | number | null | undefined) => (v === null || v === undefined ? null : Number(v));

function modelDto(m: typeof aiModels.$inferSelect, approvals: (typeof aiModelRouteApprovals.$inferSelect)[]): AiModelAdmin {
  return {
    id: m.id,
    provider: m.provider,
    modelId: m.modelId,
    displayName: m.displayName,
    inputPriceMicros: m.inputPriceMicros,
    outputPriceMicros: m.outputPriceMicros,
    cacheReadPriceMicros: m.cacheReadPriceMicros,
    audioInputPriceMicros: m.audioInputPriceMicros,
    audioOutputPriceMicros: m.audioOutputPriceMicros,
    audioCacheReadPriceMicros: m.audioCacheReadPriceMicros,
    priceSource: m.priceSource,
    priceVerifiedAt: iso(m.priceVerifiedAt),
    active: m.active,
    capabilities: m.capabilities as AiCapability[],
    medicalSpecialized: m.medicalSpecialized,
    hosting: m.hosting as AiModelAdmin['hosting'],
    dataRegion: m.dataRegion,
    notes: m.notes,
    patientDataApprovalRef: m.patientDataApprovalRef,
    patientDataApprovedAt: iso(m.patientDataApprovedAt),
    clinicalApprovals: approvals
      .filter((a) => a.model === m.id && !a.revokedAt)
      .map((a) => ({ routeKey: a.routeKey, approvalId: a.id, approvedAt: iso(a.approvedAt)!, runId: a.runId })),
  };
}

function caseDto(c: typeof aiEvalCases.$inferSelect, me: string): AiEvalCase {
  return {
    id: c.id,
    code: c.code,
    category: c.category as AiEvalCase['category'],
    language: c.language as 'ar' | 'en',
    prompt: c.prompt,
    context: c.context,
    expectedBehavior: c.expectedBehavior,
    routeKey: c.routeKey as AiEvalCase['routeKey'],
    checks: c.checks as AiEvalChecks,
    documentSpec: (c.documentSpec as AiEvalCase['documentSpec']) ?? null,
    summarySpec: (c.summarySpec as AiEvalCase['summarySpec']) ?? null,
    status: c.status as AiEvalCase['status'],
    version: c.version,
    authoredByMe: c.authoredByUserId === me,
    reviewedAt: iso(c.reviewedAt),
  };
}

export async function adminAiRoutes(app: FastifyInstance) {
  const { ai, env, realtime } = app.services;

  async function controlCentre(tx: Tx, days: number): Promise<AiControlCentre> {
    const models = await tx.select().from(aiModels).orderBy(asc(aiModels.provider), asc(aiModels.modelId));
    const approvals = await tx.select().from(aiModelRouteApprovals).where(isNull(aiModelRouteApprovals.revokedAt));
    const routes = await tx.select({ r: aiRoutes, flag: featureFlags.enabled }).from(aiRoutes).innerJoin(featureFlags, eq(featureFlags.key, aiRoutes.featureFlag)).orderBy(asc(aiRoutes.key));
    const candidates = await tx.select().from(aiRouteCandidates).orderBy(asc(aiRouteCandidates.tier), asc(aiRouteCandidates.priority));
    const plans = await tx.select({ code: billingPlans.code, tier: billingPlans.aiModelTier }).from(billingPlans).orderBy(asc(billingPlans.sortOrder));
    const planQuotas = await tx.select().from(aiPlanQuotas);
    const roleQuotas = await tx.select().from(aiRoleQuotas);
    const planBudgets = await tx.select().from(aiPlanBudgets);
    const alerts = await tx.select().from(aiBudgetAlerts).orderBy(desc(aiBudgetAlerts.createdAt)).limit(20);
    const [budget] = await tx.select().from(aiBudget);
    const spend = await tx.execute<{ n: string | null }>(sql`select app.ai_month_spend_for_staff()::text as n`);
    const planSpend = await tx.execute<{ plan: string; cost: string }>(sql`
      select plan_code::text as plan, coalesce(sum(cost_micros), 0)::text as cost from app.ai_usage
      where reserved_at >= date_trunc('month', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo' and plan_code is not null group by 1`);
    const byModel = await tx.execute<{ provider: AiProviderCode; model_id: string; requests: number; input_tokens: string; output_tokens: string; cost: string; estimated: boolean }>(sql`
      select provider::text as provider, model_id, count(*)::int as requests, coalesce(sum(input_tokens), 0)::text as input_tokens,
             coalesce(sum(output_tokens), 0)::text as output_tokens, coalesce(sum(cost_micros), 0)::text as cost, bool_or(cost_estimated) as estimated
      from app.ai_usage where reserved_at >= now() - make_interval(days => ${days}) and provider is not null
      group by provider, model_id order by 6 desc`);
    const byOutcome = await tx.execute<{ outcome: string; requests: number }>(sql`
      select coalesce(outcome, status::text) as outcome, count(*)::int as requests from app.ai_usage
      where reserved_at >= now() - make_interval(days => ${days}) group by 1 order by 2 desc`);
    const users = await tx.execute<{ n: number }>(sql`select count(distinct user_id)::int as n from app.ai_usage where reserved_at >= now() - make_interval(days => ${days})`);
    const limits = (rows: { metric: AiMetric; weeklyLimit: number }[]) => Object.fromEntries(rows.map((q) => [q.metric, q.weeklyLimit])) as Record<AiMetric, number>;
    const byId = new Map(models.map((m) => [m.id, m]));

    return {
      providers: AI_PROVIDERS.map((code) => ({
        code,
        configured: ai[code].status === 'CONFIGURED',
        realtimeConfigured: realtime[code].status === 'CONFIGURED',
        realtimeAdapter: code === 'OPENAI' || code === 'SIMULATED',
        productionAllowed: code !== 'SIMULATED',
        envVars: PROVIDER_ENV_VARS[code],
      })),
      models: models.map((m) => modelDto(m, approvals)),
      routes: routes.map(({ r, flag }) => ({
        key: r.key,
        description: r.description,
        featureFlag: r.featureFlag,
        featureEnabled: flag,
        metric: r.metric,
        enabled: r.enabled,
        maxOutputTokens: r.maxOutputTokens,
        carriesPatientData: r.carriesPatientData,
        requiredCapability: r.requiredCapability as AiCapability,
        requireClinicalApproval: r.requireClinicalApproval,
        complexityRouting: r.complexityRouting,
        simpleMaxChars: r.simpleMaxChars,
        maxConcurrentPerUser: r.maxConcurrentPerUser,
        candidates: candidates
          .filter((c) => c.routeKey === r.key)
          .map((c): AiRouteCandidate => {
            const m = byId.get(c.model)!;
            const blockers: AiRouteCandidate['blockers'] = [];
            if (!c.enabled) blockers.push('DISABLED');
            if (!m.active) blockers.push('MODEL_INACTIVE');
            // Voice routes need the provider's realtime adapter, not only its text key.
            if ((r.requiredCapability === 'REALTIME_VOICE' ? realtime : ai)[m.provider].status !== 'CONFIGURED') blockers.push('PROVIDER_NOT_CONFIGURED');
            if (!m.capabilities.includes(r.requiredCapability)) blockers.push('CAPABILITY_MISSING');
            if (r.carriesPatientData && m.provider !== 'SIMULATED' && !m.patientDataApprovedAt) blockers.push('NO_PATIENT_DATA_APPROVAL');
            if (r.requireClinicalApproval && !approvals.some((a) => a.routeKey === r.key && a.model === m.id)) blockers.push('NO_CLINICAL_APPROVAL');
            return { id: c.id, tier: c.tier, modelId: c.model, complexity: c.complexity as AiRouteCandidate['complexity'], language: c.language as AiRouteCandidate['language'], priority: c.priority, effort: c.effort as AiRouteCandidate['effort'], enabled: c.enabled, blockers };
          }),
      })),
      quotas: {
        plans: plans.map((p) => ({ plan: p.code, tier: p.tier, limits: limits(planQuotas.filter((q) => q.planCode === p.code)) })),
        clinicians: (['DOCTOR', 'NURSE'] as const).map((role) => ({ role, limits: limits(roleQuotas.filter((q) => q.role === role)) })),
      },
      usage: {
        monthLimitMicros: budget?.monthlyLimitMicros ?? null,
        monthSpendMicros: Number(spend.rows[0]?.n ?? 0),
        days,
        byModel: byModel.rows.map((r) => ({ provider: r.provider, modelId: r.model_id, requests: r.requests, inputTokens: Number(r.input_tokens), outputTokens: Number(r.output_tokens), costMicros: Number(r.cost), estimated: r.estimated })),
        byOutcome: byOutcome.rows,
        activeUsers: users.rows[0]?.n ?? 0,
      },
      planBudgets: plans.map((p) => {
        const b = planBudgets.find((x) => x.planCode === p.code);
        return { plan: p.code, userMonthlyLimitMicros: b?.userMonthlyLimitMicros ?? null, planMonthlyLimitMicros: b?.planMonthlyLimitMicros ?? null, planMonthSpendMicros: Number(planSpend.rows.find((s) => s.plan === p.code)?.cost ?? 0) };
      }),
      alerts: alerts.map((a) => ({ scope: a.scope as 'COMPANY' | 'PLAN', plan: a.planCode, month: String(a.month), thresholdPct: a.thresholdPct, spendMicros: a.spendMicros, limitMicros: a.limitMicros, createdAt: iso(a.createdAt)! })),
    };
  }

  app.get('/control-centre', async (request): Promise<AiControlCentre> => {
    const principal = await requireAnyPermission(request, 'ai.config.manage', 'ai.usage.read');
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(366).default(30) }), request.query);
    return inContext(request, principal, (tx) => controlCentre(tx, days));
  });

  // ---------------------------------------------------------------- models
  app.post('/models', async (request, reply) => {
    const principal = await requirePermission(request, 'ai.config.manage');
    const b = parse(aiModelCreateBody, request.body);
    const row = await inContext(request, principal, async (tx) => {
      // New models start inactive, unverified and without data-processing approval (database triggers).
      const [m] = await tx
        .insert(aiModels)
        .values({
          provider: b.provider,
          modelId: b.modelId,
          displayName: b.displayName,
          inputPriceMicros: b.inputPriceMicros,
          outputPriceMicros: b.outputPriceMicros,
          cacheReadPriceMicros: b.cacheReadPriceMicros ?? null,
          audioInputPriceMicros: b.audioInputPriceMicros ?? null,
          audioOutputPriceMicros: b.audioOutputPriceMicros ?? null,
          audioCacheReadPriceMicros: b.audioCacheReadPriceMicros ?? null,
          priceSource: b.priceSource,
          capabilities: b.capabilities,
          medicalSpecialized: b.medicalSpecialized,
          hosting: b.hosting,
          dataRegion: b.dataRegion ?? null,
          notes: b.notes ?? null,
        })
        .returning();
      return modelDto(m!, []);
    });
    return reply.status(201).send(row);
  });

  app.patch('/models/:id', async (request) => {
    const principal = await requirePermission(request, 'ai.config.manage');
    const { id } = parse(uuidParam, request.params);
    const { verifyPrice, patientDataApprovalRef, ...b } = parse(aiModelPatchBody, request.body);
    // The database also refuses this without ai.data.approve; checked here for a clear error.
    if (patientDataApprovalRef !== undefined) await requirePermission(request, 'ai.data.approve');
    return inContext(request, principal, async (tx) => {
      const set: Partial<typeof aiModels.$inferInsert> = { ...b };
      // The database records who verified and when; a later price edit clears the verification.
      if (verifyPrice === true) set.priceVerifiedAt = new Date().toISOString();
      if (verifyPrice === false) set.priceVerifiedAt = null;
      if (patientDataApprovalRef !== undefined) {
        set.patientDataApprovalRef = patientDataApprovalRef;
        set.patientDataApprovedAt = patientDataApprovalRef === null ? null : new Date().toISOString();
      }
      const [m] = await tx.update(aiModels).set(set).where(eq(aiModels.id, id)).returning();
      if (!m) throw notFound('Model');
      const approvals = await tx.select().from(aiModelRouteApprovals).where(and(eq(aiModelRouteApprovals.model, id), isNull(aiModelRouteApprovals.revokedAt)));
      return modelDto(m, approvals);
    });
  });

  // ---------------------------------------------------------------- routes and candidates
  app.patch('/routes/:key', async (request) => {
    const principal = await requirePermission(request, 'ai.config.manage');
    const { key } = parse(z.object({ key: z.string().regex(/^[a-z]+(\.[a-z_]+)+$/) }), request.params);
    const b = parse(aiRoutePatchBody, request.body);
    return inContext(request, principal, async (tx) => {
      if (Object.keys(b).length) {
        const updated = await tx.update(aiRoutes).set(b).where(eq(aiRoutes.key, key)).returning({ key: aiRoutes.key });
        if (!updated.length) throw notFound('Route');
      }
      return controlCentre(tx, 30);
    });
  });

  app.post('/routes/:key/candidates', async (request, reply) => {
    const principal = await requirePermission(request, 'ai.config.manage');
    const { key } = parse(z.object({ key: z.string().regex(/^[a-z]+(\.[a-z_]+)+$/) }), request.params);
    const b = parse(aiCandidateCreateBody, request.body);
    const cc = await inContext(request, principal, async (tx) => {
      await tx.insert(aiRouteCandidates).values({ routeKey: key, tier: b.tier, model: b.modelId, complexity: b.complexity, language: b.language, priority: b.priority, effort: b.effort });
      return controlCentre(tx, 30);
    });
    return reply.status(201).send(cc);
  });

  app.patch('/candidates/:id', async (request) => {
    const principal = await requirePermission(request, 'ai.config.manage');
    const { id } = parse(uuidParam, request.params);
    const b = parse(aiCandidatePatchBody, request.body);
    return inContext(request, principal, async (tx) => {
      const updated = await tx.update(aiRouteCandidates).set(b).where(eq(aiRouteCandidates.id, id)).returning({ id: aiRouteCandidates.id });
      if (!updated.length) throw notFound('Candidate');
      return controlCentre(tx, 30);
    });
  });

  app.delete('/candidates/:id', async (request) => {
    const principal = await requirePermission(request, 'ai.config.manage');
    const { id } = parse(uuidParam, request.params);
    return inContext(request, principal, async (tx) => {
      const deleted = await tx.delete(aiRouteCandidates).where(eq(aiRouteCandidates.id, id)).returning({ id: aiRouteCandidates.id });
      if (!deleted.length) throw notFound('Candidate');
      return controlCentre(tx, 30);
    });
  });

  // ---------------------------------------------------------------- quotas and budgets
  app.patch('/quotas', async (request) => {
    const principal = await requirePermission(request, 'ai.config.manage');
    const b = parse(aiQuotaPatchBody, request.body);
    if (!AI_METRICS.includes(b.metric)) throw unprocessable('INVALID_METRIC');
    return inContext(request, principal, async (tx) => {
      const updated = b.plan
        ? await tx.update(aiPlanQuotas).set({ weeklyLimit: b.weeklyLimit }).where(and(eq(aiPlanQuotas.planCode, b.plan), eq(aiPlanQuotas.metric, b.metric))).returning({ m: aiPlanQuotas.metric })
        : await tx.update(aiRoleQuotas).set({ weeklyLimit: b.weeklyLimit }).where(and(eq(aiRoleQuotas.role, b.role!), eq(aiRoleQuotas.metric, b.metric))).returning({ m: aiRoleQuotas.metric });
      if (!updated.length) throw notFound('Quota');
      return controlCentre(tx, 30);
    });
  });

  app.put('/budget', async (request) => {
    const principal = await requirePermission(request, 'ai.config.manage');
    const { monthlyLimitMicros } = parse(aiBudgetBody, request.body);
    return inContext(request, principal, async (tx) => {
      await tx.update(aiBudget).set({ monthlyLimitMicros }).where(eq(aiBudget.id, true));
      return controlCentre(tx, 30);
    });
  });

  app.put('/plan-budgets', async (request) => {
    const principal = await requirePermission(request, 'ai.config.manage');
    const b = parse(aiPlanBudgetBody, request.body);
    return inContext(request, principal, async (tx) => {
      await tx.update(aiPlanBudgets).set({ userMonthlyLimitMicros: b.userMonthlyLimitMicros, planMonthlyLimitMicros: b.planMonthlyLimitMicros }).where(eq(aiPlanBudgets.planCode, b.plan));
      return controlCentre(tx, 30);
    });
  });

  /** Free metadata call (no generation is billed): proves the key works and the model exists. */
  app.post('/providers/:code/health-check', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => {
    const principal = await requirePermission(request, 'ai.config.manage');
    const { code } = parse(z.object({ code: z.enum(AI_PROVIDERS) }), request.params);
    const { modelId } = parse(z.object({ modelId: z.string().regex(/^[A-Za-z0-9._:/-]{2,100}$/) }), request.body);
    const result = await ai[code].healthCheck(modelId);
    await inContext(request, principal, (tx) =>
      audit(tx, { actorUserId: principal.userId, action: 'ai.provider.health_checked', entityType: 'ai_provider', entityId: code, requestId: request.id, metadata: { modelId, ok: result.ok, detail: result.detail } }),
    );
    return { provider: code, configured: ai[code].status === 'CONFIGURED', ...result, environment: env.NODE_ENV };
  });

  // ---------------------------------------------------------------- evaluation suite
  async function summary(tx: Tx, runId: string): Promise<AiEvalSummary> {
    const r = await tx.execute<{ cases: number; done: number; automated_pass_rate: string | null; reviewed: number; unsafe: number; hallucinations: number; mean_accuracy: string | null; mean_arabic_quality: string | null; mean_latency_ms: string | null }>(
      sql`select * from app.ai_eval_summary(${runId}::uuid)`,
    );
    const s = r.rows[0];
    return {
      cases: s?.cases ?? 0,
      done: s?.done ?? 0,
      automatedPassRate: num(s?.automated_pass_rate),
      reviewed: s?.reviewed ?? 0,
      unsafe: s?.unsafe ?? 0,
      hallucinations: s?.hallucinations ?? 0,
      meanAccuracy: num(s?.mean_accuracy),
      meanArabicQuality: num(s?.mean_arabic_quality),
      meanLatencyMs: num(s?.mean_latency_ms),
    };
  }
  async function runDto(tx: Tx, r: typeof aiEvalRuns.$inferSelect): Promise<AiEvalRun> {
    return {
      id: r.id,
      modelRef: r.model,
      provider: r.provider,
      modelId: r.modelId,
      routeKey: r.routeKey,
      policyVersion: r.policyVersion,
      status: r.status as AiEvalRun['status'],
      failure: r.failure,
      caseCount: r.caseCount,
      completedCount: r.completedCount,
      automatedPassCount: r.automatedPassCount,
      costMicros: r.costMicros,
      costEstimated: r.costEstimated,
      startedAt: iso(r.startedAt)!,
      finishedAt: iso(r.finishedAt),
      summary: await summary(tx, r.id),
    };
  }

  app.get('/evaluation', async (request): Promise<AiEvaluationOverview> => {
    const principal = await requireAnyPermission(request, 'ai.eval.manage', 'ai.clinical.review', 'ai.config.manage');
    return inContext(request, principal, async (tx) => {
      const cases = await tx.select().from(aiEvalCases).orderBy(asc(aiEvalCases.language), asc(aiEvalCases.code));
      const runs = await tx.select().from(aiEvalRuns).orderBy(desc(aiEvalRuns.startedAt)).limit(50);
      const approvals = await tx.select({ a: aiModelRouteApprovals, provider: aiModels.provider, modelId: aiModels.modelId }).from(aiModelRouteApprovals).innerJoin(aiModels, eq(aiModels.id, aiModelRouteApprovals.model)).orderBy(desc(aiModelRouteApprovals.approvedAt)).limit(50);
      const [t] = (await tx.execute<{ value: AiEvaluationOverview['thresholds'] }>(sql`select value from app.settings where key = 'ai.eval.thresholds'`)).rows;
      return {
        cases: cases.map((c) => caseDto(c, principal.userId)),
        runs: await Promise.all(runs.map((r) => runDto(tx, r))),
        approvals: approvals.map(({ a, provider, modelId }) => ({ id: a.id, routeKey: a.routeKey, modelRef: a.model, modelId, provider, runId: a.runId, policyVersion: a.policyVersion, note: a.note, approvedAt: iso(a.approvedAt)!, revokedAt: iso(a.revokedAt), revokeNote: a.revokeNote })),
        thresholds: t!.value,
        currentPolicyVersion: policyVersionFor('patient.chat'),
        currentPolicyVersions: Object.fromEntries(['patient.chat', 'patient.voice', 'patient.document', 'patient.health_summary'].map((k) => [k, policyVersionFor(k)])),
      };
    });
  });

  app.post('/evaluation/cases', async (request, reply) => {
    const principal = await requirePermission(request, 'ai.eval.manage');
    const b = parse(aiEvalCaseBody, request.body);
    const problem = evalCaseProblem({ routeKey: b.routeKey, checks: b.checks, documentSpec: b.documentSpec ?? null, summarySpec: b.summarySpec ?? null });
    if (problem) throw unprocessable('AI_EVAL_CASE_INVALID', problem);
    const row = await inContext(request, principal, async (tx) => {
      const [c] = await tx
        .insert(aiEvalCases)
        .values({ code: b.code, category: b.category, language: b.language, prompt: b.prompt, context: b.context ?? null, expectedBehavior: b.expectedBehavior, checks: b.checks, routeKey: b.routeKey, documentSpec: b.documentSpec ?? null, summarySpec: b.summarySpec ?? null })
        .returning();
      return caseDto(c!, principal.userId);
    });
    return reply.status(201).send(row);
  });

  app.patch('/evaluation/cases/:id', async (request) => {
    const principal = await requirePermission(request, 'ai.eval.manage');
    const { id } = parse(uuidParam, request.params);
    const b = parse(aiEvalCasePatchBody, request.body);
    return inContext(request, principal, async (tx) => {
      const [old] = await tx.select().from(aiEvalCases).where(eq(aiEvalCases.id, id));
      if (!old) throw notFound('Case');
      const problem = evalCaseProblem({
        routeKey: b.routeKey ?? old.routeKey,
        checks: b.checks ?? old.checks,
        documentSpec: b.documentSpec === undefined ? old.documentSpec : b.documentSpec,
        summarySpec: b.summarySpec === undefined ? old.summarySpec : b.summarySpec,
      });
      if (problem) throw unprocessable('AI_EVAL_CASE_INVALID', problem);
      // Any content change makes a new version that needs clinical review again (database trigger).
      const [c] = await tx
        .update(aiEvalCases)
        .set({
          ...b,
          context: b.context === undefined ? undefined : (b.context ?? null),
          documentSpec: b.documentSpec === undefined ? undefined : (b.documentSpec ?? null),
          summarySpec: b.summarySpec === undefined ? undefined : (b.summarySpec ?? null),
        })
        .where(eq(aiEvalCases.id, id))
        .returning();
      if (!c) throw notFound('Case');
      return caseDto(c, principal.userId);
    });
  });

  app.post('/evaluation/cases/:id/review', async (request) => {
    const principal = await requireAnyPermission(request, 'ai.clinical.review', 'ai.eval.manage');
    const { id } = parse(uuidParam, request.params);
    const { decision } = parse(z.object({ decision: z.enum(['REVIEWED', 'RETIRED']) }), request.body);
    return inContext(request, principal, async (tx) => {
      await tx.execute(sql`select app.ai_eval_case_review(${id}::uuid, ${decision})`);
      const [c] = await tx.select().from(aiEvalCases).where(eq(aiEvalCases.id, id));
      return caseDto(c!, principal.userId);
    });
  });

  app.post('/evaluation/runs', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const principal = await requirePermission(request, 'ai.eval.manage');
    const { modelId, routeKey } = parse(z.object({ modelId: z.string().uuid(), routeKey: z.string().regex(/^[a-z]+(\.[a-z_]+)+$/).default('patient.chat') }), request.body);
    const started = await inContext(request, principal, async (tx) => {
      const [m] = await tx.select().from(aiModels).where(eq(aiModels.id, modelId));
      if (!m) throw notFound('Model');
      const [route] = await tx.select().from(aiRoutes).where(eq(aiRoutes.key, routeKey));
      if (!route) throw notFound('Route');
      if (route.requiredCapability && !m.capabilities.includes(route.requiredCapability)) throw unprocessable('AI_MODEL_LACKS_CAPABILITY', `${m.modelId} is not registered for ${route.requiredCapability}`);
      // Document cases are synthetic PDFs: the adapter must be able to send one.
      if (routeKey === 'patient.document' && !ATTACHMENT_SUPPORT[m.provider].includes('application/pdf')) throw unprocessable('AI_PROVIDER_CANNOT_READ_PDF', `${m.provider} cannot be sent a PDF by this server`);
      // Voice models are evaluated in text mode over the same realtime interface they serve with.
      const voice = route.requiredCapability === 'REALTIME_VOICE';
      const impl = voice ? { complete: realtime[m.provider].completeText.bind(realtime[m.provider]), status: realtime[m.provider].status } : ai[m.provider];
      if (impl.status !== 'CONFIGURED') throw unprocessable('AI_PROVIDER_NOT_CONFIGURED', `${m.provider} is not configured on this server${voice ? ' for realtime voice' : ''}`);
      const r = await tx.execute<{ id: string }>(sql`select app.ai_eval_start(${modelId}::uuid, ${routeKey}, ${policyVersionFor(routeKey)}) as id`);
      const [run] = await tx.select().from(aiEvalRuns).where(eq(aiEvalRuns.id, r.rows[0]!.id));
      return { run: run!, complete: impl.complete, model: m.modelId, maxTokens: route.maxOutputTokens };
    });
    // Runs in the background as the administrator who started it; progress is visible in the console.
    void executeEvaluation(app, contextFor(request, principal), started.run.id, started.complete, started.model, started.maxTokens, policyFor(routeKey));
    return reply.status(202).send(await inContext(request, principal, (tx) => runDto(tx, started.run)));
  });

  app.get('/evaluation/runs/:id', async (request): Promise<AiEvalRun & { results: AiEvalResult[] }> => {
    const principal = await requireAnyPermission(request, 'ai.eval.manage', 'ai.clinical.review', 'ai.config.manage');
    const { id } = parse(uuidParam, request.params);
    return inContext(request, principal, async (tx) => {
      const [run] = await tx.select().from(aiEvalRuns).where(eq(aiEvalRuns.id, id));
      if (!run) throw notFound('Run');
      const rows = await tx
        .select({ r: aiEvalResults, prompt: aiEvalCases.prompt, expected: aiEvalCases.expectedBehavior, currentVersion: aiEvalCases.version })
        .from(aiEvalResults)
        .innerJoin(aiEvalCases, eq(aiEvalCases.id, aiEvalResults.caseId))
        .where(eq(aiEvalResults.runId, id))
        .orderBy(asc(aiEvalResults.language), asc(aiEvalResults.caseCode));
      return {
        ...(await runDto(tx, run)),
        results: rows.map(({ r, prompt, expected, currentVersion }) => ({
          id: r.id,
          caseCode: r.caseCode,
          caseVersion: r.caseVersion,
          category: r.category as AiEvalResult['category'],
          language: r.language as 'ar' | 'en',
          status: r.status as AiEvalResult['status'],
          // The prompt shown is the version that was run; a later edit is flagged by the version number.
          prompt: currentVersion === r.caseVersion ? prompt : null,
          expectedBehavior: currentVersion === r.caseVersion ? expected : null,
          output: r.output,
          outcome: r.outcome,
          latencyMs: r.latencyMs,
          costMicros: r.costMicros,
          automatedChecks: r.automatedChecks as AiEvalResult['automatedChecks'],
          automatedPass: r.automatedPass,
          review: r.reviewedAt
            ? { accuracy: r.accuracy!, hallucination: r.hallucination!, unsafe: r.unsafe!, arabicQuality: r.arabicQuality, notes: r.reviewNotes, reviewedAt: iso(r.reviewedAt)! }
            : null,
        })),
      };
    });
  });

  app.post('/evaluation/results/:id/review', async (request) => {
    const principal = await requirePermission(request, 'ai.clinical.review');
    const { id } = parse(uuidParam, request.params);
    const b = parse(aiEvalResultReviewBody, request.body);
    await inContext(request, principal, (tx) =>
      tx.execute(sql`select app.ai_eval_review_result(${id}::uuid, ${b.accuracy}, ${b.hallucination}, ${b.unsafe}, ${b.arabicQuality ?? null}::int, ${b.notes ?? ''})`),
    );
    return { ok: true };
  });

  app.post('/evaluation/approvals', async (request, reply) => {
    const principal = await requirePermission(request, 'ai.clinical.review');
    const b = parse(z.object({ routeKey: z.string().regex(/^[a-z]+(\.[a-z_]+)+$/), modelId: z.string().uuid(), runId: z.string().uuid(), note: z.string().trim().min(3).max(1000) }), request.body);
    const id = await inContext(request, principal, async (tx) => (await tx.execute<{ id: string }>(sql`select app.ai_approve_model_for_route(${b.routeKey}, ${b.modelId}::uuid, ${b.runId}::uuid, ${b.note}) as id`)).rows[0]!.id);
    return reply.status(201).send({ id });
  });

  app.post('/evaluation/approvals/:id/revoke', async (request) => {
    const principal = await requireAnyPermission(request, 'ai.clinical.review', 'ai.config.manage');
    const { id } = parse(uuidParam, request.params);
    const { note } = parse(z.object({ note: z.string().trim().min(3).max(1000) }), request.body);
    await inContext(request, principal, (tx) => tx.execute(sql`select app.ai_revoke_model_approval(${id}::uuid, ${note})`));
    return { ok: true };
  });

  // ---------------------------------------------------------------- reported AI answers (ai.safety.review)
  const reportItem = (r: typeof aiResponseReports.$inferSelect, me: string): AiReportListItem => ({
    id: r.id,
    reason: r.reason as AiReportListItem['reason'],
    status: r.status as AiReportListItem['status'],
    resolution: r.resolution as AiReportListItem['resolution'],
    messageKind: r.messageKind,
    provider: r.provider,
    modelId: r.modelId,
    routeKey: r.routeKey,
    locale: r.locale,
    assignedToMe: r.assignedToUserId === me,
    redacted: Boolean(r.redactedAt),
    createdAt: iso(r.createdAt)!,
    updatedAt: iso(r.updatedAt)!,
  });

  app.get('/reports', async (request): Promise<AiReportListItem[]> => {
    const principal = await requirePermission(request, 'ai.safety.review');
    const { status } = parse(z.object({ status: z.enum(['ACTIVE', 'OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED', 'ALL']).default('ACTIVE') }), request.query);
    return inContext(request, principal, async (tx) => {
      const where = status === 'ALL' ? undefined : status === 'ACTIVE' ? inArray(aiResponseReports.status, ['OPEN', 'IN_REVIEW']) : eq(aiResponseReports.status, status);
      const rows = await tx.select().from(aiResponseReports).where(where).orderBy(asc(aiResponseReports.createdAt)).limit(200);
      return rows.map((r) => reportItem(r, principal.userId));
    });
  });

  app.get('/reports/:id', async (request): Promise<AiReportDetail> => {
    const principal = await requirePermission(request, 'ai.safety.review');
    const { id } = parse(uuidParam, request.params);
    return inContext(request, principal, async (tx) => {
      const [r] = await tx.select().from(aiResponseReports).where(eq(aiResponseReports.id, id));
      if (!r) throw notFound('Report');
      // Content only through the audited function.
      const [content] = (await tx.execute<{ answer_snapshot: string; question_snapshot: string | null; note: string | null }>(sql`select * from app.ai_report_detail(${id}::uuid)`)).rows;
      const events = await tx.select().from(aiReportEvents).where(eq(aiReportEvents.reportId, id)).orderBy(asc(aiReportEvents.createdAt));
      return {
        ...reportItem(r, principal.userId),
        answer: content!.answer_snapshot,
        question: content!.question_snapshot,
        note: content!.note,
        events: events.map((e) => ({ event: e.event, note: e.note, createdAt: iso(e.createdAt)!, byMe: e.actorUserId === principal.userId })),
      };
    });
  });

  app.post('/reports/:id/transition', async (request) => {
    const principal = await requirePermission(request, 'ai.safety.review');
    const { id } = parse(uuidParam, request.params);
    const b = parse(aiReportTransitionBody, request.body);
    await inContext(request, principal, (tx) => tx.execute(sql`select app.ai_report_transition(${id}::uuid, ${b.status}, ${b.resolution ?? null}, ${b.note ?? null})`));
    return { ok: true };
  });

}
