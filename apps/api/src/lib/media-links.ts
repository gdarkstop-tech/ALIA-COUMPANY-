import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env';

/**
 * Short-lived signed links for medical images (ADR 0015). An image element cannot send the session,
 * so the API mints a link bound to ONE person, ONE object and a short expiry, after checking access
 * and writing an audit entry. Fetching it re-checks access as that person (a revoked share or a
 * withdrawn consent stops working at once, not when the link expires). Links are never logged.
 */
export type MediaKind = 'vault' | 'research' | 'presentation' | 'candidate';
export type MediaVariant = 'original' | 'derived';
export type MediaClaim = { k: MediaKind; id: string; v: MediaVariant; u: string; exp: number };

export const MEDIA_LINK_TTL_SECONDS = 120;
const b64 = (b: Buffer) => b.toString('base64url');

export function mediaLinkKey(env: Env): Buffer {
  return env.MEDIA_LINK_SECRET
    ? Buffer.from(env.MEDIA_LINK_SECRET, 'utf8')
    : Buffer.from(hkdfSync('sha256', env.BETTER_AUTH_SECRET, 'dmw-media-links', 'development-only media link key', 32));
}

export function signMediaLink(key: Buffer, claim: Omit<MediaClaim, 'exp'>, now = Date.now()): { token: string; expiresAt: string } {
  const exp = Math.floor(now / 1000) + MEDIA_LINK_TTL_SECONDS;
  const body = b64(Buffer.from(JSON.stringify({ ...claim, exp }), 'utf8'));
  const sig = b64(createHmac('sha256', key).update(body).digest());
  return { token: `${body}.${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export function verifyMediaLink(key: Buffer, token: string, now = Date.now()): MediaClaim | null {
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined || body.length > 400) return null;
  const expected = createHmac('sha256', key).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as MediaClaim;
    if (typeof c.exp !== 'number' || c.exp * 1000 < now) return null;
    if (!['vault', 'research', 'presentation', 'candidate'].includes(c.k) || !['original', 'derived'].includes(c.v)) return null;
    if (typeof c.id !== 'string' || !/^[0-9a-f-]{36}$/.test(c.id) || typeof c.u !== 'string' || !c.u) return null;
    return c;
  } catch {
    return null;
  }
}
