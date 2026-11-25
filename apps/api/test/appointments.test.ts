import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAppointmentMaintenance } from '../src/modules/appointments/routes';
import { createTestServer, grantRole, ownerPool, PASSWORD, signUp, type Client } from './helpers';

/** ADR 0021 — booking rules are enforced by the database; these tests drive them through the API. */

const owner = ownerPool();
let app: FastifyInstance;
let doctor: Client;
let doctor2: Client;
let nurse: Client;
let patient: Client;
let other: Client;
let admin: Client;
let commerce: Client;
let selfPatientId: string;
let motherPatientId: string;
let otherPatientId: string;
let woundCareId: string;
let injectionId: string;
const offering: Record<string, string> = {};

const cairoParts = (iso: string) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );

async function flag(key: string, on: boolean) {
  await owner.query("update app.feature_flags set enabled = $2, evidence_ref = coalesce(evidence_ref, 'AUTOMATED TEST ONLY — not a real approval') where key = $1", [key, on]);
}

async function approvedProvider(name: string, type: 'DOCTOR' | 'NURSE', hours: { weekday: number; startMinute: number; endMinute: number }[]) {
  const c = await signUp(app, { role: type, name });
  const profile =
    type === 'DOCTOR'
      ? { providerType: 'DOCTOR', displayNameAr: `د. ${name}`, displayNameEn: `Dr. ${name}`, gender: 'FEMALE', specialty: 'DERMATOLOGY', yearsExperience: 10, governorate: 'CAIRO', city: 'Nasr City', feePiasters: 50000 }
      : { providerType: 'NURSE', displayNameAr: `م. ${name}`, displayNameEn: `Nurse ${name}`, gender: 'FEMALE', yearsExperience: 6, governorate: 'CAIRO', city: 'Nasr City' };
  expect((await c.req({ method: 'PUT', url: '/v1/provider/me', body: profile })).status).toBe(200);
  await owner.query("update app.provider_profiles set verification_status = 'APPROVED', verified_at = now(), availability_status = $2 where user_id = $1", [c.userId, type === 'DOCTOR' ? 'ACCEPTING_NEW_PATIENTS' : 'SCHEDULED_ONLY']);
  expect((await c.req({ method: 'PUT', url: '/v1/provider/me/working-hours', body: { slots: hours } })).status).toBe(200);
  return c;
}
const everyDay = (start: number, end: number) => [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: start, endMinute: end }));

async function slots(c: Client, providerId: string, q: string) {
  const r = await c.req({ method: 'GET', url: `/v1/providers/${providerId}/availability?${q}` });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json as { bookable: boolean; blockedReason: string | null; slots: { startsAt: string; endsAt: string }[]; pricePiasters: number; durationMinutes: number };
}
const clinic = (c: Client, providerId: string, patientId: string, startsAt: string, extra: object = {}) =>
  c.req({ method: 'POST', url: '/v1/appointments', body: { kind: 'DOCTOR_CLINIC', providerUserId: providerId, patientId, offeringId: offering[providerId], startsAt, ...extra } });
const visit = { governorate: 'CAIRO', city: 'Nasr City', district: 'District 7', address: '12 Abbas El Akkad St, building 4, floor 3, apt 9' };
const homeVisit = (c: Client, patientId: string, serviceId: string, startsAt: string, extra: object = {}) =>
  c.req({ method: 'POST', url: '/v1/appointments', body: { kind: 'NURSE_HOME_VISIT', providerUserId: nurse.userId, patientId, serviceId, startsAt, visit, contactPhone: '01012345678', ...extra } });
const notes = async (id: string) => (await owner.query('select purpose, channel, status, send_after, recipient_user_id from app.notifications where related_id = $1 order by created_at', [id])).rows;
/** Moves a booking's time directly (simulates the clock passing). */
const shiftTo = (id: string, startsAt: Date) => owner.query("update app.appointments set starts_at = $2, ends_at = $2::timestamptz + interval '30 minutes' where id = $1", [id, startsAt.toISOString()]);
const selfProfile = (c: Client, name: string, sex = 'FEMALE') =>
  c.req({ method: 'POST', url: '/v1/patients', body: { displayName: name, dateOfBirth: '1980-01-01', sex, relationship: 'SELF', consentBasis: 'SELF', consentAttested: true, consentStatementVersion: 'v1' } });

beforeAll(async () => {
  app = await createTestServer();
  await flag('care.clinic_booking', true);
  await flag('care.home_visit_booking', true);
  await owner.query("update app.home_care_regions set active = (governorate = 'CAIRO')");

  doctor = await approvedProvider('Mona Booking', 'DOCTOR', everyDay(9 * 60, 13 * 60));
  doctor2 = await approvedProvider('Second Booking', 'DOCTOR', everyDay(9 * 60, 13 * 60));
  for (const d of [doctor, doctor2]) {
    const r = await d.req({
      method: 'PUT',
      url: '/v1/provider/me/offerings',
      body: {
        offerings: [
          { kind: 'DOCTOR_CLINIC', durationMinutes: 30, pricePiasters: 45000, clinicAddressEn: '5 Makram Ebeid St, Nasr City', clinicAddressAr: '٥ شارع مكرم عبيد، مدينة نصر' },
          { kind: 'DOCTOR_ONLINE', durationMinutes: 20, pricePiasters: 30000 },
        ],
      },
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    offering[d.userId] = r.json.find((o: { kind: string }) => o.kind === 'DOCTOR_CLINIC').id;
  }

  nurse = await approvedProvider('Hala Booking', 'NURSE', everyDay(8 * 60, 20 * 60));
  const svc = async (code: string, auth: boolean) =>
    (
      await owner.query(
        `insert into app.nursing_services (code, name_ar, name_en, description_ar, description_en, scope_ar, scope_en, duration_minutes, base_price_piasters, requires_clinical_authorization)
       values ($1, 'خدمة', 'Service', 'وصف', 'Description', 'نطاق', 'Scope', 60, 30000, $2) returning id`,
        [code, auth],
      )
    ).rows[0].id as string;
  woundCareId = await svc(`BOOK_WOUND_${Date.now()}`, false);
  injectionId = await svc(`BOOK_INJ_${Date.now()}`, true);
  // The nurse proposes her own price; patients still pay the catalogue's approved price.
  expect((await nurse.req({ method: 'PUT', url: '/v1/provider/me/services', body: { services: [{ serviceId: woundCareId, pricePiasters: 99999 }, { serviceId: injectionId, pricePiasters: null }] } })).status).toBe(200);

  patient = await signUp(app, { role: 'PATIENT', name: 'Booking Patient' });
  selfPatientId = (await selfProfile(patient, 'Booking Patient')).json.id;
  const mother = await patient.req({ method: 'POST', url: '/v1/patients', body: { displayName: 'Mother of Patient', dateOfBirth: '1950-05-05', sex: 'FEMALE', relationship: 'MOTHER', consentBasis: 'ADULT_CONSENT_ATTESTED', consentAttested: true, consentStatementVersion: 'v1' } });
  motherPatientId = mother.json.id;
  other = await signUp(app, { role: 'PATIENT', name: 'Other Patient' });
  otherPatientId = (await selfProfile(other, 'Other Patient', 'MALE')).json.id;
  admin = await signUp(app, { name: 'Ops Admin' });
  await grantRole(admin.userId, 'ADMIN');
  commerce = await signUp(app, { name: 'Commerce Staff' });
  await grantRole(commerce.userId, 'COMMERCE_MANAGER');
});
afterAll(async () => {
  // Leave the shared test database as found: regulated features off, no launch areas.
  await flag('care.clinic_booking', false);
  await flag('care.home_visit_booking', false);
  await owner.query('update app.home_care_regions set active = false');
  await app.close();
  await owner.end();
});

describe('availability: only real slots, in Cairo time', () => {
  it('slots follow the published hours in Africa/Cairo, at least 2 hours ahead, stepped by the duration', async () => {
    const s = await slots(patient, doctor.userId, `kind=DOCTOR_CLINIC&offeringId=${offering[doctor.userId]}&days=7`);
    expect(s.bookable).toBe(true);
    expect(s.durationMinutes).toBe(30);
    expect(s.pricePiasters).toBe(45000);
    expect(s.slots.length).toBeGreaterThan(20);
    for (const slot of s.slots) {
      const { hour, minute } = cairoParts(slot.startsAt);
      expect(Number(hour) * 60 + Number(minute)).toBeGreaterThanOrEqual(9 * 60);
      expect(Number(hour) * 60 + Number(minute)).toBeLessThanOrEqual(12 * 60 + 30);
      expect(['00', '30']).toContain(minute);
      expect(new Date(slot.startsAt).getTime()).toBeGreaterThanOrEqual(Date.now() + 2 * 3_600_000 - 60_000);
      expect(new Date(slot.endsAt).getTime() - new Date(slot.startsAt).getTime()).toBe(30 * 60_000);
    }
  });

  it('the time-zone database knows Egypt summer time (UTC+3) and winter time (UTC+2)', async () => {
    const r = await owner.query(`select ('2027-07-01'::date + interval '10 hours') at time zone 'Africa/Cairo' as summer, ('2027-01-10'::date + interval '10 hours') at time zone 'Africa/Cairo' as winter`);
    expect(new Date(r.rows[0].summer).toISOString()).toBe('2027-07-01T07:00:00.000Z');
    expect(new Date(r.rows[0].winter).toISOString()).toBe('2027-01-10T08:00:00.000Z');
  });

  it('a provider without published hours shows no availability at all and cannot be booked', async () => {
    const empty = await approvedProvider('No Hours', 'DOCTOR', []);
    const o = await empty.req({ method: 'PUT', url: '/v1/provider/me/offerings', body: { offerings: [{ kind: 'DOCTOR_CLINIC', durationMinutes: 30, pricePiasters: 1000, clinicAddressEn: 'Somewhere 1, Cairo' }] } });
    const s = await slots(patient, empty.userId, `kind=DOCTOR_CLINIC&offeringId=${o.json[0].id}`);
    expect(s).toMatchObject({ bookable: false, blockedReason: 'NO_SCHEDULE', slots: [] });
    const detail = await patient.req({ method: 'GET', url: `/v1/providers/${empty.userId}` });
    expect(detail.json).toMatchObject({ bookingAvailable: false, bookingUnavailableReason: 'NO_SCHEDULE' });
    const tomorrow10 = new Date(Date.now() + 26 * 3_600_000).toISOString();
    const r = await patient.req({ method: 'POST', url: '/v1/appointments', body: { kind: 'DOCTOR_CLINIC', providerUserId: empty.userId, patientId: selfPatientId, offeringId: o.json[0].id, startsAt: tomorrow10 } });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe('PROVIDER_NOT_BOOKABLE');
  });

  it('a time outside the published slots is refused', async () => {
    const s = await slots(patient, doctor.userId, `kind=DOCTOR_CLINIC&offeringId=${offering[doctor.userId]}&days=3`);
    const offGrid = new Date(new Date(s.slots[0]!.startsAt).getTime() + 7 * 60_000).toISOString();
    const r = await clinic(patient, doctor.userId, selfPatientId, offGrid);
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('SLOT_NOT_AVAILABLE');
    const night = new Date(s.slots[0]!.startsAt);
    night.setUTCHours(night.getUTCHours() + 12);
    expect((await clinic(patient, doctor.userId, selfPatientId, night.toISOString())).json.error.code).toBe('SLOT_NOT_AVAILABLE');
  });

  it('online consultations are not offered (no video provider) and switched-off features are refused', async () => {
    const detail = await patient.req({ method: 'GET', url: `/v1/providers/${doctor.userId}` });
    const online = detail.json.bookingOptions.find((o: { kind: string }) => o.kind === 'DOCTOR_ONLINE');
    expect(online).toMatchObject({ bookable: false, blockedReason: 'VIDEO_NOT_CONFIGURED' });
    const r = await patient.req({ method: 'POST', url: '/v1/appointments', body: { kind: 'DOCTOR_ONLINE', providerUserId: doctor.userId, patientId: selfPatientId, offeringId: online.offeringId, startsAt: new Date(Date.now() + 86_400_000).toISOString() } });
    expect(r.json.error.code).toBe('VIDEO_NOT_CONFIGURED');
    await flag('care.clinic_booking', false);
    try {
      const s = await slots(patient, doctor.userId, `kind=DOCTOR_CLINIC&offeringId=${offering[doctor.userId]}`);
      expect(s).toMatchObject({ bookable: false, blockedReason: 'FEATURE_DISABLED', slots: [] });
      expect((await clinic(patient, doctor.userId, selfPatientId, new Date(Date.now() + 86_400_000).toISOString())).json.error.code).toBe('FEATURE_DISABLED');
    } finally {
      await flag('care.clinic_booking', true);
    }
  });
});

describe('doctor booking lifecycle', () => {
  let id: string;
  let start: string;

  it('a patient requests a slot for themself; the doctor is told; the slot disappears', async () => {
    const s = await slots(patient, doctor.userId, `kind=DOCTOR_CLINIC&offeringId=${offering[doctor.userId]}&days=7`);
    start = s.slots[3]!.startsAt;
    const r = await clinic(patient, doctor.userId, selfPatientId, start, { note: 'Follow-up for my knee' });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    id = r.json.id;
    expect(r.json).toMatchObject({ status: 'REQUESTED', kind: 'DOCTOR_CLINIC', pricePiasters: 45000, paymentMethod: 'PAY_AT_VISIT', viewerRole: 'PATIENT', clinicAddressEn: '5 Makram Ebeid St, Nasr City' });
    expect(r.json.reference).toMatch(/^BK-[0-9A-F]{8}$/);
    const after = await slots(patient, doctor.userId, `kind=DOCTOR_CLINIC&offeringId=${offering[doctor.userId]}&days=7`);
    expect(after.slots.map((x) => x.startsAt)).not.toContain(start);
    const n = await notes(id);
    expect(n.map((x) => [x.purpose, x.recipient_user_id])).toEqual(expect.arrayContaining([['booking.requested', doctor.userId], ['booking.awaiting', patient.userId]]));
    const bodies = (await owner.query('select body from app.notifications where related_id = $1', [id])).rows.map((x) => x.body).join('\n');
    expect(bodies).not.toContain('knee'); // notes never travel in messages
  });

  it('another patient cannot see the booking; the doctor sees the request', async () => {
    expect((await other.req({ method: 'GET', url: `/v1/appointments/${id}` })).status).toBe(404);
    expect((await doctor2.req({ method: 'GET', url: `/v1/appointments/${id}` })).status).toBe(404);
    const reqs = await doctor.req({ method: 'GET', url: '/v1/provider/me/appointments?scope=requests' });
    const mine = reqs.json.find((a: { id: string }) => a.id === id);
    expect(mine).toMatchObject({ viewerRole: 'PROVIDER', note: 'Follow-up for my knee', can: { respond: true } });
  });

  it('the patient cannot respond to their own request; the doctor accepts; reminders are queued', async () => {
    expect((await patient.req({ method: 'POST', url: `/v1/appointments/${id}/respond`, body: { accept: true } })).status).toBe(403);
    const r = await doctor.req({ method: 'POST', url: `/v1/appointments/${id}/respond`, body: { accept: true } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.status).toBe('CONFIRMED');
    const n = await notes(id);
    expect(n.some((x) => x.purpose === 'booking.confirmed' && x.recipient_user_id === patient.userId)).toBe(true);
    const reminders = n.filter((x) => x.purpose === 'booking.reminder');
    expect(reminders.length).toBeGreaterThanOrEqual(1);
    for (const rem of reminders) expect(new Date(rem.send_after).getTime()).toBeLessThan(new Date(start).getTime());
    expect((await doctor.req({ method: 'POST', url: `/v1/appointments/${id}/respond`, body: { accept: true } })).status).toBe(409);
  });

  it('the doctor moves it: confirmed at the new time, reminders replaced, history kept', async () => {
    const s = await slots(doctor, doctor.userId, `kind=DOCTOR_CLINIC&offeringId=${offering[doctor.userId]}&days=7`);
    const next = s.slots[6]!.startsAt;
    const r = await doctor.req({ method: 'POST', url: `/v1/appointments/${id}/reschedule`, body: { startsAt: next, reason: 'Clinic hours changed' } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ status: 'CONFIRMED', startsAt: next, rescheduleCount: 1 });
    expect(r.json.events.map((e: { event: string }) => e.event)).toEqual(['REQUESTED', 'CONFIRMED', 'RESCHEDULED']);
    const n = await notes(id);
    const oldReminders = n.filter((x) => x.purpose === 'booking.reminder' && new Date(x.send_after).getTime() < new Date(next).getTime() - 25 * 3_600_000);
    expect(oldReminders.every((x) => x.status === 'CANCELLED')).toBe(true);
    expect(n.some((x) => x.purpose === 'booking.rescheduled' && x.recipient_user_id === patient.userId)).toBe(true);
    start = next;
  });

  it('the patient moves it: back to REQUESTED for the doctor to answer', async () => {
    const s = await slots(patient, doctor.userId, `kind=DOCTOR_CLINIC&offeringId=${offering[doctor.userId]}&days=7`);
    const r = await patient.req({ method: 'POST', url: `/v1/appointments/${id}/reschedule`, body: { startsAt: s.slots[8]!.startsAt } });
    expect(r.json).toMatchObject({ status: 'REQUESTED', rescheduleCount: 2 });
    expect((await doctor.req({ method: 'POST', url: `/v1/appointments/${id}/respond`, body: { accept: false } })).json.error.code).toBe('REASON_REQUIRED');
    const d = await doctor.req({ method: 'POST', url: `/v1/appointments/${id}/respond`, body: { accept: false, reason: 'Fully booked that day' } });
    expect(d.json).toMatchObject({ status: 'DECLINED', statusReason: 'Fully booked that day' });
    expect((await notes(id)).some((x) => x.purpose === 'booking.declined')).toBe(true);
  });

  it('a caregiver books for a family member; the patient cancels; the doctor is told and reminders stop', async () => {
    const s = await slots(patient, doctor.userId, `kind=DOCTOR_CLINIC&offeringId=${offering[doctor.userId]}&days=7`);
    const r = await clinic(patient, doctor.userId, motherPatientId, s.slots[10]!.startsAt);
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.patient).toEqual({ id: motherPatientId, displayName: 'Mother of Patient' });
    await doctor.req({ method: 'POST', url: `/v1/appointments/${r.json.id}/respond`, body: { accept: true } });
    const c = await patient.req({ method: 'POST', url: `/v1/appointments/${r.json.id}/cancel`, body: {} });
    expect(c.json).toMatchObject({ status: 'CANCELLED', cancelledBy: 'PATIENT' });
    const n = await notes(r.json.id);
    expect(n.some((x) => x.purpose === 'booking.cancelled' && x.recipient_user_id === doctor.userId)).toBe(true);
    expect(n.filter((x) => x.purpose === 'booking.reminder').every((x) => x.status === 'CANCELLED')).toBe(true);
    // Cancelled twice → conflict
    expect((await patient.req({ method: 'POST', url: `/v1/appointments/${r.json.id}/cancel`, body: {} })).status).toBe(409);
  });

  it('nobody can book for a patient they have no access to, or book themself as provider', async () => {
    const s = await slots(other, doctor.userId, `kind=DOCTOR_CLINIC&offeringId=${offering[doctor.userId]}&days=7`);
    const r = await clinic(other, doctor.userId, selfPatientId, s.slots[12]!.startsAt);
    expect(r.status).toBe(404);
    expect(r.json.error.code).toBe('PATIENT_NOT_FOUND');
    const selfId = (await owner.query("insert into app.patients (display_name, date_of_birth, sex, created_by_user_id) values ('Doctor Self', '1980-01-01', 'FEMALE', $1) returning id", [doctor.userId])).rows[0].id;
    await owner.query("insert into app.patient_access (patient_id, user_id, relationship, access_level, consent_basis, consent_statement_version, granted_by_user_id) values ($1, $2, 'SELF', 'OWNER', 'SELF', 'v1', $2)", [selfId, doctor.userId]);
    expect((await clinic(doctor, doctor.userId, selfId, s.slots[12]!.startsAt)).json.error.code).toBe('CANNOT_BOOK_SELF');
  });
});

describe('no double booking, under concurrency', () => {
  it('ten patients racing for one slot: exactly one wins', async () => {
    const racers = await Promise.all(
      Array.from({ length: 10 }, async (_, i) => {
        const c = await signUp(app, { role: 'PATIENT', name: `Racer ${i}` });
        const p = await selfProfile(c, `Racer ${i}`, 'MALE');
        return { c, patientId: p.json.id as string };
      }),
    );
    const s = await slots(patient, doctor2.userId, `kind=DOCTOR_CLINIC&offeringId=${offering[doctor2.userId]}&days=7`);
    const target = s.slots[2]!.startsAt;
    const results = await Promise.all(racers.map(({ c, patientId }) => clinic(c, doctor2.userId, patientId, target)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 201)) {
      expect(r.status).toBe(409);
      expect(['SLOT_TAKEN', 'SLOT_NOT_AVAILABLE']).toContain(r.json.error.code);
    }
    const n = await owner.query("select count(*)::int as n from app.appointments where provider_user_id = $1 and starts_at = $2 and status in ('REQUESTED','CONFIRMED')", [doctor2.userId, target]);
    expect(n.rows[0].n).toBe(1);
  });

  it('the database refuses an overlapping booking even if the API checks were bypassed', async () => {
    const row = (await owner.query("select * from app.appointments where provider_user_id = $1 and status = 'REQUESTED' limit 1", [doctor2.userId])).rows[0];
    await expect(
      owner.query(
        `insert into app.appointments (reference, kind, provider_user_id, patient_id, booked_by_user_id, patient_display_name, provider_name_ar, provider_name_en, offering_id, starts_at, ends_at, price_piasters, respond_by)
         values ('BK-0000FFFF', 'DOCTOR_CLINIC', $1, $2, $3, 'X', 'X', 'X', $4, $5::timestamptz + interval '10 minutes', $5::timestamptz + interval '40 minutes', 1, now())`,
        [doctor2.userId, otherPatientId, other.userId, offering[doctor2.userId], new Date(row.starts_at).toISOString()],
      ),
    ).rejects.toThrow(/appt_no_overlap_provider/);
  });

  it('one patient cannot hold two overlapping bookings with different doctors', async () => {
    const s1 = await slots(patient, doctor.userId, `kind=DOCTOR_CLINIC&offeringId=${offering[doctor.userId]}&days=7`);
    const s2 = await slots(patient, doctor2.userId, `kind=DOCTOR_CLINIC&offeringId=${offering[doctor2.userId]}&days=7`);
    const common = s1.slots.map((x) => x.startsAt).find((t) => s2.slots.some((y) => y.startsAt === t))!;
    expect((await clinic(patient, doctor.userId, selfPatientId, common)).status).toBe(201);
    const second = await clinic(patient, doctor2.userId, selfPatientId, common);
    expect(second.status).toBe(409);
    expect(second.json.error.code).toBe('SLOT_TAKEN');
  });

  it('the daily cap removes a full day and refuses further requests on it', async () => {
    await owner.query('update app.provider_profiles set max_daily_appointments = 1 where user_id = $1', [doctor2.userId]);
    try {
      const s = await slots(patient, doctor2.userId, `kind=DOCTOR_CLINIC&offeringId=${offering[doctor2.userId]}&days=7`);
      const busyDay = (await owner.query("select (starts_at at time zone 'Africa/Cairo')::date::text as d from app.appointments where provider_user_id = $1 and status = 'REQUESTED' limit 1", [doctor2.userId])).rows[0].d;
      expect(s.slots.filter((x) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(x.startsAt)) === busyDay)).toHaveLength(0);
    } finally {
      await owner.query('update app.provider_profiles set max_daily_appointments = 8 where user_id = $1', [doctor2.userId]);
    }
  });

  it('time off hides slots, and cannot be added over existing bookings', async () => {
    const s = await slots(doctor, doctor.userId, `kind=DOCTOR_CLINIC&offeringId=${offering[doctor.userId]}&days=7`);
    const t = new Date(s.slots[s.slots.length - 1]!.startsAt);
    const off = await doctor.req({ method: 'POST', url: '/v1/provider/me/time-off', body: { startsAt: new Date(t.getTime() - 3_600_000).toISOString(), endsAt: new Date(t.getTime() + 3_600_000).toISOString(), note: 'Conference' } });
    expect(off.status, JSON.stringify(off.json)).toBe(201);
    const after = await slots(patient, doctor.userId, `kind=DOCTOR_CLINIC&offeringId=${offering[doctor.userId]}&days=7`);
    expect(after.slots.map((x) => x.startsAt)).not.toContain(t.toISOString());
    const booked = (await owner.query("select starts_at from app.appointments where provider_user_id = $1 and status in ('REQUESTED','CONFIRMED') order by starts_at limit 1", [doctor.userId])).rows[0];
    const clash = await doctor.req({ method: 'POST', url: '/v1/provider/me/time-off', body: { startsAt: new Date(booked.starts_at).toISOString(), endsAt: new Date(new Date(booked.starts_at).getTime() + 60_000).toISOString() } });
    expect(clash.status).toBe(409);
    expect(clash.json.error.code).toBe('BOOKINGS_IN_PERIOD');
  });
});

describe('nurse home visits', () => {
  let id: string;

  it('only areas the company serves and the nurse covers; approved catalogue price; prescription attestation', async () => {
    const detail = await patient.req({ method: 'GET', url: `/v1/providers/${nurse.userId}` });
    const wound = detail.json.bookingOptions.find((o: { serviceId: string }) => o.serviceId === woundCareId);
    expect(wound).toMatchObject({ kind: 'NURSE_HOME_VISIT', pricePiasters: 30000, bookable: true });
    expect(detail.json.services.find((x: { serviceId: string }) => x.serviceId === woundCareId).pricePiasters).toBe(30000);
    const s = await slots(patient, nurse.userId, `kind=NURSE_HOME_VISIT&serviceId=${woundCareId}&days=5`);
    const t = s.slots[4]!.startsAt;
    expect((await homeVisit(patient, selfPatientId, woundCareId, t, { visit: { ...visit, governorate: 'GIZA', city: 'Dokki' } })).json.error.code).toBe('AREA_NOT_SERVED');
    expect((await homeVisit(patient, selfPatientId, woundCareId, t, { visit: { ...visit, city: 'Maadi' } })).json.error.code).toBe('OUTSIDE_PROVIDER_AREA');
    expect((await homeVisit(patient, selfPatientId, injectionId, t)).json.error.code).toBe('CLINICAL_AUTHORIZATION_REQUIRED');
    expect((await homeVisit(patient, selfPatientId, woundCareId, t, { contactPhone: '+447400123456' })).json.error.code).toBe('INVALID_PHONE');
    const r = await homeVisit(patient, motherPatientId, woundCareId, t);
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    id = r.json.id;
    expect(r.json).toMatchObject({ pricePiasters: 30000, visit: { governorate: 'CAIRO', city: 'Nasr City', address: visit.address, contactPhone: '+201012345678' } });
  });

  it('the nurse sees the area before accepting and the full address only after', async () => {
    const before = await nurse.req({ method: 'GET', url: `/v1/appointments/${id}` });
    expect(before.json.visit).toEqual({ governorate: 'CAIRO', city: 'Nasr City', district: null, address: null, contactPhone: null });
    const after = await nurse.req({ method: 'POST', url: `/v1/appointments/${id}/respond`, body: { accept: true } });
    expect(after.json.visit).toMatchObject({ address: visit.address, contactPhone: '+201012345678', district: 'District 7' });
  });

  it('on the day: start and complete; the visit counts; the patient is told', async () => {
    expect((await nurse.req({ method: 'POST', url: `/v1/appointments/${id}/progress`, body: { action: 'COMPLETE' } })).status).toBe(409); // not started yet
    await shiftTo(id, new Date(Date.now() - 5 * 60_000));
    expect((await nurse.req({ method: 'POST', url: `/v1/appointments/${id}/progress`, body: { action: 'START' } })).json.status).toBe('IN_PROGRESS');
    const before = (await owner.query('select completed_visits from app.provider_profiles where user_id = $1', [nurse.userId])).rows[0].completed_visits;
    const done = await nurse.req({ method: 'POST', url: `/v1/appointments/${id}/progress`, body: { action: 'COMPLETE' } });
    expect(done.json.status).toBe('COMPLETED');
    expect((await owner.query('select completed_visits from app.provider_profiles where user_id = $1', [nurse.userId])).rows[0].completed_visits).toBe(before + 1);
    expect((await notes(id)).some((x) => x.purpose === 'visit.completed')).toBe(true);
    expect((await patient.req({ method: 'POST', url: `/v1/appointments/${id}/cancel`, body: {} })).status).toBe(409);
  });

  it('a failed visit opens an operations incident; a patient report about a provider no-show too', async () => {
    const s = await slots(patient, nurse.userId, `kind=NURSE_HOME_VISIT&serviceId=${woundCareId}&days=5`);
    const r = await homeVisit(patient, selfPatientId, woundCareId, s.slots[6]!.startsAt);
    await nurse.req({ method: 'POST', url: `/v1/appointments/${r.json.id}/respond`, body: { accept: true } });
    await shiftTo(r.json.id, new Date(Date.now() - 60 * 60_000));
    expect((await nurse.req({ method: 'POST', url: `/v1/appointments/${r.json.id}/progress`, body: { action: 'FAIL' } })).json.error.code).toBe('CATEGORY_REQUIRED');
    const f = await nurse.req({ method: 'POST', url: `/v1/appointments/${r.json.id}/progress`, body: { action: 'FAIL', failureCategory: 'UNSAFE_ENVIRONMENT', reason: 'Building access refused by security' } });
    expect(f.json).toMatchObject({ status: 'VISIT_FAILED', failureCategory: 'UNSAFE_ENVIRONMENT' });
    const inc = (await owner.query('select kind, severity, domain, title, detail from app.ops_incidents where related_id = $1', [r.json.id])).rows;
    expect(inc).toEqual([expect.objectContaining({ kind: 'VISIT_FAILED', severity: 'HIGH', domain: 'CARE' })]);
    expect(JSON.stringify(inc)).not.toContain('Building access'); // the free-text reason stays with the booking
    expect((await patient.req({ method: 'POST', url: `/v1/appointments/${r.json.id}/report`, body: { category: 'PROVIDER_DID_NOT_ARRIVE' } })).status).toBe(200);
    expect((await owner.query("select count(*)::int as n from app.ops_incidents where related_id = $1 and kind = 'PROVIDER_NO_SHOW'", [r.json.id])).rows[0].n).toBe(1);
  });

  it('a nurse who switches to "away" without a date gets no new requests; nobody is assigned automatically', async () => {
    await nurse.req({ method: 'PATCH', url: '/v1/provider/me/availability', body: { availabilityStatus: 'AWAY' } });
    try {
      const s = await slots(patient, nurse.userId, `kind=NURSE_HOME_VISIT&serviceId=${woundCareId}`);
      expect(s).toMatchObject({ bookable: false, blockedReason: 'AWAY', slots: [] });
      // There is no endpoint that books "any nurse": a request always names one provider.
      expect((await patient.req({ method: 'POST', url: '/v1/appointments', body: { kind: 'NURSE_HOME_VISIT', patientId: selfPatientId, serviceId: woundCareId, startsAt: new Date().toISOString(), visit, contactPhone: '01012345678' } })).status).toBe(400);
    } finally {
      await nurse.req({ method: 'PATCH', url: '/v1/provider/me/availability', body: { availabilityStatus: 'SCHEDULED_ONLY' } });
    }
  });
});

describe('expiry, restrictions and account deletion', () => {
  it('a request not answered in time expires and the patient is told', async () => {
    const s = await slots(patient, doctor2.userId, `kind=DOCTOR_CLINIC&offeringId=${offering[doctor2.userId]}&days=7`);
    const r = await clinic(other, doctor2.userId, otherPatientId, s.slots[s.slots.length - 1]!.startsAt);
    expect(r.status).toBe(201);
    await owner.query("update app.appointments set respond_by = now() - interval '1 minute' where id = $1", [r.json.id]);
    expect((await doctor2.req({ method: 'POST', url: `/v1/appointments/${r.json.id}/respond`, body: { accept: true } })).json.error.code).toBe('REQUEST_EXPIRED');
    expect(await runAppointmentMaintenance(app)).toBeGreaterThanOrEqual(1);
    expect((await other.req({ method: 'GET', url: `/v1/appointments/${r.json.id}` })).json.status).toBe('EXPIRED');
    expect((await notes(r.json.id)).some((x) => x.purpose === 'booking.expired' && x.recipient_user_id === other.userId)).toBe(true);
  });

  it('a booking-restricted provider takes no new requests', async () => {
    await owner.query("insert into app.account_states (user_id, status, bookings_restricted, reason) values ($1, 'ACTIVE', true, 'OTHER') on conflict (user_id) do update set bookings_restricted = true, reason = 'OTHER'", [doctor2.userId]);
    try {
      // Hidden from discovery altogether, and the database refuses a request sent anyway.
      expect((await patient.req({ method: 'GET', url: `/v1/providers/${doctor2.userId}` })).status).toBe(404);
      expect((await patient.req({ method: 'GET', url: `/v1/providers/${doctor2.userId}/availability?kind=DOCTOR_CLINIC&offeringId=${offering[doctor2.userId]}` })).status).toBe(404);
      const r = await clinic(patient, doctor2.userId, selfPatientId, new Date(Date.now() + 30 * 3_600_000).toISOString());
      expect(r.json.error).toMatchObject({ code: 'PROVIDER_NOT_BOOKABLE', details: { detail: 'PROVIDER_NOT_AVAILABLE' } });
    } finally {
      await owner.query("update app.account_states set bookings_restricted = false, reason = null, status = 'ACTIVE' where user_id = $1", [doctor2.userId]);
    }
  });

  it('deleting an account cancels its future bookings and removes the address and notes', async () => {
    const leaver = await signUp(app, { role: 'PATIENT', name: 'Leaving Patient' });
    const p = await selfProfile(leaver, 'Leaving Patient', 'MALE');
    const mother = await leaver.req({ method: 'POST', url: '/v1/patients', body: { displayName: 'Shared Mother', dateOfBirth: '1945-01-01', sex: 'FEMALE', relationship: 'MOTHER', consentBasis: 'ADULT_CONSENT_ATTESTED', consentAttested: true, consentStatementVersion: 'v1' } });
    expect(p.status).toBe(201);
    const s = await slots(leaver, nurse.userId, `kind=NURSE_HOME_VISIT&serviceId=${woundCareId}&days=7`);
    const r = await homeVisit(leaver, mother.json.id, woundCareId, s.slots[s.slots.length - 2]!.startsAt, { note: 'Gate code 1234' });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const del = await leaver.req({ method: 'POST', url: '/v1/me/account-deletion', body: { confirmation: 'delete', password: PASSWORD } });
    expect(del.status, JSON.stringify(del.json)).toBe(200);
    const row = (await owner.query('select status, cancelled_by, patient_note, visit_address, contact_phone from app.appointments where id = $1', [r.json.id])).rows[0];
    if (row) expect(row).toEqual({ status: 'CANCELLED', cancelled_by: 'PATIENT', patient_note: null, visit_address: null, contact_phone: null });
  });
});

describe('operations oversight', () => {
  it('care operations see bookings without notes; commerce staff do not see them at all', async () => {
    expect((await commerce.req({ method: 'GET', url: '/v1/admin/ops/appointments' })).status).toBe(403);
    expect((await patient.req({ method: 'GET', url: '/v1/admin/ops/appointments' })).status).toBe(403);
    const r = await admin.req({ method: 'GET', url: '/v1/admin/ops/appointments?kind=DOCTOR_CLINIC' });
    expect(r.status).toBe(200);
    expect(r.json.appointments.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.json)).not.toContain('knee');
    const one = r.json.appointments.find((a: { status: string }) => a.status === 'REQUESTED' || a.status === 'CONFIRMED');
    const detail = await admin.req({ method: 'GET', url: `/v1/appointments/${one.id}` });
    expect(detail.json.viewerRole).toBe('ADMIN');
    expect(detail.json.note).toBeNull();
  });

  it('an administrator cancels with a reason (audited, both sides told)', async () => {
    const one = (await owner.query("select id from app.appointments where status = 'REQUESTED' and provider_user_id = $1 limit 1", [doctor.userId])).rows[0];
    expect((await commerce.req({ method: 'POST', url: `/v1/admin/ops/appointments/${one.id}/cancel`, body: { reason: 'Clinic closed by authorities' } })).status).toBe(403);
    expect((await admin.req({ method: 'POST', url: `/v1/admin/ops/appointments/${one.id}/cancel`, body: {} })).status).toBe(400);
    const r = await admin.req({ method: 'POST', url: `/v1/admin/ops/appointments/${one.id}/cancel`, body: { reason: 'Clinic closed by authorities' } });
    expect(r.json).toMatchObject({ status: 'CANCELLED', cancelledBy: 'ADMIN' });
    expect((await owner.query("select count(*)::int as n from app.audit_log where action = 'ops.appointment.cancel' and entity_id = $1", [one.id])).rows[0].n).toBe(1);
    const sides = (await notes(one.id)).filter((x) => x.purpose === 'booking.cancelled').map((x) => x.recipient_user_id);
    expect(sides).toEqual(expect.arrayContaining([doctor.userId]));
  });

  it('incidents: care incidents only for care operations; commerce staff see commerce incidents only', async () => {
    await owner.query("insert into app.ops_incidents (kind, severity, domain, title) values ('ORDER_ISSUE', 'LOW', 'COMMERCE', 'Test commerce incident')");
    const care = await admin.req({ method: 'GET', url: '/v1/admin/ops/incidents' });
    expect(care.json.some((i: { domain: string }) => i.domain === 'CARE')).toBe(true);
    const com = await commerce.req({ method: 'GET', url: '/v1/admin/ops/incidents' });
    expect(com.status).toBe(200);
    expect(com.json.length).toBeGreaterThan(0);
    expect(com.json.every((i: { domain: string }) => i.domain === 'COMMERCE')).toBe(true);
    const careId = care.json.find((i: { domain: string }) => i.domain === 'CARE').id;
    expect((await commerce.req({ method: 'POST', url: `/v1/admin/ops/incidents/${careId}/resolve`, body: { resolution: 'Should not be allowed' } })).status).toBe(409);
    expect((await admin.req({ method: 'POST', url: `/v1/admin/ops/incidents/${careId}/acknowledge` })).status).toBe(200);
    expect((await admin.req({ method: 'POST', url: `/v1/admin/ops/incidents/${careId}/resolve`, body: { resolution: 'Called the family; visit rebooked with another nurse.' } })).status).toBe(200);
    expect((await patient.req({ method: 'GET', url: '/v1/admin/ops/incidents' })).status).toBe(403);
  });

  it('home-care launch areas are managed by operations (audited)', async () => {
    expect((await commerce.req({ method: 'PUT', url: '/v1/admin/ops/home-care-regions/GIZA', body: { active: true } })).status).toBe(403);
    expect((await admin.req({ method: 'PUT', url: '/v1/admin/ops/home-care-regions/GIZA', body: { active: true, note: 'Pilot' } })).status).toBe(200);
    const list = await admin.req({ method: 'GET', url: '/v1/admin/ops/home-care-regions' });
    expect(list.json.find((r: { governorate: string }) => r.governorate === 'GIZA').active).toBe(true);
    await admin.req({ method: 'PUT', url: '/v1/admin/ops/home-care-regions/GIZA', body: { active: false } });
  });

  it('the admin user page shows open bookings a clinician holds (count only)', async () => {
    const expected = (await owner.query("select count(*)::int as n from app.appointments where provider_user_id = $1 and status in ('REQUESTED','CONFIRMED','IN_PROGRESS') and ends_at > now()", [doctor2.userId])).rows[0].n;
    expect(expected).toBeGreaterThanOrEqual(1);
    const r = await admin.req({ method: 'GET', url: `/v1/admin/users/${doctor2.userId}` });
    expect(r.status).toBe(200);
    expect(r.json.openBookingsAsProvider).toBe(expected);
  });
});
