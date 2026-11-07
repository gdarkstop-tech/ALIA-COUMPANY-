/**
 * AI provider states and the kill switch (migration 0029, ADR 0019). No real provider is called:
 * the QWEN slot is a scripted stand-in whose health check passes or fails on demand, configured
 * with a random key per run so earlier runs' checks never count as "the current key".
 */
import { randomUUID } from 'node:crypto';
import type { AiProviderStatus } from '@ghayarly/shared';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import type { AiProvider } from '../src/integrations/ai';
import { buildServer } from '../src/server';
import { grantRole, ownerPool, signUp, type Client } from './helpers';

let app: FastifyInstance;
let owner: pg.Pool;
let admin: Client;
let healthy = true;
const KEY = `sk-qwen-${randomUUID()}`;
const env = () => loadEnv({ ...process.env, AI_QWEN_API_KEY: KEY, AI_QWEN_BASE_URL: 'https://qwen.example.invalid/compatible-mode/v1' });
const scriptedQwen: AiProvider = {
  code: 'QWEN',
  status: 'CONFIGURED',
  complete: async () => {
    throw new Error('not used in these tests');
  },
  healthCheck: async () => ({ ok: healthy, detail: healthy ? 'model reachable' : 'AUTH: invalid key', checkedAt: new Date().toISOString() }),
};

async function provider(code: string, c: Client = admin): Promise<AiProviderStatus> {
  const r = await c.req({ method: 'GET', url: '/v1/admin/ai/control-centre' });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return (r.json.providers as AiProviderStatus[]).find((p) => p.code === code)!;
}
const check = (code = 'QWEN', modelId = 'qwen-plus') => admin.req({ method: 'POST', url: `/v1/admin/ai/providers/${code}/health-check`, body: { modelId } });
const control = (code: string, body: object, c: Client = admin) => c.req({ method: 'PUT', url: `/v1/admin/ai/providers/${code}/control`, body });

beforeAll(async () => {
  app = await buildServer(env(), { ai: { QWEN: scriptedQwen } });
  await app.ready();
  owner = ownerPool();
  admin = await signUp(app, { name: 'AI Admin' });
  await grantRole(admin.userId, 'ADMIN');
});

afterAll(async () => {
  // Provider controls are global: leave every provider enabled for the other test files.
  await owner.query('update app.ai_provider_controls set enabled = true, reason = null');
  await owner.end();
  await app.close();
});

describe('provider states', () => {
  it('moves NOT_CONFIGURED → CONFIGURED → VERIFIED / ERROR on recorded checks with the current key', async () => {
    expect((await provider('ANTHROPIC')).state).toBe('NOT_CONFIGURED');
    expect((await provider('QWEN')).state).toBe('CONFIGURED');
    // The development simulator is never "verified".
    expect((await provider('SIMULATED')).state).not.toBe('VERIFIED');

    healthy = true;
    expect((await check()).json).toMatchObject({ provider: 'QWEN', ok: true });
    const verified = await provider('QWEN');
    expect(verified.state).toBe('VERIFIED');
    expect(verified.lastCheck).toMatchObject({ ok: true, modelId: 'qwen-plus', currentKey: true });

    healthy = false;
    expect((await check()).json.ok).toBe(false);
    expect((await provider('QWEN')).state).toBe('ERROR');

    // Checks are kept with a key fingerprint, never the key; an unconfigured provider records nothing.
    const rows = (await owner.query<{ key_fingerprint: string; detail: string }>("select key_fingerprint, detail from app.ai_provider_checks where provider = 'QWEN' order by checked_at desc limit 2")).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.key_fingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(rows)).not.toContain(KEY);
    const before = (await owner.query("select count(*)::int as n from app.ai_provider_checks where provider = 'ANTHROPIC'")).rows[0].n;
    await check('ANTHROPIC', 'claude-haiku-5-5');
    expect((await owner.query("select count(*)::int as n from app.ai_provider_checks where provider = 'ANTHROPIC'")).rows[0].n).toBe(before);
    await expect(owner.query("delete from app.ai_provider_checks where provider = 'QWEN'")).rejects.toThrow();
  });

  it('a rotated key is unverified again', async () => {
    healthy = true;
    await check();
    expect((await provider('QWEN')).state).toBe('VERIFIED');
    const rotated = await buildServer(loadEnv({ ...process.env, AI_QWEN_API_KEY: `sk-qwen-${randomUUID()}`, AI_QWEN_BASE_URL: 'https://qwen.example.invalid/compatible-mode/v1' }), { ai: { QWEN: scriptedQwen } });
    await rotated.ready();
    try {
      const r = await rotated.inject({ method: 'GET', url: '/v1/admin/ai/control-centre', headers: { origin: 'http://localhost:8081', cookie: admin.cookie } });
      const q = (JSON.parse(r.body).providers as AiProviderStatus[]).find((p) => p.code === 'QWEN')!;
      expect(q.state).toBe('CONFIGURED');
      expect(q.lastCheck?.currentKey).toBe(false);
    } finally {
      await rotated.close();
    }
  });

  it('system status counts any real provider (not only Anthropic, OpenAI and Gemini)', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/system/status' });
    expect(JSON.parse(r.body).integrations.ai).toBe('CONFIGURED');
  });
});

describe('kill switch', () => {
  it('needs a reason and the permission, is audited, and shows as DISABLED', async () => {
    const patient = await signUp(app, { role: 'PATIENT' });
    expect((await control('QWEN', { enabled: false, reason: 'Provider incident' }, patient)).status).toBe(403);
    expect((await control('QWEN', { enabled: false })).status).toBe(400);
    expect((await control('QWEN', { enabled: false, reason: 'Provider incident INC-42' })).status).toBe(200);
    const q = await provider('QWEN');
    expect(q).toMatchObject({ state: 'DISABLED', disabledReason: 'Provider incident INC-42' });
    expect((await owner.query("select count(*)::int as n from app.audit_log where action = 'ai.provider.disabled' and entity_id = 'QWEN' and actor_user_id = $1", [admin.userId])).rows[0].n).toBe(1);
  });

  it('is enforced by the database router, including for evaluation runs', async () => {
    // QWEN is still disabled from the previous test; disable the simulator too.
    expect((await control('SIMULATED', { enabled: false, reason: 'Router test' })).status).toBe(200);
    const usable = (await owner.query<{ p: string[] }>("select app.ai_usable_providers(array['QWEN','SIMULATED','GEMINI']::app.ai_provider[])::text[] as p")).rows[0]!.p;
    expect(usable).toEqual(['GEMINI']);

    // The router itself: one eligible simulator candidate, then none once the simulator is disabled.
    // Set up and checked inside one owner transaction that is rolled back (no global route changes).
    const tester = await signUp(app, { role: 'PATIENT' });
    await owner.query("update app.user_profiles set account_kind = 'INTERNAL_TEST' where user_id = $1", [tester.userId]);
    const db = await owner.connect();
    try {
      await db.query('begin');
      await db.query("update app.ai_provider_controls set enabled = true, reason = null where provider = 'SIMULATED'");
      await db.query("update app.ai_routes set enabled = true where key = 'patient.chat'");
      await db.query("update app.ai_models set active = true where provider = 'SIMULATED' and model_id = 'simulated-echo'");
      await db.query("insert into app.ai_route_candidates (route_key, tier, model, priority) select 'patient.chat', b.ai_model_tier, m.id, 1 from app.ai_models m, app.billing_plans b where m.provider = 'SIMULATED' and m.model_id = 'simulated-echo' and b.code = 'SILVER'");
      await db.query("select set_config('app.user_id', $1, true)", [tester.userId]);
      const eligible = async () => (await db.query<{ eligible: number }>("select eligible from app.ai_route_status('patient.chat', array['SIMULATED']::app.ai_provider[])")).rows[0]!.eligible;
      expect(await eligible()).toBeGreaterThan(0);
      await db.query("update app.ai_provider_controls set enabled = false, reason = 'Router test' where provider = 'SIMULATED'");
      expect(await eligible()).toBe(0);
    } finally {
      await db.query('rollback');
      db.release();
    }

    // The unfiltered router is not reachable by the application role at all.
    const appPool = new pg.Pool({ connectionString: process.env.DATABASE_URL_APP });
    try {
      await expect(appPool.query("select * from app.ai_route_status_unfiltered('patient.chat', array['SIMULATED']::app.ai_provider[])")).rejects.toThrow(/permission denied/);
      await expect(appPool.query("select * from app.ai_reserve_unfiltered('patient.chat', 1, array['SIMULATED']::app.ai_provider[])")).rejects.toThrow(/permission denied/);
    } finally {
      await appPool.end();
    }
    await owner.query("update app.ai_provider_controls set enabled = true, reason = null where provider = 'SIMULATED'");

    // An evaluation run against a disabled provider is refused before anything is sent.
    const qwenModel = (await owner.query<{ id: string }>("select id from app.ai_models where provider = 'QWEN' limit 1")).rows[0];
    if (qwenModel) {
      const run = await admin.req({ method: 'POST', url: '/v1/admin/ai/evaluation/runs', body: { modelId: qwenModel.id } });
      expect(run.status, JSON.stringify(run.json)).toBe(422);
      expect(run.json.error.code).toBe('AI_PROVIDER_DISABLED');
    }
  });

  it('re-enabling restores the state from the last check', async () => {
    expect((await control('QWEN', { enabled: true })).status).toBe(200);
    expect((await provider('QWEN')).state).toBe('VERIFIED');
  });
});
