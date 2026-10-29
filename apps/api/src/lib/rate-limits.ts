import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type { Env } from '../config/env';
import { sessionKey } from './rateLimitKey';

/**
 * API rate-limit policy (ADR 0016). Three layers, all answering 429 RATE_LIMITED with an accurate
 * Retry-After:
 *  1. per-IP ceiling over ALL traffic — cheap, checked first, before any session lookup, so one
 *     address cannot flood the API with many accounts or forged cookies;
 *  2. per account for signed-in traffic, per IP for anonymous traffic (the global limiter) — many
 *     people behind one carrier-grade NAT address no longer throttle each other;
 *  3. per-route limits on expensive or sensitive actions (AI, uploads, exports) keyed by account,
 *     plus per-account daily upload caps.
 * Sign-in, sign-up, OTP, password reset and TOTP keep their own strict per-IP limits inside Better
 * Auth (auth.ts, counters in PostgreSQL), unchanged by this policy.
 */
export type RateLimitPolicy = {
  accountPerMinute: number;
  anonymousIpPerMinute: number;
  ipCeilingPerMinute: number;
  uploadsPerAccountPerDay: number;
};

export function rateLimitPolicy(env: Env): RateLimitPolicy {
  const test = env.NODE_ENV === 'test';
  return {
    accountPerMinute: env.RATE_LIMIT_ACCOUNT_PER_MIN ?? (test ? 10_000 : 600),
    anonymousIpPerMinute: env.RATE_LIMIT_ANON_IP_PER_MIN ?? (test ? 10_000 : 300),
    ipCeilingPerMinute: env.RATE_LIMIT_IP_CEILING_PER_MIN ?? (test ? 100_000 : 6_000),
    uploadsPerAccountPerDay: env.UPLOADS_PER_ACCOUNT_PER_DAY ?? 200,
  };
}

/** Thrown through the error handler, which renders `{ error: { code: 'RATE_LIMITED' } }` with 429. */
export function rateLimited(): Error {
  return Object.assign(new Error('Too many requests'), { statusCode: 429, code: 'RATE_LIMITED' });
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export type WindowHit = { count: number; resetInMs: number };

/**
 * Fixed-window counters shared by every API instance through Redis (one atomic script per hit).
 * Without Redis (tests, a single development process) or while Redis is unreachable, counting
 * falls back to this process's memory: the limit still holds per instance instead of failing open.
 */
export function createWindowCounter(redis: Redis | null) {
  const memory = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = Date.now();
  const SCRIPT = "local c = redis.call('INCR', KEYS[1]) if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end local t = redis.call('PTTL', KEYS[1]) if t < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) t = tonumber(ARGV[1]) end return {c, t}";

  function inMemory(key: string, windowMs: number): WindowHit {
    const now = Date.now();
    if (now - lastSweep > 60_000) {
      for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
      lastSweep = now;
    }
    let entry = memory.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      memory.set(key, entry);
    }
    entry.count += 1;
    return { count: entry.count, resetInMs: entry.resetAt - now };
  }

  return {
    async hit(key: string, windowMs: number): Promise<WindowHit> {
      if (redis && redis.status === 'ready') {
        try {
          const [count, ttl] = (await redis.eval(SCRIPT, 1, `dmw-rl:${key}`, String(windowMs))) as [number, number];
          return { count: Number(count), resetInMs: Number(ttl) };
        } catch {
          // Redis hiccup: count locally rather than letting traffic through uncounted.
        }
      }
      return inMemory(key, windowMs);
    },
  };
}

export type WindowCounter = ReturnType<typeof createWindowCounter>;

function retryAfterSeconds(hit: WindowHit): number {
  return Math.max(1, Math.ceil(hit.resetInMs / 1000));
}

/** Layer 1: per-IP ceiling, registered before the rate-limit plugin so it runs first. */
export function registerIpCeiling(app: FastifyInstance, counter: WindowCounter, perMinute: number) {
  app.addHook('onRequest', async (request, reply) => {
    if ((request.routeOptions.config as { rateLimit?: unknown } | undefined)?.rateLimit === false) return;
    const hit = await counter.hit(`ceiling:${request.ip}`, 60_000);
    if (hit.count > perMinute) {
      reply.header('retry-after', retryAfterSeconds(hit));
      throw rateLimited();
    }
  });
}

/** Layer 2 options for @fastify/rate-limit: account when signed in, IP otherwise. */
export function globalLimiterOptions(policy: RateLimitPolicy) {
  return {
    keyGenerator: (request: FastifyRequest) => sessionKey(request),
    max: (_request: FastifyRequest, key: string) => (key.startsWith('u:') ? policy.accountPerMinute : policy.anonymousIpPerMinute),
  };
}

/**
 * Per-account allowance over a longer window (e.g. uploads per day). Call it inside the handler
 * after the request is authenticated and validated, just before the costly work.
 */
export async function consumeAllowance(app: FastifyInstance, reply: { header: (k: string, v: number) => unknown }, key: string, max: number, windowMs: number) {
  const hit = await app.services.counters.hit(key, windowMs);
  if (hit.count > max) {
    reply.header('retry-after', retryAfterSeconds(hit));
    throw rateLimited();
  }
}
