import { hasPermission, requiresMfa, type AccountStatusInfo, type Permission, type Role } from '@ghayarly/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withContext, type RequestContext, type Tx } from '../db/client';
import { accountStatus, userRoles } from '../db/schema';
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
  /** Effective account status (an elapsed suspension counts as ACTIVE). */
  account: AccountStatusInfo;
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
  const { roles, account } = await withContext(db, { userId: u.id, demoMode: env.DEMO_MODE }, async (tx) => {
    const roles = await tx
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(and(eq(userRoles.userId, u.id), isNull(userRoles.revokedAt)));
    const [row] = await tx
      .select({ s: accountStatus, effective: sql<AccountStatusInfo['status']>`app.account_status_of(${u.id})` })
      .from(accountStatus)
      .where(eq(accountStatus.userId, u.id));
    const account: AccountStatusInfo = row
      ? {
          status: row.effective,
          bookingsRestricted: row.s.bookingsRestricted,
          reason: row.effective === 'ACTIVE' && !row.s.bookingsRestricted ? null : row.s.reason,
          publicMessage: row.effective === 'ACTIVE' && !row.s.bookingsRestricted ? null : row.s.publicMessage,
          suspendedUntil: row.effective === 'SUSPENDED' && row.s.suspendedUntil ? new Date(row.s.suspendedUntil).toISOString() : null,
        }
      : { status: 'ACTIVE', bookingsRestricted: false, reason: null, publicMessage: null, suspendedUntil: null };
    return { roles, account };
  });
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
    account,
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

/** As requirePermission, for screens shared by several duties (e.g. catalogue editors and clinical approvers). */
export async function requireAnyPermission(request: FastifyRequest, ...permissions: Permission[]): Promise<Principal> {
  const principal = await requirePrincipal(request);
  if (!permissions.some((p) => hasPermission(principal.roles, p))) throw forbidden('PERMISSION_REQUIRED', `Requires one of: ${permissions.join(', ')}`);
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
