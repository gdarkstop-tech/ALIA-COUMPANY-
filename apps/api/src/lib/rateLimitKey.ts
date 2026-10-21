import type { FastifyRequest } from 'fastify';
import { getPrincipal } from './principal';

/**
 * Rate-limit key for signed-in endpoints: the account, not the network address. Egyptian mobile
 * networks put many users behind one carrier-grade NAT address (an IP key would let one person
 * lock out others), and keying on raw headers would let a client mint a new key per request.
 * Anonymous callers fall back to the proxy-resolved IP.
 */
export async function sessionKey(request: FastifyRequest): Promise<string> {
  const principal = await getPrincipal(request).catch(() => null);
  return principal ? `u:${principal.userId}` : `ip:${request.ip}`;
}
