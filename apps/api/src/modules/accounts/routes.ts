/**
 * Account status: the person's own view (status, history without internal notes, appeals) and the
 * Admin Console's user management. Every status change is made by app.set_account_status() /
 * app.decide_appeal() in PostgreSQL (migration 0009), which re-checks permissions, forbids acting
 * on oneself, requires reasons and notes, signs restricted accounts out and writes the audit log.
 */
import {
  accountStatusActionBody,
  adminUsersQuery,
  appealBody,
  appealDecisionBody,
  type AccountStatusInfo,
  type AdminStatusEvent,
  type AdminUserDetail,
  type AdminUserListItem,
  type Appeal,
  type MyAccountStatus,
} from '@ghayarly/shared';
import { and, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Tx } from '../../db/client';
import { accountAppeals, accountStatus, accountStatusEvents, authUsers, myAccountStatusEvents, providerProfiles, userProfiles, userRoles } from '../../db/schema';
import { audit } from '../../lib/audit';
import { notFound, unprocessable } from '../../lib/errors';
import { inContext, requirePermission, requirePrincipal } from '../../lib/principal';
import { sessionKey } from '../../lib/rateLimitKey';
import { parse } from '../../lib/validate';

const iso = (v: string | null | undefined) => (v ? new Date(v).toISOString() : null);
const STAFF = ['ADMIN', 'CLINICAL_REVIEWER', 'SUPPORT', 'TRUST_AND_SAFETY', 'COMMERCE_MANAGER'] as const;

function appealDto(a: typeof accountAppeals.$inferSelect, userName?: string): Appeal {
  return { id: a.id, userId: a.userId, ...(userName ? { userName } : {}), eventId: a.eventId, message: a.message, status: a.status, decisionNote: a.decisionNote, decidedAt: iso(a.decidedAt), createdAt: iso(a.createdAt)! };
}

function statusInfo(row: { s: typeof accountStatus.$inferSelect | null; effective: AccountStatusInfo['status'] }): AccountStatusInfo {
  const s = row.s;
  if (!s) return { status: 'ACTIVE', bookingsRestricted: false, reason: null, publicMessage: null, suspendedUntil: null };
  const restricted = row.effective !== 'ACTIVE' || s.bookingsRestricted;
  return {
    status: row.effective,
    bookingsRestricted: s.bookingsRestricted,
    reason: restricted ? s.reason : null,
    publicMessage: restricted ? s.publicMessage : null,
    suspendedUntil: row.effective === 'SUSPENDED' ? iso(s.suspendedUntil) : null,
  };
}

async function listUsers(tx: Tx, where: SQL | undefined, limit: number, offset: number): Promise<AdminUserListItem[]> {
  const rows = await tx
    .select({
      u: authUsers,
      p: userProfiles,
      s: accountStatus,
      effective: sql<AccountStatusInfo['status']>`app.account_status_of(${authUsers.id})`,
      lastSeen: sql<string | null>`app.user_last_session_at(${authUsers.id})`,
      deleted: sql<boolean>`exists (select 1 from app.account_deletions d where d.user_id = ${authUsers.id})`,
      verification: providerProfiles.verificationStatus,
    })
    .from(authUsers)
    .leftJoin(userProfiles, eq(userProfiles.userId, authUsers.id))
    .leftJoin(accountStatus, eq(accountStatus.userId, authUsers.id))
    .leftJoin(providerProfiles, eq(providerProfiles.userId, authUsers.id))
    .where(where)
    .orderBy(desc(authUsers.createdAt))
    .limit(limit)
    .offset(offset);
  const ids = rows.map((r) => r.u.id);
  const roles = ids.length ? await tx.select({ userId: userRoles.userId, role: userRoles.role }).from(userRoles).where(and(inArray(userRoles.userId, ids), isNull(userRoles.revokedAt))) : [];
  return rows.map((r) => ({
    id: r.u.id,
    name: r.p?.displayName ?? r.u.name,
    email: r.u.email,
    phoneNumber: r.u.phoneNumber,
    roles: roles.filter((x) => x.userId === r.u.id).map((x) => x.role),
    twoFactorEnabled: Boolean(r.u.twoFactorEnabled),
    createdAt: iso(r.u.createdAt)!,
    lastSeenAt: iso(r.lastSeen),
    deleted: r.deleted,
    isDemo: r.p?.isDemo ?? false,
    accountKind: r.p?.accountKind ?? 'STANDARD',
    account: statusInfo({ s: r.s, effective: r.effective }),
    providerVerification: r.verification ?? null,
  }));
}

export async function accountRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------ the person's own view
  app.get('/me/account-status', async (request): Promise<MyAccountStatus> => {
    const principal = await requirePrincipal(request);
    return inContext(request, principal, async (tx) => {
      const events = await tx.select().from(myAccountStatusEvents).orderBy(desc(myAccountStatusEvents.createdAt)).limit(50);
      const appeals = await tx.select().from(accountAppeals).where(eq(accountAppeals.userId, principal.userId)).orderBy(desc(accountAppeals.createdAt)).limit(20);
      const restricted = principal.account.status !== 'ACTIVE' || principal.account.bookingsRestricted;
      return {
        account: principal.account,
        events: events.map((e) => ({ ...e, suspendedUntil: iso(e.suspendedUntil), createdAt: iso(e.createdAt)! })),
        appeals: appeals.map((a) => appealDto(a)),
        canAppeal: restricted && !appeals.some((a) => a.status === 'OPEN'),
      };
    });
  });

  app.get('/me/appeals', async (request): Promise<Appeal[]> => {
    const principal = await requirePrincipal(request);
    return inContext(request, principal, async (tx) => (await tx.select().from(accountAppeals).where(eq(accountAppeals.userId, principal.userId)).orderBy(desc(accountAppeals.createdAt))).map((a) => appealDto(a)));
  });

  app.post('/me/appeals', { config: { rateLimit: { max: 5, timeWindow: '1 hour', keyGenerator: sessionKey } } }, async (request, reply) => {
    const principal = await requirePrincipal(request);
    const body = parse(appealBody, request.body);
    const appeal = await inContext(request, principal, async (tx) => {
      // RLS: only while a restriction applies, only one open appeal, only about one's own history.
      const [a] = await tx.insert(accountAppeals).values({ userId: principal.userId, message: body.message, eventId: body.eventId ?? null }).returning();
      await audit(tx, { actorUserId: principal.userId, action: 'users.appeal.submitted', entityType: 'user', entityId: principal.userId, requestId: request.id, metadata: { appealId: a!.id } });
      return appealDto(a!);
    });
    return reply.status(201).send(appeal);
  });

  // ------------------------------------------------------------ Admin Console
  app.get('/admin/users', async (request): Promise<AdminUserListItem[]> => {
    const principal = await requirePermission(request, 'users.read');
    const q = parse(adminUsersQuery, request.query);
    return inContext(request, principal, (tx) => {
      const filters: SQL[] = [];
      if (q.q) {
        const like = `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
        filters.push(or(ilike(authUsers.email, like), ilike(authUsers.name, like), ilike(authUsers.phoneNumber, like), ilike(userProfiles.displayName, like), eq(authUsers.id, q.q))!);
      }
      if (q.role === 'STAFF') filters.push(sql`exists (select 1 from app.user_roles r where r.user_id = ${authUsers.id} and r.revoked_at is null and r.role in (${sql.join(STAFF.map((s) => sql`${s}::app.role`), sql`, `)}))`);
      else if (q.role !== 'ANY') filters.push(sql`exists (select 1 from app.user_roles r where r.user_id = ${authUsers.id} and r.revoked_at is null and r.role = ${q.role}::app.role)`);
      if (q.status === 'BOOKINGS_RESTRICTED') filters.push(eq(accountStatus.bookingsRestricted, true));
      else if (q.status !== 'ANY') filters.push(sql`app.account_status_of(${authUsers.id}) = ${q.status}::app.account_status`);
      return listUsers(tx, filters.length ? and(...filters) : undefined, q.limit, q.offset);
    });
  });

  app.get('/admin/users/:id', async (request): Promise<AdminUserDetail> => {
    const principal = await requirePermission(request, 'users.read');
    const { id } = parse(z.object({ id: z.string().min(1).max(64) }), request.params);
    return inContext(request, principal, async (tx) => {
      const [base] = await listUsers(tx, eq(authUsers.id, id), 1, 0);
      if (!base) throw notFound('User');
      const [u] = await tx.select({ emailVerified: authUsers.emailVerified, phoneNumberVerified: authUsers.phoneNumberVerified }).from(authUsers).where(eq(authUsers.id, id));
      const events = await tx.select().from(accountStatusEvents).where(eq(accountStatusEvents.userId, id)).orderBy(desc(accountStatusEvents.createdAt)).limit(100);
      const actorIds = [...new Set(events.map((e) => e.actorUserId).filter((x): x is string => Boolean(x)))];
      const actors = actorIds.length ? await tx.select({ id: userProfiles.userId, name: userProfiles.displayName }).from(userProfiles).where(inArray(userProfiles.userId, actorIds)) : [];
      const appeals = await tx.select().from(accountAppeals).where(eq(accountAppeals.userId, id)).orderBy(desc(accountAppeals.createdAt)).limit(50);
      const count = await tx.execute<{ n: number | null }>(sql`select app.user_patient_profile_count(${id}) as n`);
      // Looking up a person's account is itself audited.
      await audit(tx, { actorUserId: principal.userId, action: 'admin.user.viewed', entityType: 'user', entityId: id, requestId: request.id });
      return {
        ...base,
        emailVerified: u!.emailVerified,
        phoneNumberVerified: Boolean(u!.phoneNumberVerified),
        events: events.map(
          (e): AdminStatusEvent => ({
            id: e.id,
            action: e.action,
            fromStatus: e.fromStatus,
            toStatus: e.toStatus,
            bookingsRestricted: e.bookingsRestricted,
            reason: e.reason,
            publicMessage: e.publicMessage,
            staffNote: e.staffNote,
            careContinuityNote: e.careContinuityNote,
            suspendedUntil: iso(e.suspendedUntil),
            actorName: actors.find((a) => a.id === e.actorUserId)?.name ?? null,
            createdAt: iso(e.createdAt)!,
          }),
        ),
        appeals: appeals.map((a) => appealDto(a)),
        patientProfiles: count.rows[0]?.n ?? 0,
        isSelf: id === principal.userId,
      };
    });
  });

  app.post('/admin/users/:id/status', async (request) => {
    // MFA is mandatory for this permission in production (MFA_ENFORCEMENT=required is enforced at boot).
    const principal = await requirePermission(request, 'users.status.manage');
    const { id } = parse(z.object({ id: z.string().min(1).max(64) }), request.params);
    const b = parse(accountStatusActionBody, request.body);
    if (id === principal.userId) throw unprocessable('SELF_ACTION_FORBIDDEN', 'You cannot change your own account status');
    return inContext(request, principal, async (tx) => {
      const r = await tx.execute<{ status: string }>(
        sql`select app.set_account_status(${id}, ${b.action}::app.status_action, ${b.reason}::app.status_reason, ${b.publicMessage ?? null}, ${b.staffNote}, ${b.suspendedUntil ?? null}::timestamptz, ${b.careContinuityNote ?? null}) as status`,
      );
      return { status: r.rows[0]!.status };
    });
  });

  app.get('/admin/appeals', async (request): Promise<Appeal[]> => {
    const principal = await requirePermission(request, 'users.appeals.decide');
    const { status } = parse(z.object({ status: z.enum(['OPEN', 'GRANTED', 'DENIED', 'WITHDRAWN', 'ALL']).default('OPEN') }), request.query);
    return inContext(request, principal, async (tx) => {
      const rows = await tx
        .select({ a: accountAppeals, name: userProfiles.displayName })
        .from(accountAppeals)
        .leftJoin(userProfiles, eq(userProfiles.userId, accountAppeals.userId))
        .where(status === 'ALL' ? undefined : eq(accountAppeals.status, status))
        .orderBy(accountAppeals.createdAt)
        .limit(200);
      return rows.map(({ a, name }) => appealDto(a, name ?? undefined));
    });
  });

  app.post('/admin/appeals/:id/decision', async (request) => {
    const principal = await requirePermission(request, 'users.appeals.decide');
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const b = parse(appealDecisionBody, request.body);
    return inContext(request, principal, async (tx) => {
      const r = await tx.execute<{ status: string }>(sql`select app.decide_appeal(${id}::uuid, ${b.decision}::app.appeal_status, ${b.note}) as status`);
      return { status: r.rows[0]!.status };
    });
  });
}
