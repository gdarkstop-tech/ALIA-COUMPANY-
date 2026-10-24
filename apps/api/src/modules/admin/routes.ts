import {
  credentialDecisionBody,
  decisionRequiresReason,
  decisionTarget,
  verificationDecisionBody,
  VERIFICATION_STATUSES,
  type AuditLogEntry,
  type VerificationQueueItem,
} from '@ghayarly/shared';
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  auditLog,
  providerCredentials,
  providerProfiles,
  providerVerificationEvents,
  providerWorkingHours,
  userProfiles,
} from '../../db/schema';
import { audit } from '../../lib/audit';
import { notFound, unprocessable } from '../../lib/errors';
import { inContext, requirePermission } from '../../lib/principal';
import { parse } from '../../lib/validate';
import { credentialToDto } from '../providers/routes';

export async function adminRoutes(app: FastifyInstance) {
  app.get('/overview', async (request) => {
    const principal = await requirePermission(request, 'provider.verification.review');
    return inContext(request, principal, async (tx) => {
      const rows = await tx
        .select({ status: providerProfiles.verificationStatus, type: providerProfiles.providerType, n: sql<number>`count(*)::int` })
        .from(providerProfiles)
        .groupBy(providerProfiles.verificationStatus, providerProfiles.providerType);
      return { providersByStatus: rows, mfaEnforcement: app.services.env.MFA_ENFORCEMENT, demoMode: app.services.env.DEMO_MODE };
    });
  });

  app.get('/verification-queue', async (request) => {
    const principal = await requirePermission(request, 'provider.verification.review');
    const { status } = parse(z.object({ status: z.enum([...VERIFICATION_STATUSES, 'OPEN', 'ALL']).default('OPEN') }), request.query);
    return inContext(request, principal, async (tx): Promise<VerificationQueueItem[]> => {
      const filter =
        status === 'ALL'
          ? undefined
          : status === 'OPEN'
            ? inArray(providerProfiles.verificationStatus, ['SUBMITTED', 'UNDER_REVIEW'])
            : eq(providerProfiles.verificationStatus, status);
      const rows = await tx
        .select({
          p: providerProfiles,
          credentialCount: sql<number>`(select count(*)::int from app.provider_credentials c where c.provider_user_id = ${providerProfiles.userId})`,
          pendingCount: sql<number>`(select count(*)::int from app.provider_credentials c where c.provider_user_id = ${providerProfiles.userId} and c.status = 'PENDING')`,
        })
        .from(providerProfiles)
        .where(filter)
        .orderBy(sql`${providerProfiles.submittedAt} asc nulls last`, asc(providerProfiles.createdAt))
        .limit(200);
      return rows.map(({ p, credentialCount, pendingCount }) => ({
        userId: p.userId,
        providerType: p.providerType,
        displayNameEn: p.displayNameEn,
        displayNameAr: p.displayNameAr,
        specialty: p.specialty,
        governorate: p.governorate,
        verificationStatus: p.verificationStatus,
        submittedAt: p.submittedAt,
        credentialCount,
        pendingCredentialCount: pendingCount,
        isDemo: p.isDemo,
      }));
    });
  });

  app.get('/providers/:userId', async (request) => {
    const principal = await requirePermission(request, 'provider.verification.review');
    const { userId } = parse(z.object({ userId: z.string().min(1).max(64) }), request.params);
    return inContext(request, principal, async (tx) => {
      const [p] = await tx.select().from(providerProfiles).where(eq(providerProfiles.userId, userId));
      if (!p) throw notFound('Provider');
      const creds = await tx.select().from(providerCredentials).where(eq(providerCredentials.providerUserId, userId)).orderBy(asc(providerCredentials.createdAt));
      const events = await tx
        .select()
        .from(providerVerificationEvents)
        .where(eq(providerVerificationEvents.providerUserId, userId))
        .orderBy(desc(providerVerificationEvents.createdAt))
        .limit(50);
      const hours = await tx
        .select({ weekday: providerWorkingHours.weekday, startMinute: providerWorkingHours.startMinute, endMinute: providerWorkingHours.endMinute })
        .from(providerWorkingHours)
        .where(eq(providerWorkingHours.providerUserId, userId))
        .orderBy(asc(providerWorkingHours.weekday));
      const missing = await tx.execute<{ missing: string }>(
        sql`select array_to_string(app.provider_missing_credentials(${userId}, ${p.providerType}::app.provider_type, true), ',') as missing`,
      );
      // Viewing a clinician's identity documents is a sensitive operation → audited.
      await audit(tx, { actorUserId: principal.userId, action: 'admin.provider_submission.viewed', entityType: 'provider', entityId: userId, requestId: request.id });
      return {
        profile: p,
        credentials: creds.map(credentialToDto),
        events,
        workingHours: hours,
        missingApprovedCredentials: (missing.rows[0]?.missing ?? '').split(',').filter(Boolean),
        isSelf: userId === principal.userId,
      };
    });
  });

  app.post('/providers/:userId/decision', async (request) => {
    const principal = await requirePermission(request, 'provider.verification.decide');
    const { userId } = parse(z.object({ userId: z.string().min(1).max(64) }), request.params);
    const body = parse(verificationDecisionBody, request.body);
    if (decisionRequiresReason(body.decision) && !body.reason?.trim()) throw unprocessable('REASON_REQUIRED', 'A written reason is required for this decision');
    if (userId === principal.userId) throw unprocessable('SELF_REVIEW_FORBIDDEN', 'You cannot review your own provider profile');
    const target = decisionTarget(body.decision);
    return inContext(request, principal, async (tx) => {
      // The database trigger validates the transition, the reviewer's permission and that all
      // required credentials are approved before APPROVED; it also writes the history + audit.
      const updated = await tx
        .update(providerProfiles)
        .set({ verificationStatus: target, verificationNote: body.reason?.trim() || null })
        .where(eq(providerProfiles.userId, userId))
        .returning({ status: providerProfiles.verificationStatus });
      if (!updated.length) throw notFound('Provider');
      return { status: updated[0]!.status };
    });
  });

  app.post('/credentials/:id/decision', async (request) => {
    const principal = await requirePermission(request, 'provider.verification.decide');
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const body = parse(credentialDecisionBody, request.body);
    if (body.status === 'REJECTED' && !body.note?.trim()) throw unprocessable('REASON_REQUIRED', 'A note is required when rejecting a credential');
    return inContext(request, principal, async (tx) => {
      const [c] = await tx.select({ owner: providerCredentials.providerUserId }).from(providerCredentials).where(eq(providerCredentials.id, id));
      if (!c) throw notFound('Credential');
      if (c.owner === principal.userId) throw unprocessable('SELF_REVIEW_FORBIDDEN', 'You cannot review your own credentials');
      const [updated] = await tx
        .update(providerCredentials)
        .set({ status: body.status, reviewNote: body.note?.trim() || null })
        .where(eq(providerCredentials.id, id))
        .returning();
      return credentialToDto(updated!);
    });
  });

  app.get('/audit-log', async (request) => {
    const principal = await requirePermission(request, 'audit.read');
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) }), request.query);
    return inContext(request, principal, async (tx): Promise<AuditLogEntry[]> => {
      const rows = await tx
        .select({ a: auditLog, name: userProfiles.displayName })
        .from(auditLog)
        .leftJoin(userProfiles, eq(userProfiles.userId, auditLog.actorUserId))
        .orderBy(desc(auditLog.occurredAt))
        .limit(limit);
      return rows.map(({ a, name }) => ({
        id: a.id,
        actorUserId: a.actorUserId,
        actorName: name,
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
        metadata: a.metadata,
        createdAt: a.occurredAt,
      }));
    });
  });
}
