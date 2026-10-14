import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestServer, grantRole, ownerPool, signUp, type Client } from './helpers';

let app: FastifyInstance;
let doctor: Client;
let nurse: Client;
let reviewer: Client;
let patient: Client;

const doctorProfile = {
  providerType: 'DOCTOR',
  displayNameAr: 'د. اختبار',
  displayNameEn: 'Dr. Verification Test',
  gender: 'MALE',
  specialty: 'GENERAL_SURGERY',
  yearsExperience: 12,
  governorate: 'CAIRO',
  city: 'Nasr City',
  feePiasters: 60000,
} as const;

beforeAll(async () => {
  app = await createTestServer();
  doctor = await signUp(app, { role: 'DOCTOR', name: 'Doctor' });
  nurse = await signUp(app, { role: 'NURSE', name: 'Nurse' });
  patient = await signUp(app, { role: 'PATIENT', name: 'Patient' });
  reviewer = await signUp(app, { name: 'Reviewer' });
  await grantRole(reviewer.userId, 'CLINICAL_REVIEWER');
});
afterAll(async () => {
  await app.close();
});

describe('doctor onboarding → admin verification → discovery (Flow B + E)', () => {
  const credentialIds: string[] = [];

  it('only allows the provider type matching a held role', async () => {
    const res = await nurse.req({ method: 'PUT', url: '/v1/provider/me', body: doctorProfile });
    expect(res.status).toBe(403);
  });

  it('creates a DRAFT profile that is not bookable', async () => {
    const res = await doctor.req({ method: 'PUT', url: '/v1/provider/me', body: doctorProfile });
    expect(res.status).toBe(200);
    expect(res.json.profile.verificationStatus).toBe('DRAFT');
    expect(res.json.bookable).toBe(false);
    expect(res.json.canSubmit).toBe(false);
  });

  it('cannot submit before required credentials are added', async () => {
    const res = await doctor.req({ method: 'POST', url: '/v1/provider/me/submit' });
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe('REQUIRED_CREDENTIALS_MISSING');
  });

  it('submits once required credentials exist', async () => {
    for (const kind of ['NATIONAL_ID', 'MEDICAL_LICENSE', 'MEDICAL_DEGREE']) {
      const res = await doctor.req({ method: 'POST', url: '/v1/provider/me/credentials', body: { kind, issuer: 'Test Authority', identifier: `ID-${kind}` } });
      expect(res.status).toBe(201);
    }
    const mine = await doctor.req({ method: 'GET', url: '/v1/provider/me' });
    expect(mine.json.canSubmit).toBe(true);
    credentialIds.push(...mine.json.credentials.map((c: { id: string }) => c.id));
    const res = await doctor.req({ method: 'POST', url: '/v1/provider/me/submit' });
    expect(res.status).toBe(200);
    expect(res.json.profile.verificationStatus).toBe('SUBMITTED');
  });

  it('is not discoverable while under review', async () => {
    const res = await patient.req({ method: 'GET', url: '/v1/providers?type=DOCTOR' });
    expect(res.json.find((p: { userId: string }) => p.userId === doctor.userId)).toBeUndefined();
    const detail = await patient.req({ method: 'GET', url: `/v1/providers/${doctor.userId}` });
    expect(detail.status).toBe(404);
  });

  it('non-staff cannot access the verification queue', async () => {
    expect((await doctor.req({ method: 'GET', url: '/v1/admin/verification-queue' })).status).toBe(403);
    expect((await patient.req({ method: 'POST', url: `/v1/admin/providers/${doctor.userId}/decision`, body: { decision: 'APPROVE' } })).status).toBe(403);
  });

  it('the reviewer sees the submission with credential details (and the view is audited)', async () => {
    const queue = await reviewer.req({ method: 'GET', url: '/v1/admin/verification-queue' });
    expect(queue.status).toBe(200);
    expect(queue.json.some((q: { userId: string }) => q.userId === doctor.userId)).toBe(true);
    const detail = await reviewer.req({ method: 'GET', url: `/v1/admin/providers/${doctor.userId}` });
    expect(detail.json.credentials).toHaveLength(3);
    expect(detail.json.credentials[0].identifier).toMatch(/^ID-/);
  });

  it('requires a reason to reject or request changes', async () => {
    const res = await reviewer.req({ method: 'POST', url: `/v1/admin/providers/${doctor.userId}/decision`, body: { decision: 'REQUEST_CHANGES' } });
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe('REASON_REQUIRED');
  });

  it('cannot approve the provider until every required credential is approved', async () => {
    await reviewer.req({ method: 'POST', url: `/v1/admin/providers/${doctor.userId}/decision`, body: { decision: 'START_REVIEW' } });
    const res = await reviewer.req({ method: 'POST', url: `/v1/admin/providers/${doctor.userId}/decision`, body: { decision: 'APPROVE' } });
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe('REQUIRED_CREDENTIALS_NOT_APPROVED');
  });

  it('approves credentials then the provider', async () => {
    for (const id of credentialIds) {
      const res = await reviewer.req({ method: 'POST', url: `/v1/admin/credentials/${id}/decision`, body: { status: 'APPROVED' } });
      expect(res.status).toBe(200);
      expect(res.json.status).toBe('APPROVED');
    }
    const res = await reviewer.req({ method: 'POST', url: `/v1/admin/providers/${doctor.userId}/decision`, body: { decision: 'APPROVE' } });
    expect(res.status).toBe(200);
    expect(res.json.status).toBe('APPROVED');
  });

  it('a reviewer cannot suspend (admin-only transition)', async () => {
    const res = await reviewer.req({ method: 'POST', url: `/v1/admin/providers/${doctor.userId}/decision`, body: { decision: 'SUSPEND', reason: 'test' } });
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe('INVALID_VERIFICATION_TRANSITION');
  });

  it('the approved doctor is discoverable with verified credentials but no licence numbers', async () => {
    const list = await patient.req({ method: 'GET', url: '/v1/providers?type=DOCTOR&specialty=GENERAL_SURGERY' });
    const card = list.json.find((p: { userId: string }) => p.userId === doctor.userId);
    expect(card.verifiedCredentialCount).toBe(3);
    const detail = await patient.req({ method: 'GET', url: `/v1/providers/${doctor.userId}` });
    expect(detail.status).toBe(200);
    expect(detail.json.bookingAvailable).toBe(false);
    expect(JSON.stringify(detail.json)).not.toContain('ID-MEDICAL_LICENSE');
  });

  it('records verification history and audit events', async () => {
    const pool = ownerPool();
    try {
      const events = await pool.query('select to_status from app.provider_verification_events where provider_user_id = $1 order by created_at', [doctor.userId]);
      expect(events.rows.map((r) => r.to_status)).toEqual(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED']);
      const audits = await pool.query("select action from app.audit_log where entity_id = $1 and action like 'provider.verification.%'", [doctor.userId]);
      expect(audits.rowCount).toBe(3);
    } finally {
      await pool.end();
    }
  });

  it('the doctor stops accepting new patients and remains discoverable', async () => {
    const res = await doctor.req({ method: 'PATCH', url: '/v1/provider/me/availability', body: { availabilityStatus: 'EXISTING_PATIENTS_ONLY' } });
    expect(res.status).toBe(200);
    expect(res.json.profile.availabilityStatus).toBe('EXISTING_PATIENTS_ONLY');
    const list = await patient.req({ method: 'GET', url: '/v1/providers?type=DOCTOR' });
    const card = list.json.find((p: { userId: string }) => p.userId === doctor.userId);
    expect(card.acceptingNewPatients).toBe(false);
    const accepting = await patient.req({ method: 'GET', url: '/v1/providers?type=DOCTOR&acceptingOnly=true' });
    expect(accepting.json.find((p: { userId: string }) => p.userId === doctor.userId)).toBeUndefined();
  });

  it('rejects nurse-only statuses for doctors and overlapping working hours', async () => {
    expect((await doctor.req({ method: 'PATCH', url: '/v1/provider/me/availability', body: { availabilityStatus: 'AVAILABLE_NOW' } })).status).toBe(422);
    const overlap = await doctor.req({ method: 'PUT', url: '/v1/provider/me/working-hours', body: { slots: [{ weekday: 1, startMinute: 600, endMinute: 720 }, { weekday: 1, startMinute: 700, endMinute: 800 }] } });
    expect(overlap.status).toBe(422);
    const ok = await doctor.req({ method: 'PUT', url: '/v1/provider/me/working-hours', body: { slots: [{ weekday: 0, startMinute: 1020, endMinute: 1260 }] } });
    expect(ok.status).toBe(200);
    expect(ok.json.workingHours).toHaveLength(1);
  });

  it('changing specialty after approval sends the profile back for review', async () => {
    const res = await doctor.req({ method: 'PUT', url: '/v1/provider/me', body: { ...doctorProfile, specialty: 'DERMATOLOGY' } });
    expect(res.json.profile.verificationStatus).toBe('SUBMITTED');
  });
});

describe('nurse services, capacity and earnings (Flow C)', () => {
  beforeAll(async () => {
    const pool = ownerPool();
    try {
      await pool.query(
        `insert into app.nursing_services (code, name_ar, name_en, description_ar, description_en, scope_ar, scope_en, duration_minutes, base_price_piasters, eligible_provider_types, is_demo)
         values ('TEST_WOUND', 'غيار', 'Wound dressing', 'd', 'd', 's', 's', 45, 35000, '{NURSE}', false),
                ('TEST_DOCTOR_ONLY', 'كشف', 'Doctor visit', 'd', 'd', 's', 's', 30, 50000, '{DOCTOR}', false)
         on conflict (code) do nothing`,
      );
    } finally {
      await pool.end();
    }
    await nurse.req({
      method: 'PUT',
      url: '/v1/provider/me',
      body: { providerType: 'NURSE', displayNameAr: 'ممرضة', displayNameEn: 'Nurse Test', gender: 'FEMALE', yearsExperience: 4, governorate: 'GIZA', city: 'Dokki' },
    });
  });

  it('lists only services the nurse is eligible for and saves a selection', async () => {
    const list = await nurse.req({ method: 'GET', url: '/v1/provider/me/services' });
    const codes = list.json.map((s: { code: string }) => s.code);
    expect(codes).toContain('TEST_WOUND');
    expect(codes).not.toContain('TEST_DOCTOR_ONLY');
    const wound = list.json.find((s: { code: string }) => s.code === 'TEST_WOUND');
    const save = await nurse.req({ method: 'PUT', url: '/v1/provider/me/services', body: { services: [{ serviceId: wound.id, pricePiasters: 40000 }] } });
    expect(save.status).toBe(200);
    const after = await nurse.req({ method: 'GET', url: '/v1/provider/me/services' });
    expect(after.json.find((s: { code: string }) => s.code === 'TEST_WOUND').selected).toBe(true);
  });

  it('cannot offer a service reserved for doctors', async () => {
    const all = await reviewer.req({ method: 'GET', url: '/v1/services' });
    const doctorOnly = all.json.find((s: { code: string }) => s.code === 'TEST_DOCTOR_ONLY');
    const res = await nurse.req({ method: 'PUT', url: '/v1/provider/me/services', body: { services: [{ serviceId: doctorOnly.id, pricePiasters: null }] } });
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe('SERVICE_NOT_ELIGIBLE');
  });

  it('changes nurse availability', async () => {
    const res = await nurse.req({ method: 'PATCH', url: '/v1/provider/me/availability', body: { availabilityStatus: 'AVAILABLE_NOW', serviceRadiusKm: 15 } });
    expect(res.status).toBe(200);
    expect(res.json.profile.availabilityStatus).toBe('AVAILABLE_NOW');
    expect(res.json.profile.serviceRadiusKm).toBe(15);
  });

  it('reports zero earnings without fabricating data, payouts disabled', async () => {
    const res = await nurse.req({ method: 'GET', url: '/v1/provider/me/earnings' });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ todayNetPiasters: 0, weekNetPiasters: 0, availableForPayoutPiasters: 0, payoutsEnabled: false, containsDemoData: false });
  });

  it('summarises net earnings from the ledger', async () => {
    const pool = ownerPool();
    try {
      await pool.query(
        `insert into app.provider_ledger_entries (provider_user_id, entry_type, status, amount_piasters, description, occurred_at) values
          ($1, 'VISIT_EARNING', 'PENDING', 75000, 't', now()),
          ($1, 'VISIT_EARNING', 'AVAILABLE', 50000, 't', now() - interval '20 days'),
          ($1, 'PAYOUT', 'AVAILABLE', -20000, 't', now() - interval '19 days')`,
        [nurse.userId],
      );
    } finally {
      await pool.end();
    }
    const res = await nurse.req({ method: 'GET', url: '/v1/provider/me/earnings' });
    expect(res.json.todayNetPiasters).toBe(75000);
    expect(res.json.todayCompletedVisits).toBe(1);
    expect(res.json.availableForPayoutPiasters).toBe(30000);
    expect(res.json.pendingPiasters).toBe(75000);
  });

  it('clinician dashboard reflects real profile state', async () => {
    const res = await nurse.req({ method: 'GET', url: '/v1/dashboard/clinician' });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ providerType: 'NURSE', verificationStatus: 'DRAFT', bookable: false, serviceCount: 1 });
  });
});
