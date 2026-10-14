import { hasPermission, requiresMfa, type Permission, type Role } from '@ghayarly/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withContext, type RequestContext, type Tx } from '../db/client';
import { userRoles } from '../db/schema';
import { forbidden, unauthorized } from './errors';

export type Principal = {
  userId: string;
  sessionId: string;
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    phoneNumber: string | null;
    phoneNumberVerified: boolean;
    twoFactorEnabled: boolean;
  };
  roles: Role[];
};

declare module 'fastify' {
  interface FastifyRequest {
    principalCache?: Principal | null;
  }
}

export function registerPrincipal(app: FastifyInstance) {
  app.decorateRequest('principalCache', undefined);
}

/** Resolves (and caches per request) the authenticated principal from the Better Auth session. */
export async function getPrincipal(request: FastifyRequest): Promise<Principal | null> {
  if (request.principalCache !== undefined) return request.principalCache;
  const { auth, db, env } = request.server.services;
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  if (!session) {
    request.principalCache = null;
    return null;
  }
  const u = session.user as typeof session.user & { phoneNumber?: string | null; phoneNumberVerified?: boolean | null; twoFactorEnabled?: boolean | null };
  const roles = await withContext(db, { userId: u.id, demoMode: env.DEMO_MODE }, (tx) =>
    tx
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(and(eq(userRoles.userId, u.id), isNull(userRoles.revokedAt))),
  );
  request.principalCache = {
    userId: u.id,
    sessionId: session.session.id,
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      emailVerified: u.emailVerified,
      phoneNumber: u.phoneNumber ?? null,
      phoneNumberVerified: Boolean(u.phoneNumberVerified),
      twoFactorEnabled: Boolean(u.twoFactorEnabled),
    },
    roles: roles.map((r) => r.role),
  };
  return request.principalCache;
}

export async function requirePrincipal(request: FastifyRequest): Promise<Principal> {
  const principal = await getPrincipal(request);
  if (!principal) throw unauthorized();
  return principal;
}

export async function requireRole(request: FastifyRequest, ...roles: Role[]): Promise<Principal> {
  const principal = await requirePrincipal(request);
  if (!principal.roles.some((r) => roles.includes(r))) throw forbidden('ROLE_REQUIRED', `Requires one of: ${roles.join(', ')}`);
  return principal;
}

/**
 * Staff permission check (defence in depth — RLS enforces the same rules again) plus MFA
 * enforcement for privileged roles.
 */
export async function requirePermission(request: FastifyRequest, permission: Permission): Promise<Principal> {
  const principal = await requirePrincipal(request);
  if (!hasPermission(principal.roles, permission)) throw forbidden('PERMISSION_REQUIRED', `Missing permission ${permission}`);
  enforceMfa(request, principal);
  return principal;
}

export function enforceMfa(request: FastifyRequest, principal: Principal) {
  const { env } = request.server.services;
  if (requiresMfa(principal.roles) && !principal.user.twoFactorEnabled && env.MFA_ENFORCEMENT === 'required') {
    throw forbidden('MFA_REQUIRED', 'Two-step verification is required for this account');
  }
}

export function contextFor(request: FastifyRequest, principal: Principal | null): RequestContext {
  return { userId: principal?.userId ?? null, demoMode: request.server.services.env.DEMO_MODE, requestId: request.id };
}

/** Run a unit of work under the principal's RLS context. */
export function inContext<T>(request: FastifyRequest, principal: Principal | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withContext(request.server.services.db, contextFor(request, principal), fn);
}
