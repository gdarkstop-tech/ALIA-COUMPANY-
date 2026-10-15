import { BRAND_NAME_EN, assignRoleBody, requiresMfa, updateMeBody, type MeResponse, type Role } from '@ghayarly/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db/client';
import { userProfiles, userRoles } from '../../db/schema';
import { audit } from '../../lib/audit';
import { forbidden } from '../../lib/errors';
import { inContext, requirePrincipal, type Principal } from '../../lib/principal';
import { parse } from '../../lib/validate';

async function ensureProfile(tx: Tx, principal: Principal) {
  const [existing] = await tx.select().from(userProfiles).where(eq(userProfiles.userId, principal.userId));
  if (existing) return existing;
  const [created] = await tx
    .insert(userProfiles)
    .values({ userId: principal.userId, displayName: principal.user.name.slice(0, 80) || `${BRAND_NAME_EN} user` })
    .returning();
  return created!;
}

export async function meRoutes(app: FastifyInstance) {
  const { env } = app.services;

  const toResponse = (principal: Principal, profile: Awaited<ReturnType<typeof ensureProfile>>, roles: Role[]): MeResponse => ({
    user: principal.user,
    roles,
    profile: {
      displayName: profile.displayName,
      locale: profile.locale,
      activeRole: profile.activeRole,
      assistantName: profile.assistantName,
      onboardingCompletedAt: profile.onboardingCompletedAt,
    },
    mfa: { required: requiresMfa(roles), enrolled: principal.user.twoFactorEnabled, enforcement: env.MFA_ENFORCEMENT },
    demoMode: env.DEMO_MODE,
  });

  app.get('/me', async (request) => {
    const principal = await requirePrincipal(request);
    const profile = await inContext(request, principal, (tx) => ensureProfile(tx, principal));
    return toResponse(principal, profile, principal.roles);
  });

  app.patch('/me', async (request) => {
    const principal = await requirePrincipal(request);
    const body = parse(updateMeBody, request.body);
    if (body.activeRole && !principal.roles.includes(body.activeRole)) throw forbidden('ROLE_NOT_HELD', 'You do not hold that role');
    const profile = await inContext(request, principal, async (tx) => {
      await ensureProfile(tx, principal);
      const [updated] = await tx
        .update(userProfiles)
        .set({
          ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
          ...(body.locale !== undefined ? { locale: body.locale } : {}),
          ...(body.activeRole !== undefined ? { activeRole: body.activeRole } : {}),
          ...(body.assistantName !== undefined ? { assistantName: body.assistantName } : {}),
        })
        .where(eq(userProfiles.userId, principal.userId))
        .returning();
      return updated!;
    });
    return toResponse(principal, profile, principal.roles);
  });

  /** Self-service role selection — only PATIENT / DOCTOR / NURSE (validated here and by RLS). */
  app.post('/me/roles', async (request) => {
    const principal = await requirePrincipal(request);
    const { role } = parse(assignRoleBody, request.body);
    const roles = await inContext(request, principal, async (tx) => {
      await ensureProfile(tx, principal);
      await tx
        .insert(userRoles)
        .values({ userId: principal.userId, role, grantedByUserId: principal.userId })
        .onConflictDoNothing();
      await tx.update(userProfiles).set({ activeRole: role }).where(eq(userProfiles.userId, principal.userId));
      await audit(tx, { actorUserId: principal.userId, action: 'user.role.self_assigned', entityType: 'user', entityId: principal.userId, requestId: request.id, metadata: { role } });
      const rows = await tx.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, principal.userId));
      return rows.map((r) => r.role);
    });
    const profile = await inContext(request, principal, (tx) => ensureProfile(tx, principal));
    return toResponse({ ...principal, roles }, profile, roles);
  });

  app.post('/me/onboarding/complete', async (request) => {
    const principal = await requirePrincipal(request);
    await inContext(request, principal, async (tx) => {
      await ensureProfile(tx, principal);
      await tx.update(userProfiles).set({ onboardingCompletedAt: new Date().toISOString() }).where(eq(userProfiles.userId, principal.userId));
    });
    return { ok: true };
  });
}
