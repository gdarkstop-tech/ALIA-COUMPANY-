/**
 * Realtime voice conversations (route `patient.voice`, migration 0018, ADR 0010).
 *
 *   POST /v1/ai/voice/sessions  — every gate (flag, route, both consents, approved model, budget,
 *                                 weekly voice seconds, one live session per person), first block
 *                                 of seconds reserved, single-use ticket returned.
 *   GET  /v1/ai/voice/sessions/:id/stream (WebSocket, subprotocol dmw.voice.v1 + ticket.<ticket>)
 *                               — the relay: app audio → provider (business key, server-side),
 *                                 provider audio/transcripts → app.
 *
 * Rules the relay enforces regardless of what the model or the app does:
 *   * Every transcribed turn is checked for emergencies BEFORE the model is asked to answer
 *     (the provider never answers on its own); an emergency gets the fixed guidance and ends the call.
 *   * Seconds are metered in reserved blocks; when no further block is granted the stream stops.
 *   * Only text transcripts are stored (the person's conversation); audio is never stored or logged.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  AI_VOICE_MAX_FRAME_CHARS,
  AI_VOICE_MAX_SESSION_SECONDS,
  AI_VOICE_PROTOCOL,
  AI_VOICE_SAMPLE_RATE,
  startVoiceBody,
  type AiMessageKind,
  type AiVoiceEndReason,
  type AiVoiceServerEvent,
  type AiVoiceSessionStart,
  type AiVoiceStatus,
} from '@ghayarly/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import { webOrigins } from '../../config/env';
import { withContext, type RequestContext, type Tx } from '../../db/client';
import { aiConversations, aiMessages, userProfiles } from '../../db/schema';
import { configuredRealtimeProviders, type RealtimeEvent, type RealtimeSession } from '../../integrations/ai/realtime';
import { AppError, notFound } from '../../lib/errors';
import { inContext, requirePrincipal, type Principal } from '../../lib/principal';
import { sessionKey } from '../../lib/rateLimitKey';
import { parse } from '../../lib/validate';
import { allowance, preferences, providerArray } from './routes';
import { emergencyGuidance, endUserRefFor, looksLikeEmergency, policyFor, preferenceContext, refusalNotice } from './safety';

const ROUTE = 'patient.voice';
const HISTORY_MESSAGES = 12;
const HISTORY_CHARS = 8_000;
/** Real-time PCM is 48,000 bytes/s; allow bursts (reconnects, buffering) up to 2.5×. */
const MAX_AUDIO_BYTES_PER_SECOND = 120_000;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const TICKET = /^[A-Za-z0-9_-]{43}$/;

export type VoiceTiming = { tickMs: number; idleMs: number; extendAheadSeconds: number; usageEveryMs: number; maxSessionSeconds: number };
export const DEFAULT_VOICE_TIMING: VoiceTiming = { tickMs: 1000, idleMs: 45_000, extendAheadSeconds: 5, usageEveryMs: 5000, maxSessionSeconds: AI_VOICE_MAX_SESSION_SECONDS };

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

type Claim = { user_id: string; conversation_id: string | null; provider: keyof FastifyInstance['services']['realtime']; model_id: string; locale: 'ar' | 'en'; reserved_seconds: number; max_output_tokens: number };

export async function voiceRoutes(app: FastifyInstance) {
  const { realtime, env, db } = app.services;
  const timing: VoiceTiming = { ...DEFAULT_VOICE_TIMING, ...app.services.voiceTiming };
  const active = new Set<{ end: (r: AiVoiceEndReason) => Promise<void> }>();

  async function voiceStatus(request: FastifyRequest, principal: Principal): Promise<AiVoiceStatus> {
    return inContext(request, principal, async (tx) => {
      const r = await tx.execute<{ feature_on: boolean; internal_test: boolean; consented: boolean; route_on: boolean; eligible: number; eligible_free: number; budget_ok: boolean }>(
        sql`select * from app.ai_route_status(${ROUTE}, ${providerArray(configuredRealtimeProviders(realtime))})`,
      );
      const s = r.rows[0];
      const voice = (await tx.execute<{ ok: boolean }>(sql`select app.has_current_consent('AI_VOICE_PROCESSING') as ok`)).rows[0]?.ok ?? false;
      const unavailableReason: AiVoiceStatus['unavailableReason'] =
        !s || (!s.feature_on && !s.internal_test) ? 'FEATURE_DISABLED'
        : !s.route_on || s.eligible === 0 ? 'NOT_CONFIGURED'
        : s.eligible_free === 0 && !s.budget_ok ? 'PAUSED'
        : !s.consented ? 'CONSENT_REQUIRED'
        : !voice ? 'VOICE_CONSENT_REQUIRED'
        : null;
      return { unavailableReason, allowance: unavailableReason === 'FEATURE_DISABLED' ? null : await allowance(tx, ROUTE) };
    });
  }

  app.get('/ai/voice', async (request) => voiceStatus(request, await requirePrincipal(request)));

  app.post('/ai/voice/sessions', { config: { rateLimit: { max: 6, timeWindow: '1 minute', keyGenerator: sessionKey } } }, async (request, reply) => {
    const principal = await requirePrincipal(request);
    const body = parse(startVoiceBody, request.body ?? {});
    const status = await voiceStatus(request, principal);
    if (status.unavailableReason) {
      const consent = status.unavailableReason === 'CONSENT_REQUIRED' || status.unavailableReason === 'VOICE_CONSENT_REQUIRED';
      const code = status.unavailableReason === 'CONSENT_REQUIRED' ? 'AI_CONSENT_REQUIRED' : status.unavailableReason === 'VOICE_CONSENT_REQUIRED' ? 'AI_VOICE_CONSENT_REQUIRED' : status.unavailableReason;
      throw new AppError(consent ? 403 : 409, code, 'Voice is not available');
    }
    // 256-bit single-use ticket; only its hash reaches the database.
    const ticket = randomBytes(32).toString('base64url');
    const started = await inContext(request, principal, async (tx) => {
      const prefs = await preferences(tx, principal.userId);
      const [profile] = await tx.select({ locale: userProfiles.locale }).from(userProfiles).where(eq(userProfiles.userId, principal.userId));
      const locale: 'ar' | 'en' = prefs.replyLanguage === 'auto' ? (profile?.locale === 'en' ? 'en' : 'ar') : prefs.replyLanguage;
      let conversationId = body.conversationId;
      if (conversationId) {
        const [c] = await tx.select({ id: aiConversations.id }).from(aiConversations).where(eq(aiConversations.id, conversationId));
        if (!c) throw notFound('Conversation');
      } else {
        const [c] = await tx.insert(aiConversations).values({ userId: principal.userId, routeKey: 'patient.chat', patientId: null }).returning({ id: aiConversations.id });
        conversationId = c!.id;
      }
      const r = await tx.execute<{ session_id: string }>(
        sql`select * from app.ai_voice_start(${providerArray(configuredRealtimeProviders(realtime))}, ${locale}, ${conversationId}::uuid, ${sha256(ticket)})`,
      );
      return { sessionId: r.rows[0]!.session_id, conversationId, allowance: await allowance(tx, ROUTE) };
    });
    const out: AiVoiceSessionStart = {
      sessionId: started.sessionId,
      conversationId: started.conversationId,
      ticket,
      protocol: AI_VOICE_PROTOCOL,
      streamPath: `/v1/ai/voice/sessions/${started.sessionId}/stream`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      sampleRate: AI_VOICE_SAMPLE_RATE,
      maxSessionSeconds: timing.maxSessionSeconds,
      allowance: started.allowance,
    };
    return reply.status(201).send(out);
  });

  // ---------------------------------------------------------------- the relay
  app.get(
    '/ai/voice/sessions/:id/stream',
    {
      websocket: true,
      // Defence in depth against cross-site WebSocket use (the ticket is the credential): browsers
      // must come from an allowed origin; native clients send none or the API's own host.
      preValidation: async (request, reply) => {
        const origin = request.headers.origin;
        if (!origin) return;
        const host = request.headers.host;
        if (webOrigins(env).includes(origin) || (host && (origin === `https://${host}` || origin === `http://${host}`))) return;
        return reply.status(403).send({ error: { code: 'INVALID_ORIGIN', message: 'Origin not allowed' } });
      },
    },
    (socket, request) => {
      const relay = startRelay(socket, request);
      active.add(relay);
      void relay.done.finally(() => active.delete(relay));
    },
  );

  function startRelay(socket: WebSocket, request: FastifyRequest) {
    const send = (e: AiVoiceServerEvent) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(e));
    };
    let ended = false;
    let ctx: RequestContext | null = null;
    let sessionId: string | null = null;
    let claim: Claim | null = null;
    let provider: RealtimeSession | null = null;
    let startedAt: number | null = null;
    let reserved = 0;
    let stopReason: string | null = null;
    let extending = false;
    let lastActivity = Date.now();
    let lastUsageSent = 0;
    let usedBefore = 0;
    let weeklyLimit = 0;
    let failures = 0;
    let audioWindow = { at: 0, bytes: 0, violations: 0 };
    let ticker: NodeJS.Timeout | null = null;
    const partial = new Map<string, string>();
    let queue: Promise<unknown> = Promise.resolve();
    let resolveDone!: () => void;
    const done = new Promise<void>((r) => (resolveDone = r));

    const usedSeconds = () => (startedAt ? Math.ceil((Date.now() - startedAt) / 1000) : 0);
    const remaining = () => Math.max(0, weeklyLimit - usedBefore - usedSeconds());
    const asUser = <T>(fn: (tx: Tx) => Promise<T>) => withContext(db, ctx!, fn);
    /** Database writes in arrival order (the person's turn is stored before the answer to it). */
    const enqueue = <T>(fn: () => Promise<T>): Promise<T | null> => {
      const p = queue.then(fn).catch((e: unknown) => {
        request.log.warn({ err: e instanceof Error ? e.message : String(e) }, 'voice relay database write failed');
        return null;
      });
      queue = p;
      return p;
    };
    const record = (role: 'user' | 'assistant', kind: AiMessageKind, content: string) =>
      enqueue(async () => (await asUser((tx) => tx.execute<{ id: string | null }>(sql`select app.ai_voice_record(${sessionId}::uuid, ${role}, ${kind}, ${content}) as id`))).rows[0]?.id ?? null);

    async function end(reason: AiVoiceEndReason) {
      if (ended) return;
      ended = true;
      if (ticker) clearInterval(ticker);
      const usage = provider?.usage() ?? null;
      provider?.close();
      const seconds = Math.min(usedSeconds(), reserved);
      if (ctx && sessionId) {
        await queue;
        await asUser((tx) => tx.execute(sql`select app.ai_voice_settle(${sessionId}::uuid, ${seconds}, ${JSON.stringify(usage ?? {})}::jsonb, ${reason})`)).catch((e: unknown) =>
          request.log.error({ err: e instanceof Error ? e.message : String(e) }, 'voice session settlement failed'),
        );
      }
      request.log.info({ event: 'ai.voice.ended', reason, seconds, provider: claim?.provider ?? null }, 'voice session ended');
      send({ type: 'ended', reason, usedSeconds: seconds });
      if (socket.readyState === socket.OPEN) socket.close(1000, reason);
      resolveDone();
    }
    function reject(code: string, closeCode: number) {
      ended = true;
      send({ type: 'error', code });
      socket.close(closeCode, code);
      resolveDone();
    }

    function extend() {
      extending = true;
      const usage = provider?.usage() ?? {};
      asUser((tx) => tx.execute<{ reserved_seconds: number; stop_reason: string | null }>(sql`select * from app.ai_voice_extend(${sessionId}::uuid, ${usedSeconds()}, ${JSON.stringify(usage)}::jsonb)`))
        .then((r) => {
          reserved = r.rows[0]!.reserved_seconds;
          stopReason = r.rows[0]!.stop_reason;
          if (stopReason === 'STOPPED') void end('STOPPED');
        })
        .catch((e: unknown) => {
          request.log.warn({ err: e instanceof Error ? e.message : String(e) }, 'voice block reservation failed');
          stopReason = 'STOPPED';
        })
        .finally(() => (extending = false));
    }

    function tick() {
      if (ended || !startedAt) return;
      const used = usedSeconds();
      if (used >= timing.maxSessionSeconds) return void end('MAX_DURATION');
      if (Date.now() - lastActivity > timing.idleMs) return void end('IDLE');
      if (used >= reserved) return void end(stopReason === 'MAX_DURATION' ? 'MAX_DURATION' : 'QUOTA');
      if (!extending && !stopReason && used >= reserved - timing.extendAheadSeconds) extend();
      if (Date.now() - lastUsageSent >= timing.usageEveryMs) {
        lastUsageSent = Date.now();
        send({ type: 'usage', usedSeconds: used, remainingSeconds: remaining() });
      }
    }

    async function onProviderEvent(e: RealtimeEvent) {
      if (ended) return;
      switch (e.type) {
        case 'ready':
          if (startedAt) return;
          startedAt = Date.now();
          lastActivity = Date.now();
          ticker = setInterval(tick, timing.tickMs);
          send({ type: 'ready', sessionId: sessionId!, maxSessionSeconds: timing.maxSessionSeconds, remainingSeconds: remaining(), simulated: claim!.provider === 'SIMULATED' });
          return;
        case 'speech_started':
          lastActivity = Date.now();
          return send({ type: 'speech_started' });
        case 'speech_stopped':
          lastActivity = Date.now();
          return send({ type: 'speech_stopped' });
        case 'user_transcript': {
          lastActivity = Date.now();
          if (!e.text) return;
          if (looksLikeEmergency(e.text)) {
            // Deterministic: the model is not asked to answer; fixed guidance; the call ends.
            provider?.cancel();
            const userId = await record('user', 'MESSAGE', e.text);
            send({ type: 'user_transcript', messageId: userId, text: e.text });
            const text = emergencyGuidance(claim!.locale);
            const guidanceId = await record('assistant', 'EMERGENCY_GUIDANCE', text);
            send({ type: 'emergency', messageId: guidanceId, text });
            return void end('EMERGENCY');
          }
          provider?.respond();
          const messageId = await record('user', 'MESSAGE', e.text);
          return send({ type: 'user_transcript', messageId, text: e.text });
        }
        case 'user_transcript_failed':
          return send({ type: 'not_understood' });
        case 'audio':
          lastActivity = Date.now();
          return send({ type: 'audio', itemId: e.itemId, data: e.data });
        case 'assistant_delta':
          partial.set(e.itemId, (partial.get(e.itemId) ?? '') + e.text);
          return send({ type: 'assistant_delta', itemId: e.itemId, text: e.text });
        case 'assistant_done': {
          partial.delete(e.itemId);
          lastActivity = Date.now();
          failures = 0;
          const kind: AiMessageKind = claim!.provider === 'SIMULATED' ? 'SIMULATED' : 'MESSAGE';
          const messageId = await record('assistant', kind, e.text);
          return send({ type: 'assistant_done', itemId: e.itemId, messageId, text: e.text, kind });
        }
        case 'response_done': {
          if (e.refused) {
            const text = refusalNotice(claim!.locale);
            const messageId = await record('assistant', 'REFUSAL', text);
            return send({ type: 'assistant_done', itemId: 'refusal', messageId, text, kind: 'REFUSAL' });
          }
          if (e.status === 'cancelled') {
            // Interrupted: keep what was said so far in the transcript, marked as cut off.
            for (const [itemId, text] of partial) {
              partial.delete(itemId);
              if (!text.trim()) continue;
              const messageId = await record('assistant', claim!.provider === 'SIMULATED' ? 'SIMULATED' : 'MESSAGE', `${text.trim()} …`);
              send({ type: 'assistant_done', itemId, messageId, text: `${text.trim()} …`, kind: 'MESSAGE' });
            }
            return;
          }
          if (e.status === 'failed') {
            failures += 1;
            send({ type: 'error', code: 'AI_UNAVAILABLE' });
            if (failures >= 2) return void end('PROVIDER_ERROR');
          }
          return;
        }
        case 'error':
          request.log.warn({ provider: claim?.provider, kind: e.kind }, 'voice provider error');
          if (e.kind === 'RATE_LIMIT') send({ type: 'error', code: 'AI_RATE_LIMITED' });
          return;
        case 'closed':
          return void end(e.expected ? 'USER_ENDED' : 'PROVIDER_ERROR');
      }
    }

    // Listeners are attached synchronously so nothing the app sends is lost while we set up.
    socket.on('message', (raw, isBinary) => {
      if (ended || isBinary) return;
      let m: { type?: unknown; data?: unknown; itemId?: unknown; playedMs?: unknown };
      try {
        m = JSON.parse(raw.toString()) as typeof m;
      } catch {
        return;
      }
      if (m.type === 'end') return void end('USER_ENDED');
      if (!provider || !startedAt) return;
      if (m.type === 'audio') {
        if (typeof m.data !== 'string' || !m.data.length || m.data.length > AI_VOICE_MAX_FRAME_CHARS || m.data.length % 4 !== 0 || !BASE64.test(m.data)) return;
        const now = Date.now();
        if (now - audioWindow.at >= 1000) audioWindow = { at: now, bytes: 0, violations: audioWindow.violations };
        audioWindow.bytes += (m.data.length * 3) / 4;
        if (audioWindow.bytes > MAX_AUDIO_BYTES_PER_SECOND) {
          audioWindow.violations += 1;
          if (audioWindow.violations > 20) {
            send({ type: 'error', code: 'AI_VOICE_RATE_LIMITED' });
            void end('STOPPED');
          }
          return;
        }
        provider.sendAudio(m.data);
      } else if (m.type === 'interrupt') {
        provider.cancel();
        if (typeof m.itemId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(m.itemId) && typeof m.playedMs === 'number' && Number.isFinite(m.playedMs)) {
          provider.truncate(m.itemId, Math.min(Math.max(m.playedMs, 0), 600_000));
        }
      }
    });
    socket.on('close', () => void end('DISCONNECTED'));

    void (async () => {
      const id = z.string().uuid().safeParse((request.params as { id?: string }).id);
      const offered = String(request.headers['sec-websocket-protocol'] ?? '').split(',').map((p) => p.trim());
      const ticket = offered.find((p) => p.startsWith('ticket.'))?.slice('ticket.'.length);
      if (!id.success || !ticket || !TICKET.test(ticket)) return reject('AI_VOICE_TICKET_INVALID', 4401);
      try {
        const r = await withContext(db, { userId: null, demoMode: env.DEMO_MODE, requestId: request.id }, (tx) =>
          tx.execute<Claim>(sql`select * from app.ai_voice_claim(${id.data}::uuid, ${sha256(ticket)})`),
        );
        claim = r.rows[0]!;
      } catch {
        return reject('AI_VOICE_TICKET_INVALID', 4401);
      }
      sessionId = id.data;
      reserved = claim.reserved_seconds;
      ctx = { userId: claim.user_id, demoMode: env.DEMO_MODE, requestId: request.id };
      if (ended) {
        // The app hung up while the ticket was being checked: settle now instead of waiting for the reaper.
        ended = false;
        return void end('DISCONNECTED');
      }

      try {
        const setup = await asUser(async (tx) => {
          const a = await allowance(tx, ROUTE);
          const prefs = await preferences(tx, claim!.user_id);
          const history = claim!.conversation_id
            ? (
                await tx
                  .select({ role: aiMessages.role, content: aiMessages.content })
                  .from(aiMessages)
                  .where(and(eq(aiMessages.conversationId, claim!.conversation_id), inArray(aiMessages.kind, ['MESSAGE', 'SIMULATED'])))
                  .orderBy(desc(aiMessages.createdAt))
                  .limit(HISTORY_MESSAGES)
              ).reverse()
            : [];
          return { a, prefs, history };
        });
        weeklyLimit = setup.a?.weeklyLimit ?? 0;
        usedBefore = Math.max(0, (setup.a?.used ?? 0) - reserved);
        let budget = HISTORY_CHARS;
        const turns = setup.history
          .reverse()
          .filter((m) => (budget -= m.content.length) >= 0)
          .reverse()
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
        const instructions = [policyFor(ROUTE), preferenceContext(setup.prefs, setup.prefs.assistantName)].join('\n\n');
        provider = await realtime[claim.provider].connect({
          model: claim.model_id,
          instructions,
          language: claim.locale,
          history: turns,
          maxOutputTokens: claim.max_output_tokens,
          requestId: request.id,
          endUserRef: endUserRefFor(env.BETTER_AUTH_SECRET, claim.user_id),
          onEvent: (e) => void onProviderEvent(e),
        });
        if (ended) provider.close();
      } catch (e) {
        request.log.warn({ provider: claim.provider, err: e instanceof Error ? e.message : String(e) }, 'voice provider connection failed');
        send({ type: 'error', code: 'AI_UNAVAILABLE' });
        return void end('PROVIDER_ERROR');
      }
    })();

    return { end, done };
  }

  // Abandoned sessions (lost connections, a restarted server) are settled from their last heartbeat.
  const reaper = setInterval(() => {
    void withContext(db, { userId: null, demoMode: env.DEMO_MODE }, (tx) => tx.execute(sql`select app.ai_voice_reap(null)`)).catch(() => undefined);
  }, 60_000);
  reaper.unref();
  app.addHook('preClose', async () => {
    clearInterval(reaper);
    await Promise.allSettled([...active].map((r) => r.end('SERVER_SHUTDOWN')));
  });
}
