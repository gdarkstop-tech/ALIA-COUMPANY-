/**
 * AI control centre (/v1/admin/ai). Configuration only — never credentials: provider keys live in
 * the backend secret manager, and the console can only see whether each provider is configured.
 * Every change is permission-checked and audited by the database (migration 0011).
 */
import {
  AI_METRICS,
  aiBudgetBody,
  aiModelCreateBody,
  aiModelPatchBody,
  aiQuotaPatchBody,
  aiRoutePatchBody,
  type AiControlCentre,
  type AiMetric,
  type AiModelAdmin,
  type AiProviderCode,
} from '@ghayarly/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Tx } from '../../db/client';
import { aiBudget, aiModels, aiPlanQuotas, aiRoleQuotas, aiRouteModels, aiRoutes, billingPlans, featureFlags } from '../../db/schema';
import { audit } from '../../lib/audit';
import { notFound, unprocessable } from '../../lib/errors';
import { inContext, requireAnyPermission, requirePermission } from '../../lib/principal';
import { parse } from '../../lib/validate';

const ENV_VARS: Record<AiProviderCode, string | null> = { ANTHROPIC: 'AI_ANTHROPIC_API_KEY', OPENAI: 'AI_OPENAI_API_KEY', GEMINI: 'AI_GEMINI_API_KEY', SIMULATED: null };
const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);

function modelDto(m: typeof aiModels.$inferSelect): AiModelAdmin {
  return {
    id: m.id,
    provider: m.provider,
    modelId: m.modelId,
    displayName: m.displayName,
    inputPriceMicros: m.inputPriceMicros,
    outputPriceMicros: m.outputPriceMicros,
    cacheReadPriceMicros: m.cacheReadPriceMicros,
    priceSource: m.priceSource,
    priceVerifiedAt: iso(m.priceVerifiedAt),
    active: m.active,
  };
}

export async function adminAiRoutes(app: FastifyInstance) {
  const { ai, env } = app.services;

  async function controlCentre(tx: Tx, days: number): Promise<AiControlCentre> {
    const models = await tx.select().from(aiModels).orderBy(asc(aiModels.provider), asc(aiModels.modelId));
    const routes = await tx.select({ r: aiRoutes, flag: featureFlags.enabled }).from(aiRoutes).innerJoin(featureFlags, eq(featureFlags.key, aiRoutes.featureFlag)).orderBy(asc(aiRoutes.key));
    const tiers = await tx.select().from(aiRouteModels);
    const plans = await tx.select({ code: billingPlans.code, tier: billingPlans.aiModelTier }).from(billingPlans).orderBy(asc(billingPlans.sortOrder));
    const planQuotas = await tx.select().from(aiPlanQuotas);
    const roleQuotas = await tx.select().from(aiRoleQuotas);
    const [budget] = await tx.select().from(aiBudget);
    const spend = await tx.execute<{ n: string | null }>(sql`select app.ai_month_spend_for_staff()::text as n`);
    const byModel = await tx.execute<{ provider: AiProviderCode; model_id: string; requests: number; input_tokens: string; output_tokens: string; cost: string; estimated: boolean }>(sql`
      select provider::text as provider, model_id, count(*)::int as requests, coalesce(sum(input_tokens), 0)::text as input_tokens,
             coalesce(sum(output_tokens), 0)::text as output_tokens, coalesce(sum(cost_micros), 0)::text as cost, bool_or(cost_estimated) as estimated
      from app.ai_usage where reserved_at >= now() - make_interval(days => ${days}) and provider is not null
      group by provider, model_id order by 6 desc`);
    const byOutcome = await tx.execute<{ outcome: string; requests: number }>(sql`
      select coalesce(outcome, status::text) as outcome, count(*)::int as requests from app.ai_usage
      where reserved_at >= now() - make_interval(days => ${days}) group by 1 order by 2 desc`);
    const users = await tx.execute<{ n: number }>(sql`select count(distinct user_id)::int as n from app.ai_usage where reserved_at >= now() - make_interval(days => ${days})`);
    const modelKey = (id: string | null) => (id ? (models.find((m) => m.id === id)?.id ?? null) : null);
    const limits = (rows: { metric: AiMetric; weeklyLimit: number }[]) => Object.fromEntries(rows.map((q) => [q.metric, q.weeklyLimit])) as Record<AiMetric, number>;
    return {
      providers: (['ANTHROPIC', 'OPENAI', 'GEMINI', 'SIMULATED'] as const).map((code) => ({
        code,
        configured: ai[code].status === 'CONFIGURED',
        productionAllowed: code !== 'SIMULATED',
        envVar: ENV_VARS[code],
      })),
      models: models.map(modelDto),
      routes: routes.map(({ r, flag }) => ({
        key: r.key,
        description: r.description,
        featureFlag: r.featureFlag,
        featureEnabled: flag,
        metric: r.metric,
        enabled: r.enabled,
        maxOutputTokens: r.maxOutputTokens,
        tiers: tiers
          .filter((t) => t.routeKey === r.key)
          .map((t) => ({ tier: t.tier, modelId: modelKey(t.model)!, fallbackModelId: modelKey(t.fallbackModel), effort: t.effort as AiControlCentre['routes'][number]['tiers'][number]['effort'] })),
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
    };
  }

  app.get('/control-centre', async (request): Promise<AiControlCentre> => {
    const principal = await requireAnyPermission(request, 'ai.config.manage', 'ai.usage.read');
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(366).default(30) }), request.query);
    return inContext(request, principal, (tx) => controlCentre(tx, days));
  });

  app.post('/models', async (request, reply) => {
    const principal = await requirePermission(request, 'ai.config.manage');
    const b = parse(aiModelCreateBody, request.body);
    const row = await inContext(request, principal, async (tx) => {
      // New models start inactive and unverified (database trigger), whatever is sent.
      const [m] = await tx
        .insert(aiModels)
        .values({ provider: b.provider, modelId: b.modelId, displayName: b.displayName, inputPriceMicros: b.inputPriceMicros, outputPriceMicros: b.outputPriceMicros, cacheReadPriceMicros: b.cacheReadPriceMicros ?? null, priceSource: b.priceSource })
        .returning();
      return modelDto(m!);
    });
    return reply.status(201).send(row);
  });

  app.patch('/models/:id', async (request) => {
    const principal = await requirePermission(request, 'ai.config.manage');
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { verifyPrice, ...b } = parse(aiModelPatchBody, request.body);
    return inContext(request, principal, async (tx) => {
      const set: Partial<typeof aiModels.$inferInsert> = { ...b };
      // The database records who verified and when; a later price edit clears the verification.
      if (verifyPrice === true) set.priceVerifiedAt = new Date().toISOString();
      if (verifyPrice === false) set.priceVerifiedAt = null;
      const [m] = await tx.update(aiModels).set(set).where(eq(aiModels.id, id)).returning();
      if (!m) throw notFound('Model');
      return modelDto(m);
    });
  });

  app.patch('/routes/:key', async (request) => {
    const principal = await requirePermission(request, 'ai.config.manage');
    const { key } = parse(z.object({ key: z.string().regex(/^[a-z]+(\.[a-z_]+)+$/) }), request.params);
    const b = parse(aiRoutePatchBody, request.body);
    return inContext(request, principal, async (tx) => {
      const set: Partial<typeof aiRoutes.$inferInsert> = {};
      if (b.enabled !== undefined) set.enabled = b.enabled;
      if (b.maxOutputTokens !== undefined) set.maxOutputTokens = b.maxOutputTokens;
      if (Object.keys(set).length) {
        const updated = await tx.update(aiRoutes).set(set).where(eq(aiRoutes.key, key)).returning({ key: aiRoutes.key });
        if (!updated.length) throw notFound('Route');
      }
      for (const t of b.tiers ?? []) {
        if (t.fallbackModelId === t.modelId) throw unprocessable('FALLBACK_MUST_DIFFER', 'The fallback must be a different model');
        await tx.update(aiRouteModels).set({ model: t.modelId, fallbackModel: t.fallbackModelId, effort: t.effort }).where(and(eq(aiRouteModels.routeKey, key), eq(aiRouteModels.tier, t.tier)));
      }
      return controlCentre(tx, 30);
    });
  });

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

  /** Free metadata call (no generation is billed): proves the key works and the model exists. */
  app.post('/providers/:code/health-check', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => {
    const principal = await requirePermission(request, 'ai.config.manage');
    const { code } = parse(z.object({ code: z.enum(['ANTHROPIC', 'OPENAI', 'GEMINI', 'SIMULATED']) }), request.params);
    const { modelId } = parse(z.object({ modelId: z.string().regex(/^[A-Za-z0-9._:/-]{2,100}$/) }), request.body);
    const result = await ai[code].healthCheck(modelId);
    await inContext(request, principal, (tx) =>
      audit(tx, { actorUserId: principal.userId, action: 'ai.provider.health_checked', entityType: 'ai_provider', entityId: code, requestId: request.id, metadata: { modelId, ok: result.ok, detail: result.detail } }),
    );
    return { provider: code, configured: ai[code].status === 'CONFIGURED', ...result, environment: env.NODE_ENV };
  });
}
