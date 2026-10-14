import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const HOP_BY_HOP = new Set(['content-length', 'transfer-encoding', 'connection', 'keep-alive', 'host']);

/**
 * Mounts Better Auth at /api/auth/* by translating Fastify requests to Web Requests.
 * Multiple Set-Cookie headers are preserved individually.
 */
export async function registerAuthRoutes(app: FastifyInstance) {
  const { auth, env } = app.services;
  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const url = new URL(request.url, env.API_PUBLIC_URL);
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value === undefined || HOP_BY_HOP.has(key)) continue;
      if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
      else headers.set(key, String(value));
    }
    if (request.ip && !headers.has('x-forwarded-for')) headers.set('x-forwarded-for', request.ip);
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body !== undefined && request.body !== null;
    const webRequest = new Request(url, {
      method: request.method,
      headers,
      body: hasBody ? (typeof request.body === 'string' ? request.body : JSON.stringify(request.body)) : undefined,
    });
    const response = await auth.handler(webRequest);
    reply.status(response.status);
    response.headers.forEach((value, key) => {
      if (key === 'set-cookie' || HOP_BY_HOP.has(key)) return;
      reply.header(key, value);
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) reply.header('set-cookie', cookies);
    const body = response.body ? Buffer.from(await response.arrayBuffer()) : null;
    return reply.send(body);
  };
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    // Per-endpoint brute-force limits (sign-in, OTP, password reset, 2FA) are enforced by Better
    // Auth itself (see auth.ts); the global API ceiling still applies here.
    handler,
  });
}
