/**
 * Realtime voice (migration 0018): gates, single-use stream tickets, the relay's emergency gate,
 * interruptions, second metering with a hard stop, settlement and cost, reaping, isolation between
 * people. The provider is a scripted stand-in driven by each test over a real WebSocket.
 */
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { loadEnv } from '../src/config/env';
import { emptyRealtimeUsage, type RealtimeConnectOptions, type RealtimeEvent, type RealtimeSession, type RealtimeVoiceProvider } from '../src/integrations/ai/realtime';
import { buildServer } from '../src/server';
import { ORIGIN, ownerPool, signUp, type Client } from './helpers';

class FakeSession implements RealtimeSession {
  audio: string[] = [];
  responded = 0;
  cancelled = 0;
  truncated: [string, number][] = [];
  closed = false;
  u = emptyRealtimeUsage('gpt-4o-mini-transcribe');
  constructor(public o: RealtimeConnectOptions) {}
  emit(e: RealtimeEvent) {
    this.o.onEvent(e);
  }
  sendAudio(d: string) {
    this.audio.push(d);
  }
  respond() {
    this.responded += 1;
    if (!autoAnswer) return;
    const id = `item-${this.responded}`;
    setTimeout(() => {
      this.emit({ type: 'assistant_delta', itemId: id, text: 'Keep it covered and dry.' });
      this.emit({ type: 'audio', itemId: id, data: Buffer.alloc(480).toString('base64') });
      this.emit({ type: 'assistant_done', itemId: id, text: 'Keep it covered and dry.' });
      Object.assign(this.u, { textIn: 100, textOut: 50, audioIn: 1000, audioOut: 2000, transcribeIn: 500, transcribeOut: 20 });
      this.emit({ type: 'response_done', status: 'completed', refused: false });
    }, 20);
  }
  cancel() {
    this.cancelled += 1;
  }
  truncate(itemId: string, ms: number) {
    this.truncated.push([itemId, ms]);
  }
  close() {
    this.closed = true;
  }
  usage() {
    return { ...this.u };
  }
}

let autoAnswer = true;
const sessions: FakeSession[] = [];
const fake: RealtimeVoiceProvider = {
  code: 'OPENAI',
  status: 'CONFIGURED',
  connect: async (o) => {
    const s = new FakeSession(o);
    sessions.push(s);
    setImmediate(() => s.emit({ type: 'ready' }));
    return s;
  },
  completeText: async () => {
    throw new Error('not used');
  },
};

let app: FastifyInstance;
let owner: pg.Pool;
let base: string;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const tone = () => Buffer.alloc(4800, 7).toString('base64'); // 0.1 s of audio

async function tester(voiceConsent = true) {
  const c = await signUp(app, { role: 'PATIENT' });
  await c.req({ method: 'GET', url: '/v1/me' });
  await owner.query("update app.user_profiles set account_kind = 'INTERNAL_TEST', locale = 'en' where user_id = $1", [c.userId]);
  const state = await c.req({ method: 'GET', url: '/v1/me/consents' });
  const wanted = ['AI_ASSISTANT_PROCESSING', ...(voiceConsent ? ['AI_VOICE_PROCESSING'] : [])];
  const consents = state.json.consents.filter((x: { type: string }) => wanted.includes(x.type)).map((x: { type: string; currentVersion: string }) => ({ type: x.type, version: x.currentVersion, granted: true }));
  const r = await c.req({ method: 'POST', url: '/v1/me/consents', body: { consents, source: 'web', locale: 'en' } });
  expect(r.status).toBe(200);
  return c;
}

type Conn = { ws: WebSocket; events: any[]; next: (type: string, ms?: number) => Promise<any>; closed: Promise<{ code: number }> };
function connect(path: string, protocols: string[], headers: Record<string, string> = {}): Promise<Conn> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base}${path}`, protocols, { headers });
    const events: any[] = [];
    const waiters: { type: string; resolve: (e: any) => void }[] = [];
    let closedResolve!: (v: { code: number }) => void;
    const closed = new Promise<{ code: number }>((r) => (closedResolve = r));
    ws.on('message', (raw) => {
      const e = JSON.parse(raw.toString());
      events.push(e);
      for (const w of [...waiters]) if (w.type === e.type) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(e);
      }
    });
    ws.on('close', (code) => closedResolve({ code }));
    ws.on('open', () =>
      resolve({
        ws,
        events,
        closed,
        next: (type, ms = 4000) =>
          new Promise((res, rej) => {
            const seen = events.find((e) => e.type === type && !e.__taken);
            if (seen) {
              seen.__taken = true;
              return res(seen);
            }
            const t = setTimeout(() => rej(new Error(`timeout waiting for ${type}; got ${events.map((e) => e.type).join(',')}`)), ms);
            waiters.push({ type, resolve: (e) => (clearTimeout(t), (e.__taken = true), res(e)) });
          }),
      }),
    );
    ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.on('error', reject);
  });
}

async function start(c: Client, body: object = {}) {
  const r = await c.req({ method: 'POST', url: '/v1/ai/voice/sessions', body });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json as { sessionId: string; conversationId: string; ticket: string; protocol: string; streamPath: string };
}
async function open(c: Client, body: object = {}) {
  const s = await start(c, body);
  const conn = await connect(s.streamPath, [s.protocol, `ticket.${s.ticket}`]);
  await conn.next('ready');
  return { s, conn, fake: sessions[sessions.length - 1]! };
}
const session = async (id: string) => (await owner.query('select s.*, u.status as usage_status, u.units, u.cost_micros, u.cost_estimated from app.ai_voice_sessions s join app.ai_usage u on u.id = s.usage_id where s.id = $1', [id])).rows[0];
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 5000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() - t0 > ms) throw new Error(`condition not met: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  app = await buildServer(loadEnv(process.env), { realtime: { OPENAI: fake }, voiceTiming: { tickMs: 50, idleMs: 1500, usageEveryMs: 200 } });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  owner = ownerPool();
  await owner.query("update app.ai_models set price_verified_at = now(), active = true where model_id = 'gpt-realtime-2.1-mini'");
  await owner.query("update app.ai_routes set enabled = true where key = 'patient.voice'");
  await owner.query('update app.ai_budget set monthly_limit_micros = 50000000');
});
beforeEach(() => {
  autoAnswer = true;
});
afterAll(async () => {
  await owner.query("update app.ai_routes set enabled = false where key = 'patient.voice'");
  await owner.query('update app.ai_budget set monthly_limit_micros = null');
  await owner.query("update app.ai_models set active = false, price_verified_at = null where model_id = 'gpt-realtime-2.1-mini'");
  await owner.query("update app.ai_plan_quotas set weekly_limit = 180 where plan_code = 'SILVER' and metric = 'VOICE_SECONDS'");
  await owner.end();
  await app.close();
});

describe('availability and consent', () => {
  it('is off for standard accounts while the regulated flag is off; needs its own consent', async () => {
    const standard = await signUp(app, { role: 'PATIENT' });
    expect((await standard.req({ method: 'GET', url: '/v1/ai/voice' })).json.unavailableReason).toBe('FEATURE_DISABLED');
    expect((await standard.req({ method: 'POST', url: '/v1/ai/voice/sessions', body: {} })).json.error.code).toBe('FEATURE_DISABLED');

    const noVoice = await tester(false);
    const s = await noVoice.req({ method: 'GET', url: '/v1/ai/voice' });
    expect(s.json).toMatchObject({ unavailableReason: 'VOICE_CONSENT_REQUIRED', allowance: { metric: 'VOICE_SECONDS', weeklyLimit: 180 } });
    const r = await noVoice.req({ method: 'POST', url: '/v1/ai/voice/sessions', body: {} });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe('AI_VOICE_CONSENT_REQUIRED');

    const ok = await tester();
    expect((await ok.req({ method: 'GET', url: '/v1/ai/voice' })).json.unavailableReason).toBeNull();
    await owner.query("update app.ai_routes set enabled = false where key = 'patient.voice'");
    expect((await ok.req({ method: 'GET', url: '/v1/ai/voice' })).json.unavailableReason).toBe('NOT_CONFIGURED');
    await owner.query("update app.ai_routes set enabled = true where key = 'patient.voice'");
  });
});

describe('stream tickets', () => {
  it('are single-use, never in the URL, stored only as a hash, and expire', async () => {
    const c = await tester();
    const s = await start(c);
    expect(s.streamPath).not.toContain(s.ticket);
    const row = await session(s.sessionId);
    expect(row.ticket_hash).toBe(sha(s.ticket));
    await expect(connect(s.streamPath, [s.protocol, `ticket.${'x'.repeat(43)}`]).then((cn) => cn.next('error'))).resolves.toMatchObject({ code: 'AI_VOICE_TICKET_INVALID' });
    const first = await connect(s.streamPath, [s.protocol, `ticket.${s.ticket}`]);
    await first.next('ready');
    const again = await connect(s.streamPath, [s.protocol, `ticket.${s.ticket}`]);
    expect(await again.next('error')).toMatchObject({ code: 'AI_VOICE_TICKET_INVALID' });
    expect((await again.closed).code).toBe(4401);
    first.ws.send(JSON.stringify({ type: 'end' }));
    await first.next('ended');

    // An unclaimed ticket expires; the reaper gives the reserved seconds back.
    const late = await start(c);
    await owner.query("update app.ai_voice_sessions set ticket_expires_at = now() - interval '1 second' where id = $1", [late.sessionId]);
    const expired = await connect(late.streamPath, [late.protocol, `ticket.${late.ticket}`]);
    expect(await expired.next('error')).toMatchObject({ code: 'AI_VOICE_TICKET_INVALID' });
    await owner.query('select app.ai_voice_reap(null)');
    expect(await session(late.sessionId)).toMatchObject({ status: 'ENDED', end_reason: 'EXPIRED', usage_status: 'RELEASED' });
  });

  it('refuses browsers from other origins', async () => {
    const c = await tester();
    const s = await start(c);
    await expect(connect(s.streamPath, [s.protocol, `ticket.${s.ticket}`], { origin: 'https://evil.example' })).rejects.toThrow(/403/);
    const ok = await connect(s.streamPath, [s.protocol, `ticket.${s.ticket}`], { origin: ORIGIN });
    await ok.next('ready');
    ok.ws.send(JSON.stringify({ type: 'end' }));
    await ok.next('ended');
  });
});

describe('a conversation turn', () => {
  it('relays audio, answers only after the transcript, stores text transcripts and settles seconds and cost', async () => {
    const c = await tester();
    const { s, conn, fake: f } = await open(c);
    expect(f.o.instructions).toContain('VOICE CONVERSATION RULES');
    expect(f.o.instructions).toContain('Dress My Wound'); // the same fixed policy as text chat
    expect(f.o.history).toEqual([]);
    expect(f.o.language).toBe('en');
    conn.ws.send(JSON.stringify({ type: 'audio', data: tone() }));
    await until(async () => f.audio.length, (n) => n === 1);
    f.emit({ type: 'speech_started', itemId: 'u1' });
    f.emit({ type: 'speech_stopped' });
    expect(f.responded).toBe(0); // the provider never answers on its own
    f.emit({ type: 'user_transcript', itemId: 'u1', text: 'How do I keep a dressing dry in the shower?' });
    expect((await conn.next('user_transcript')).text).toContain('dressing');
    expect(f.responded).toBe(1);
    expect((await conn.next('audio')).itemId).toBe('item-1');
    const done = await conn.next('assistant_done');
    expect(done).toMatchObject({ kind: 'MESSAGE', text: 'Keep it covered and dry.' });
    expect(done.messageId).toBeTruthy();
    await new Promise((r) => setTimeout(r, 1100)); // at least one metered second
    conn.ws.send(JSON.stringify({ type: 'end' }));
    expect(await conn.next('ended')).toMatchObject({ reason: 'USER_ENDED' });

    const row = await until(() => session(s.sessionId), (r) => r.status === 'ENDED');
    expect(row).toMatchObject({ end_reason: 'USER_ENDED', usage_status: 'SETTLED', cost_estimated: true });
    expect(row.used_seconds).toBeGreaterThanOrEqual(1);
    expect(row.units).toBe(row.used_seconds);
    // 100×0.60 + 50×2.40 + 1000×10 + 2000×20 (audio) + 500×1.25 + 20×5 (transcription), micro-USD.
    expect(Number(row.cost_micros)).toBe(50905);
    const msgs = await c.req({ method: 'GET', url: `/v1/ai/conversations/${s.conversationId}` });
    expect(msgs.json.messages.map((m: any) => [m.role, m.channel, m.kind])).toEqual([
      ['user', 'VOICE', 'MESSAGE'],
      ['assistant', 'VOICE', 'MESSAGE'],
    ]);

    // Continuing the conversation gives the model its earlier turns (text), never audio.
    const again = await open(c, { conversationId: s.conversationId });
    expect(again.fake.o.history).toEqual([
      { role: 'user', content: 'How do I keep a dressing dry in the shower?' },
      { role: 'assistant', content: 'Keep it covered and dry.' },
    ]);
    again.conn.ws.send(JSON.stringify({ type: 'end' }));
    await again.conn.next('ended');
  });

  it('drops malformed and oversized audio frames', async () => {
    const c = await tester();
    const { conn, fake: f } = await open(c);
    conn.ws.send(JSON.stringify({ type: 'audio', data: 'not base64!' }));
    conn.ws.send(JSON.stringify({ type: 'audio', data: 'A'.repeat(64_004) }));
    conn.ws.send(JSON.stringify({ type: 'audio', data: 12 }));
    conn.ws.send('{oops');
    conn.ws.send(JSON.stringify({ type: 'audio', data: tone() }));
    await until(async () => f.audio.length, (n) => n === 1);
    conn.ws.send(JSON.stringify({ type: 'end' }));
    await conn.next('ended');
  });
});

describe('emergencies', () => {
  for (const text of ['My father has chest pain and he cannot breathe', 'ابويا عنده ألم في الصدر ومش قادر يتنفس']) {
    it(`never reach the model and end the call: ${text.slice(0, 24)}`, async () => {
      const c = await tester();
      const { s, conn, fake: f } = await open(c);
      f.emit({ type: 'user_transcript', itemId: 'u1', text });
      const e = await conn.next('emergency');
      expect(e.text).toContain('123');
      expect(f.responded).toBe(0);
      expect(f.cancelled).toBeGreaterThanOrEqual(1);
      expect(await conn.next('ended')).toMatchObject({ reason: 'EMERGENCY' });
      const msgs = await c.req({ method: 'GET', url: `/v1/ai/conversations/${s.conversationId}` });
      expect(msgs.json.messages.map((m: any) => m.kind)).toEqual(['MESSAGE', 'EMERGENCY_GUIDANCE']);
      expect((await session(s.sessionId)).end_reason).toBe('EMERGENCY');
    });
  }
});

describe('interruptions', () => {
  it('cancels the answer, truncates it to what was heard and keeps the partial transcript', async () => {
    autoAnswer = false;
    const c = await tester();
    const { s, conn, fake: f } = await open(c);
    f.emit({ type: 'user_transcript', itemId: 'u1', text: 'Tell me about wound dressings' });
    await conn.next('user_transcript');
    f.emit({ type: 'assistant_delta', itemId: 'a1', text: 'Dressings protect the wound and' });
    await conn.next('assistant_delta');
    conn.ws.send(JSON.stringify({ type: 'interrupt', itemId: 'a1', playedMs: 1234 }));
    await until(async () => f.truncated.length, (n) => n === 1);
    expect(f.cancelled).toBe(1);
    expect(f.truncated).toEqual([['a1', 1234]]);
    f.emit({ type: 'response_done', status: 'cancelled', refused: false });
    expect((await conn.next('assistant_done')).text).toBe('Dressings protect the wound and …');
    conn.ws.send(JSON.stringify({ type: 'end' }));
    await conn.next('ended');
    const msgs = await c.req({ method: 'GET', url: `/v1/ai/conversations/${s.conversationId}` });
    expect(msgs.json.messages.at(-1).content).toBe('Dressings protect the wound and …');
  });

  it('a provider refusal is replaced by the fixed notice', async () => {
    autoAnswer = false;
    const c = await tester();
    const { conn, fake: f } = await open(c);
    f.emit({ type: 'user_transcript', itemId: 'u1', text: 'Something the provider declines' });
    await conn.next('user_transcript');
    f.emit({ type: 'response_done', status: 'incomplete', refused: true });
    expect(await conn.next('assistant_done')).toMatchObject({ kind: 'REFUSAL' });
    conn.ws.send(JSON.stringify({ type: 'end' }));
    await conn.next('ended');
  });
});

describe('metering', () => {
  it('stops the stream when the weekly seconds run out (hard stop), then refuses new sessions', async () => {
    await owner.query("update app.ai_plan_quotas set weekly_limit = 2 where plan_code = 'SILVER' and metric = 'VOICE_SECONDS'");
    try {
      const c = await tester();
      const { s, conn } = await open(c);
      expect(await conn.next('ended', 6000)).toMatchObject({ reason: 'QUOTA' });
      const row = await until(() => session(s.sessionId), (r) => r.status === 'ENDED');
      expect(row.units).toBeLessThanOrEqual(2);
      const again = await c.req({ method: 'POST', url: '/v1/ai/voice/sessions', body: {} });
      expect(again.json.error.code).toBe('AI_QUOTA_EXCEEDED');
    } finally {
      await owner.query("update app.ai_plan_quotas set weekly_limit = 180 where plan_code = 'SILVER' and metric = 'VOICE_SECONDS'");
    }
  });

  it('grants further blocks only while every gate holds (allowance, consent)', async () => {
    await owner.query("update app.ai_plan_quotas set weekly_limit = 40 where plan_code = 'SILVER' and metric = 'VOICE_SECONDS'");
    try {
      const c = await tester();
      const s = await start(c);
      await owner.query('select * from app.ai_voice_claim($1, $2)', [s.sessionId, sha(s.ticket)]);
      const extend = async () => {
        const conn = await app.services.pools.appPool.connect();
        try {
          await conn.query('begin');
          await conn.query("select set_config('app.user_id', $1, true)", [c.userId]);
          const r = (await conn.query('select * from app.ai_voice_extend($1, 20, $2)', [s.sessionId, '{"audioIn": 10}'])).rows[0];
          await conn.query('commit');
          return r;
        } finally {
          conn.release();
        }
      };
      expect(await extend()).toEqual({ reserved_seconds: 40, stop_reason: null });
      expect(await extend()).toEqual({ reserved_seconds: 40, stop_reason: 'QUOTA' });
      // Withdrawing the voice consent stops the next block.
      const state = await c.req({ method: 'GET', url: '/v1/me/consents' });
      const v = state.json.consents.find((x: any) => x.type === 'AI_VOICE_PROCESSING');
      await c.req({ method: 'POST', url: '/v1/me/consents', body: { consents: [{ type: v.type, version: v.currentVersion, granted: false }], source: 'web', locale: 'en' } });
      expect((await extend()).stop_reason).toBe('STOPPED');
      // A silent stream is settled from its last heartbeat by the reaper.
      await owner.query("update app.ai_voice_sessions set heartbeat_at = now() - interval '2 minutes' where id = $1", [s.sessionId]);
      await owner.query('select app.ai_voice_reap(null)');
      expect(await session(s.sessionId)).toMatchObject({ status: 'ENDED', end_reason: 'LOST', used_seconds: 20, usage_status: 'SETTLED', units: 20 });
    } finally {
      await owner.query("update app.ai_plan_quotas set weekly_limit = 180 where plan_code = 'SILVER' and metric = 'VOICE_SECONDS'");
    }
  });

  it('ends idle calls and settles when the app disconnects; one live session per person', async () => {
    const c = await tester();
    const idle = await open(c);
    expect(await idle.conn.next('ended', 5000)).toMatchObject({ reason: 'IDLE' });

    const { s, conn } = await open(c);
    const second = await c.req({ method: 'POST', url: '/v1/ai/voice/sessions', body: {} });
    expect(second.json.error.code).toBe('AI_CONCURRENCY_LIMIT');
    conn.ws.terminate();
    expect(await until(() => session(s.sessionId), (r) => r.status === 'ENDED')).toMatchObject({ end_reason: 'DISCONNECTED' });
  });
});

describe('isolation', () => {
  /** One statement as `userId` through the app role (RLS applies), in its own transaction. */
  async function asUser(userId: string, text: string, params: unknown[] = []) {
    const conn = await app.services.pools.appPool.connect();
    try {
      await conn.query('begin');
      await conn.query("select set_config('app.user_id', $1, true)", [userId]);
      return (await conn.query(text, params)).rows;
    } finally {
      await conn.query('rollback');
      conn.release();
    }
  }

  it("one person cannot read or write another person's voice session", async () => {
    const a = await tester();
    const b = await tester();
    const s = await start(a);
    await owner.query('select * from app.ai_voice_claim($1, $2)', [s.sessionId, sha(s.ticket)]);
    expect(await asUser(b.userId, 'select id from app.ai_voice_sessions where id = $1', [s.sessionId])).toEqual([]);
    await expect(asUser(b.userId, "select app.ai_voice_record($1, 'assistant', 'MESSAGE', 'injected')", [s.sessionId])).rejects.toThrow(/AI_VOICE_SESSION_INVALID/);
    await expect(asUser(b.userId, "select app.ai_voice_settle($1, 5, '{}', 'USER_ENDED')", [s.sessionId])).rejects.toThrow(/AI_VOICE_SESSION_INVALID/);
    await expect(asUser(b.userId, 'select * from app.ai_voice_extend($1, 5, null)', [s.sessionId])).rejects.toThrow(/AI_VOICE_SESSION_INVALID/);
    // Not even the owner can write sessions, or forge voice transcripts, directly.
    await expect(asUser(a.userId, 'update app.ai_voice_sessions set used_seconds = 0')).rejects.toThrow(/permission denied/);
    await expect(
      asUser(a.userId, "insert into app.ai_messages (conversation_id, user_id, role, kind, channel, content) values ($1, $2, 'user', 'MESSAGE', 'VOICE', 'forged')", [s.conversationId, a.userId]),
    ).rejects.toThrow(/row-level security/);
    // The claim and settlement internals are not callable by the app at all.
    await expect(asUser(a.userId, "select app.ai_voice_finish($1, 1, '{}', 'USER_ENDED')", [s.sessionId])).rejects.toThrow(/permission denied/);
  });
});
