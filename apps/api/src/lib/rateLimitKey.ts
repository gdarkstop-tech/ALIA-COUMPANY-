import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

/**
 * Per-session rate-limit key: Egyptian mobile networks put many users behind one carrier-grade
 * NAT address, so IP-only limits would let one person lock out others (and let one account spread
 * over many IPs). Hashing keeps the raw cookie out of the limiter store.
 */
export function sessionKey(request: FastifyRequest): string {
  const cookie = request.headers.cookie ?? request.headers.authorization ?? '';
  return cookie ? `s:${createHash('sha256').update(cookie).digest('hex').slice(0, 32)}` : `ip:${request.ip}`;
}
