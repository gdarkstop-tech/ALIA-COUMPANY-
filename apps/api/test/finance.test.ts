/**
 * AI Finance Center (migration 0028, ADR 0018). Totals are global in the shared test database, so
 * every money assertion compares the overview before and after inserting known synthetic usage.
 * Proves: who may see and enter finance data; real-provider spend only (simulated usage is never
 * money); estimated costs are labelled; per-user rows are pseudonymous; budget states follow the
 * numbers; invoices are append-only and reconcile against metering; revenue is never estimated
 * and demo ledger rows are never revenue; nothing can move money.
 */
import { randomUUID } from 'node:crypto';
import type { AiFinanceOverview } from '@ghayarly/shared';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestServer, grantRole, ownerPool, signUp, type Client } from './helpers';

let app: FastifyInstance;
let owner: pg.Pool;
let admin: Client;
let patient: Client;
let reviewer: Client;
let originalLimit: string | null = null;

async function overview(c: Client = admin, days = 30): Promise<AiFinanceOverview> {
  const r = await c.req({ method: 'GET', url: `/v1/admin/finance/overview?days=${days}` });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json as AiFinanceOverview;
}

/** One settled metering row, as the gateway would write it. */
async function usage(userId: string, o: { provider: string; model: string; cost: number; estimated?: boolean; route?: string; metric?: string; units?: number; outcome?: string; plan?: string | null; at?: string }) {
  await owner.query(
    `insert into app.ai_usage (user_id, route_key, metric, units, week_start, status, tier, provider, model_id, input_tokens, output_tokens, cost_micros, cost_estimated, outcome, plan_code, reserved_at, settled_at)
     values ($1, $2, $3::app.ai_metric, $4, date_trunc('week', now()), 'SETTLED', 'BASIC', $5::app.ai_provider, $6, 1000, 500, $7, $8, $9, $10::app.plan_code, coalesce($11::timestamptz, now()), now())`,
    [userId, o.route ?? 'patient.chat', o.metric ?? 'CHAT_MESSAGES', o.units ?? 1, o.provider, o.model, o.cost, o.estimated ?? false, o.outcome ?? 'ANSWERED', o.plan === undefined ? 'GOLD' : o.plan, o.at ?? null],
  );
}

beforeAll(async () => {
  app = await createTestServer();
  owner = ownerPool();
  admin = await signUp(app, { name: 'Finance Admin' });
  await grantRole(admin.userId, 'ADMIN');
  patient = await signUp(app, { role: 'PATIENT', name: 'Huda Finance-Test' });
  reviewer = await signUp(app, { name: 'Reviewer' });
  await grantRole(reviewer.userId, 'CLINICAL_REVIEWER');
  originalLimit = (await owner.query<{ l: string | null }>('select monthly_limit_micros::text as l from app.ai_budget')).rows[0]?.l ?? null;
});

afterAll(async () => {
  await owner.query('update app.ai_budget set monthly_limit_micros = $1', [originalLimit]);
  await owner.end();
  await app.close();
});

describe('access', () => {
  it('only finance.read sees the Finance Center; only finance.manage records invoices', async () => {
    expect((await patient.req({ method: 'GET', url: '/v1/admin/finance/overview' })).status).toBe(403);
    expect((await reviewer.req({ method: 'GET', url: '/v1/admin/finance/overview' })).status).toBe(403);
    expect((await patient.req({ method: 'POST', url: '/v1/admin/finance/provider-invoices', body: { provider: 'ANTHROPIC', month: '2026-01', amountUsd: 1, reference: 'INV-1' } })).status).toBe(403);
    const o = await overview();
    expect(o.timezone).toBe('Africa/Cairo');
    // Aggregate functions refuse anyone without the permission, even through the application role.
    const appPool = new pg.Pool({ connectionString: process.env.DATABASE_URL_APP });
    const c = await appPool.connect();
    try {
      await c.query('begin');
      await c.query("select set_config('app.user_id', $1, true)", [patient.userId]);
      await expect(c.query('select * from app.finance_subscription_counts()')).rejects.toThrow('FORBIDDEN');
    } finally {
      await c.query('rollback').catch(() => undefined);
      c.release();
      await appPool.end();
    }
  });

  it('exposes no endpoint that could move money', async () => {
    for (const url of ['/v1/admin/finance/payouts', '/v1/admin/finance/withdrawals', '/v1/admin/finance/transfers']) {
      expect((await admin.req({ method: 'POST', url, body: { amount: 1 } })).status).toBe(404);
    }
    expect((await overview()).limitations).toContain('NO_PAYOUTS');
  });
});

describe('AI costs', () => {
  it('counts real-provider spend only, labels estimated costs and splits by provider, model, feature, plan and user', async () => {
    const before = await overview();
    const user = await signUp(app, { role: 'PATIENT', name: 'Mona Secret-Name' });
    await usage(user.userId, { provider: 'ANTHROPIC', model: 'claude-haiku-5-5', cost: 3_000 });
    await usage(user.userId, { provider: 'ANTHROPIC', model: 'claude-haiku-5-5', cost: 2_000, estimated: true });
    await usage(user.userId, { provider: 'ANTHROPIC', model: 'claude-haiku-5-5', cost: 1_000, outcome: 'INVALID_OUTPUT' });
    await usage(user.userId, { provider: 'OPENAI', model: 'gpt-realtime-2.1-mini', cost: 4_000, route: 'patient.voice', metric: 'VOICE_SECONDS', units: 120, plan: 'PLATINUM' });
    await usage(user.userId, { provider: 'GEMINI', model: 'gemini-3.8-flash', cost: 500, route: 'patient.document', metric: 'ANALYSES' });
    // The development simulator: requests, never money.
    await usage(user.userId, { provider: 'SIMULATED', model: 'simulated-echo', cost: 0 });
    const after = await overview();

    expect(after.spend.todayMicros - before.spend.todayMicros).toBe(10_500);
    expect(after.spend.periodMicros - before.spend.periodMicros).toBe(10_500);
    expect(after.spend.periodEstimatedMicros - before.spend.periodEstimatedMicros).toBe(2_000);
    expect(after.spend.simulatedRequests - before.spend.simulatedRequests).toBe(1);
    expect(after.byProvider.some((p) => p.provider === 'SIMULATED')).toBe(false);

    const model = after.byModel.find((m) => m.modelId === 'claude-haiku-5-5')!;
    const modelBefore = before.byModel.find((m) => m.modelId === 'claude-haiku-5-5');
    expect(model.costMicros - (modelBefore?.costMicros ?? 0)).toBe(6_000);
    expect(model.wastedMicros - (modelBefore?.wastedMicros ?? 0)).toBe(1_000);
    expect(model.costPerAnsweredMicros).not.toBeNull();

    const voiceDelta = after.voice.costMicros - before.voice.costMicros;
    expect(voiceDelta).toBe(4_000);
    expect(after.voice.minutes - before.voice.minutes).toBeCloseTo(2, 1);
    expect(after.documents.costMicros - before.documents.costMicros).toBe(500);
    const platinum = (o: AiFinanceOverview) => o.byPlan.find((p) => p.plan === 'PLATINUM')?.costMicros ?? 0;
    expect(platinum(after) - platinum(before)).toBe(4_000);

    // Per-user rows are pseudonymous: an 8-character reference, no name, e-mail or full id.
    const top = after.topUsers.find((u) => user.userId.startsWith(u.userRef));
    expect(top?.userRef).toHaveLength(8);
    const body = JSON.stringify(after);
    expect(body).not.toContain('Mona Secret-Name');
    expect(body).not.toContain(user.email);
    expect(body).not.toContain(user.userId);
  });

  it('budget state follows the month spend, the limit and the straight-line projection', async () => {
    const o = await overview();
    const spend = o.budget.monthSpendMicros;
    await owner.query('update app.ai_budget set monthly_limit_micros = null');
    expect((await overview()).budget.state).toBe('NO_BUDGET');
    await owner.query('update app.ai_budget set monthly_limit_micros = $1', [Math.max(1, spend - 1)]);
    expect((await overview()).budget.state).toBe('EXCEEDED');
    await owner.query('update app.ai_budget set monthly_limit_micros = $1', [spend * 1000 + 10_000_000]);
    const ok = await overview();
    expect(ok.budget.state).toBe('OK');
    expect(ok.budget.projectedMonthMicros).toBeGreaterThanOrEqual(ok.budget.monthSpendMicros);
    expect(ok.budget.daysElapsed).toBeLessThanOrEqual(ok.budget.daysInMonth);
  });
});

describe('provider invoices', () => {
  it('records what a provider billed, reconciles it with metering, keeps corrections append-only', async () => {
    const lastMonth = (await owner.query<{ m: string }>("select to_char(date_trunc('month', now() at time zone 'Africa/Cairo') - interval '1 month', 'YYYY-MM') as m")).rows[0]!.m;
    const user = await signUp(app, { role: 'PATIENT' });
    await usage(user.userId, { provider: 'KIMI', model: `kimi-test-${randomUUID().slice(0, 4)}`, cost: 7_000_000, at: `${lastMonth}-15T12:00:00Z` });
    const ref = `INV-KIMI-${randomUUID().slice(0, 6)}`;
    const first = await admin.req({ method: 'POST', url: '/v1/admin/finance/provider-invoices', body: { provider: 'KIMI', month: lastMonth, amountUsd: 9, reference: ref } });
    expect(first.status, JSON.stringify(first.json)).toBe(201);
    const fixed = await admin.req({ method: 'POST', url: '/v1/admin/finance/provider-invoices', body: { provider: 'KIMI', month: lastMonth, amountUsd: 8.5, reference: `${ref}-CORR`, note: 'credit note applied' } });
    expect(fixed.status).toBe(201);

    const row = (await overview()).reconciliation.find((r) => r.provider === 'KIMI' && r.month === `${lastMonth}-01`)!;
    expect(row.invoicedMicros).toBe(8_500_000);
    expect(row.reference).toBe(`${ref}-CORR`);
    expect(row.varianceMicros).toBe(8_500_000 - row.meteredMicros);
    expect(row.meteredMicros).toBeGreaterThanOrEqual(7_000_000);

    // Both entries remain; neither can be changed or removed, even by the schema owner.
    expect((await owner.query('select count(*)::int as n from app.ai_provider_invoices where reference like $1', [`${ref}%`])).rows[0].n).toBe(2);
    await expect(owner.query('update app.ai_provider_invoices set amount_micros = 0 where reference = $1', [ref])).rejects.toThrow();
    await expect(owner.query('delete from app.ai_provider_invoices where reference = $1', [ref])).rejects.toThrow();
    expect((await owner.query("select count(*)::int as n from app.audit_log where action = 'finance.provider_invoice.record' and actor_user_id = $1", [admin.userId])).rows[0].n).toBeGreaterThanOrEqual(2);

    // The simulator never bills; invoices for the future do not exist.
    expect((await admin.req({ method: 'POST', url: '/v1/admin/finance/provider-invoices', body: { provider: 'SIMULATED', month: lastMonth, amountUsd: 1, reference: 'INV-SIM' } })).status).toBe(400);
    expect((await admin.req({ method: 'POST', url: '/v1/admin/finance/provider-invoices', body: { provider: 'KIMI', month: '2099-01', amountUsd: 1, reference: 'INV-FUTURE' } })).status).toBe(409);
  });
});

describe('revenue', () => {
  it('reports only verified records: stores and card payments are not connected, demo ledger rows are never revenue', async () => {
    const before = await overview();
    const provider = await signUp(app, { role: 'NURSE', name: 'Ledger Nurse' });
    const prof = { providerType: 'NURSE', displayNameAr: 'ممرضة', displayNameEn: 'Ledger Nurse', gender: 'FEMALE', yearsExperience: 5, governorate: 'CAIRO', city: 'Nasr City' };
    expect((await provider.req({ method: 'PUT', url: '/v1/provider/me', body: prof })).status).toBe(200);
    await owner.query("insert into app.provider_ledger_entries (provider_user_id, entry_type, status, amount_piasters, description, is_demo) values ($1, 'PLATFORM_FEE', 'AVAILABLE', 50000, 'demo fee', true)", [provider.userId]);
    const after = await overview();
    expect(after.revenue.recordedPiasters).toBe(before.revenue.recordedPiasters);
    expect(after.revenue.ledger.some((l) => l.isDemo && l.entryType === 'PLATFORM_FEE')).toBe(true);
    const source = (s: string) => after.revenue.sources.find((x) => x.source === s)!;
    expect(source('APP_STORE')).toMatchObject({ state: 'NOT_CONFIGURED', recordedPiasters: null });
    expect(source('GOOGLE_PLAY')).toMatchObject({ state: 'NOT_CONFIGURED', recordedPiasters: null });
    expect(source('CARD_PAYMENTS').state).toBe('NOT_CONFIGURED');
    expect(after.limitations).toEqual(expect.arrayContaining(['NO_STORE_PROCEEDS', 'NO_CARD_PAYMENTS', 'NO_FX_CONVERSION', 'OTHER_COSTS_NOT_TRACKED']));
  });
});
