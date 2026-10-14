import {
  acceptsNewPatients,
  addCredentialBody,
  availabilityOptionsFor,
  isBookable,
  providerSearchQuery,
  providerServicesBody,
  updateAvailabilityBody,
  upsertProviderProfileBody,
  workingHoursBody,
  type AvailabilityStatus,
  type Credential,
  type EarningsSummary,
  type MyProviderProfile,
  type NursingService,
  type ProviderCard,
  type ProviderDetail,
  type ProviderType,
  type VerificationStatus,
} from '@ghayarly/shared';
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Tx } from '../../db/client';
import {
  nursingServices,
  providerCredentials,
  providerLedgerEntries,
  providerProfiles,
  providerServices,
  providerWorkingHours,
  publicProviderCredentials,
} from '../../db/schema';
import { audit } from '../../lib/audit';
import { forbidden, notFound, unprocessable } from '../../lib/errors';
import { inContext, requirePrincipal, requireRole, type Principal } from '../../lib/principal';
import { parse } from '../../lib/validate';
import { serviceToDto } from '../services/routes';

const ACCEPTING: AvailabilityStatus[] = ['ACCEPTING_NEW_PATIENTS', 'LIMITED_AVAILABILITY', 'AVAILABLE_NOW', 'AVAILABLE_TODAY', 'SCHEDULED_ONLY'];

const verifiedCount = sql<number>`(select count(*)::int from app.public_provider_credentials c where c.provider_user_id = ${providerProfiles.userId})`;

export function toCard(p: typeof providerProfiles.$inferSelect, verifiedCredentialCount: number): ProviderCard {
  return {
    userId: p.userId,
    providerType: p.providerType,
    displayNameAr: p.displayNameAr,
    displayNameEn: p.displayNameEn,
    gender: p.gender,
    specialty: p.specialty,
    yearsExperience: p.yearsExperience,
    governorate: p.governorate,
    city: p.city,
    currentAffiliation: p.currentAffiliation,
    feePiasters: p.feePiasters,
    availabilityStatus: p.availabilityStatus,
    acceptingNewPatients: acceptsNewPatients(p.availabilityStatus) && !p.temporarilyUnavailable,
    verifiedCredentialCount,
    completedVisits: p.completedVisits,
    isDemo: p.isDemo,
  };
}

export async function searchProviders(tx: Tx, query: z.infer<typeof providerSearchQuery>, limit = 50): Promise<ProviderCard[]> {
  const where: SQL[] = [eq(providerProfiles.verificationStatus, 'APPROVED')];
  if (query.type) where.push(eq(providerProfiles.providerType, query.type));
  if (query.specialty) where.push(eq(providerProfiles.specialty, query.specialty));
  if (query.governorate) where.push(eq(providerProfiles.governorate, query.governorate));
  if (query.gender) where.push(eq(providerProfiles.gender, query.gender));
  if (query.acceptingOnly === 'true') {
    where.push(inArray(providerProfiles.availabilityStatus, ACCEPTING), eq(providerProfiles.temporarilyUnavailable, false));
  }
  if (query.serviceId) {
    where.push(sql`exists (select 1 from app.provider_services ps where ps.provider_user_id = ${providerProfiles.userId} and ps.service_id = ${query.serviceId})`);
  }
  if (query.q) {
    const term = `%${query.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push(
      or(
        ilike(providerProfiles.displayNameAr, term),
        ilike(providerProfiles.displayNameEn, term),
        ilike(providerProfiles.city, term),
        ilike(providerProfiles.currentAffiliation, term),
        ilike(providerProfiles.subspecialty, term),
      )!,
    );
  }
  const acceptingFirst = sql`case when ${providerProfiles.availabilityStatus} in ('ACCEPTING_NEW_PATIENTS','AVAILABLE_NOW','AVAILABLE_TODAY','LIMITED_AVAILABILITY','SCHEDULED_ONLY') and not ${providerProfiles.temporarilyUnavailable} then 0 else 1 end`;
  const order =
    query.sort === 'experience'
      ? [desc(providerProfiles.yearsExperience)]
      : query.sort === 'price_low'
        ? [sql`${providerProfiles.feePiasters} asc nulls last`]
        : query.sort === 'price_high'
          ? [sql`${providerProfiles.feePiasters} desc nulls last`]
          : // "Recommended" is NOT average stars: availability, verified volume, then experience.
            [acceptingFirst, desc(providerProfiles.completedVisits), desc(verifiedCount), desc(providerProfiles.yearsExperience)];
  const rows = await tx
    .select({ p: providerProfiles, verified: verifiedCount })
    .from(providerProfiles)
    .where(and(...where))
    .orderBy(...order, asc(providerProfiles.userId))
    .limit(limit);
  return rows.map((r) => toCard(r.p, r.verified));
}

async function loadMine(tx: Tx, principal: Principal): Promise<MyProviderProfile> {
  const [p] = await tx.select().from(providerProfiles).where(eq(providerProfiles.userId, principal.userId));
  const creds = p
    ? await tx.select().from(providerCredentials).where(eq(providerCredentials.providerUserId, principal.userId)).orderBy(asc(providerCredentials.createdAt))
    : [];
  const hours = p
    ? await tx
        .select({ weekday: providerWorkingHours.weekday, startMinute: providerWorkingHours.startMinute, endMinute: providerWorkingHours.endMinute })
        .from(providerWorkingHours)
        .where(eq(providerWorkingHours.providerUserId, principal.userId))
        .orderBy(asc(providerWorkingHours.weekday), asc(providerWorkingHours.startMinute))
    : [];
  let missing: string[] = [];
  if (p) {
    const res = await tx.execute<{ missing: string }>(
      sql`select array_to_string(app.provider_missing_credentials(${principal.userId}, ${p.providerType}::app.provider_type, false), ',') as missing`,
    );
    missing = (res.rows[0]?.missing ?? '').split(',').filter(Boolean);
  }
  const status: VerificationStatus | null = p?.verificationStatus ?? null;
  const checklist = [
    { key: 'profile', done: Boolean(p) },
    { key: 'credentials', done: Boolean(p) && missing.length === 0 },
    { key: 'hours', done: hours.length > 0 },
    { key: 'mfa', done: principal.user.twoFactorEnabled },
  ];
  return {
    exists: Boolean(p),
    profile: p
      ? {
          userId: p.userId,
          providerType: p.providerType,
          displayNameAr: p.displayNameAr,
          displayNameEn: p.displayNameEn,
          gender: p.gender,
          specialty: p.specialty,
          subspecialty: p.subspecialty,
          yearsExperience: p.yearsExperience,
          bioAr: p.bioAr,
          bioEn: p.bioEn,
          currentAffiliation: p.currentAffiliation,
          previousExperience: p.previousExperience,
          governorate: p.governorate,
          city: p.city,
          feePiasters: p.feePiasters,
          skills: p.skills,
          verificationStatus: p.verificationStatus,
          verificationNote: p.verificationNote,
          submittedAt: p.submittedAt,
          verifiedAt: p.verifiedAt,
          availabilityStatus: p.availabilityStatus,
          maxDailyAppointments: p.maxDailyAppointments,
          serviceRadiusKm: p.serviceRadiusKm,
          awayUntil: p.awayUntil,
          temporarilyUnavailable: p.temporarilyUnavailable,
          isDemo: p.isDemo,
        }
      : null,
    credentials: creds.map(credentialToDto),
    workingHours: hours,
    checklist,
    canSubmit: Boolean(p) && missing.length === 0 && (status === 'DRAFT' || status === 'CHANGES_REQUESTED' || status === 'REJECTED'),
    bookable: status ? isBookable(status) : false,
  };
}

export function credentialToDto(c: typeof providerCredentials.$inferSelect): Credential {
  return {
    id: c.id,
    kind: c.kind,
    issuer: c.issuer,
    identifier: c.identifier,
    issuedOn: c.issuedOn,
    expiresOn: c.expiresOn,
    status: c.status,
    reviewNote: c.reviewNote,
    reviewedAt: c.reviewedAt,
    documentStatus: c.documentObjectKey ? 'UPLOADED' : 'NOT_UPLOADED',
    createdAt: c.createdAt,
  };
}

/** Earnings are summarised in Africa/Cairo local time; the week starts on Saturday. */
export async function earningsSummary(tx: Tx, userId: string): Promise<EarningsSummary> {
  const res = await tx.execute<{
    today_net: string;
    today_visits: string;
    week_net: string;
    available: string;
    pending: string;
  }>(sql`
    with bounds as (
      select (date_trunc('day', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo') as day_start,
             ((date_trunc('day', now() at time zone 'Africa/Cairo')
               - (((extract(dow from now() at time zone 'Africa/Cairo')::int + 1) % 7) * interval '1 day')) at time zone 'Africa/Cairo') as week_start
    )
    select
      coalesce(sum(amount_piasters) filter (where entry_type <> 'PAYOUT' and occurred_at >= b.day_start), 0) as today_net,
      count(*) filter (where entry_type = 'VISIT_EARNING' and occurred_at >= b.day_start) as today_visits,
      coalesce(sum(amount_piasters) filter (where entry_type <> 'PAYOUT' and occurred_at >= b.week_start), 0) as week_net,
      coalesce(sum(amount_piasters) filter (where status = 'AVAILABLE'), 0) as available,
      coalesce(sum(amount_piasters) filter (where status = 'PENDING'), 0) as pending
    from app.provider_ledger_entries, bounds b
    where provider_user_id = ${userId}`);
  const s = res.rows[0]!;
  const entries = await tx
    .select()
    .from(providerLedgerEntries)
    .where(eq(providerLedgerEntries.providerUserId, userId))
    .orderBy(desc(providerLedgerEntries.occurredAt))
    .limit(20);
  return {
    currency: 'EGP',
    todayNetPiasters: Number(s.today_net),
    todayCompletedVisits: Number(s.today_visits),
    weekNetPiasters: Number(s.week_net),
    availableForPayoutPiasters: Number(s.available),
    pendingPiasters: Number(s.pending),
    entries: entries.map((e) => ({
      id: e.id,
      entryType: e.entryType,
      status: e.status,
      amountPiasters: e.amountPiasters,
      description: e.description,
      occurredAt: e.occurredAt,
      isDemo: e.isDemo,
    })),
    containsDemoData: entries.some((e) => e.isDemo),
    payoutsEnabled: false,
  };
}

export async function providerRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------ discovery (any signed-in user)
  app.get('/providers', async (request) => {
    const principal = await requirePrincipal(request);
    const query = parse(providerSearchQuery, request.query);
    return inContext(request, principal, (tx) => searchProviders(tx, query));
  });

  app.get('/providers/:userId', async (request): Promise<ProviderDetail> => {
    const principal = await requirePrincipal(request);
    const { userId } = parse(z.object({ userId: z.string().min(1).max(64) }), request.params);
    return inContext(request, principal, async (tx) => {
      const [row] = await tx
        .select({ p: providerProfiles, verified: verifiedCount })
        .from(providerProfiles)
        .where(and(eq(providerProfiles.userId, userId), eq(providerProfiles.verificationStatus, 'APPROVED')));
      if (!row) throw notFound('Provider');
      const creds = await tx
        .select()
        .from(publicProviderCredentials)
        .where(eq(publicProviderCredentials.providerUserId, userId))
        .orderBy(asc(publicProviderCredentials.kind));
      const services = await tx
        .select({ s: nursingServices, price: providerServices.pricePiasters })
        .from(providerServices)
        .innerJoin(nursingServices, eq(nursingServices.id, providerServices.serviceId))
        .where(eq(providerServices.providerUserId, userId))
        .orderBy(asc(nursingServices.sortOrder));
      const hours = await tx
        .select({ weekday: providerWorkingHours.weekday, startMinute: providerWorkingHours.startMinute, endMinute: providerWorkingHours.endMinute })
        .from(providerWorkingHours)
        .where(eq(providerWorkingHours.providerUserId, userId))
        .orderBy(asc(providerWorkingHours.weekday), asc(providerWorkingHours.startMinute));
      return {
        ...toCard(row.p, row.verified),
        subspecialty: row.p.subspecialty,
        bioAr: row.p.bioAr,
        bioEn: row.p.bioEn,
        previousExperience: row.p.previousExperience,
        skills: row.p.skills,
        verifiedCredentials: creds.map((c) => ({ kind: c.kind, issuer: c.issuer, verifiedAt: c.verifiedAt })),
        services: services.map(({ s, price }) => ({
          serviceId: s.id,
          code: s.code,
          nameAr: s.nameAr,
          nameEn: s.nameEn,
          pricePiasters: price ?? s.basePricePiasters,
          durationMinutes: s.durationMinutes,
        })),
        workingHours: hours,
        awayUntil: row.p.awayUntil,
        bookingAvailable: false,
        bookingUnavailableReason: 'BOOKING_NOT_YET_RELEASED',
      };
    });
  });

  // ------------------------------------------------------------ provider self-service
  app.get('/provider/me', async (request) => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    return inContext(request, principal, (tx) => loadMine(tx, principal));
  });

  app.put('/provider/me', async (request) => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    const body = parse(upsertProviderProfileBody, request.body);
    if (!principal.roles.includes(body.providerType)) throw forbidden('ROLE_REQUIRED', `Requires the ${body.providerType} role`);
    if (body.providerType === 'DOCTOR' && !body.specialty) throw unprocessable('SPECIALTY_REQUIRED', 'Doctors must select a specialty');
    return inContext(request, principal, async (tx) => {
      const fields = {
        displayNameAr: body.displayNameAr,
        displayNameEn: body.displayNameEn,
        gender: body.gender,
        specialty: body.specialty ?? null,
        subspecialty: body.subspecialty ?? null,
        yearsExperience: body.yearsExperience,
        bioAr: body.bioAr ?? null,
        bioEn: body.bioEn ?? null,
        currentAffiliation: body.currentAffiliation ?? null,
        previousExperience: body.previousExperience ?? null,
        governorate: body.governorate,
        city: body.city,
        feePiasters: body.feePiasters ?? null,
        skills: body.skills ?? [],
      };
      const [existing] = await tx.select({ t: providerProfiles.providerType }).from(providerProfiles).where(eq(providerProfiles.userId, principal.userId));
      if (existing) {
        if (existing.t !== body.providerType) throw unprocessable('PROVIDER_TYPE_IMMUTABLE', 'Provider type cannot be changed');
        await tx.update(providerProfiles).set(fields).where(eq(providerProfiles.userId, principal.userId));
      } else {
        await tx.insert(providerProfiles).values({
          userId: principal.userId,
          providerType: body.providerType,
          availabilityStatus: body.providerType === 'DOCTOR' ? 'ACCEPTING_NEW_PATIENTS' : 'SCHEDULED_ONLY',
          ...fields,
        });
      }
      await audit(tx, { actorUserId: principal.userId, action: existing ? 'provider.profile.updated' : 'provider.profile.created', entityType: 'provider', entityId: principal.userId, requestId: request.id });
      return loadMine(tx, principal);
    });
  });

  app.post('/provider/me/credentials', async (request, reply) => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    const body = parse(addCredentialBody, request.body);
    const result = await inContext(request, principal, async (tx) => {
      const [p] = await tx.select({ t: providerProfiles.providerType }).from(providerProfiles).where(eq(providerProfiles.userId, principal.userId));
      if (!p) throw unprocessable('PROFILE_REQUIRED', 'Create your professional profile first');
      await tx.insert(providerCredentials).values({
        providerUserId: principal.userId,
        kind: body.kind,
        issuer: body.issuer,
        identifier: body.identifier,
        issuedOn: body.issuedOn ?? null,
        expiresOn: body.expiresOn ?? null,
      });
      return loadMine(tx, principal);
    });
    return reply.status(201).send(result);
  });

  app.delete('/provider/me/credentials/:id', async (request) => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    return inContext(request, principal, async (tx) => {
      const deleted = await tx.delete(providerCredentials).where(eq(providerCredentials.id, id)).returning({ id: providerCredentials.id });
      if (!deleted.length) throw notFound('Credential');
      return loadMine(tx, principal);
    });
  });

  app.post('/provider/me/submit', async (request) => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    return inContext(request, principal, async (tx) => {
      const updated = await tx
        .update(providerProfiles)
        .set({ verificationStatus: 'SUBMITTED' })
        .where(eq(providerProfiles.userId, principal.userId))
        .returning({ id: providerProfiles.userId });
      if (!updated.length) throw unprocessable('PROFILE_REQUIRED', 'Create your professional profile first');
      return loadMine(tx, principal);
    });
  });

  app.patch('/provider/me/availability', async (request) => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    const body = parse(updateAvailabilityBody, request.body);
    return inContext(request, principal, async (tx) => {
      const [p] = await tx.select({ t: providerProfiles.providerType }).from(providerProfiles).where(eq(providerProfiles.userId, principal.userId));
      if (!p) throw unprocessable('PROFILE_REQUIRED', 'Create your professional profile first');
      const status = body.availabilityStatus as AvailabilityStatus | undefined;
      if (status && !availabilityOptionsFor(p.t as ProviderType).includes(status)) {
        throw unprocessable('INVALID_AVAILABILITY_STATUS', `${status} is not valid for ${p.t}`);
      }
      if (status === 'AWAY' && body.awayUntil && body.awayUntil < new Date().toISOString().slice(0, 10)) {
        throw unprocessable('INVALID_DATE', 'awayUntil must be in the future');
      }
      await tx
        .update(providerProfiles)
        .set({
          ...(status ? { availabilityStatus: status } : {}),
          ...(body.maxDailyAppointments !== undefined ? { maxDailyAppointments: body.maxDailyAppointments } : {}),
          ...(body.serviceRadiusKm !== undefined ? { serviceRadiusKm: body.serviceRadiusKm } : {}),
          ...(body.awayUntil !== undefined ? { awayUntil: body.awayUntil } : {}),
          ...(status && status !== 'AWAY' ? { awayUntil: null } : {}),
          ...(body.temporarilyUnavailable !== undefined ? { temporarilyUnavailable: body.temporarilyUnavailable } : {}),
        })
        .where(eq(providerProfiles.userId, principal.userId));
      await audit(tx, { actorUserId: principal.userId, action: 'provider.capacity.updated', entityType: 'provider', entityId: principal.userId, requestId: request.id, metadata: body });
      return loadMine(tx, principal);
    });
  });

  app.put('/provider/me/working-hours', async (request) => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    const { slots } = parse(workingHoursBody, request.body);
    for (const day of new Set(slots.map((s) => s.weekday))) {
      const daySlots = slots.filter((s) => s.weekday === day).sort((a, b) => a.startMinute - b.startMinute);
      for (let i = 1; i < daySlots.length; i++) {
        if (daySlots[i]!.startMinute < daySlots[i - 1]!.endMinute) throw unprocessable('OVERLAPPING_HOURS', 'Working hours overlap');
      }
    }
    return inContext(request, principal, async (tx) => {
      const [p] = await tx.select({ id: providerProfiles.userId }).from(providerProfiles).where(eq(providerProfiles.userId, principal.userId));
      if (!p) throw unprocessable('PROFILE_REQUIRED', 'Create your professional profile first');
      await tx.delete(providerWorkingHours).where(eq(providerWorkingHours.providerUserId, principal.userId));
      if (slots.length) await tx.insert(providerWorkingHours).values(slots.map((s) => ({ ...s, providerUserId: principal.userId })));
      return loadMine(tx, principal);
    });
  });

  app.get('/provider/me/services', async (request) => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    return inContext(request, principal, async (tx) => {
      const [p] = await tx.select({ t: providerProfiles.providerType }).from(providerProfiles).where(eq(providerProfiles.userId, principal.userId));
      const catalog = await tx.select().from(nursingServices).where(eq(nursingServices.active, true)).orderBy(asc(nursingServices.sortOrder));
      const mine = await tx.select().from(providerServices).where(eq(providerServices.providerUserId, principal.userId));
      const selected = new Map(mine.map((m) => [m.serviceId, m.pricePiasters]));
      return catalog
        .filter((s) => !p || s.eligibleProviderTypes.includes(p.t))
        .map((s): NursingService & { selected: boolean; pricePiasters: number | null } => ({
          ...serviceToDto(s),
          selected: selected.has(s.id),
          pricePiasters: selected.get(s.id) ?? null,
        }));
    });
  });

  app.put('/provider/me/services', async (request) => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    const { services } = parse(providerServicesBody, request.body);
    return inContext(request, principal, async (tx) => {
      const [p] = await tx.select({ id: providerProfiles.userId }).from(providerProfiles).where(eq(providerProfiles.userId, principal.userId));
      if (!p) throw unprocessable('PROFILE_REQUIRED', 'Create your professional profile first');
      await tx.delete(providerServices).where(eq(providerServices.providerUserId, principal.userId));
      if (services.length) {
        await tx.insert(providerServices).values(services.map((s) => ({ providerUserId: principal.userId, serviceId: s.serviceId, pricePiasters: s.pricePiasters })));
      }
      await audit(tx, { actorUserId: principal.userId, action: 'provider.services.updated', entityType: 'provider', entityId: principal.userId, requestId: request.id, metadata: { count: services.length } });
      return { ok: true, count: services.length };
    });
  });

  app.get('/provider/me/earnings', async (request) => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    return inContext(request, principal, (tx) => earningsSummary(tx, principal.userId));
  });
}
