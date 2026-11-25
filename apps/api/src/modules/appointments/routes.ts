import {
  availabilityQuery,
  cancelAppointmentBody,
  coverageBody,
  createAppointmentBody,
  doctorOfferingsBody,
  hasPermission,
  homeCareRegionBody,
  progressAppointmentBody,
  reportAppointmentIssueBody,
  rescheduleAppointmentBody,
  resolveIncidentBody,
  respondAppointmentBody,
  timeOffBody,
  type Appointment,
  type AppointmentKind,
  type AppointmentStatus,
  type AvailabilityResponse,
  type BookingBlock,
  type BookingOption,
  type DoctorOffering,
  type OpsAppointment,
  type OpsIncident,
  type OpsSchedule,
  type TimeOff,
} from '@ghayarly/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { withContext, type Tx } from '../../db/client';
import { audit } from '../../lib/audit';
import { AppError, conflict, forbidden, fromPgError, notFound, unprocessable } from '../../lib/errors';
import { inContext, requirePermission, requirePrincipal, requireRole, type Principal } from '../../lib/principal';
import { parse } from '../../lib/validate';
import { normalizePhone } from '../../notifications/phone';
import { notifyBooking } from './notify';

/** Bookings (ADR 0021). Every rule is enforced by the database functions of migration 0031. */

const CONFLICT_CODES = new Set(['SLOT_TAKEN', 'SLOT_NOT_AVAILABLE', 'INVALID_TRANSITION', 'REQUEST_EXPIRED', 'ALREADY_STARTED', 'RESCHEDULE_LIMIT']);
const HOME_KINDS: readonly AppointmentKind[] = ['DOCTOR_HOME_VISIT', 'NURSE_HOME_VISIT'];

/** Database refusals become stable API errors; slot races and stale actions are 409. */
async function db<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const mapped = fromPgError(e);
    if (mapped && CONFLICT_CODES.has(mapped.code)) throw new AppError(409, mapped.code, mapped.message);
    throw mapped ?? e;
  }
}

const todayInCairo = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const iso = (v: string | Date | null) => (v ? new Date(v).toISOString() : null);

type Row = {
  id: string;
  reference: string;
  kind: AppointmentKind;
  status: AppointmentStatus;
  starts_at: string;
  ends_at: string;
  respond_by: string;
  provider_user_id: string;
  booked_by_user_id: string;
  patient_id: string;
  patient_name: string;
  provider_name_ar: string;
  provider_name_en: string;
  provider_type: 'DOCTOR' | 'NURSE';
  specialty: string | null;
  service_id: string | null;
  offering_id: string | null;
  service_name_ar: string | null;
  service_name_en: string | null;
  clinic_address_ar: string | null;
  clinic_address_en: string | null;
  price_piasters: number;
  visit_governorate: string | null;
  visit_city: string | null;
  visit_district: string | null;
  visit_address: string | null;
  contact_phone: string | null;
  patient_note: string | null;
  status_reason: string | null;
  failure_category: Appointment['failureCategory'];
  cancelled_by: Appointment['cancelledBy'];
  reschedule_count: number;
  created_at: string;
  can_view_patient: boolean;
};

const SELECT = sql`
  select a.id, a.reference, a.kind, a.status, a.starts_at::text, a.ends_at::text, a.respond_by::text, a.provider_user_id, a.booked_by_user_id,
         a.patient_id, a.patient_display_name as patient_name, a.provider_name_ar, a.provider_name_en, a.offering_id,
         case when a.kind = 'NURSE_HOME_VISIT' then 'NURSE' else 'DOCTOR' end as provider_type, p.specialty, a.service_id,
         s.name_ar as service_name_ar, s.name_en as service_name_en,
         o.clinic_address_ar, o.clinic_address_en, a.price_piasters, a.visit_governorate, a.visit_city, a.visit_district, a.visit_address,
         a.contact_phone, a.patient_note, a.status_reason, a.failure_category, a.cancelled_by, a.reschedule_count, a.created_at::text,
         app.can_view_patient(a.patient_id) as can_view_patient
  from app.appointments a
  left join app.provider_profiles p on p.user_id = a.provider_user_id
  left join app.nursing_services s on s.id = a.service_id
  left join app.doctor_offerings o on o.id = a.offering_id`;

function toDto(r: Row, viewer: Principal): Appointment {
  const now = Date.now();
  const start = new Date(r.starts_at).getTime();
  const role: Appointment['viewerRole'] =
    r.provider_user_id === viewer.userId ? 'PROVIDER' : r.booked_by_user_id === viewer.userId || r.can_view_patient ? 'PATIENT' : 'ADMIN';
  const home = HOME_KINDS.includes(r.kind);
  const open = r.status === 'REQUESTED' || r.status === 'CONFIRMED';
  // The provider sees the street address and phone only after accepting; operations staff never
  // see notes, addresses or numbers here.
  const showAddress = role === 'PATIENT' || (role === 'PROVIDER' && r.status !== 'REQUESTED');
  return {
    id: r.id,
    reference: r.reference,
    kind: r.kind,
    status: r.status,
    startsAt: iso(r.starts_at)!,
    endsAt: iso(r.ends_at)!,
    respondBy: iso(r.respond_by)!,
    provider: { userId: r.provider_user_id, displayNameAr: r.provider_name_ar, displayNameEn: r.provider_name_en, providerType: r.provider_type, specialty: r.specialty },
    patient: { id: r.patient_id, displayName: r.patient_name },
    service: r.service_id ? { id: r.service_id, nameAr: r.service_name_ar ?? '', nameEn: r.service_name_en ?? '' } : null,
    offeringId: r.offering_id,
    clinicAddressAr: r.kind === 'DOCTOR_CLINIC' ? r.clinic_address_ar : null,
    clinicAddressEn: r.kind === 'DOCTOR_CLINIC' ? r.clinic_address_en : null,
    pricePiasters: r.price_piasters,
    currency: 'EGP',
    paymentMethod: 'PAY_AT_VISIT',
    visit:
      home && r.visit_governorate
        ? { governorate: r.visit_governorate, city: r.visit_city ?? '', district: showAddress ? r.visit_district : null, address: showAddress ? r.visit_address : null, contactPhone: showAddress ? r.contact_phone : null }
        : null,
    note: role === 'ADMIN' ? null : r.patient_note,
    statusReason: r.status_reason,
    failureCategory: r.failure_category,
    cancelledBy: r.cancelled_by,
    rescheduleCount: r.reschedule_count,
    viewerRole: role,
    can: {
      cancel: open && (role === 'ADMIN' || start > now),
      reschedule: open && role !== 'ADMIN' && start > now && r.reschedule_count < 3,
      respond: role === 'PROVIDER' && r.status === 'REQUESTED' && new Date(r.respond_by).getTime() > now && start > now,
      start: role === 'PROVIDER' && home && r.status === 'CONFIRMED' && now >= start - 2 * 3_600_000,
      complete: role === 'PROVIDER' && (r.status === 'CONFIRMED' || r.status === 'IN_PROGRESS') && now >= start,
      noShow: role === 'PROVIDER' && r.status === 'CONFIRMED' && now >= start + 15 * 60_000,
      fail: role === 'PROVIDER' && home && (r.status === 'CONFIRMED' || r.status === 'IN_PROGRESS') && now >= start - 2 * 3_600_000,
      reportIssue: role === 'PATIENT' && now >= start && ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW', 'VISIT_FAILED'].includes(r.status),
    },
    createdAt: iso(r.created_at)!,
  };
}

async function loadOne(tx: Tx, id: string, viewer: Principal, withEvents = false): Promise<Appointment> {
  const r = (await tx.execute<Row>(sql`${SELECT} where a.id = ${id}::uuid`)).rows[0];
  if (!r) throw notFound('Appointment');
  const dto = toDto(r, viewer);
  if (withEvents) {
    const ev = await tx.execute<{ event: string; actor_role: string; from_status: AppointmentStatus | null; to_status: AppointmentStatus; old_starts_at: string | null; new_starts_at: string | null; note: string | null; created_at: string }>(
      sql`select event, actor_role, from_status, to_status, old_starts_at::text, new_starts_at::text, note, created_at::text from app.appointment_events where appointment_id = ${id}::uuid order by created_at`,
    );
    dto.events = ev.rows.map((e) => ({
      event: e.event,
      actorRole: e.actor_role as 'PATIENT',
      fromStatus: e.from_status,
      toStatus: e.to_status,
      oldStartsAt: iso(e.old_starts_at),
      newStartsAt: iso(e.new_starts_at),
      // Decline / cancel reasons are for the parties; operations staff see the event only.
      note: dto.viewerRole === 'ADMIN' ? null : e.note,
      at: iso(e.created_at)!,
    }));
  }
  return dto;
}

// ---------------------------------------------------------------- booking options of a provider
const FLAG_FOR: Record<AppointmentKind, string | null> = {
  DOCTOR_CLINIC: 'care.clinic_booking',
  DOCTOR_HOME_VISIT: 'care.home_visit_booking',
  NURSE_HOME_VISIT: 'care.home_visit_booking',
  DOCTOR_ONLINE: null,
};

export async function bookingOptions(tx: Tx, providerUserId: string): Promise<BookingOption[]> {
  const flags = new Map(
    (await tx.execute<{ key: string; enabled: boolean }>(sql`select key, enabled from app.feature_flags where key in ('care.clinic_booking', 'care.home_visit_booking')`)).rows.map((f) => [f.key, f.enabled]),
  );
  const block = (await tx.execute<{ b: string | null }>(sql`select app.provider_booking_block(${providerUserId}) as b`)).rows[0]?.b as BookingBlock | null;
  const blockedFor = (kind: AppointmentKind): BookingBlock | null => {
    if (kind === 'DOCTOR_ONLINE') return 'VIDEO_NOT_CONFIGURED';
    const flag = FLAG_FOR[kind];
    if (flag && !flags.get(flag)) return 'FEATURE_DISABLED';
    return block;
  };
  const offerings = await tx.execute<{ id: string; kind: AppointmentKind; duration_minutes: number; price_piasters: number; clinic_address_ar: string | null; clinic_address_en: string | null }>(
    sql`select id, kind, duration_minutes, price_piasters, clinic_address_ar, clinic_address_en from app.doctor_offerings where provider_user_id = ${providerUserId} and active order by kind`,
  );
  const services = await tx.execute<{ id: string; name_ar: string; name_en: string; duration_minutes: number; base_price_piasters: number; requires_clinical_authorization: boolean }>(
    sql`select s.id, s.name_ar, s.name_en, s.duration_minutes, s.base_price_piasters, s.requires_clinical_authorization
        from app.provider_services ps join app.nursing_services s on s.id = ps.service_id
        join app.provider_profiles p on p.user_id = ps.provider_user_id and p.provider_type = 'NURSE'
        where ps.provider_user_id = ${providerUserId} and s.active order by s.sort_order`,
  );
  const out: BookingOption[] = offerings.rows.map((o) => {
    const b = blockedFor(o.kind);
    return { kind: o.kind, offeringId: o.id, serviceId: null, nameAr: null, nameEn: null, durationMinutes: o.duration_minutes, pricePiasters: o.price_piasters, clinicAddressAr: o.clinic_address_ar, clinicAddressEn: o.clinic_address_en, requiresClinicalAuthorization: false, bookable: !b, blockedReason: b };
  });
  for (const s of services.rows) {
    const b = blockedFor('NURSE_HOME_VISIT');
    out.push({ kind: 'NURSE_HOME_VISIT', offeringId: null, serviceId: s.id, nameAr: s.name_ar, nameEn: s.name_en, durationMinutes: s.duration_minutes, pricePiasters: s.base_price_piasters, clinicAddressAr: null, clinicAddressEn: null, requiresClinicalAuthorization: s.requires_clinical_authorization, bookable: !b, blockedReason: b });
  }
  return out;
}

// ---------------------------------------------------------------- worker
/** Expires unanswered requests and tells the patient (system context). Returns how many expired. */
export async function runAppointmentMaintenance(app: FastifyInstance): Promise<number> {
  const { db: database, env, notifier } = app.services;
  return withContext(database, { userId: null, demoMode: env.DEMO_MODE }, async (tx) => {
    const ids = (await tx.execute<{ id: string }>(sql`select app.appointments_expire() as id`)).rows.map((r) => r.id);
    for (const id of ids) await notifyBooking(tx, notifier, env, id, 'EXPIRED');
    return ids.length;
  });
}

export function startAppointmentWorker(app: FastifyInstance) {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runAppointmentMaintenance(app)
      .catch((err) => app.log.warn({ err: (err as Error).message }, 'appointment maintenance failed'))
      .finally(() => {
        running = false;
      });
  }, 60_000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
}

// ---------------------------------------------------------------- routes
export async function appointmentRoutes(app: FastifyInstance) {
  const { env, notifier } = app.services;
  const idParam = z.object({ id: z.string().uuid() });
  const act = async <T>(request: FastifyRequest, principal: Principal, fn: (tx: Tx) => Promise<T>) => db(() => inContext(request, principal, fn));
  const writeLimit = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

  // ------------------------------------------------------------ availability (any signed-in user)
  app.get('/providers/:userId/availability', async (request): Promise<AvailabilityResponse> => {
    const principal = await requirePrincipal(request);
    const { userId } = parse(z.object({ userId: z.string().min(1).max(64) }), request.params);
    const q = parse(availabilityQuery, request.query);
    return inContext(request, principal, async (tx) => {
      const options = await bookingOptions(tx, userId);
      const opt = options.find((o) => o.kind === q.kind && (q.kind === 'NURSE_HOME_VISIT' ? o.serviceId === q.serviceId : o.offeringId === q.offeringId));
      if (!opt) throw notFound('Booking option');
      const base = { timeZone: 'Africa/Cairo' as const, durationMinutes: opt.durationMinutes, pricePiasters: opt.pricePiasters };
      if (!opt.bookable) return { ...base, bookable: false, blockedReason: opt.blockedReason, slots: [] };
      const from = q.from ?? todayInCairo();
      const slots = await tx.execute<{ starts_at: string; ends_at: string }>(
        sql`select starts_at::text, ends_at::text from app.provider_slots(${userId}, ${opt.durationMinutes}, ${from}::date, ${q.days})`,
      );
      return { ...base, bookable: true, blockedReason: null, slots: slots.rows.map((s) => ({ startsAt: iso(s.starts_at)!, endsAt: iso(s.ends_at)! })) };
    });
  });

  // ------------------------------------------------------------ patient side
  app.post('/appointments', writeLimit, async (request, reply) => {
    const principal = await requirePrincipal(request);
    const body = parse(createAppointmentBody, request.body);
    const home = HOME_KINDS.includes(body.kind);
    let phone: string | null = null;
    if (home) {
      if (!body.visit || !body.contactPhone) throw unprocessable('ADDRESS_REQUIRED', 'A home visit needs the visit address and a contact phone number');
      const p = normalizePhone(body.contactPhone, { allowedCountries: env.SMS_ALLOWED_COUNTRIES.split(',') });
      if (!p.ok) throw unprocessable('INVALID_PHONE', 'Enter a mobile number we can reach', { reason: p.reason });
      phone = p.e164;
    }
    const appt = await act(request, principal, async (tx) => {
      const id = (
        await tx.execute<{ id: string }>(sql`
          select app.appointment_request(${body.kind}::app.appointment_kind, ${body.providerUserId}, ${body.patientId}::uuid, ${body.offeringId ?? null}::uuid,
            ${body.serviceId ?? null}::uuid, ${body.startsAt}::timestamptz, ${home ? body.visit!.governorate : null}::app.governorate, ${home ? body.visit!.city : null},
            ${home ? (body.visit!.district ?? null) : null}, ${home ? body.visit!.address : null}, ${phone}, ${body.note ?? null}, ${body.clinicalAuthorizationAttested ?? false}) as id`)
      ).rows[0]!.id;
      await notifyBooking(tx, notifier, env, id, 'REQUESTED');
      return loadOne(tx, id, principal, true);
    });
    return reply.status(201).send(appt);
  });

  app.get('/appointments', async (request) => {
    const principal = await requirePrincipal(request);
    const q = parse(z.object({ scope: z.enum(['upcoming', 'past', 'all']).default('upcoming'), patientId: z.string().uuid().optional() }), request.query);
    return inContext(request, principal, async (tx) => {
      const scope =
        q.scope === 'upcoming'
          ? sql`and (a.status in ('REQUESTED','CONFIRMED','IN_PROGRESS') and a.ends_at > now())`
          : q.scope === 'past'
            ? sql`and not (a.status in ('REQUESTED','CONFIRMED','IN_PROGRESS') and a.ends_at > now())`
            : sql``;
      const rows = await tx.execute<Row>(sql`${SELECT}
        where (a.booked_by_user_id = ${principal.userId} or app.can_view_patient(a.patient_id))
          ${q.patientId ? sql`and a.patient_id = ${q.patientId}::uuid` : sql``} ${scope}
        order by a.starts_at ${q.scope === 'upcoming' ? sql`asc` : sql`desc`} limit 100`);
      return rows.rows.map((r) => toDto(r, principal));
    });
  });

  app.get('/appointments/:id', async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    return inContext(request, principal, (tx) => loadOne(tx, id, principal, true));
  });

  app.post('/appointments/:id/cancel', writeLimit, async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    const { reason } = parse(cancelAppointmentBody, request.body ?? {});
    return act(request, principal, async (tx) => {
      const before = await loadOne(tx, id, principal);
      if (before.viewerRole === 'ADMIN') throw notFound('Appointment'); // staff cancel through the operations endpoint
      await tx.execute(sql`select app.appointment_cancel(${id}::uuid, ${reason ?? null})`);
      await notifyBooking(tx, notifier, env, id, 'CANCELLED');
      return loadOne(tx, id, principal, true);
    });
  });

  app.post('/appointments/:id/reschedule', writeLimit, async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    const body = parse(rescheduleAppointmentBody, request.body);
    return act(request, principal, async (tx) => {
      const before = await loadOne(tx, id, principal);
      if (before.viewerRole === 'ADMIN') throw notFound('Appointment');
      await tx.execute(sql`select app.appointment_reschedule(${id}::uuid, ${body.startsAt}::timestamptz, ${body.reason ?? null})`);
      await notifyBooking(tx, notifier, env, id, before.viewerRole === 'PROVIDER' ? 'RESCHEDULED_BY_PROVIDER' : 'RESCHEDULED_BY_PATIENT');
      return loadOne(tx, id, principal, true);
    });
  });

  app.post('/appointments/:id/respond', writeLimit, async (request) => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    const { id } = parse(idParam, request.params);
    const body = parse(respondAppointmentBody, request.body);
    return act(request, principal, async (tx) => {
      const status = (await tx.execute<{ s: AppointmentStatus }>(sql`select app.appointment_respond(${id}::uuid, ${body.accept}, ${body.reason ?? null}) as s`)).rows[0]!.s;
      await notifyBooking(tx, notifier, env, id, status === 'CONFIRMED' ? 'CONFIRMED' : 'DECLINED');
      return loadOne(tx, id, principal, true);
    });
  });

  app.post('/appointments/:id/progress', writeLimit, async (request) => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    const { id } = parse(idParam, request.params);
    const body = parse(progressAppointmentBody, request.body);
    if (body.action === 'FAIL' && !body.failureCategory) throw unprocessable('CATEGORY_REQUIRED', 'Choose why the visit could not be carried out');
    return act(request, principal, async (tx) => {
      const status = (await tx.execute<{ s: AppointmentStatus }>(sql`select app.appointment_progress(${id}::uuid, ${body.action}, ${body.reason ?? null}, ${body.failureCategory ?? null}) as s`)).rows[0]!.s;
      if (status === 'COMPLETED') await notifyBooking(tx, notifier, env, id, 'COMPLETED');
      if (status === 'NO_SHOW' || status === 'VISIT_FAILED') await notifier.cancelRelated(tx, 'appointment', id, ['booking.reminder']);
      return loadOne(tx, id, principal, true);
    });
  });

  app.post('/appointments/:id/report', writeLimit, async (request) => {
    const principal = await requirePrincipal(request);
    const { id } = parse(idParam, request.params);
    const { category } = parse(reportAppointmentIssueBody, request.body);
    return act(request, principal, async (tx) => {
      await tx.execute(sql`select app.appointment_report_issue(${id}::uuid, ${category})`);
      return { ok: true };
    });
  });

  // ------------------------------------------------------------ provider self-service
  app.get('/provider/me/appointments', async (request) => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    const q = parse(z.object({ scope: z.enum(['requests', 'upcoming', 'past']).default('upcoming') }), request.query);
    return inContext(request, principal, async (tx) => {
      const scope =
        q.scope === 'requests'
          ? sql`and a.status = 'REQUESTED'`
          : q.scope === 'upcoming'
            ? sql`and a.status in ('CONFIRMED','IN_PROGRESS')`
            : sql`and a.status not in ('REQUESTED','CONFIRMED','IN_PROGRESS')`;
      const rows = await tx.execute<Row>(sql`${SELECT} where a.provider_user_id = ${principal.userId} ${scope}
        order by a.starts_at ${q.scope === 'past' ? sql`desc` : sql`asc`} limit 200`);
      return rows.rows.map((r) => toDto(r, principal));
    });
  });

  const mineOnly = async (tx: Tx, principal: Principal, type?: 'DOCTOR' | 'NURSE') => {
    const p = (await tx.execute<{ t: 'DOCTOR' | 'NURSE' }>(sql`select provider_type as t from app.provider_profiles where user_id = ${principal.userId}`)).rows[0];
    if (!p) throw unprocessable('PROFILE_REQUIRED', 'Create your professional profile first');
    if (type && p.t !== type) throw forbidden('DOCTORS_ONLY', 'Only doctors set consultation types');
  };
  const loadOfferings = async (tx: Tx, userId: string): Promise<DoctorOffering[]> =>
    (
      await tx.execute<{ id: string; kind: DoctorOffering['kind']; duration_minutes: number; price_piasters: number; clinic_address_ar: string | null; clinic_address_en: string | null; active: boolean }>(
        sql`select id, kind, duration_minutes, price_piasters, clinic_address_ar, clinic_address_en, active from app.doctor_offerings where provider_user_id = ${userId} order by kind`,
      )
    ).rows.map((o) => ({ id: o.id, kind: o.kind, durationMinutes: o.duration_minutes, pricePiasters: o.price_piasters, clinicAddressAr: o.clinic_address_ar, clinicAddressEn: o.clinic_address_en, active: o.active }));

  app.get('/provider/me/offerings', async (request) => {
    const principal = await requireRole(request, 'DOCTOR');
    return inContext(request, principal, (tx) => loadOfferings(tx, principal.userId));
  });

  app.put('/provider/me/offerings', async (request) => {
    const principal = await requireRole(request, 'DOCTOR');
    const { offerings } = parse(doctorOfferingsBody, request.body);
    if (new Set(offerings.map((o) => o.kind)).size !== offerings.length) throw unprocessable('DUPLICATE_KIND', 'One entry per consultation type');
    for (const o of offerings) if (o.kind === 'DOCTOR_CLINIC' && !o.clinicAddressAr && !o.clinicAddressEn) throw unprocessable('CLINIC_ADDRESS_REQUIRED', 'Add the clinic address');
    return db(() =>
      inContext(request, principal, async (tx) => {
        await mineOnly(tx, principal, 'DOCTOR');
        // Types left out are switched off, not deleted: existing bookings keep their reference.
        await tx.execute(sql`update app.doctor_offerings set active = false where provider_user_id = ${principal.userId}
          and kind <> all(${`{${offerings.map((o) => o.kind).join(',')}}`}::app.appointment_kind[])`);
        for (const o of offerings) {
          await tx.execute(sql`
            insert into app.doctor_offerings (provider_user_id, kind, duration_minutes, price_piasters, clinic_address_ar, clinic_address_en, active)
            values (${principal.userId}, ${o.kind}::app.appointment_kind, ${o.durationMinutes}, ${o.pricePiasters}, ${o.clinicAddressAr ?? null}, ${o.clinicAddressEn ?? null}, ${o.active})
            on conflict (provider_user_id, kind) do update set duration_minutes = excluded.duration_minutes, price_piasters = excluded.price_piasters,
              clinic_address_ar = excluded.clinic_address_ar, clinic_address_en = excluded.clinic_address_en, active = excluded.active`);
        }
        await audit(tx, { actorUserId: principal.userId, action: 'provider.offerings.updated', entityType: 'provider', entityId: principal.userId, requestId: request.id, metadata: { offerings } });
        return loadOfferings(tx, principal.userId);
      }),
    );
  });

  app.get('/provider/me/coverage', async (request) => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    return inContext(request, principal, async (tx) => (await tx.execute<{ governorate: string; city: string | null }>(sql`select governorate, city from app.provider_coverage where provider_user_id = ${principal.userId} order by governorate, city nulls first`)).rows);
  });

  app.put('/provider/me/coverage', async (request) => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    const { areas } = parse(coverageBody, request.body);
    return db(() =>
      inContext(request, principal, async (tx) => {
        await mineOnly(tx, principal);
        await tx.execute(sql`delete from app.provider_coverage where provider_user_id = ${principal.userId}`);
        for (const a of areas) {
          await tx.execute(sql`insert into app.provider_coverage (provider_user_id, governorate, city) values (${principal.userId}, ${a.governorate}::app.governorate, ${a.city ?? null}) on conflict do nothing`);
        }
        await audit(tx, { actorUserId: principal.userId, action: 'provider.coverage.updated', entityType: 'provider', entityId: principal.userId, requestId: request.id, metadata: { count: areas.length } });
        return (await tx.execute(sql`select governorate, city from app.provider_coverage where provider_user_id = ${principal.userId} order by governorate, city nulls first`)).rows;
      }),
    );
  });

  const loadTimeOff = async (tx: Tx, userId: string): Promise<TimeOff[]> =>
    (
      await tx.execute<{ id: string; s: string; e: string; note: string | null }>(
        sql`select id, lower(period)::text as s, upper(period)::text as e, note from app.provider_time_off where provider_user_id = ${userId} and upper(period) > now() order by lower(period)`,
      )
    ).rows.map((t) => ({ id: t.id, startsAt: iso(t.s)!, endsAt: iso(t.e)!, note: t.note }));

  app.get('/provider/me/time-off', async (request) => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    return inContext(request, principal, (tx) => loadTimeOff(tx, principal.userId));
  });

  app.post('/provider/me/time-off', async (request, reply) => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    const body = parse(timeOffBody, request.body);
    const out = await db(() =>
      inContext(request, principal, async (tx) => {
        await mineOnly(tx, principal);
        // Booked patients are never silently dropped: cancel or move those bookings first.
        const clash = await tx.execute<{ reference: string }>(sql`
          select reference from app.appointments where provider_user_id = ${principal.userId} and status in ('REQUESTED','CONFIRMED','IN_PROGRESS')
            and slot && tstzrange(${body.startsAt}::timestamptz, ${body.endsAt}::timestamptz, '[)') order by starts_at`);
        if (clash.rows.length) throw conflict('BOOKINGS_IN_PERIOD', `Move or cancel these bookings first: ${clash.rows.map((c) => c.reference).join(', ')}`);
        await tx.execute(sql`insert into app.provider_time_off (provider_user_id, period, note) values (${principal.userId}, tstzrange(${body.startsAt}::timestamptz, ${body.endsAt}::timestamptz, '[)'), ${body.note ?? null})`);
        return loadTimeOff(tx, principal.userId);
      }),
    );
    return reply.status(201).send(out);
  });

  app.delete('/provider/me/time-off/:id', async (request) => {
    const principal = await requireRole(request, 'DOCTOR', 'NURSE');
    const { id } = parse(idParam, request.params);
    return inContext(request, principal, async (tx) => {
      await tx.execute(sql`delete from app.provider_time_off where id = ${id}::uuid and provider_user_id = ${principal.userId}`);
      return loadTimeOff(tx, principal.userId);
    });
  });

  // ------------------------------------------------------------ operations (care staff only)
  app.get('/admin/ops/appointments', async (request) => {
    const principal = await requirePermission(request, 'ops.read');
    const q = parse(
      z.object({
        status: z.enum(['REQUESTED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'DECLINED', 'CANCELLED', 'EXPIRED', 'NO_SHOW', 'VISIT_FAILED']).optional(),
        kind: z.enum(['DOCTOR_CLINIC', 'DOCTOR_HOME_VISIT', 'DOCTOR_ONLINE', 'NURSE_HOME_VISIT']).optional(),
        providerUserId: z.string().min(1).max(64).optional(),
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100),
      }),
      request.query,
    );
    return inContext(request, principal, async (tx) => {
      const where = [sql`true`];
      if (q.status) where.push(sql`a.status = ${q.status}::app.appointment_status`);
      if (q.kind) where.push(sql`a.kind = ${q.kind}::app.appointment_kind`);
      if (q.providerUserId) where.push(sql`a.provider_user_id = ${q.providerUserId}`);
      if (q.from) where.push(sql`a.starts_at >= ${q.from}::timestamptz`);
      if (q.to) where.push(sql`a.starts_at < ${q.to}::timestamptz`);
      const rows = await tx.execute<{ id: string; reference: string; kind: AppointmentKind; status: AppointmentStatus; starts_at: string; provider_name: string; provider_user_id: string; patient_name: string; governorate: string | null; price_piasters: number; failure_category: OpsAppointment['failureCategory']; cancelled_by: string | null; created_at: string }>(sql`
        select a.id, a.reference, a.kind, a.status, a.starts_at::text, a.provider_name_en as provider_name, a.provider_user_id, a.patient_display_name as patient_name,
               coalesce(a.visit_governorate, p.governorate)::text as governorate, a.price_piasters, a.failure_category, a.cancelled_by, a.created_at::text
        from app.appointments a left join app.provider_profiles p on p.user_id = a.provider_user_id
        where ${sql.join(where, sql` and `)} order by a.starts_at desc limit ${q.limit}`);
      const counts = await tx.execute<{ status: string; n: number }>(sql`select status::text, count(*)::int as n from app.appointments where starts_at > now() - interval '30 days' group by 1`);
      return {
        last30Days: Object.fromEntries(counts.rows.map((c) => [c.status, c.n])),
        appointments: rows.rows.map(
          (r): OpsAppointment => ({
            id: r.id,
            reference: r.reference,
            kind: r.kind,
            status: r.status,
            startsAt: iso(r.starts_at)!,
            providerName: r.provider_name,
            providerUserId: r.provider_user_id,
            patientDisplayName: r.patient_name,
            governorate: r.governorate,
            pricePiasters: r.price_piasters,
            failureCategory: r.failure_category,
            cancelledBy: r.cancelled_by,
            createdAt: iso(r.created_at)!,
          }),
        ),
      };
    });
  });

  app.post('/admin/ops/appointments/:id/cancel', async (request) => {
    const principal = await requirePermission(request, 'ops.manage');
    const { id } = parse(idParam, request.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(500) }).strict(), request.body);
    return act(request, principal, async (tx) => {
      const role = (await tx.execute<{ r: string }>(sql`select app.appointment_cancel(${id}::uuid, ${reason}) as r`)).rows[0]!.r;
      if (role !== 'ADMIN') throw forbidden('NOT_AS_STAFF', 'You are a party to this booking; cancel it from the app');
      await notifyBooking(tx, notifier, env, id, 'CANCELLED');
      return loadOne(tx, id, principal, true);
    });
  });

  app.get('/admin/ops/home-care-regions', async (request) => {
    const principal = await requirePermission(request, 'ops.read');
    return inContext(request, principal, async (tx) => (await tx.execute(sql`select governorate::text, active, note, updated_at::text from app.home_care_regions order by governorate`)).rows);
  });

  app.put('/admin/ops/home-care-regions/:governorate', async (request) => {
    const principal = await requirePermission(request, 'ops.manage');
    const { governorate } = parse(z.object({ governorate: z.string().regex(/^[A-Z_]{3,30}$/) }), request.params);
    const body = parse(homeCareRegionBody, request.body);
    return db(() =>
      inContext(request, principal, async (tx) => {
        const r = await tx.execute(sql`update app.home_care_regions set active = ${body.active}, note = ${body.note ?? null}, updated_by_user_id = ${principal.userId}, updated_at = now()
          where governorate = ${governorate}::app.governorate`);
        if (!r.rowCount) throw notFound('Governorate');
        await audit(tx, { actorUserId: principal.userId, action: 'ops.home_care_region.update', entityType: 'home_care_region', entityId: governorate, requestId: request.id, metadata: body });
        return { ok: true };
      }),
    );
  });

  /** Bookable setup of every approved provider: hours, offerings, coverage, time off, load. Read-only. */
  app.get('/admin/ops/schedules', async (request): Promise<OpsSchedule[]> => {
    const principal = await requirePermission(request, 'ops.read');
    const q = parse(z.object({ type: z.enum(['DOCTOR', 'NURSE']).optional(), blockedOnly: z.coerce.boolean().default(false) }), request.query);
    return inContext(request, principal, async (tx) => {
      const rows = await tx.execute<{
        user_id: string; provider_type: 'DOCTOR' | 'NURSE'; name_ar: string; name_en: string; governorate: string | null; city: string | null; availability_status: string;
        temporarily_unavailable: boolean; max_daily: number | null; block: BookingBlock | null; weekly_minutes: number; working_days: number;
        offerings: OpsSchedule['offerings'] | null; nursing_services: number; coverage_areas: number; time_off: number; requested_open: number; booked_7d: number;
      }>(sql`
        select p.user_id, p.provider_type::text as provider_type, p.display_name_ar as name_ar, p.display_name_en as name_en, p.governorate::text, p.city,
               p.availability_status::text, p.temporarily_unavailable, p.max_daily_appointments as max_daily, app.provider_booking_block(p.user_id) as block,
               coalesce((select sum(h.end_minute - h.start_minute) from app.provider_working_hours h where h.provider_user_id = p.user_id), 0)::int as weekly_minutes,
               (select count(distinct h.weekday) from app.provider_working_hours h where h.provider_user_id = p.user_id)::int as working_days,
               (select jsonb_agg(jsonb_build_object('kind', o.kind, 'durationMinutes', o.duration_minutes, 'pricePiasters', o.price_piasters, 'active', o.active) order by o.kind)
                  from app.doctor_offerings o where o.provider_user_id = p.user_id) as offerings,
               (select count(*) from app.provider_services s where s.provider_user_id = p.user_id)::int as nursing_services,
               (select count(*) from app.provider_coverage c where c.provider_user_id = p.user_id)::int as coverage_areas,
               (select count(*) from app.provider_time_off t where t.provider_user_id = p.user_id and t.period && tstzrange(now(), now() + interval '14 days'))::int as time_off,
               (select count(*) from app.appointments a where a.provider_user_id = p.user_id and a.status = 'REQUESTED')::int as requested_open,
               (select count(*) from app.appointments a where a.provider_user_id = p.user_id and a.status in ('REQUESTED', 'CONFIRMED', 'IN_PROGRESS')
                  and a.starts_at >= now() and a.starts_at < now() + interval '7 days')::int as booked_7d
        from app.provider_profiles p
        where p.verification_status = 'APPROVED' and p.provider_type in ('DOCTOR', 'NURSE')
          ${q.type ? sql`and p.provider_type = ${q.type}::app.provider_type` : sql``}
        order by p.provider_type, p.display_name_en limit 500`);
      return rows.rows
        .map((r): OpsSchedule => ({
          userId: r.user_id,
          providerType: r.provider_type,
          nameAr: r.name_ar,
          nameEn: r.name_en,
          governorate: r.governorate,
          city: r.city,
          availabilityStatus: r.availability_status,
          temporarilyUnavailable: r.temporarily_unavailable,
          maxDailyAppointments: r.max_daily,
          bookingBlock: r.block,
          weeklyMinutes: r.weekly_minutes,
          workingDays: r.working_days,
          offerings: r.offerings ?? [],
          nursingServices: r.nursing_services,
          coverageAreas: r.coverage_areas,
          timeOffNext14Days: r.time_off,
          requestedOpen: r.requested_open,
          bookedNext7Days: r.booked_7d,
        }))
        .filter((r) => !q.blockedOnly || r.bookingBlock !== null);
    });
  });

  // ------------------------------------------------------------ incidents (care: ops.*; commerce: also orders.manage)
  // RLS then limits commerce staff to COMMERCE incidents.
  const incidentPerm = async (request: FastifyRequest) => {
    const principal = await requirePrincipal(request);
    return requirePermission(request, hasPermission(principal.roles, 'ops.read') ? 'ops.read' : 'orders.manage');
  };
  const incidentDto = (r: Record<string, unknown>): OpsIncident => ({
    id: r.id as string,
    kind: r.kind as OpsIncident['kind'],
    severity: r.severity as OpsIncident['severity'],
    status: r.status as OpsIncident['status'],
    domain: r.domain as OpsIncident['domain'],
    title: r.title as string,
    detail: (r.detail as string | null) ?? null,
    relatedType: (r.related_type as string | null) ?? null,
    relatedId: (r.related_id as string | null) ?? null,
    resolution: (r.resolution as string | null) ?? null,
    createdAt: iso(r.created_at as string)!,
    acknowledgedAt: iso(r.acknowledged_at as string | null),
    resolvedAt: iso(r.resolved_at as string | null),
  });

  app.get('/admin/ops/incidents', async (request) => {
    const principal = await incidentPerm(request);
    const q = parse(z.object({ status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'UNRESOLVED']).default('UNRESOLVED'), domain: z.enum(['CARE', 'COMMERCE', 'PLATFORM']).optional() }), request.query);
    return inContext(request, principal, async (tx) => {
      const rows = await tx.execute(sql`select id, kind, severity, status::text, domain, title, detail, related_type, related_id, resolution, created_at::text, acknowledged_at::text, resolved_at::text
        from app.ops_incidents where ${q.status === 'UNRESOLVED' ? sql`status <> 'RESOLVED'` : sql`status = ${q.status}::app.incident_status`}
        ${q.domain ? sql`and domain = ${q.domain}` : sql``}
        order by case severity when 'CRITICAL' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 else 3 end, created_at desc limit 200`);
      return rows.rows.map((r) => incidentDto(r as Record<string, unknown>));
    });
  });

  app.post('/admin/ops/incidents/:id/acknowledge', async (request) => {
    const principal = await incidentPerm(request);
    const { id } = parse(idParam, request.params);
    return inContext(request, principal, async (tx) => {
      const r = await tx.execute(sql`update app.ops_incidents set status = 'ACKNOWLEDGED', acknowledged_at = now(), updated_at = now() where id = ${id}::uuid and status = 'OPEN'`);
      if (!r.rowCount) throw conflict('INVALID_TRANSITION', 'Only open incidents can be acknowledged');
      await audit(tx, { actorUserId: principal.userId, action: 'ops.incident.acknowledge', entityType: 'incident', entityId: id, requestId: request.id });
      return { ok: true };
    });
  });

  app.post('/admin/ops/incidents/:id/resolve', async (request) => {
    const principal = await incidentPerm(request);
    const { id } = parse(idParam, request.params);
    const { resolution } = parse(resolveIncidentBody, request.body);
    return inContext(request, principal, async (tx) => {
      const r = await tx.execute(sql`update app.ops_incidents set status = 'RESOLVED', resolution = ${resolution}, resolved_at = now(), resolved_by_user_id = ${principal.userId},
        acknowledged_at = coalesce(acknowledged_at, now()), updated_at = now() where id = ${id}::uuid and status <> 'RESOLVED'`);
      if (!r.rowCount) throw conflict('INVALID_TRANSITION', 'Already resolved');
      await audit(tx, { actorUserId: principal.userId, action: 'ops.incident.resolve', entityType: 'incident', entityId: id, requestId: request.id });
      return { ok: true };
    });
  });
}
