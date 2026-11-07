import type { AiFinanceOverview, AiMetric, AiProviderCode, BudgetState, PlanCode } from '@ghayarly/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Tx } from '../../db/client';
import { audit } from '../../lib/audit';
import { conflict } from '../../lib/errors';
import { inContext, requirePermission } from '../../lib/principal';
import { parse } from '../../lib/validate';

/**
 * AI Finance Center (ADR 0018). Read-only aggregates over AI metering, budgets and verified revenue
 * records, plus provider-invoice entry for reconciliation. Money never moves from here: there is no
 * payout, withdrawal or transfer endpoint. Simulated development usage is never counted as spend,
 * demo ledger rows never as revenue, and revenue is never estimated.
 */
const CAIRO = 'Africa/Cairo';
const n = (v: string | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

// Boundaries in Cairo local time, as timestamptz.
const DAY0 = sql`(date_trunc('day', now() at time zone ${CAIRO}) at time zone ${CAIRO})`;
const WEEK0 = sql`(date_trunc('week', now() at time zone ${CAIRO}) at time zone ${CAIRO})`;
const MONTH0 = sql`(date_trunc('month', now() at time zone ${CAIRO}) at time zone ${CAIRO})`;

async function overview(tx: Tx, days: number, env: { stores: { apple: { status: string }; google: { status: string } }; payments: { status: string }; checkoutEnabled: boolean }): Promise<AiFinanceOverview> {
  const since = sql`now() - make_interval(days => ${days})`;
  const real = sql`provider is not null and provider <> 'SIMULATED'`;

  // Usage plus company evaluation runs (both are real money when a real provider served them).
  const totals = (
    await tx.execute<{ today: string; week: string; month: string; period: string; estimated: string; unsettled: number; simulated: number }>(sql`
      with spend as (
        select reserved_at as at, cost_micros, cost_estimated, provider::text as provider, status::text as status from app.ai_usage
        union all
        select r.started_at, r.cost_micros, r.cost_estimated, m.provider::text, 'SETTLED' from app.ai_eval_runs r join app.ai_models m on m.id = r.model
      )
      select coalesce(sum(cost_micros) filter (where at >= ${DAY0} and ${real}), 0)::text as today,
             coalesce(sum(cost_micros) filter (where at >= ${WEEK0} and ${real}), 0)::text as week,
             coalesce(sum(cost_micros) filter (where at >= ${MONTH0} and ${real}), 0)::text as month,
             coalesce(sum(cost_micros) filter (where at >= ${since} and ${real}), 0)::text as period,
             coalesce(sum(cost_micros) filter (where at >= ${since} and ${real} and cost_estimated), 0)::text as estimated,
             count(*) filter (where at >= ${since} and status = 'RESERVED')::int as unsettled,
             count(*) filter (where at >= ${since} and provider = 'SIMULATED')::int as simulated
      from spend`)
  ).rows[0]!;

  const cal = (await tx.execute<{ elapsed: number; days_in_month: number }>(sql`
    select extract(day from now() at time zone ${CAIRO})::int as elapsed,
           extract(day from (date_trunc('month', now() at time zone ${CAIRO}) + interval '1 month - 1 day'))::int as days_in_month`)).rows[0]!;
  const limitRow = (await tx.execute<{ l: string | null }>(sql`select monthly_limit_micros::text as l from app.ai_budget`)).rows[0];
  const limit = limitRow?.l === null || limitRow?.l === undefined ? null : Number(limitRow.l);
  const monthSpend = n(totals.month);
  // Straight line from the month so far, counting today as a full day elapsed.
  const projected = Math.round((monthSpend / Math.max(1, cal.elapsed)) * cal.days_in_month);
  const usedPct = limit ? Math.round((monthSpend / limit) * 1000) / 10 : null;
  const projectedPct = limit ? Math.round((projected / limit) * 1000) / 10 : null;
  const state: BudgetState =
    limit === null ? 'NO_BUDGET' : monthSpend >= limit ? 'EXCEEDED' : projected > limit ? 'PROJECTED_OVER' : monthSpend >= limit * 0.8 ? 'WARNING' : 'OK';

  const planBudgets = await tx.execute<{ plan: PlanCode; user_limit: string | null; plan_limit: string | null; spend: string }>(sql`
    select p.code::text as plan, b.user_monthly_limit_micros::text as user_limit, b.plan_monthly_limit_micros::text as plan_limit,
           coalesce((select sum(cost_micros) from app.ai_usage u where u.plan_code = p.code and u.reserved_at >= ${MONTH0} and u.provider <> 'SIMULATED'), 0)::text as spend
    from app.billing_plans p left join app.ai_plan_budgets b on b.plan_code = p.code order by p.sort_order`);
  const alerts = await tx.execute<{ scope: 'COMPANY' | 'PLAN'; plan_code: PlanCode | null; month: string; threshold_pct: number; spend_micros: string; limit_micros: string; created_at: string }>(sql`
    select scope, plan_code::text as plan_code, month::text as month, threshold_pct, spend_micros::text, limit_micros::text, created_at::text
    from app.ai_budget_alerts order by created_at desc limit 20`);

  const byModel = await tx.execute<{ provider: AiProviderCode; model_id: string; requests: number; answered: number; failed: number; input_tokens: string; output_tokens: string; cost: string; estimated: string; wasted: string }>(sql`
    select provider::text as provider, model_id, count(*)::int as requests,
           count(*) filter (where outcome = 'ANSWERED')::int as answered,
           count(*) filter (where outcome in ('REFUSED', 'PROVIDER_ERROR', 'INVALID_OUTPUT', 'TRUNCATED'))::int as failed,
           coalesce(sum(input_tokens), 0)::text as input_tokens, coalesce(sum(output_tokens), 0)::text as output_tokens,
           coalesce(sum(cost_micros), 0)::text as cost, coalesce(sum(cost_micros) filter (where cost_estimated), 0)::text as estimated,
           coalesce(sum(cost_micros) filter (where outcome is distinct from 'ANSWERED'), 0)::text as wasted
    from app.ai_usage where reserved_at >= ${since} and ${real}
    group by provider, model_id order by sum(cost_micros) desc nulls last, requests desc`);

  // Sorted numerically by cost (the totals are returned as text to keep bigint precision).
  const byFeature = await tx.execute<{ feature: string; description: string; metric: AiMetric | 'EVALUATION'; requests: number; units: string; cost: string }>(sql`
    select * from (
    select u.route_key as feature, r.description, r.metric::text as metric, count(*)::int as requests,
           coalesce(sum(u.units), 0)::text as units, coalesce(sum(u.cost_micros) filter (where ${real}), 0)::text as cost
    from app.ai_usage u join app.ai_routes r on r.key = u.route_key
    where u.reserved_at >= ${since} group by 1, 2, 3
    union all
    select 'evaluation', 'Company evaluation runs (testing models before approval)', 'EVALUATION', count(*)::int, count(*)::text,
           coalesce(sum(r.cost_micros) filter (where m.provider <> 'SIMULATED'), 0)::text
    from app.ai_eval_runs r join app.ai_models m on m.id = r.model where r.started_at >= ${since}
    ) f order by f.cost::bigint desc, f.requests desc`);

  const byPlan = await tx.execute<{ plan: PlanCode | 'NONE'; users: number; requests: number; cost: string }>(sql`
    select coalesce(plan_code::text, 'NONE') as plan, count(distinct user_id)::int as users, count(*)::int as requests,
           coalesce(sum(cost_micros) filter (where ${real}), 0)::text as cost
    from app.ai_usage where reserved_at >= ${since} group by 1 order by 1`);

  const topUsers = await tx.execute<{ user_id: string; kind: string | null; plan: PlanCode | null; requests: number; cost: string }>(sql`
    select u.user_id, p.account_kind::text as kind, (array_agg(u.plan_code::text order by u.reserved_at desc))[1] as plan,
           count(*)::int as requests, coalesce(sum(u.cost_micros) filter (where u.provider is not null and u.provider <> 'SIMULATED'), 0)::text as cost
    from app.ai_usage u left join app.user_profiles p on p.user_id = u.user_id
    where u.reserved_at >= ${since} group by u.user_id, p.account_kind
    order by coalesce(sum(u.cost_micros) filter (where u.provider is not null and u.provider <> 'SIMULATED'), 0) desc, count(*) desc limit 10`);

  const daily = await tx.execute<{ date: string; requests: number; cost: string }>(sql`
    select (reserved_at at time zone ${CAIRO})::date::text as date, count(*)::int as requests,
           coalesce(sum(cost_micros) filter (where ${real}), 0)::text as cost
    from app.ai_usage where reserved_at >= ${since} group by 1 order by 1`);

  // Metered vs invoiced, per provider and month, for the last six months (latest invoice entry wins).
  const reconciliation = await tx.execute<{ month: string; provider: AiProviderCode; metered: string; invoiced: string | null; reference: string | null; recorded_at: string | null }>(sql`
    with metered as (
      select date_trunc('month', at at time zone ${CAIRO})::date as month, provider, sum(cost_micros) as micros from (
        select reserved_at as at, provider::text as provider, cost_micros from app.ai_usage where ${real}
        union all
        select r.started_at, m.provider::text, r.cost_micros from app.ai_eval_runs r join app.ai_models m on m.id = r.model where m.provider <> 'SIMULATED'
      ) s where at >= (${MONTH0} - interval '5 months') group by 1, 2
    ), invoices as (
      select distinct on (provider, month) month, provider::text as provider, amount_micros, reference, recorded_at
      from app.ai_provider_invoices i where not exists (select 1 from app.ai_provider_invoices x where x.supersedes = i.id)
      order by provider, month, recorded_at desc
    )
    select coalesce(m.month, i.month)::text as month, coalesce(m.provider, i.provider) as provider, coalesce(m.micros, 0)::text as metered,
           i.amount_micros::text as invoiced, i.reference, i.recorded_at::text as recorded_at
    from metered m full join invoices i on i.month = m.month and i.provider = m.provider
    order by 1 desc, 2`);

  const subs = await tx.execute<{ plan_code: PlanCode; source: 'APPLE' | 'GOOGLE' | 'ADMIN_GRANT'; status: string; accounts: number }>(sql`select plan_code::text, source::text, status::text, accounts from app.finance_subscription_counts()`);
  const ledger = await tx.execute<{ entry_type: string; status: string; is_demo: boolean; entries: number; amount_piasters: string }>(sql`select entry_type::text, status::text, is_demo, entries, amount_piasters::text from app.finance_ledger_totals()`);
  // Platform revenue the system itself records: real (non-demo) platform fees that became available or were paid out.
  const visitFees = ledger.rows.filter((r) => !r.is_demo && r.entry_type === 'PLATFORM_FEE' && r.status !== 'PENDING').reduce((a, r) => a + Math.abs(n(r.amount_piasters)), 0);

  const storeState = (s: string) => (s === 'CONFIGURED' ? 'CONFIGURED' : 'NOT_CONFIGURED') as 'CONFIGURED' | 'NOT_CONFIGURED';
  const periodTotal = n(totals.period);
  return {
    generatedAt: new Date().toISOString(),
    timezone: CAIRO,
    days,
    spend: {
      todayMicros: n(totals.today),
      weekMicros: n(totals.week),
      monthMicros: monthSpend,
      periodMicros: periodTotal,
      periodEstimatedMicros: n(totals.estimated),
      unsettledRequests: totals.unsettled,
      simulatedRequests: totals.simulated,
    },
    budget: { monthLimitMicros: limit, monthSpendMicros: monthSpend, usedPct, projectedMonthMicros: projected, projectedPct, state, daysElapsed: cal.elapsed, daysInMonth: cal.days_in_month },
    planBudgets: planBudgets.rows.map((r) => ({ plan: r.plan, userMonthlyLimitMicros: r.user_limit === null ? null : n(r.user_limit), planMonthlyLimitMicros: r.plan_limit === null ? null : n(r.plan_limit), planMonthSpendMicros: n(r.spend) })),
    alerts: alerts.rows.map((a) => ({ scope: a.scope, plan: a.plan_code, month: a.month, thresholdPct: a.threshold_pct, spendMicros: n(a.spend_micros), limitMicros: n(a.limit_micros), createdAt: new Date(a.created_at).toISOString() })),
    byProvider: Object.values(
      byModel.rows.reduce<Record<string, { provider: AiProviderCode; requests: number; costMicros: number; estimatedMicros: number }>>((acc, r) => {
        const p = (acc[r.provider] ??= { provider: r.provider, requests: 0, costMicros: 0, estimatedMicros: 0 });
        p.requests += r.requests;
        p.costMicros += n(r.cost);
        p.estimatedMicros += n(r.estimated);
        return acc;
      }, {}),
    ).sort((a, b) => b.costMicros - a.costMicros),
    byModel: byModel.rows.map((r) => ({
      provider: r.provider,
      modelId: r.model_id,
      requests: r.requests,
      answered: r.answered,
      failed: r.failed,
      inputTokens: n(r.input_tokens),
      outputTokens: n(r.output_tokens),
      costMicros: n(r.cost),
      estimatedMicros: n(r.estimated),
      wastedMicros: n(r.wasted),
      costPerAnsweredMicros: r.answered ? Math.round(n(r.cost) / r.answered) : null,
      costPer1kOutputTokensMicros: n(r.output_tokens) ? Math.round((n(r.cost) / n(r.output_tokens)) * 1000) : null,
    })),
    byFeature: byFeature.rows.map((r) => ({ feature: r.feature, description: r.description, metric: r.metric, requests: r.requests, units: n(r.units), costMicros: n(r.cost) })),
    byPlan: byPlan.rows.map((r) => ({ plan: r.plan, users: r.users, requests: r.requests, costMicros: n(r.cost) })),
    voice: (() => {
      const v = byFeature.rows.find((r) => r.feature === 'patient.voice');
      return { requests: v?.requests ?? 0, minutes: Math.round((n(v?.units) / 60) * 10) / 10, costMicros: n(v?.cost) };
    })(),
    documents: (() => {
      const d = byFeature.rows.find((r) => r.feature === 'patient.document');
      return { requests: d?.requests ?? 0, costMicros: n(d?.cost) };
    })(),
    topUsers: topUsers.rows.map((r) => ({
      userRef: r.user_id.slice(0, 8),
      accountKind: r.kind ?? 'UNKNOWN',
      plan: r.plan,
      requests: r.requests,
      costMicros: n(r.cost),
      sharePct: periodTotal ? Math.round((n(r.cost) / periodTotal) * 1000) / 10 : 0,
    })),
    daily: daily.rows.map((r) => ({ date: r.date, requests: r.requests, costMicros: n(r.cost) })),
    reconciliation: reconciliation.rows.map((r) => ({
      month: r.month,
      provider: r.provider,
      meteredMicros: n(r.metered),
      invoicedMicros: r.invoiced === null ? null : n(r.invoiced),
      varianceMicros: r.invoiced === null ? null : n(r.invoiced) - n(r.metered),
      reference: r.reference,
      recordedAt: r.recorded_at ? new Date(r.recorded_at).toISOString() : null,
    })),
    revenue: {
      recordedPiasters: visitFees,
      sources: [
        { source: 'APP_STORE', state: storeState(env.stores.apple.status), recordedPiasters: null },
        { source: 'GOOGLE_PLAY', state: storeState(env.stores.google.status), recordedPiasters: null },
        { source: 'CARD_PAYMENTS', state: env.payments.status === 'CONFIGURED' ? (env.checkoutEnabled ? 'CONFIGURED' : 'DISABLED') : 'NOT_CONFIGURED', recordedPiasters: null },
        { source: 'VISIT_FEES', state: env.payments.status === 'CONFIGURED' ? 'CONFIGURED' : 'NOT_CONFIGURED', recordedPiasters: visitFees },
      ],
      subscriptions: subs.rows.map((r) => ({ plan: r.plan_code, source: r.source, status: r.status, accounts: r.accounts })),
      ledger: ledger.rows.map((r) => ({ entryType: r.entry_type, status: r.status, isDemo: r.is_demo, entries: r.entries, amountPiasters: n(r.amount_piasters) })),
    },
    limitations: ['NO_STORE_PROCEEDS', ...(env.payments.status === 'CONFIGURED' && env.checkoutEnabled ? [] : (['NO_CARD_PAYMENTS'] as const)), 'NO_FX_CONVERSION', 'OTHER_COSTS_NOT_TRACKED', 'NO_PAYOUTS'],
  };
}

export async function financeRoutes(app: FastifyInstance) {
  const { stores, payments } = app.services;

  app.get('/overview', async (request): Promise<AiFinanceOverview> => {
    const principal = await requirePermission(request, 'finance.read');
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(366).default(30) }), request.query);
    return inContext(request, principal, async (tx) => {
      const checkout = (await tx.execute<{ on: boolean }>(sql`select coalesce((select enabled from app.feature_flags where key = 'commerce.checkout'), false) as on`)).rows[0]!.on;
      return overview(tx, days, { stores, payments, checkoutEnabled: checkout });
    });
  });

  // What a provider actually billed for a month (from its invoice). A correction supersedes the earlier entry.
  app.post('/provider-invoices', async (request, reply) => {
    const principal = await requirePermission(request, 'finance.manage');
    const b = parse(
      z.object({
        provider: z.enum(['ANTHROPIC', 'OPENAI', 'GEMINI', 'QWEN', 'GROK', 'KIMI', 'MEDGEMMA']),
        month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
        amountUsd: z.number().min(0).max(10_000_000),
        reference: z.string().trim().min(3).max(120),
        note: z.string().trim().max(500).optional(),
      }),
      request.body,
    );
    const month = `${b.month}-01`;
    if (new Date(`${month}T00:00:00Z`) > new Date()) throw conflict('MONTH_IN_FUTURE', 'An invoice cannot be entered for a future month');
    const id = await inContext(request, principal, async (tx) => {
      const prev = (await tx.execute<{ id: string }>(sql`
        select i.id from app.ai_provider_invoices i where i.provider = ${b.provider}::app.ai_provider and i.month = ${month}::date
          and not exists (select 1 from app.ai_provider_invoices x where x.supersedes = i.id) order by recorded_at desc limit 1`)).rows[0]?.id ?? null;
      const row = (
        await tx.execute<{ id: string }>(sql`
          insert into app.ai_provider_invoices (provider, month, amount_micros, reference, note, supersedes, recorded_by_user_id)
          values (${b.provider}::app.ai_provider, ${month}::date, ${Math.round(b.amountUsd * 1_000_000)}, ${b.reference}, ${b.note ?? null}, ${prev}::uuid, ${principal.userId})
          returning id`)
      ).rows[0]!;
      await audit(tx, { actorUserId: principal.userId, action: 'finance.provider_invoice.record', entityType: 'ai_provider_invoice', entityId: row.id, requestId: request.id, metadata: { provider: b.provider, month: b.month, amountMicros: Math.round(b.amountUsd * 1_000_000), supersedes: prev } });
      return row.id;
    });
    return reply.status(201).send({ id });
  });
}
