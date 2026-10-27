/**
 * Patient AI assistant (route `patient.chat`). Order of operations for every message:
 *   1. Deterministic emergency check — emergencies get fixed guidance (call 123), no model, no quota.
 *   2. Reserve allowance in the database (every gate: flag, consent, model, budget, weekly quota),
 *      committed BEFORE the provider is called so concurrent requests cannot overspend.
 *   3. Call the provider outside any database transaction (fallback model on provider failure).
 *   4. Settle with the provider's reported usage (cost from verified prices) — or release.
 */
import { createHmac } from 'node:crypto';
import {
  createConversationBody,
  sendMessageBody,
  type AiAllowance,
  type AiAssistantStatus,
  type AiChatMessage,
  type AiConversation,
  type AiConversationDetail,
  type AiReply,
} from '@ghayarly/shared';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Tx } from '../../db/client';
import { aiConversations, aiMessages, userProfiles } from '../../db/schema';
import { AiProviderError, configuredProviders, type AiProviderCode, type AiResult, type AiTurn } from '../../integrations/ai';
import { AppError, notFound } from '../../lib/errors';
import { inContext, requirePrincipal, type Principal } from '../../lib/principal';
import { sessionKey } from '../../lib/rateLimitKey';
import { parse } from '../../lib/validate';
import { ASSISTANT_POLICY, emergencyGuidance, looksLikeEmergency, patientSummary, refusalNotice, replyLocale } from './safety';

const ROUTE = 'patient.chat';
const HISTORY_MESSAGES = 20;
const HISTORY_CHARS = 24_000;
const idParam = z.object({ id: z.string().uuid() });
const iso = (v: string) => new Date(v).toISOString();

type Candidate = { provider: AiProviderCode; modelId: string; effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'; paid: boolean };
type Reservation = { reservation_id: string; candidates: Candidate[]; max_output_tokens: number };

/** The providers this server can call, as a PostgreSQL array literal for the router. */
const providerArray = (codes: AiProviderCode[]) => sql`${`{${codes.join(',')}}`}::app.ai_provider[]`;

function messageDto(m: typeof aiMessages.$inferSelect): AiChatMessage {
  return { id: m.id, role: m.role as 'user' | 'assistant', kind: m.kind as AiChatMessage['kind'], content: m.content, createdAt: iso(m.createdAt) };
}

async function allowance(tx: Tx): Promise<AiAllowance | null> {
  const r = await tx.execute<{ metric: AiAllowance['metric']; weekly_limit: number; used: number; resets_at: string; tier: AiAllowance['tier']; plan: AiAllowance['plan'] }>(
    sql`select * from app.ai_allowance(${ROUTE})`,
  );
  const a = r.rows[0];
  return a ? { metric: a.metric, weeklyLimit: a.weekly_limit, used: a.used, remaining: Math.max(0, a.weekly_limit - a.used), resetsAt: iso(a.resets_at), tier: a.tier, plan: a.plan } : null;
}

export async function aiRoutes(app: FastifyInstance) {
  const { ai, env } = app.services;
  /** Opaque, non-reversible per-person reference for the provider's abuse monitoring. */
  const endUserRef = (userId: string) => createHmac('sha256', env.BETTER_AUTH_SECRET).update(`ai-end-user:${userId}`).digest('hex').slice(0, 32);

  async function assistantStatus(request: FastifyRequest, principal: Principal): Promise<AiAssistantStatus> {
    return inContext(request, principal, async (tx) => {
      const r = await tx.execute<{ feature_on: boolean; internal_test: boolean; consented: boolean; route_on: boolean; eligible: number; eligible_free: number; budget_ok: boolean }>(
        sql`select * from app.ai_route_status(${ROUTE}, ${providerArray(configuredProviders(ai))})`,
      );
      const s = r.rows[0];
      // Same eligibility rules as the router (configured, active, approved models for this plan tier).
      const unavailableReason: AiAssistantStatus['unavailableReason'] =
        !s || (!s.feature_on && !s.internal_test) ? 'FEATURE_DISABLED'
        : !s.route_on || s.eligible === 0 ? 'NOT_CONFIGURED'
        : s.eligible_free === 0 && !s.budget_ok ? 'PAUSED'
        : !s.consented ? 'CONSENT_REQUIRED'
        : null;
      return { unavailableReason, allowance: unavailableReason === 'FEATURE_DISABLED' ? null : await allowance(tx) };
    });
  }

  app.get('/ai/assistant', async (request) => {
    const principal = await requirePrincipal(request);
    return assistantStatus(request, principal);
  });

  app.get('/ai/conversations', async (request): Promise<AiConversation[]> => {
    const principal = await requirePrincipal(request);
    return inContext(request, principal, async (tx) => {
      const rows = await tx.select().from(aiConversations).where(eq(aiConversations.userId, principal.userId)).orderBy(desc(aiConversations.updatedAt)).limit(100);
      return rows.map((c) => ({ id: c.id, title: c.title, patientId: c.patientId, createdAt: iso(c.createdAt), updatedAt: iso(c.updatedAt) }));
    });
  });

  app.post('/ai/conversations', async (request, reply) => {
    const principal = await requirePrincipal(request);
    const body = parse(createConversationBody, request.body ?? {});
    const status = await assistantStatus(request, principal);
    if (status.unavailableReason) throw new AppError(status.unavailableReason === 'CONSENT_REQUIRED' ? 403 : 409, status.unavailableReason === 'CONSENT_REQUIRED' ? 'AI_CONSENT_REQUIRED' : status.unavailableReason, 'The assistant is not available');
    const created = await inContext(request, principal, async (tx) => {
      // RLS: a profile can be shared only if the person is authorized to view it.
      const [c] = await tx.insert(aiConversations).values({ userId: principal.userId, routeKey: ROUTE, patientId: body.patientId ?? null }).returning();
      return c!;
    });
    return reply.status(201).send({ id: created.id, title: created.title, patientId: created.patientId, createdAt: iso(created.createdAt), updatedAt: iso(created.updatedAt), messages: [] } satisfies AiConversationDetail);
  });

  app.get('/ai/conversations/:id', async (request): Promise<AiConversationDetail> => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    return inContext(request, principal, async (tx) => {
      const [c] = await tx.select().from(aiConversations).where(eq(aiConversations.id, id));
      if (!c) throw notFound('Conversation');
      const msgs = await tx.select().from(aiMessages).where(eq(aiMessages.conversationId, id)).orderBy(asc(aiMessages.createdAt));
      return { id: c.id, title: c.title, patientId: c.patientId, createdAt: iso(c.createdAt), updatedAt: iso(c.updatedAt), messages: msgs.map(messageDto) };
    });
  });

  app.delete('/ai/conversations/:id', async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    return inContext(request, principal, async (tx) => {
      const deleted = await tx.delete(aiConversations).where(eq(aiConversations.id, id)).returning({ id: aiConversations.id });
      if (!deleted.length) throw notFound('Conversation');
      return { ok: true };
    });
  });

  app.post('/ai/conversations/:id/messages', { config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator: sessionKey } } }, async (request): Promise<AiReply> => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    const { content } = parse(sendMessageBody, request.body);

    // 1–2. Emergency check, then the reservation (both committed before any provider call).
    const prep = await inContext(request, principal, async (tx) => {
      const [c] = await tx.select().from(aiConversations).where(eq(aiConversations.id, id));
      if (!c) throw notFound('Conversation');
      const [profile] = await tx.select({ locale: userProfiles.locale }).from(userProfiles).where(eq(userProfiles.userId, principal.userId));
      const locale = replyLocale(content, profile?.locale ?? 'ar');
      if (looksLikeEmergency(content)) {
        await tx.insert(aiMessages).values({ conversationId: id, userId: principal.userId, role: 'user', content });
        const r = await tx.execute<{ id: string }>(sql`select app.ai_record_emergency(${id}::uuid, ${emergencyGuidance(locale)}) as id`);
        const [m] = await tx.select().from(aiMessages).where(eq(aiMessages.id, r.rows[0]!.id));
        return { emergency: messageDto(m!), allowance: await allowance(tx) } as const;
      }
      const summary = c.patientId ? await patientSummary(tx, c.patientId) : null;
      // The router sees only the size of the request and its language, never its content.
      const requestChars = [...content].length + (summary ? [...summary].length : 0);
      const reservation = (
        await tx.execute<Reservation>(sql`select * from app.ai_reserve(${ROUTE}, 1, ${providerArray(configuredProviders(ai))}, ${requestChars}, ${locale})`)
      ).rows[0]!;
      await tx.insert(aiMessages).values({ conversationId: id, userId: principal.userId, role: 'user', content });
      if (!c.title) await tx.update(aiConversations).set({ title: content.slice(0, 60) }).where(eq(aiConversations.id, id));
      // History: the person's own messages and the assistant's real answers, newest last.
      const history = (await tx.select().from(aiMessages).where(and(eq(aiMessages.conversationId, id), inArray(aiMessages.kind, ['MESSAGE', 'SIMULATED']))).orderBy(desc(aiMessages.createdAt)).limit(HISTORY_MESSAGES)).reverse();
      return { reservation, history, summary, locale } as const;
    });
    if ('emergency' in prep) return { message: prep.emergency!, allowance: prep.allowance ?? null };

    const { reservation, history, summary, locale } = prep;
    const turns: AiTurn[] = [];
    let budget = HISTORY_CHARS;
    for (const m of [...history].reverse()) {
      if (budget - m.content.length < 0 && turns.length) break;
      budget -= m.content.length;
      turns.unshift({ role: m.role as AiTurn['role'], content: m.content });
    }
    while (turns[0]?.role === 'assistant') turns.shift();
    if (summary && turns[0]) turns[0] = { role: 'user', content: `${summary}\n\n${turns[0].content}` };

    // 3. Provider call(s), outside the database transaction: the first eligible candidate, then —
    //    only for a retryable failure — one fallback, preferring a different provider.
    const base = { system: ASSISTANT_POLICY, messages: turns, maxOutputTokens: reservation.max_output_tokens, requestId: request.id, endUserRef: endUserRef(principal.userId) };
    const [primary, ...rest] = reservation.candidates;
    let result: AiResult | null = null;
    let servedBy: AiProviderCode = primary!.provider;
    try {
      result = await ai[primary!.provider].complete({ ...base, model: primary!.modelId, effort: primary!.effort });
    } catch (e) {
      const fallback = e instanceof AiProviderError && e.retryable ? (rest.find((c) => c.provider !== primary!.provider) ?? rest[0]) : undefined;
      request.log.warn({ provider: primary!.provider, kind: e instanceof AiProviderError ? e.kind : 'UNKNOWN', fallback: fallback?.provider ?? null }, 'ai provider call failed');
      if (fallback) {
        try {
          servedBy = fallback.provider;
          result = await ai[fallback.provider].complete({ ...base, model: fallback.modelId, effort: fallback.effort });
        } catch (e2) {
          request.log.warn({ provider: servedBy, kind: e2 instanceof AiProviderError ? e2.kind : 'UNKNOWN' }, 'ai fallback call failed');
        }
      }
    }
    if (!result || (result.outcome !== 'REFUSED' && !result.text)) {
      // Nothing delivered: the allowance goes back.
      await inContext(request, principal, (tx) => tx.execute(sql`select app.ai_release(${reservation.reservation_id}::uuid)`));
      throw new AppError(503, 'AI_UNAVAILABLE', 'The assistant could not answer right now. Nothing was counted against your allowance.');
    }

    // 4. Settle with the provider's own usage report.
    const final = result;
    return inContext(request, principal, async (tx) => {
      const kind = final.outcome === 'REFUSED' ? 'REFUSAL' : servedBy === 'SIMULATED' ? 'SIMULATED' : 'MESSAGE';
      const text = final.outcome === 'REFUSED' ? refusalNotice(locale) : final.text.slice(0, 12_000);
      const r = await tx.execute<{ id: string }>(
        sql`select app.ai_settle(${reservation.reservation_id}::uuid, ${id}::uuid, ${servedBy}::app.ai_provider, ${final.servedModel}, ${final.usage.inputTokens}, ${final.usage.outputTokens}, ${final.usage.cacheReadTokens}, ${final.outcome}, ${kind}, ${text}) as id`,
      );
      const [m] = await tx.select().from(aiMessages).where(eq(aiMessages.id, r.rows[0]!.id));
      return { message: messageDto(m!), allowance: await allowance(tx) };
    });
  });
}
