import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestServer, signUp, type Client } from './helpers';

let app: FastifyInstance;
let caregiver: Client;

const consent = { consentAttested: true, consentStatementVersion: 'family-consent-v1' } as const;

function isoYearsAgo(years: number) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  app = await createTestServer();
  caregiver = await signUp(app, { role: 'PATIENT', name: 'Caregiver' });
});
afterAll(async () => {
  await app.close();
});

describe('patient profiles & family management', () => {
  let selfId: string;
  let motherId: string;
  let childId: string;

  it('requires the PATIENT role to create profiles', async () => {
    const nurse = await signUp(app, { role: 'NURSE' });
    const res = await nurse.req({ method: 'POST', url: '/v1/patients', body: { displayName: 'X', dateOfBirth: '1990-01-01', sex: 'MALE', relationship: 'SELF', consentBasis: 'SELF', ...consent } });
    expect(res.status).toBe(403);
  });

  it('creates the self profile once', async () => {
    const res = await caregiver.req({ method: 'POST', url: '/v1/patients', body: { displayName: 'Me', dateOfBirth: '1985-05-05', sex: 'FEMALE', relationship: 'SELF', consentBasis: 'SELF', ...consent } });
    expect(res.status).toBe(201);
    expect(res.json.accessLevel).toBe('OWNER');
    selfId = res.json.id;
    const dup = await caregiver.req({ method: 'POST', url: '/v1/patients', body: { displayName: 'Me again', dateOfBirth: '1985-05-05', sex: 'FEMALE', relationship: 'SELF', consentBasis: 'SELF', ...consent } });
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe('SELF_PROFILE_EXISTS');
  });

  it('requires explicit consent attestation for an adult family member', async () => {
    const missing = await caregiver.req({ method: 'POST', url: '/v1/patients', body: { displayName: 'Mother', dateOfBirth: '1955-01-01', sex: 'FEMALE', relationship: 'MOTHER', consentBasis: 'ADULT_CONSENT_ATTESTED', consentAttested: false, consentStatementVersion: 'v1' } });
    expect(missing.status).toBe(400);
    const wrongBasis = await caregiver.req({ method: 'POST', url: '/v1/patients', body: { displayName: 'Mother', dateOfBirth: '1955-01-01', sex: 'FEMALE', relationship: 'MOTHER', consentBasis: 'GUARDIAN_OF_MINOR', ...consent } });
    expect(wrongBasis.status).toBe(422);
    expect(wrongBasis.json.error.code).toBe('ADULT_REQUIRES_CONSENT_BASIS');
    const ok = await caregiver.req({ method: 'POST', url: '/v1/patients', body: { displayName: 'Mother', dateOfBirth: '1955-01-01', sex: 'FEMALE', relationship: 'MOTHER', consentBasis: 'ADULT_CONSENT_ATTESTED', ...consent } });
    expect(ok.status).toBe(201);
    expect(ok.json.accessLevel).toBe('CAREGIVER');
    motherId = ok.json.id;
  });

  it('uses guardianship for minors (computed from date of birth, not trusted from the client)', async () => {
    const asAdult = await caregiver.req({ method: 'POST', url: '/v1/patients', body: { displayName: 'Child', dateOfBirth: isoYearsAgo(8), sex: 'MALE', relationship: 'CHILD', consentBasis: 'ADULT_CONSENT_ATTESTED', ...consent } });
    expect(asAdult.status).toBe(422);
    expect(asAdult.json.error.code).toBe('MINOR_REQUIRES_GUARDIAN_BASIS');
    const ok = await caregiver.req({ method: 'POST', url: '/v1/patients', body: { displayName: 'Child', dateOfBirth: isoYearsAgo(8), sex: 'MALE', relationship: 'CHILD', consentBasis: 'GUARDIAN_OF_MINOR', ...consent } });
    expect(ok.status).toBe(201);
    expect(ok.json.accessLevel).toBe('GUARDIAN');
    childId = ok.json.id;
  });

  it('rejects a date of birth in the future', async () => {
    const res = await caregiver.req({ method: 'POST', url: '/v1/patients', body: { displayName: 'Future', dateOfBirth: '2099-01-01', sex: 'MALE', relationship: 'CHILD', consentBasis: 'GUARDIAN_OF_MINOR', ...consent } });
    expect(res.status).toBe(422);
  });

  it('lists profiles with self first (profile switcher)', async () => {
    const res = await caregiver.req({ method: 'GET', url: '/v1/patients' });
    expect(res.status).toBe(200);
    expect(res.json.map((p: { id: string }) => p.id)).toEqual([selfId, motherId, childId]);
  });

  it('derives provenance: self entries are patient-reported, others caregiver-reported', async () => {
    const own = await caregiver.req({ method: 'POST', url: `/v1/patients/${selfId}/health-entries`, body: { kind: 'ALLERGY', title: 'Penicillin' } });
    expect(own.status).toBe(201);
    expect(own.json.provenance).toBe('PATIENT_REPORTED');
    const mother = await caregiver.req({ method: 'POST', url: `/v1/patients/${motherId}/health-entries`, body: { kind: 'CONDITION', title: 'Hypertension' } });
    expect(mother.json.provenance).toBe('CAREGIVER_REPORTED');
  });

  it('records blood type as reported, never as verified', async () => {
    const res = await caregiver.req({ method: 'PATCH', url: `/v1/patients/${motherId}`, body: { bloodType: 'A+' } });
    expect(res.status).toBe(200);
    expect(res.json.bloodType).toBe('A+');
    expect(res.json.bloodTypeProvenance).toBe('CAREGIVER_REPORTED');
  });

  it('marks entries as entered-in-error instead of deleting them', async () => {
    const created = await caregiver.req({ method: 'POST', url: `/v1/patients/${childId}/health-entries`, body: { kind: 'MEDICATION', title: 'Wrong entry' } });
    const del = await caregiver.req({ method: 'DELETE', url: `/v1/patients/${childId}/health-entries/${created.json.id}` });
    expect(del.status).toBe(200);
    const list = await caregiver.req({ method: 'GET', url: `/v1/patients/${childId}/health-entries` });
    expect(list.json.find((e: { id: string }) => e.id === created.json.id)).toBeUndefined();
  });

  it('builds the family dashboard from real data only', async () => {
    const res = await caregiver.req({ method: 'GET', url: `/v1/dashboard/patient?patientId=${motherId}` });
    expect(res.status).toBe(200);
    expect(res.json.activePatient.id).toBe(motherId);
    expect(res.json.family.map((f: { patient: { id: string } }) => f.patient.id).sort()).toEqual([selfId, childId].sort());
    expect(res.json.healthSnapshot.conditions).toBe(1);
    expect(res.json.appointments.status).toBe('NOT_YET_AVAILABLE');
    expect(res.json.aiAssistant.status).toBe('NOT_CONFIGURED');
  });

  it('an outsider cannot use a patient id they are not authorized for (dashboard falls back to own data)', async () => {
    const other = await signUp(app, { role: 'PATIENT' });
    await other.req({ method: 'POST', url: '/v1/patients', body: { displayName: 'Other', dateOfBirth: '1970-01-01', sex: 'MALE', relationship: 'SELF', consentBasis: 'SELF', ...consent } });
    const res = await other.req({ method: 'GET', url: `/v1/dashboard/patient?patientId=${motherId}` });
    expect(res.status).toBe(200);
    expect(res.json.activePatient.id).not.toBe(motherId);
    const patch = await other.req({ method: 'PATCH', url: `/v1/patients/${motherId}`, body: { displayName: 'Hijacked' } });
    expect(patch.status).toBe(404);
  });

  it('lets the managing caregiver leave and the owner cannot be revoked', async () => {
    const access = await caregiver.req({ method: 'GET', url: `/v1/patients/${selfId}/access` });
    expect(access.json[0].accessLevel).toBe('OWNER');
    const revokeOwner = await caregiver.req({ method: 'DELETE', url: `/v1/patients/${selfId}/access/${caregiver.userId}` });
    expect(revokeOwner.status).toBe(403);
    const leave = await caregiver.req({ method: 'DELETE', url: `/v1/patients/${childId}/access/${caregiver.userId}` });
    expect(leave.status).toBe(200);
    const after = await caregiver.req({ method: 'GET', url: `/v1/patients/${childId}` });
    expect(after.status).toBe(404);
  });

  it('writes audit entries for profile creation', async () => {
    const pool = (await import('./helpers')).ownerPool();
    try {
      const { rows } = await pool.query("select action from app.audit_log where patient_id = $1 order by occurred_at", [motherId]);
      expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['patient.profile.created', 'patient.health_entry.created', 'patient.profile.updated']));
    } finally {
      await pool.end();
    }
  });
});
