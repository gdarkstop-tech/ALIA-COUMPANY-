import { BRAND_NAME_EN, assignRoleBody, requiresMfa, updateMeBody, type MeResponse, type Role, type SelfContactField } from '@ghayarly/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db/client';
import { patients, userProfiles, userRoles } from '../../db/schema';
import { audit } from '../../lib/audit';
import { AppError, forbidden } from '../../lib/errors';
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

/** Required details missing from the patient's own profile (none until that profile exists). */
async function missingContactFields(tx: Tx, principal: Principal, roles: Role[]): Promise<SelfContactField[]> {
  if (!roles.includes('PATIENT')) return [];
  const [self] = await tx.select({ governorate: patients.governorate, city: patients.city, phone: patients.phone }).from(patients).where(eq(patients.linkedUserId, principal.userId));
  if (!self) return [];
  return [...(self.governorate ? [] : ['GOVERNORATE' as const]), ...(self.city?.trim() ? [] : ['CITY' as const]), ...(self.phone ? [] : ['PHONE' as const])];
}

export async function meRoutes(app: FastifyInstance) {
  const { env } = app.services;

  const toResponse = (principal: Principal, profile: Awaited<ReturnType<typeof ensureProfile>>, roles: Role[], missing: SelfContactField[]): MeResponse => ({
    user: principal.user,
    roles,
    profile: {
      displayName: profile.displayName,
      locale: profile.locale,
      activeRole: profile.activeRole,
      assistantName: profile.assistantName,
      onboardingCompletedAt: profile.onboardingCompletedAt,
      missingContactFields: missing,
    },
    mfa: { required: requiresMfa(roles), enrolled: principal.user.twoFactorEnabled, enforcement: env.MFA_ENFORCEMENT },
    account: principal.account,
    demoMode: env.DEMO_MODE,
  });

  app.get('/me', async (request) => {
    const principal = await requirePrincipal(request);
    const [profile, missing] = await inContext(request, principal, async (tx) => [await ensureProfile(tx, principal), await missingContactFields(tx, principal, principal.roles)] as const);
    return toResponse(principal, profile, principal.roles, missing);
  });

  app.patch('/me', async (request) => {
    const principal = await requirePrincipal(request);
    const body = parse(updateMeBody, request.body);
    if (body.activeRole && !principal.roles.includes(body.activeRole)) throw forbidden('ROLE_NOT_HELD', 'You do not hold that role');
    const [profile, missing] = await inContext(request, principal, async (tx) => {
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
      return [updated!, await missingContactFields(tx, principal, principal.roles)] as const;
    });
    return toResponse(principal, profile, principal.roles, missing);
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
    const [profile, missing] = await inContext(request, principal, async (tx) => [await ensureProfile(tx, principal), await missingContactFields(tx, principal, roles)] as const);
    return toResponse({ ...principal, roles }, profile, roles, missing);
  });

  app.post('/me/onboarding/complete', async (request) => {
    const principal = await requirePrincipal(request);
    await inContext(request, principal, async (tx) => {
      await ensureProfile(tx, principal);
      // Patients: governorate, city / area and mobile number are required on their own profile.
      if (principal.roles.includes('PATIENT')) {
        const [self] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.linkedUserId, principal.userId));
        const missing = await missingContactFields(tx, principal, principal.roles);
        if (!self || missing.length) throw new AppError(422, 'PROFILE_INCOMPLETE', 'Governorate, city / area and mobile number are required', { missing: self ? missing : ['GOVERNORATE', 'CITY', 'PHONE'] });
      }
      await tx.update(userProfiles).set({ onboardingCompletedAt: new Date().toISOString() }).where(eq(userProfiles.userId, principal.userId));
    });
    return { ok: true };
  });
}
