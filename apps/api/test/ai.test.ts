/**
 * AI gateway + patient assistant (migrations 0010–0011). No real provider is called: the
 * ANTHROPIC slot is replaced by a scripted stand-in, so these tests prove the gateway's own rules
 * (gates, atomic reservation, settlement and cost from verified prices, release on failure,
 * fallback, emergencies, privacy) — not any provider's behaviour.
 */
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { AiProviderError, type AiProvider, type AiRequest, type AiResult } from '../src/integrations/ai';
import { buildServer } from '../src/server';
import { grantRole, ownerPool, PASSWORD, signUp, type Client } from './helpers';

type Script = (req: AiRequest) => AiResult | Promise<AiResult>;
const calls: AiRequest[] = [];
let script: Script = () => ({ outcome: 'ANSWERED', text: 'General wound-care information.', servedModel: 'claude-opus-5-5', usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0 } });
const scripted: AiProvider = {
  code: 'ANTHROPIC',
  status: 'CONFIGURED',
  complete: async (req) => {
    calls.push(req);
    return script(req);
  },
  healthCheck: async () => ({ ok: true, detail: 'scripted', checkedAt: new Date().toISOString() }),
};

let app: FastifyInstance;
let owner: pg.Pool;
let admin: Client;

async function aiConsent(c: Client) {
  const state = await c.req({ method: 'GET', url: '/v1/me/consents' });
  const ai = state.json.consents.find((x: { type: string }) => x.type === 'AI_ASSISTANT_PROCESSING');
  const r = await c.req({ method: 'POST', url: '/v1/me/consents', body: { consents: [{ type: 'AI_ASSISTANT_PROCESSING', version: ai.currentVersion, granted: true }], source: 'web', locale: 'en' } });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
}

/** A patient who may use the assistant before launch (internal test account) and has consented. */
async function tester(health = true) {
  const c = await signUp(app, { role: 'PATIENT' });
  await c.req({ method: 'GET', url: '/v1/me' }); // creates the profile row
  await owner.query("update app.user_profiles set account_kind = 'INTERNAL_TEST' where user_id = $1", [c.userId]);
  if (health) await aiConsent(c);
  return c;
}

async function conversation(c: Client, body: Record<string, unknown> = {}) {
  const r = await c.req({ method: 'POST', url: '/v1/ai/conversations', body });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json.id as string;
}

const send = (c: Client, id: string, content: string) => c.req({ method: 'POST', url: `/v1/ai/conversations/${id}/messages`, body: { content } });

beforeAll(async () => {
  app = await buildServer(loadEnv(process.env), { ai: { ANTHROPIC: scripted } });
  await app.ready();
  owner = ownerPool();
  admin = await signUp(app);
  await grantRole(admin.userId, 'ADMIN');
  // Operator setup an administrator would do: verify the price, activate, enable the route, approve a budget.
  await owner.query("update app.ai_models set price_verified_at = now(), active = true where provider = 'ANTHROPIC' and model_id = 'claude-opus-5-5'");
  await owner.query("update app.ai_routes set enabled = true where key = 'patient.chat'");
  await owner.query('update app.ai_budget set monthly_limit_micros = 50000000');
});
beforeEach(() => {
  calls.length = 0;
  script = () => ({ outcome: 'ANSWERED', text: 'General wound-care information.', servedModel: 'claude-opus-5-5', usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0 } });
});
afterAll(async () => {
  await owner.query("update app.ai_routes set enabled = false where key = 'patient.chat'");
  await owner.query("delete from app.ai_route_candidates where route_key = 'patient.chat' and model = (select id from app.ai_models where model_id = 'simulated-echo')");
  await owner.query("update app.ai_plan_quotas set weekly_limit = 50 where plan_code = 'SILVER' and metric = 'CHAT_MESSAGES'");
  await owner.query('update app.ai_budget set monthly_limit_micros = null');
  await owner.end();
  await app.close();
});

describe('who can use the assistant', () => {
  it('is off for everyone while the ai.assistant flag is off (regulatory evidence required to turn it on)', async () => {
    const c = await signUp(app, { role: 'PATIENT' });
    expect((await c.req({ method: 'GET', url: '/v1/ai/assistant' })).json.unavailableReason).toBe('FEATURE_DISABLED');
    expect((await c.req({ method: 'POST', url: '/v1/ai/conversations', body: {} })).status).toBe(409);
    await expect(owner.query("update app.feature_flags set enabled = true where key = 'ai.assistant'")).rejects.toThrow(/regulated_feature_needs_evidence/);
  });

  it('needs the separate AI consent before anything is sent to a provider', async () => {
    const c = await tester(false);
    const s = await c.req({ method: 'GET', url: '/v1/ai/assistant' });
    expect(s.json.unavailableReason).toBe('CONSENT_REQUIRED');
    expect((await c.req({ method: 'POST', url: '/v1/ai/conversations', body: {} })).json.error.code).toBe('AI_CONSENT_REQUIRED');
    await aiConsent(c);
    const ok = await c.req({ method: 'GET', url: '/v1/ai/assistant' });
    expect(ok.json).toMatchObject({ unavailableReason: null, allowance: { metric: 'CHAT_MESSAGES', weeklyLimit: 50, used: 0, plan: 'SILVER', tier: 'BASIC' } });
  });
});

describe('a message', () => {
  it('is answered, metered from the verified price, and counted once', async () => {
    const c = await tester();
    const id = await conversation(c);
    const r = await send(c, id, 'How often should I change a dressing on a small cut?');
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.message).toMatchObject({ role: 'assistant', kind: 'MESSAGE', content: 'General wound-care information.' });
    expect(r.json.allowance).toMatchObject({ used: 1, remaining: 49 });
    // Basic tier → low effort on the configured model; the policy is the system prompt, not user text.
    expect(calls[0]).toMatchObject({ model: 'claude-opus-5-5', effort: 'low' });
    expect(calls[0]!.system).toContain('Never diagnose');
    expect(calls[0]!.endUserRef).not.toContain(c.userId);
    const u = await owner.query('select status, cost_micros, cost_estimated, outcome from app.ai_usage where user_id = $1', [c.userId]);
    // 1,000 input × $4/M + 500 output × $20/M = $0.014 = 14,000 micro-dollars.
    expect(u.rows).toEqual([{ status: 'SETTLED', cost_micros: '14000', cost_estimated: false, outcome: 'ANSWERED' }]);
  });

  it('emergencies get fixed guidance immediately — no model call, nothing counted', async () => {
    const c = await tester();
    const id = await conversation(c);
    for (const text of ['My father has chest pain and is sweating', 'أمي مش قادرة تتنفس']) {
      const r = await send(c, id, text);
      expect(r.json.message.kind).toBe('EMERGENCY_GUIDANCE');
      expect(r.json.message.content).toMatch(/123|١٢٣/);
    }
    expect(calls).toHaveLength(0);
    expect((await c.req({ method: 'GET', url: '/v1/ai/assistant' })).json.allowance.used).toBe(0);
  });

  it('a provider safety refusal is shown as a refusal and not counted (its cost is still recorded)', async () => {
    script = () => ({ outcome: 'REFUSED', text: '', servedModel: 'claude-opus-5-5', usage: { inputTokens: 800, outputTokens: 0, cacheReadTokens: 0 }, refusalCategory: 'bio' });
    const c = await tester();
    const id = await conversation(c);
    const r = await send(c, id, 'something the provider declines');
    expect(r.json.message.kind).toBe('REFUSAL');
    expect(r.json.allowance.used).toBe(0);
    const u = await owner.query('select status, cost_micros from app.ai_usage where user_id = $1', [c.userId]);
    expect(u.rows[0]).toEqual({ status: 'RELEASED', cost_micros: '3200' });
  });

  it('a provider failure gives the allowance back; with a fallback model configured, the fallback answers', async () => {
    script = () => {
      throw new AiProviderError('ANTHROPIC', 'OVERLOADED', 'overloaded');
    };
    const c = await tester();
    const id = await conversation(c);
    const failed = await send(c, id, 'What is a hydrocolloid dressing?');
    expect(failed.status).toBe(503);
    expect(failed.json.error.code).toBe('AI_UNAVAILABLE');
    expect((await c.req({ method: 'GET', url: '/v1/ai/assistant' })).json.allowance.used).toBe(0);

    // A second, lower-priority candidate from another provider (the development simulator here).
    await owner.query("insert into app.ai_route_candidates (route_key, tier, model, priority) select 'patient.chat', 'BASIC', id, 20 from app.ai_models where model_id = 'simulated-echo'");
    const rescued = await send(c, id, 'What is a hydrocolloid dressing?');
    expect(rescued.status).toBe(200);
    expect(rescued.json.message.kind).toBe('SIMULATED');
    expect(rescued.json.message.content).toContain('SIMULATED');
    await owner.query("delete from app.ai_route_candidates where route_key = 'patient.chat' and model = (select id from app.ai_models where model_id = 'simulated-echo')");
  });

  it('a profile summary is shared only when chosen, as data, without name or contact details', async () => {
    const c = await tester();
    const self = await c.req({ method: 'POST', url: '/v1/patients', body: { displayName: 'Distinctive Name', dateOfBirth: '1960-01-01', sex: 'FEMALE', relationship: 'SELF', consentBasis: 'SELF', consentAttested: true, consentStatementVersion: 'v1' } });
    await c.req({ method: 'POST', url: `/v1/patients/${self.json.id}/health-entries`, body: { kind: 'ALLERGY', title: 'Penicillin' } });
    const id = await conversation(c, { patientId: self.json.id });
    await send(c, id, 'Which dressing is gentle on older skin?');
    const first = calls[0]!.messages[0]!.content;
    expect(first).toContain('PROFILE SUMMARY');
    expect(first).toContain('Penicillin');
    expect(first).not.toContain('Distinctive Name');
    expect(calls[0]!.system).not.toContain('Penicillin');
    // Somebody else's profile cannot be attached.
    const other = await tester();
    expect((await other.req({ method: 'POST', url: '/v1/ai/conversations', body: { patientId: self.json.id } })).status).toBe(403);
  });
});

describe('allowances and budget', () => {
  it('weekly allowances are enforced atomically, even for concurrent messages', async () => {
    const set = await admin.req({ method: 'PATCH', url: '/v1/admin/ai/quotas', body: { plan: 'SILVER', metric: 'CHAT_MESSAGES', weeklyLimit: 2 } });
    expect(set.status, JSON.stringify(set.json)).toBe(200);
    const c = await tester();
    const id = await conversation(c);
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => send(c, id, `Question ${i} about dressings`)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    expect(results.filter((r) => r.json?.error?.code === 'AI_QUOTA_EXCEEDED')).toHaveLength(3);
    await admin.req({ method: 'PATCH', url: '/v1/admin/ai/quotas', body: { plan: 'SILVER', metric: 'CHAT_MESSAGES', weeklyLimit: 50 } });
  });

  it('nothing is spent with a real provider without an approved monthly budget, or once it is used up', async () => {
    const c = await tester();
    const id = await conversation(c);
    await owner.query('update app.ai_budget set monthly_limit_micros = null');
    expect((await send(c, id, 'Hello there')).json.error.code).toBe('AI_BUDGET_NOT_SET');
    await owner.query('update app.ai_budget set monthly_limit_micros = 1');
    expect((await send(c, id, 'Hello there')).json.error.code).toBe('AI_BUDGET_EXHAUSTED');
    await owner.query('update app.ai_budget set monthly_limit_micros = 50000000');
    expect(calls).toHaveLength(0);
  });
});

describe('privacy and integrity', () => {
  it('conversations are private: staff cannot read them, and assistant answers cannot be forged', async () => {
    const c = await tester();
    const id = await conversation(c);
    await send(c, id, 'private question about a wound');
    const appPool = new pg.Pool({ connectionString: process.env.DATABASE_URL_APP });
    const cl = await appPool.connect();
    try {
      await cl.query('BEGIN');
      await cl.query("select set_config('app.user_id', $1, true)", [admin.userId]);
      expect((await cl.query('select * from app.ai_messages where conversation_id = $1', [id])).rowCount).toBe(0);
      await cl.query('ROLLBACK');
      await cl.query('BEGIN');
      await cl.query("select set_config('app.user_id', $1, true)", [c.userId]);
      await expect(cl.query("insert into app.ai_messages (conversation_id, user_id, role, content) values ($1, $2, 'assistant', 'forged')", [id, c.userId])).rejects.toThrow(/row-level security/);
    } finally {
      await cl.query('ROLLBACK');
      cl.release();
      await appPool.end();
    }
    // The control centre sees counts and costs, never content.
    const cc = await admin.req({ method: 'GET', url: '/v1/admin/ai/control-centre' });
    expect(cc.status).toBe(200);
    expect(JSON.stringify(cc.json)).not.toContain('private question');
    expect(cc.json.providers.find((p: { code: string }) => p.code === 'OPENAI')).toMatchObject({ configured: false, envVars: ['AI_OPENAI_API_KEY'] });
    expect(cc.json.providers.find((p: { code: string }) => p.code === 'QWEN')).toMatchObject({ configured: false, envVars: ['AI_QWEN_API_KEY', 'AI_QWEN_BASE_URL'] });
  });

  it('deleting the account deletes its conversations', async () => {
    const c = await tester();
    const id = await conversation(c);
    await send(c, id, 'question before leaving');
    const del = await c.req({ method: 'POST', url: '/v1/me/account-deletion', body: { confirmation: 'DELETE', password: PASSWORD } });
    expect(del.status).toBe(200);
    expect((await owner.query('select count(*)::int as n from app.ai_conversations where user_id = $1', [c.userId])).rows[0].n).toBe(0);
    expect((await owner.query('select count(*)::int as n from app.ai_usage where user_id = $1', [c.userId])).rows[0].n).toBe(1);
  });
});

describe('AI control centre', () => {
  it('a model cannot serve traffic until its price is verified; editing the price clears the verification', async () => {
    const created = await admin.req({ method: 'POST', url: '/v1/admin/ai/models', body: { provider: 'OPENAI', modelId: `test-model-${Date.now()}`, displayName: 'Test model', inputPriceMicros: 1_000_000, outputPriceMicros: 2_000_000, priceSource: 'Provider pricing page (test)' } });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ active: false, priceVerifiedAt: null });
    const activate = await admin.req({ method: 'PATCH', url: `/v1/admin/ai/models/${created.json.id}`, body: { active: true } });
    expect(activate.status).toBe(422);
    const verified = await admin.req({ method: 'PATCH', url: `/v1/admin/ai/models/${created.json.id}`, body: { verifyPrice: true, active: true } });
    expect(verified.json).toMatchObject({ active: true });
    expect(verified.json.priceVerifiedAt).not.toBeNull();
    const repriced = await admin.req({ method: 'PATCH', url: `/v1/admin/ai/models/${created.json.id}`, body: { active: false, outputPriceMicros: 3_000_000 } });
    expect(repriced.json.priceVerifiedAt).toBeNull();
    const audited = await owner.query("select count(*)::int as n from app.audit_log where action like 'ai.config.ai_models.%' and actor_user_id = $1", [admin.userId]);
    expect(audited.rows[0].n).toBeGreaterThanOrEqual(3);
  });

  it('only AI administrators can change AI configuration', async () => {
    const p = await signUp(app, { role: 'PATIENT' });
    expect((await p.req({ method: 'GET', url: '/v1/admin/ai/control-centre' })).status).toBe(403);
    expect((await p.req({ method: 'PUT', url: '/v1/admin/ai/budget', body: { monthlyLimitMicros: 1 } })).status).toBe(403);
  });
});
