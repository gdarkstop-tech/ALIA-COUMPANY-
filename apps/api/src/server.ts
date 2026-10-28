import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { REQUIRED_ACCOUNT_CONSENTS } from '@ghayarly/shared';
import { sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import { createAuth, type Auth } from './auth/auth';
import { registerAuthRoutes } from './auth/routes';
import { webOrigins, type Env } from './config/env';
import { assertRlsEffective, createDb, createPools, type Db, type Pools } from './db/client';
import { createMessaging, type Messaging } from './integrations/messaging';
import { createPaymentGateway, type PaymentGateway } from './integrations/payments';
import { AppError, fromPgError } from './lib/errors';
import { serializeRequest } from './lib/logging';
import { getPrincipal, inContext, registerPrincipal } from './lib/principal';
import { adminRoutes } from './modules/admin/routes';
import { adminCatalogRoutes } from './modules/catalog/admin';
import { accountRoutes } from './modules/accounts/routes';
import { aiRoutes } from './modules/ai/routes';
import { knowledgeRoutes } from './modules/knowledge/routes';
import { documentRoutes } from './modules/documents/routes';
import { analyticsRoutes } from './modules/analytics/routes';
import { clinicianRoutes } from './modules/clinician/routes';
import { productKnowledgeRoutes } from './modules/products/routes';
import { adminAiRoutes } from './modules/ai/admin';
import { complianceRoutes } from './modules/compliance/routes';
import { billingRoutes } from './modules/billing/routes';
import { createStores, type Stores } from './integrations/billing';
import { createAiProviders, type AiProviders } from './integrations/ai';
import { createRealtimeProviders, type RealtimeProviders } from './integrations/ai/realtime';
import { voiceRoutes, type VoiceTiming } from './modules/ai/voice';
import { AI_VOICE_PROTOCOL } from '@ghayarly/shared';
import { dashboardRoutes } from './modules/dashboard/routes';
import { devRoutes } from './modules/dev/routes';
import { meRoutes } from './modules/me/routes';
import { patientRoutes } from './modules/patients/routes';
import { providerRoutes } from './modules/providers/routes';
import { serviceRoutes } from './modules/services/routes';
import { storeRoutes } from './modules/store/routes';
import { systemRoutes } from './modules/system/routes';

export type Services = {
  env: Env;
  db: Db;
  pools: Pools;
  auth: Auth;
  messaging: Messaging;
  payments: PaymentGateway;
  stores: Stores;
  ai: AiProviders;
  /** Realtime voice adapters (only providers with a realtime adapter can be CONFIGURED). */
  realtime: RealtimeProviders;
  /** Tests only: shorter voice timers. */
  voiceTiming?: Partial<VoiceTiming>;
};

declare module 'fastify' {
  interface FastifyInstance {
    services: Services;
  }
}

/** `overrides` exists for tests only (e.g. a store adapter fed with fixture payloads). */
export async function buildServer(
  env: Env,
  overrides: { stores?: Stores; ai?: Partial<AiProviders>; realtime?: Partial<RealtimeProviders>; voiceTiming?: Partial<VoiceTiming> } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      env.LOG_LEVEL === 'silent'
        ? false
        : {
            level: env.LOG_LEVEL,
            // Never log credentials, cookies or authorization material.
            // The voice stream ticket travels as a WebSocket subprotocol: never logged either.
            redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["sec-websocket-protocol"]', 'res.headers["set-cookie"]'], remove: true },
            // Single-use document links carry their ticket in the query string: never logged.
            serializers: { req: serializeRequest },
            ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } } : {}),
          },
    // Trust exactly TRUST_PROXY_HOPS proxies (counted from the server), never the whole header.
    trustProxy: env.NODE_ENV === 'production' ? (_address: string, hop: number) => hop < env.TRUST_PROXY_HOPS : false,
    genReqId: () => randomUUID(),
    bodyLimit: 1024 * 1024,
  });

  const pools = createPools(env);
  await assertRlsEffective(pools.appPool);
  const db = createDb(pools.appPool);
  const messaging = createMessaging(env, (line) => app.log.info(line));
  const payments = createPaymentGateway(env);
  const auth = createAuth(env, pools.authPool, messaging);
  const stores = overrides.stores ?? createStores(env);
  const ai: AiProviders = { ...createAiProviders(env), ...overrides.ai };
  const realtime: RealtimeProviders = { ...createRealtimeProviders(env), ...overrides.realtime };
  app.decorate('services', { env, db, pools, auth, messaging, payments, stores, ai, realtime, voiceTiming: overrides.voiceTiming });

  const redis = env.REDIS_URL && env.NODE_ENV !== 'test' ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false }) : null;
  redis?.on('error', (err) => app.log.warn({ err: err.message }, 'redis unavailable — rate limiting falls back per request'));

  app.addHook('onClose', async () => {
    await Promise.allSettled([pools.appPool.end(), pools.authPool.end(), redis?.quit()]);
  });

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } });
  const origins = webOrigins(env);
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || origins.includes(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-request-id', 'expo-origin', 'cookie'],
    maxAge: 600,
  });
  await app.register(rateLimit, {
    global: true,
    max: env.NODE_ENV === 'test' ? 10_000 : 300,
    timeWindow: '1 minute',
    ...(redis ? { redis, nameSpace: 'ghayarly-rl:', skipOnError: true } : {}),
    errorResponseBuilder: () => ({ statusCode: 429, error: { code: 'RATE_LIMITED', message: 'Too many requests' } }),
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } });
    }
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } });
    }
    const mapped = fromPgError(error);
    if (mapped) {
      request.log.info({ code: mapped.code }, 'database rule rejected request');
      return reply.status(mapped.statusCode).send({ error: { code: mapped.code, message: mapped.message, ...(mapped.details ? { details: mapped.details } : {}) } });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: { code: (error as { code?: string }).code ?? 'BAD_REQUEST', message: (error as Error).message } });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
  });
  app.setNotFoundHandler((_request, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));

  // CSRF defence in depth for cookie-authenticated, state-changing domain requests (on top of
  // SameSite=Lax cookies and CORS). Native clients send no Origin header and are unaffected.
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/v1/') || ['GET', 'HEAD', 'OPTIONS'].includes(request.method) || !request.headers.cookie) return;
    const origin = request.headers.origin;
    const site = request.headers['sec-fetch-site'];
    if ((origin && !origins.includes(origin)) || site === 'cross-site') {
      return reply.status(403).send({ error: { code: 'INVALID_ORIGIN', message: 'Request origin is not allowed' } });
    }
  });

  registerPrincipal(app);

  // Suspended / blocked accounts: everything is refused except seeing why, appealing, deleting the
  // account and anonymous crash reports. The database removes their roles and permissions too.
  const RESTRICTED_ALLOWED: { method: string; path: RegExp }[] = [
    { method: 'GET', path: /^\/v1\/me$/ },
    { method: 'GET', path: /^\/v1\/me\/account-status$/ },
    { method: 'GET', path: /^\/v1\/me\/appeals$/ },
    { method: 'POST', path: /^\/v1\/me\/appeals$/ },
    { method: 'POST', path: /^\/v1\/me\/account-deletion$/ },
    { method: 'GET', path: /^\/v1\/me\/consents$/ },
    { method: 'GET', path: /^\/v1\/system\// },
    { method: 'POST', path: /^\/v1\/telemetry\// },
  ];
  app.addHook('preHandler', async (request) => {
    if (!request.url.startsWith('/v1/') || request.method === 'OPTIONS') return;
    const principal = await getPrincipal(request);
    if (!principal || principal.account.status === 'ACTIVE') return;
    const path = request.url.split('?')[0]!;
    const method = request.method === 'HEAD' ? 'GET' : request.method;
    if (RESTRICTED_ALLOWED.some((r) => r.method === method && r.path.test(path))) return;
    throw new AppError(403, principal.account.status === 'BLOCKED' ? 'ACCOUNT_BLOCKED' : 'ACCOUNT_SUSPENDED', 'This account is restricted');
  });

  // Terms of Use + Privacy Policy acceptance is enforced here for every state-changing /v1 request,
  // not only by the app's consent screen (deep links, old app builds and other clients). Exempt:
  // answering the consents themselves, account deletion (declining the terms means deleting the
  // account), anonymous crash reports, appeals, and the staff console (staff work under employment
  // terms, not the consumer documents).
  const CONSENT_FREE_WRITES = [/^\/v1\/me\/consents$/, /^\/v1\/me\/account-deletion$/, /^\/v1\/me\/appeals(\/|$)/, /^\/v1\/telemetry\//, /^\/v1\/admin\//];
  app.addHook('preHandler', async (request) => {
    if (!request.url.startsWith('/v1/') || ['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    const path = request.url.split('?')[0]!;
    if (CONSENT_FREE_WRITES.some((r) => r.test(path))) return;
    const principal = await getPrincipal(request);
    if (!principal) return; // the route answers 401 itself
    const checks = sql.join(REQUIRED_ACCOUNT_CONSENTS.map((type) => sql`app.has_current_consent(${type}::app.consent_type)`), sql` and `);
    const res = await inContext(request, principal, (tx) => tx.execute<{ ok: boolean | null }>(sql`select ${checks} as ok`));
    if (!res.rows[0]?.ok) throw new AppError(403, 'CONSENT_REQUIRED', 'Accept the current Terms of Use and Privacy Policy to continue');
  });

  // WebSocket upgrades (voice relay only). Small frames; the ticket subprotocol is never echoed.
  await app.register(websocket, {
    options: { maxPayload: 96 * 1024, handleProtocols: (protocols) => (protocols.has(AI_VOICE_PROTOCOL) ? AI_VOICE_PROTOCOL : false) },
  });

  await registerAuthRoutes(app);
  await app.register(systemRoutes);
  await app.register(meRoutes, { prefix: '/v1' });
  await app.register(accountRoutes, { prefix: '/v1' });
  await app.register(aiRoutes, { prefix: '/v1' });
  await app.register(voiceRoutes, { prefix: '/v1' });
  await app.register(documentRoutes, { prefix: '/v1' });
  await app.register(analyticsRoutes, { prefix: '/v1' });
  await app.register(clinicianRoutes, { prefix: '/v1' });
  await app.register(knowledgeRoutes, { prefix: '/v1' });
  await app.register(productKnowledgeRoutes, { prefix: '/v1' });
  await app.register(adminAiRoutes, { prefix: '/v1/admin/ai' });
  await app.register(complianceRoutes, { prefix: '/v1' });
  await app.register(billingRoutes);
  await app.register(patientRoutes, { prefix: '/v1' });
  await app.register(providerRoutes, { prefix: '/v1' });
  await app.register(serviceRoutes, { prefix: '/v1' });
  await app.register(storeRoutes, { prefix: '/v1' });
  await app.register(dashboardRoutes, { prefix: '/v1' });
  await app.register(adminRoutes, { prefix: '/v1/admin' });
  await app.register(adminCatalogRoutes, { prefix: '/v1/admin/catalog' });
  if (env.DEV_TOOLS_ENABLED && env.NODE_ENV !== 'production') await app.register(devRoutes, { prefix: '/dev' });

  return app;
}
