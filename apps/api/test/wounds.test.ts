/**
 * Wound Intelligence Registry (migrations 0026–0027, ADR 0015): the three permissions, the vault,
 * family / clinician / staff access, research datasets, presentations, analytics, withdrawal,
 * deletion and the storage lifecycle. Every rule is checked through the API (and, where it matters,
 * straight against the database as the application role).
 */
import { readdir } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { WOUND_CONSENT_VERSION as V } from '@ghayarly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { LocalEncryptedStore, type ObjectStore } from '../src/integrations/storage';
import { buildServer } from '../src/server';
import { runWoundMaintenance } from '../src/modules/wounds/routes';
import { grantRole, ownerPool, PASSWORD, signUp, type Client } from './helpers';
import { exifBlock, testJpeg, withSegments } from './wound-fixtures';

let app: FastifyInstance;
let owner: pg.Pool;
let dir: string;
let failDerivedWrites = false;
let storageConfigured = true;
let store: LocalEncryptedStore;
/** The encrypted local store, with switches to simulate a storage failure or missing configuration. */
const objects: ObjectStore = {
  get status() {
    return storageConfigured ? ('DEV_ADAPTER' as const) : ('NOT_CONFIGURED' as const);
  },
  put: async (k, b) => {
    if (failDerivedWrites && k.endsWith('.d')) throw new Error('disk full (simulated)');
    return store.put(k, b);
  },
  get: (k) => store.get(k),
  delete: (k) => store.delete(k),
};

const consentStatement = { consentAttested: true, consentStatementVersion: 'v1' };
const RESEARCH_ALL = ['HEALING_TRAJECTORIES', 'CASE_COMPARISON', 'PRODUCT_OUTCOMES'];

async function flag(key: string, on: boolean) {
  await owner.query("update app.feature_flags set enabled = $2, evidence_ref = coalesce(evidence_ref, 'AUTOMATED TEST ONLY — not a real approval') where key = $1", [key, on]);
}
async function patient(opts: { internal?: boolean; name?: string; dob?: string } = {}) {
  const c = await signUp(app, { role: 'PATIENT', name: opts.name ?? 'Hoda Mahmoud' });
  if (opts.internal) await owner.query("update app.user_profiles set account_kind = 'INTERNAL_TEST' where user_id = $1", [c.userId]);
  const p = await c.req({ method: 'POST', url: '/v1/patients', body: { displayName: opts.name ?? 'Hoda Mahmoud', dateOfBirth: opts.dob ?? '1962-04-04', sex: 'FEMALE', relationship: 'SELF', consentBasis: 'SELF', ...consentStatement } });
  expect(p.status, JSON.stringify(p.json)).toBe(201);
  return { c, patientId: p.json.id as string };
}
const permit = (c: Client, patientId: string, body: object) => c.req({ method: 'POST', url: `/v1/patients/${patientId}/wound-permissions`, body });
const scan = (c: Client, patientId: string) => permit(c, patientId, { purpose: 'SCAN', action: 'GRANT', version: V });
const research = (c: Client, patientId: string, purposes = RESEARCH_ALL, recipients = ['DMW_CLINICAL_RESEARCH']) => permit(c, patientId, { purpose: 'RESEARCH', action: 'GRANT', version: V, scope: { purposes, recipients } });
const presentation = (c: Client, patientId: string, audiences = ['INTERNAL_TRAINING'], organizations = ['ALIA_GROUP']) => permit(c, patientId, { purpose: 'PRESENTATION', action: 'GRANT', version: V, scope: { audiences, organizations } });
const withdraw = (c: Client, patientId: string, purpose: string) => permit(c, patientId, { purpose, action: 'WITHDRAW', version: V });
const newCase = (c: Client, patientId: string, over: object = {}) => c.req({ method: 'POST', url: '/v1/wounds', body: { patientId, label: 'Left heel', bodySite: 'HEEL', bodySide: 'LEFT', reportedCategory: 'DIABETIC_FOOT', ...over } });
const upload = (c: Client, caseId: string, jpg = testJpeg(800, 600), extra: object = {}) =>
  c.req({ method: 'POST', url: `/v1/wounds/${caseId}/images`, body: { contentType: 'image/jpeg', dataBase64: jpg.toString('base64'), ...extra } });
const fetchMedia = async (url: string) => {
  const res = await app.inject({ method: 'GET', url: url.replace('http://localhost:4000', '') });
  return { status: res.statusCode, body: res.rawPayload, type: res.headers['content-type'] };
};
async function clinician(role: 'DOCTOR' | 'NURSE' = 'NURSE') {
  const c = await signUp(app, { role, name: role });
  const body = { providerType: role, displayNameAr: 'ممرضة جروح', displayNameEn: 'Wound Nurse', gender: 'FEMALE', yearsExperience: 9, governorate: 'CAIRO', city: 'Nasr City', ...(role === 'DOCTOR' ? { specialty: 'GENERAL_SURGERY' } : {}) };
  expect((await c.req({ method: 'PUT', url: '/v1/provider/me', body })).status).toBe(200);
  await owner.query("update app.provider_profiles set verification_status = 'APPROVED', verified_at = now() where user_id = $1", [c.userId]);
  return c;
}
async function shareWounds(c: Client, patientId: string, providerUserId: string, wounds = true) {
  const s = await c.req({ method: 'POST', url: '/v1/care-shares', body: { patientId, providerUserId, days: 30, aiAllowed: false } });
  expect(s.status, JSON.stringify(s.json)).toBe(201);
  expect(s.json.woundsAllowed).toBe(false);
  if (wounds) expect((await c.req({ method: 'POST', url: `/v1/care-shares/${s.json.id}/wounds`, body: { allowed: true } })).status).toBe(200);
  return s.json.id as string;
}
async function staff(role: string, opts: { internal?: boolean } = {}) {
  const c = await signUp(app, { name: role });
  await grantRole(c.userId, role);
  await c.req({ method: 'GET', url: '/v1/me' }); // creates the profile row
  if (opts.internal) await owner.query("update app.user_profiles set account_kind = 'INTERNAL_TEST' where user_id = $1", [c.userId]);
  return c;
}
/** A consenting adult with one wound case, photos and (optionally) the clinician's classification. */
async function consentingCase(nurse: Client, opts: { research?: string[] | null; presentation?: boolean; site?: string; photos?: number; confirm?: boolean; outcome?: string; name?: string } = {}) {
  const p = await patient({ name: opts.name ?? 'Hoda Mahmoud' });
  expect((await scan(p.c, p.patientId)).status).toBe(200);
  if (opts.research !== null) expect((await research(p.c, p.patientId, opts.research ?? RESEARCH_ALL)).status).toBe(200);
  if (opts.presentation) expect((await presentation(p.c, p.patientId)).status).toBe(200);
  const cs = await newCase(p.c, p.patientId, opts.site ? { bodySite: opts.site } : {});
  expect(cs.status, JSON.stringify(cs.json)).toBe(201);
  for (let i = 0; i < (opts.photos ?? 2); i++) {
    const day = new Date(Date.now() - (opts.photos ?? 2) * 86_400_000 * 3 + i * 86_400_000 * 3).toISOString();
    expect((await upload(p.c, cs.json.id, testJpeg(800, 600), { capturedAt: day })).status).toBe(201);
  }
  if (opts.confirm !== false) {
    await shareWounds(p.c, p.patientId, nurse.userId);
    expect((await nurse.req({ method: 'POST', url: `/v1/wounds/${cs.json.id}/clinical`, body: { category: 'DIABETIC_FOOT', diabetes: 'YES' } })).status).toBe(200);
    if (opts.outcome) expect((await nurse.req({ method: 'POST', url: `/v1/wounds/${cs.json.id}/outcome`, body: { outcome: opts.outcome, on: new Date().toISOString().slice(0, 10) } })).status).toBe(200);
  }
  return { ...p, caseId: cs.json.id as string };
}
async function asAppRole<T>(userId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_APP });
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('app.user_id', $1, true)", [userId]);
    return await fn(c);
  } finally {
    await c.query('rollback').catch(() => undefined);
    c.release();
    await pool.end();
  }
}
const files = async (prefix: 'w' | 'r') => (await readdir(join(dir, prefix)).catch(() => [])).filter((f) => !f.endsWith('.tmp'));

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dmw-wounds-'));
  store = new LocalEncryptedStore(dir, randomBytes(32));
  app = await buildServer(loadEnv({ ...process.env, LOG_LEVEL: process.env.WOUND_TEST_LOG ?? 'silent' }), { objects });
  await app.ready();
  owner = ownerPool();
  await flag('wound.registry', true);
});
afterAll(async () => {
  for (const k of ['wound.registry', 'wound.research', 'wound.research_export', 'wound.presentations', 'wound.presentation_export', 'wound.similar_cases']) await flag(k, false);
  await owner.end();
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

describe('flags and test data', () => {
  it('real data needs the flag; internal-test accounts may exercise the feature on test data only', async () => {
    await flag('wound.registry', false);
    try {
      const real = await patient();
      const r = await scan(real.c, real.patientId);
      expect(r.status).toBe(422);
      expect(r.json.error.code).toBe('FEATURE_DISABLED');
      expect((await real.c.req({ method: 'GET', url: `/v1/patients/${real.patientId}/wound-permissions` })).json.available).toBe(false);

      const t = await patient({ internal: true });
      expect((await scan(t.c, t.patientId)).status).toBe(200);
      const cs = await newCase(t.c, t.patientId);
      expect(cs.status).toBe(201);
      expect((await owner.query('select test_data from app.wound_cases where id = $1', [cs.json.id])).rows[0].test_data).toBe(true);
    } finally {
      await flag('wound.registry', true);
    }
    expect((await owner.query("select enabled from app.feature_flags where key = 'ai.wound_assessment'")).rows[0].enabled).toBe(false);
  });
});

describe('A · scanning permission', () => {
  it('scanning without the scanning permission is blocked — by the API and by the database itself', async () => {
    const { c, patientId } = await patient();
    const r = await newCase(c, patientId);
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe('WOUND_SCAN_CONSENT_REQUIRED');
    await expect(
      asAppRole(c.userId, (db) =>
        db.query("insert into app.wound_cases (patient_id, created_by_user_id, label, body_site, reported_category, test_data) values ($1, $2, 'x', 'HEEL', 'BURN', false)", [patientId, c.userId]),
      ),
    ).rejects.toThrow('WOUND_SCAN_CONSENT_REQUIRED');

    expect((await scan(c, patientId)).status).toBe(200);
    const cs = await newCase(c, patientId);
    expect(cs.status).toBe(201);
    expect((await upload(c, cs.json.id)).status).toBe(201);
    // Withdrawn: nothing new may be added (existing photos stay the person's own record).
    expect((await withdraw(c, patientId, 'SCAN')).status).toBe(200);
    const again = await upload(c, cs.json.id);
    expect(again.status).toBe(403);
    expect(again.json.error.code).toBe('WOUND_SCAN_CONSENT_REQUIRED');
    expect((await c.req({ method: 'POST', url: `/v1/wounds/${cs.json.id}/observations`, body: { observedOn: '2026-10-20', painScore: 3 } })).json.error.code).toBe('WOUND_SCAN_CONSENT_REQUIRED');
    expect((await c.req({ method: 'GET', url: `/v1/wounds/${cs.json.id}` })).json.images).toHaveLength(1);
  });

  it('declining research and presentations never blocks scanning; both are off unless turned on', async () => {
    const { c, patientId } = await patient();
    const before = (await c.req({ method: 'GET', url: `/v1/patients/${patientId}/wound-permissions` })).json;
    expect(before.consents.map((x: { purpose: string; active: boolean }) => [x.purpose, x.active])).toEqual([['SCAN', false], ['RESEARCH', false], ['PRESENTATION', false]]);
    expect(before.wordingStatus).toBe('DRAFT_PENDING_LEGAL_REVIEW');
    expect((await scan(c, patientId)).status).toBe(200);
    // Saying no (withdrawing what was never given) is accepted and changes nothing.
    expect((await withdraw(c, patientId, 'RESEARCH')).status).toBe(200);
    expect((await withdraw(c, patientId, 'PRESENTATION')).status).toBe(200);
    const after = (await c.req({ method: 'GET', url: `/v1/patients/${patientId}/wound-permissions` })).json;
    expect(after.consents.map((x: { purpose: string; active: boolean }) => [x.purpose, x.active])).toEqual([['SCAN', true], ['RESEARCH', false], ['PRESENTATION', false]]);
    const cs = await newCase(c, patientId);
    const up = await upload(c, cs.json.id);
    expect(up.status).toBe(201);
    expect(up.json.images).toHaveLength(1);
    expect(up.json.ai).toEqual({ status: 'DISABLED', reason: 'NOT_VALIDATED' });
  });
});

describe('B / C · optional permissions', () => {
  it('have named purposes and recipients, the current wording, and come after A', async () => {
    const { c, patientId } = await patient();
    expect((await research(c, patientId)).json.error.code).toBe('WOUND_SCAN_CONSENT_REQUIRED');
    await scan(c, patientId);
    expect((await permit(c, patientId, { purpose: 'RESEARCH', action: 'GRANT', version: '2025-old', scope: { purposes: ['CASE_COMPARISON'], recipients: ['DMW_CLINICAL_RESEARCH'] } })).json.error.code).toBe('WOUND_CONSENT_VERSION_OUTDATED');
    expect((await permit(c, patientId, { purpose: 'RESEARCH', action: 'GRANT', version: V, scope: { purposes: [], recipients: ['DMW_CLINICAL_RESEARCH'] } })).status).toBe(400);
    expect((await permit(c, patientId, { purpose: 'RESEARCH', action: 'GRANT', version: V, scope: { purposes: ['UNRESTRICTED_TRAINING'], recipients: ['OPENAI'] } })).status).toBe(400);
    const r = await research(c, patientId, ['AI_EVALUATION'], ['DMW_CLINICAL_RESEARCH', 'TETRASOL']);
    expect(r.status).toBe(200);
    const b = r.json.consents.find((x: { purpose: string }) => x.purpose === 'RESEARCH');
    expect(b).toMatchObject({ active: true, scope: { purposes: ['AI_EVALUATION'], recipients: ['DMW_CLINICAL_RESEARCH', 'TETRASOL'] }, decision: 'ALLOWED' });
    expect(r.json.history[0]).toMatchObject({ purpose: 'RESEARCH', action: 'GRANT', version: V, basis: 'SELF', byMe: true });
    // Append-only, even for the schema owner.
    await expect(owner.query("update app.wound_consent_events set scope = '{}' where patient_id = $1", [patientId])).rejects.toThrow();
    // Withdrawing A withdraws B and C with it.
    await presentation(c, patientId);
    const w = await withdraw(c, patientId, 'SCAN');
    expect(w.json.consents.every((x: { active: boolean }) => !x.active)).toBe(true);
    expect(w.json.history.slice(0, 3).map((e: { purpose: string; reason: string }) => [e.purpose, e.reason]).sort()).toEqual([['PRESENTATION', 'SCAN_WITHDRAWN'], ['RESEARCH', 'SCAN_WITHDRAWN'], ['SCAN', 'PERSON_CHOICE']]);
  });

  it('minors and caregivers: a guardian may allow A only; B and C need the adult or attested legal authority', async () => {
    const parent = await signUp(app, { role: 'PATIENT' });
    const years = (n: number) => new Date(Date.now() - n * 365.25 * 86_400_000).toISOString().slice(0, 10);
    const child = (await parent.req({ method: 'POST', url: '/v1/patients', body: { displayName: 'Omar', dateOfBirth: years(9), sex: 'MALE', relationship: 'CHILD', consentBasis: 'GUARDIAN_OF_MINOR', ...consentStatement } })).json.id;
    expect((await scan(parent, child)).json.history[0].basis).toBe('GUARDIAN_OF_MINOR');
    const r = await research(parent, child);
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe('WOUND_SECONDARY_USE_MINOR');
    const perms = (await parent.req({ method: 'GET', url: `/v1/patients/${child}/wound-permissions` })).json;
    expect(perms.consents.filter((x: { decision: string }) => x.decision === 'NOT_FOR_MINORS')).toHaveLength(2);

    const relative = (await parent.req({ method: 'POST', url: '/v1/patients', body: { displayName: 'Father', dateOfBirth: '1940-01-01', sex: 'MALE', relationship: 'FATHER', consentBasis: 'ADULT_CONSENT_ATTESTED', ...consentStatement } })).json.id;
    expect((await scan(parent, relative)).json.history[0].basis).toBe('CAREGIVER_FOR_ADULT');
    expect((await research(parent, relative)).json.error.code).toBe('WOUND_CONSENT_NOT_ALLOWED');
    const ward = (await parent.req({ method: 'POST', url: '/v1/patients', body: { displayName: 'Mother', dateOfBirth: '1942-01-01', sex: 'FEMALE', relationship: 'MOTHER', consentBasis: 'LEGAL_AUTHORITY_ATTESTED', ...consentStatement } })).json.id;
    await scan(parent, ward);
    const ok = await research(parent, ward);
    expect(ok.status).toBe(200);
    expect(ok.json.history[0].basis).toBe('LEGAL_AUTHORITY');
  });
});

describe('the vault: photos, family, clinicians, strangers and administrators', () => {
  it('stores photos encrypted, without location or device data, behind audited short-lived links', async () => {
    const { c, patientId } = await patient();
    await scan(c, patientId);
    const cs = (await newCase(c, patientId)).json;
    const before = new Set(await files('w'));
    const jpg = withSegments(testJpeg(1200, 900), [exifBlock({ orientation: 1, dateTimeOriginal: '2026:10:20 08:00:00', gps: 'GPS 30.0444N 31.2357E' })]);
    const up = await upload(c, cs.id, jpg);
    expect(up.status, JSON.stringify(up.json)).toBe(201);
    const img = up.json.images[0];
    expect(img).toMatchObject({ day: 1, capturedAtSource: 'CAMERA', uploaderRole: 'PATIENT' });
    expect(img.metadataRemoved).toContain('EXIF');
    const added = (await files('w')).filter((f) => !before.has(f));
    expect(added.sort()).toEqual([`${img.id}.d`, `${img.id}.o`]);
    // Nothing in the stored rows or files is plaintext image or metadata.
    const row = (await owner.query('select * from app.wound_images where id = $1', [img.id])).rows[0];
    expect(Object.keys(row)).not.toContain('bytes');
    const link = await c.req({ method: 'POST', url: `/v1/wound-images/${img.id}/link`, body: { variant: 'derived' } });
    expect(link.status).toBe(200);
    const derived = await fetchMedia(link.json.url);
    expect(derived.status).toBe(200);
    expect(derived.type).toBe('image/jpeg');
    expect(derived.body.toString('latin1')).not.toMatch(/Exif|GPS/);
    const original = await fetchMedia((await c.req({ method: 'POST', url: `/v1/wound-images/${img.id}/link`, body: { variant: 'original' } })).json.url);
    expect(original.status).toBe(200);
    expect(original.body.toString('latin1')).not.toContain('GPS');
    const views = await owner.query("select metadata from app.audit_log where action = 'wound.image.view' and entity_id = $1", [img.id]);
    expect(views.rows.map((r) => r.metadata.variant).sort()).toEqual(['derived', 'original']);
    // A tampered or expired link is refused.
    const [body, sig] = (new URL(link.json.url).searchParams.get('t') ?? '').split('.');
    expect((await fetchMedia(`/v1/wound-media?t=${body}x.${sig}`)).status).toBe(403);
  });

  it('family see what the profile allows, strangers nothing, and administrators never see a photo', async () => {
    const { c, patientId } = await patient();
    await scan(c, patientId);
    const cs = (await newCase(c, patientId)).json;
    const img = (await upload(c, cs.id)).json.images[0];
    const link = (await c.req({ method: 'POST', url: `/v1/wound-images/${img.id}/link`, body: {} })).json.url;

    const stranger = await signUp(app, { role: 'PATIENT' });
    expect((await stranger.req({ method: 'GET', url: `/v1/wounds/${cs.id}` })).status).toBe(404);
    expect((await stranger.req({ method: 'GET', url: `/v1/patients/${patientId}/wounds` })).status).toBe(404);
    expect((await stranger.req({ method: 'POST', url: `/v1/wound-images/${img.id}/link`, body: {} })).status).toBe(404);
    expect((await stranger.req({ method: 'DELETE', url: `/v1/wound-images/${img.id}` })).status).toBe(404);

    const admin = await staff('ADMIN');
    expect((await admin.req({ method: 'GET', url: `/v1/wounds/${cs.id}` })).status).toBe(404);
    expect((await admin.req({ method: 'POST', url: `/v1/wound-images/${img.id}/link`, body: {} })).status).toBe(404);
    expect((await admin.req({ method: 'GET', url: '/v1/admin/wounds/presentation-candidates' })).status).toBe(403);
    expect((await admin.req({ method: 'GET', url: '/v1/admin/wounds/product-outcomes' })).status).toBe(403);
    const overview = await admin.req({ method: 'GET', url: '/v1/admin/wounds/overview' });
    expect(overview.status).toBe(200);
    expect(overview.json.cases).toBeGreaterThan(0);
    expect(JSON.stringify(overview.json)).not.toContain(cs.id);
    expect(JSON.stringify(overview.json)).not.toContain(img.id);
    // An administrator cannot give themself a wound role (database rule).
    await expect(
      asAppRole(admin.userId, (db) => db.query("insert into app.user_roles (user_id, role, granted_by_user_id) values ($1, 'WOUND_RESEARCHER', $1)", [admin.userId])),
    ).rejects.toThrow('SELF_GRANT_FORBIDDEN');

    // A family caregiver of this (claimed) profile may view and add, not delete or decide permissions.
    const sister = await signUp(app, { role: 'PATIENT' });
    await owner.query(
      "insert into app.patient_access (patient_id, user_id, relationship, access_level, consent_basis, consent_statement_version, granted_by_user_id) values ($1, $2, 'SIBLING', 'CAREGIVER', 'ADULT_CONSENT_ATTESTED', 'v1', $3)",
      [patientId, sister.userId, c.userId],
    );
    expect((await sister.req({ method: 'GET', url: `/v1/wounds/${cs.id}` })).status).toBe(200);
    const added = await upload(sister, cs.id);
    expect(added.status).toBe(201);
    expect(added.json.images.find((i: { uploaderRole: string }) => i.uploaderRole === 'CAREGIVER')).toBeTruthy();
    expect((await sister.req({ method: 'DELETE', url: `/v1/wounds/${cs.id}` })).status).toBe(404);
    expect((await withdraw(sister, patientId, 'SCAN')).json.error.code).toBe('WOUND_CONSENT_NOT_ALLOWED');
    const sisterLink = (await sister.req({ method: 'POST', url: `/v1/wound-images/${img.id}/link`, body: {} })).json.url;
    expect((await fetchMedia(sisterLink)).status).toBe(200);
    // Access revoked: an already-issued link stops working at once.
    await owner.query("update app.patient_access set status = 'REVOKED', revoked_at = now(), revoked_by_user_id = $2 where patient_id = $1 and user_id = $3", [patientId, c.userId, sister.userId]);
    expect((await fetchMedia(sisterLink)).status).toBe(403);
    expect((await sister.req({ method: 'GET', url: `/v1/wounds/${cs.id}` })).status).toBe(404);
    expect((await fetchMedia(link)).status).toBe(200);
  });

  it('clinicians see wounds only when the person includes them in a share; classification and outcome are theirs alone', async () => {
    const { c, patientId } = await patient();
    await scan(c, patientId);
    const cs = (await newCase(c, patientId)).json;
    await upload(c, cs.id);
    const nurse = await clinician('NURSE');
    const shareId = await shareWounds(c, patientId, nurse.userId, false);
    expect((await nurse.req({ method: 'GET', url: `/v1/wounds/${cs.id}` })).status).toBe(404);
    expect((await nurse.req({ method: 'GET', url: `/v1/patients/${patientId}/wounds` })).status).toBe(404);
    expect((await c.req({ method: 'POST', url: `/v1/care-shares/${shareId}/wounds`, body: { allowed: true } })).status).toBe(200);
    const seen = await nurse.req({ method: 'GET', url: `/v1/wounds/${cs.id}` });
    expect(seen.status).toBe(200);
    expect(seen.json.access).toMatchObject({ asClinician: true, canDelete: false });

    // The person cannot classify their own wound; the clinician can, and their notes are marked verified.
    expect((await c.req({ method: 'POST', url: `/v1/wounds/${cs.id}/clinical`, body: { category: 'BURN' } })).status).toBe(403);
    const confirmed = await nurse.req({ method: 'POST', url: `/v1/wounds/${cs.id}/clinical`, body: { category: 'PRESSURE_ULCER', diabetes: 'NO' } });
    expect(confirmed.json.clinical).toMatchObject({ category: 'PRESSURE_ULCER', diabetes: 'NO' });
    expect(confirmed.json.reportedCategory).toBe('DIABETIC_FOOT');
    const obs = await nurse.req({ method: 'POST', url: `/v1/wounds/${cs.id}/observations`, body: { observedOn: new Date().toISOString().slice(0, 10), lengthMm: 30, widthMm: 20, exudate: 'LOW' } });
    expect(obs.json.observations.at(-1)).toMatchObject({ authorRole: 'CLINICIAN', provenance: 'PROFESSIONALLY_VERIFIED' });
    expect(obs.json.measurements.at(-1)).toMatchObject({ areaMm2: 600, provenance: 'PROFESSIONALLY_VERIFIED' });
    const mine = await c.req({ method: 'POST', url: `/v1/wounds/${cs.id}/observations`, body: { observedOn: new Date().toISOString().slice(0, 10), painScore: 4, signs: ['REDNESS'] } });
    expect(mine.json.observations.at(-1)).toMatchObject({ authorRole: 'PATIENT', provenance: 'PATIENT_REPORTED' });
    const outcome = await nurse.req({ method: 'POST', url: `/v1/wounds/${cs.id}/outcome`, body: { outcome: 'IMPROVING', on: new Date().toISOString().slice(0, 10) } });
    expect(outcome.json.outcome.outcome).toBe('IMPROVING');

    const link = (await nurse.req({ method: 'POST', url: `/v1/wound-images/${seen.json.images[0].id}/link`, body: {} })).json.url;
    expect((await fetchMedia(link)).status).toBe(200);
    expect((await c.req({ method: 'POST', url: `/v1/care-shares/${shareId}/revoke` })).status).toBe(200);
    expect((await fetchMedia(link)).status).toBe(403);
    expect((await nurse.req({ method: 'GET', url: `/v1/wounds/${cs.id}` })).status).toBe(404);
  });

  it('a timeline: Day numbers from the first photo, the follow-up plan and side-by-side links', async () => {
    const { c, patientId } = await patient();
    await scan(c, patientId);
    const cs = (await newCase(c, patientId, { followUpDays: [3, 7, 14] })).json;
    const day1 = new Date(Date.now() - 6 * 86_400_000);
    await upload(c, cs.id, testJpeg(800, 600), { capturedAt: day1.toISOString() });
    const d = await upload(c, cs.id, testJpeg(800, 600), { capturedAt: new Date(day1.getTime() + 2 * 86_400_000).toISOString() });
    expect(d.json.images.map((i: { day: number }) => i.day)).toEqual([1, 3]);
    expect(d.json.plan.map((p: { day: number; status: string }) => [p.day, p.status])).toEqual([[1, 'DONE'], [3, 'DONE'], [7, 'DUE'], [14, 'UPCOMING']]);
    expect(d.json.nextDue.day).toBe(7);
    const links = await c.req({ method: 'POST', url: `/v1/wounds/${cs.id}/image-links` });
    expect(links.json).toHaveLength(2);
    expect((await fetchMedia(links.json[1].url)).status).toBe(200);
  });
});

describe('storage lifecycle', () => {
  it('a failed upload leaves no photo behind; abandoned uploads are swept; no storage means NOT_CONFIGURED', async () => {
    const { c, patientId } = await patient();
    await scan(c, patientId);
    const cs = (await newCase(c, patientId)).json;
    const before = (await files('w')).length;
    failDerivedWrites = true;
    try {
      const r = await upload(c, cs.id);
      expect(r.status).toBe(503);
      expect(r.json.error.code).toBe('STORAGE_UNAVAILABLE');
    } finally {
      failDerivedWrites = false;
    }
    expect((await owner.query('select count(*)::int as n from app.wound_images where case_id = $1', [cs.id])).rows[0].n).toBe(0);
    expect((await files('w')).length).toBe(before);

    // An upload abandoned mid-way (row reserved, objects written, never committed).
    const id = '0d0d0d0d-0000-4000-8000-000000000001';
    await owner.query(
      `insert into app.wound_images (id, case_id, patient_id, uploaded_by_user_id, uploader_role, original_key, derived_key, content_type, byte_size, sha256, derived_sha256,
         width, height, derived_width, derived_height, captured_at, captured_at_source, quality, created_at)
       values ($1, $2, $3, $4, 'PATIENT', $5, $6, 'image/jpeg', 1000, repeat('a', 64), repeat('b', 64), 10, 10, 10, 10, now(), 'UPLOAD', '{}', now() - interval '2 hours')`,
      [id, cs.id, patientId, c.userId, `w/${id}.o`, `w/${id}.d`],
    );
    await store.put(`w/${id}.o`, Buffer.from('half-finished'));
    expect((await c.req({ method: 'GET', url: `/v1/wounds/${cs.id}` })).json.images).toHaveLength(0);
    const swept = await runWoundMaintenance(app);
    expect(swept.abandonedUploads).toBeGreaterThanOrEqual(1);
    expect(await files('w')).not.toContain(`${id}.o`);
    expect((await owner.query('select count(*)::int as n from app.storage_purge_queue where object_key like $1', [`w/${id}%`])).rows[0].n).toBe(0);

    storageConfigured = false;
    try {
      expect((await upload(c, cs.id)).json.error.code).toBe('NOT_CONFIGURED');
    } finally {
      storageConfigured = true;
    }
    // A signed-in user can neither read nor clear the purge queue.
    await expect(asAppRole(c.userId, (db) => db.query('select app.storage_purge_claim(10)'))).rejects.toThrow('SYSTEM_ONLY');
  });

  it('deleting a photo, a case or all wound data removes the stored objects', async () => {
    const { c, patientId } = await patient();
    await scan(c, patientId);
    const a = (await newCase(c, patientId)).json;
    const b = (await newCase(c, patientId, { label: 'Right heel', bodySide: 'RIGHT' })).json;
    const i1 = (await upload(c, a.id)).json.images[0].id;
    await upload(c, a.id);
    await upload(c, b.id);
    expect((await c.req({ method: 'DELETE', url: `/v1/wound-images/${i1}` })).status).toBe(200);
    await runWoundMaintenance(app);
    expect(await files('w')).not.toContain(`${i1}.o`);
    const del = await c.req({ method: 'POST', url: `/v1/patients/${patientId}/wounds/delete-all` });
    expect(del.json.deletedCases).toBe(2);
    await runWoundMaintenance(app);
    expect((await owner.query('select count(*)::int as n from app.wound_images where patient_id = $1', [patientId])).rows[0].n).toBe(0);
    expect((await owner.query("select count(*)::int as n from app.audit_log where action = 'wound.data.delete_all' and patient_id = $1", [patientId])).rows[0].n).toBe(1);
  });
});

describe('research registry', () => {
  let nurse: Client;
  let researcher: Client;
  let reviewer: Client;
  beforeAll(async () => {
    nurse = await clinician('NURSE');
    researcher = await staff('WOUND_RESEARCHER');
    reviewer = await staff('CLINICAL_REVIEWER');
  });

  it('includes only consented, clinician-reviewed, adult, allowed-site cases — de-identified — and handles withdrawal', async () => {
    const yes = await consentingCase(nurse, { name: 'Samira Fawzy' });
    const declined = await consentingCase(nurse, { research: null });
    const otherPurpose = await consentingCase(nurse, { research: ['AI_EVALUATION'] });
    const face = await consentingCase(nurse, { site: 'HEAD_FACE' });
    const unreviewed = await consentingCase(nurse, { confirm: false });

    expect((await researcher.req({ method: 'POST', url: '/v1/admin/wounds/datasets', body: { name: 'Healing trajectories', purpose: 'HEALING_TRAJECTORIES', recipient: 'DMW_CLINICAL_RESEARCH' } })).json.error.code).toBe('FEATURE_DISABLED');
    await flag('wound.research', true);
    const ds = await researcher.req({ method: 'POST', url: '/v1/admin/wounds/datasets', body: { name: 'Healing trajectories', purpose: 'HEALING_TRAJECTORIES', recipient: 'DMW_CLINICAL_RESEARCH', criteria: { categories: ['DIABETIC_FOOT'] } } });
    expect(ds.status, JSON.stringify(ds.json)).toBe(201);
    const built = await researcher.req({ method: 'POST', url: `/v1/admin/wounds/datasets/${ds.json.id}/build` });
    expect(built.json).toMatchObject({ failed: 0 });
    const detail = (await researcher.req({ method: 'GET', url: `/v1/admin/wounds/datasets/${ds.json.id}` })).json;
    const links = await owner.query('select case_id from app.wound_research_links l join app.wound_research_items i on i.id = l.item_id where i.dataset_id = $1', [ds.json.id]);
    const included = links.rows.map((r) => r.case_id);
    expect(included).toContain(yes.caseId);
    for (const excluded of [declined, otherPurpose, face, unreviewed]) expect(included).not.toContain(excluded.caseId);
    const item = detail.items.find((i: { pseudonym: string }) => i.pseudonym && included.length) as { id: string; snapshot: Record<string, unknown>; images: { id: string }[] };
    const snap = JSON.stringify(detail.items);
    expect(snap).not.toContain('Samira');
    expect(snap).not.toContain(yes.patientId);
    expect(snap).not.toContain(yes.caseId);
    expect(snap).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(item.snapshot).toMatchObject({ category: 'DIABETIC_FOOT', region: 'FOOT', diabetes: 'YES', photoDays: [1, 4] });
    expect(item.images).toHaveLength(2);

    // Researchers see accepted items only; the reviewer sees pending ones; administrators neither.
    expect((await researcher.req({ method: 'POST', url: `/v1/admin/wounds/research-images/${item.images[0]!.id}/link` })).status).toBe(404);
    const rl = await reviewer.req({ method: 'POST', url: `/v1/admin/wounds/research-images/${item.images[0]!.id}/link` });
    expect(rl.status).toBe(200);
    const copy = await fetchMedia(rl.json.url);
    expect(copy.status).toBe(200);
    expect(copy.body.toString('latin1')).not.toContain('Exif');
    const admin = await staff('ADMIN');
    expect((await admin.req({ method: 'GET', url: `/v1/admin/wounds/datasets/${ds.json.id}` })).status).toBe(403);
    expect((await admin.req({ method: 'POST', url: `/v1/admin/wounds/research-images/${item.images[0]!.id}/link` })).status).toBe(403);
    expect((await researcher.req({ method: 'POST', url: `/v1/admin/wounds/research-items/${item.id}/review`, body: { decision: 'ACCEPTED' } })).status).toBe(403);

    expect((await researcher.req({ method: 'POST', url: `/v1/admin/wounds/datasets/${ds.json.id}/freeze`, body: { approvalReference: 'ETHICS-2026-001', retentionUntil: '2028-01-01' } })).json.error.code).toBe('DATASET_REVIEW_INCOMPLETE');
    for (const it of detail.items) expect((await reviewer.req({ method: 'POST', url: `/v1/admin/wounds/research-items/${it.id}/review`, body: { decision: 'ACCEPTED' } })).status).toBe(200);
    expect((await researcher.req({ method: 'POST', url: `/v1/admin/wounds/datasets/${ds.json.id}/freeze`, body: { retentionUntil: '2028-01-01' } })).status).toBe(400);
    expect((await researcher.req({ method: 'POST', url: `/v1/admin/wounds/datasets/${ds.json.id}/freeze`, body: { approvalReference: 'ETHICS-2026-001', retentionUntil: '2028-01-01' } })).status).toBe(200);
    expect((await researcher.req({ method: 'POST', url: `/v1/admin/wounds/research-images/${item.images[0]!.id}/link` })).status).toBe(200);

    // Real research exports stay disabled until approvals.
    const exp = await researcher.req({ method: 'POST', url: `/v1/admin/wounds/datasets/${ds.json.id}/export` });
    expect(exp.json.error.code).toBe('FEATURE_DISABLED');

    // Withdrawal: the frozen item is withdrawn, its data and copies destroyed, future builds exclude the case.
    const rFiles = (await files('r')).length;
    expect((await withdraw(yes.c, yes.patientId, 'RESEARCH')).status).toBe(200);
    const after = (await researcher.req({ method: 'GET', url: `/v1/admin/wounds/datasets/${ds.json.id}` })).json;
    const gone = after.items.find((i: { id: string }) => i.id === item.id);
    expect(gone).toMatchObject({ status: 'WITHDRAWN', snapshot: { withdrawn: true }, images: [] });
    expect((await researcher.req({ method: 'POST', url: `/v1/admin/wounds/research-images/${item.images[0]!.id}/link` })).status).toBe(404);
    expect((await fetchMedia(rl.json.url)).status).toBe(403);
    await runWoundMaintenance(app);
    expect((await files('r')).length).toBe(rFiles - 2);
    const v2 = await researcher.req({ method: 'POST', url: `/v1/admin/wounds/datasets/${ds.json.id}/new-version` });
    expect(v2.json.version).toBe(2);
    await researcher.req({ method: 'POST', url: `/v1/admin/wounds/datasets/${v2.json.id}/build` });
    const v2links = await owner.query('select case_id from app.wound_research_links l join app.wound_research_items i on i.id = l.item_id where i.dataset_id = $1', [v2.json.id]);
    expect(v2links.rows.map((r) => r.case_id)).not.toContain(yes.caseId);
    await flag('wound.research', false);
  });

  it('test datasets: internal-test staff only, test cases only; the export is a de-identified package', async () => {
    const tester = await staff('WOUND_RESEARCHER', { internal: true });
    const testReviewer = await staff('CLINICAL_REVIEWER', { internal: true });
    const t = await patient({ internal: true, name: 'Test Person' });
    await scan(t.c, t.patientId);
    await research(t.c, t.patientId);
    const cs = (await newCase(t.c, t.patientId)).json;
    await upload(t.c, cs.id);
    await owner.query("update app.wound_cases set clinical_category = 'BURN', clinically_reviewed_at = now() where id = $1", [cs.id]);
    const real = await consentingCase(nurse);
    const created = await tester.req({ method: 'POST', url: '/v1/admin/wounds/datasets', body: { name: 'Test set', purpose: 'HEALING_TRAJECTORIES', recipient: 'DMW_CLINICAL_RESEARCH' } });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const ds = created.json;
    await tester.req({ method: 'POST', url: `/v1/admin/wounds/datasets/${ds.id}/build` });
    const cases = (await owner.query('select case_id from app.wound_research_links l join app.wound_research_items i on i.id = l.item_id where i.dataset_id = $1', [ds.id])).rows.map((r) => r.case_id);
    expect(cases).toEqual([cs.id]);
    expect(cases).not.toContain(real.caseId);
    // A real researcher does not see test datasets.
    expect((await researcher.req({ method: 'GET', url: `/v1/admin/wounds/datasets/${ds.id}` })).status).toBe(404);
    const items = (await tester.req({ method: 'GET', url: `/v1/admin/wounds/datasets/${ds.id}` })).json.items;
    await testReviewer.req({ method: 'POST', url: `/v1/admin/wounds/research-items/${items[0].id}/review`, body: { decision: 'ACCEPTED' } });
    expect((await tester.req({ method: 'POST', url: `/v1/admin/wounds/datasets/${ds.id}/freeze`, body: { approvalReference: 'TEST-ONLY', retentionUntil: '2027-12-31' } })).status).toBe(200);
    const res = await app.inject({ method: 'POST', url: `/v1/admin/wounds/datasets/${ds.id}/export`, headers: { origin: 'http://localhost:8081', cookie: tester.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    const zip = res.rawPayload.toString('latin1');
    expect(zip).toContain('manifest.json');
    expect(zip).not.toContain('Test Person');
    expect(zip).not.toContain(t.patientId);
    expect((await owner.query('select item_count from app.wound_research_exports where dataset_id = $1', [ds.id])).rows[0].item_count).toBe(1);
  });
});

describe('similar cases and product-outcome analytics', () => {
  it('similar cases: clinicians only, consenting cases only, no photos or identities', async () => {
    const nurse = await clinician('NURSE');
    const target = await consentingCase(nurse, { name: 'Target Person' });
    const comparable = await consentingCase(nurse, { name: 'Comparable Person' });
    const notComparable = await consentingCase(nurse, { research: ['AI_EVALUATION'] });
    expect((await nurse.req({ method: 'GET', url: `/v1/wounds/${target.caseId}/similar` })).json.error.code).toBe('FEATURE_DISABLED');
    await flag('wound.similar_cases', true);
    try {
      const r = await nurse.req({ method: 'GET', url: `/v1/wounds/${target.caseId}/similar` });
      expect(r.status).toBe(200);
      const text = JSON.stringify(r.json);
      expect(text).not.toContain('Comparable Person');
      expect(text).not.toContain(comparable.caseId);
      expect(text).not.toContain(notComparable.caseId);
      expect(r.json.length).toBeGreaterThan(0);
      expect(r.json[0]).toMatchObject({ category: 'DIABETIC_FOOT', matchedOn: expect.arrayContaining(['CATEGORY']) });
      expect(r.json[0]).not.toHaveProperty('images');
      expect((await target.c.req({ method: 'GET', url: `/v1/wounds/${target.caseId}/similar` })).status).toBe(403);
    } finally {
      await flag('wound.similar_cases', false);
    }
  });

  it('product outcomes: descriptive counts per category and product, small groups suppressed', async () => {
    const nurse = await clinician('NURSE');
    const productId = (
      await owner.query(
        "insert into app.products (slug, name_ar, name_en, summary_ar, summary_en, description_ar, description_en, usage_ar, usage_en, is_demo) values ($1, 'جل', 'TetraSol Gel (test)', 's', 's', 'd', 'd', 'u', 'u', false) returning id",
        [`tetrasol-gel-test-${Date.now()}`],
      )
    ).rows[0].id as string;
    for (let i = 0; i < 6; i++) {
      const x = await consentingCase(nurse, { outcome: i % 2 ? 'HEALED' : 'IMPROVING' });
      const tr = await x.c.req({ method: 'POST', url: `/v1/wounds/${x.caseId}/treatments`, body: { kind: 'COMPANY_PRODUCT', productId, description: 'Gel twice daily', startedOn: new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10) } });
      expect(tr.status, JSON.stringify(tr.json)).toBe(201);
    }
    const lone = await consentingCase(nurse);
    await lone.c.req({ method: 'POST', url: `/v1/wounds/${lone.caseId}/treatments`, body: { kind: 'DRESSING', description: 'Gauze', startedOn: new Date().toISOString().slice(0, 10) } });
    const researcher = await staff('WOUND_RESEARCHER');
    expect((await researcher.req({ method: 'GET', url: '/v1/admin/wounds/product-outcomes' })).json.error.code).toBe('FEATURE_DISABLED');
    await flag('wound.research', true);
    try {
      const r = await researcher.req({ method: 'GET', url: '/v1/admin/wounds/product-outcomes' });
      expect(r.status).toBe(200);
      const gel = r.json.rows.find((x: { productName: string }) => x.productName === 'TetraSol Gel (test)');
      expect(gel).toMatchObject({ suppressed: false, cases: 6, withConfirmedOutcome: 6, outcomes: { HEALED: 3, IMPROVING: 3 } });
      expect(r.json.rows.filter((x: { suppressed: boolean; cases?: number }) => !x.suppressed && (x.cases ?? 0) < 5)).toHaveLength(0);
    } finally {
      await flag('wound.research', false);
    }
  });
});

describe('presentation case library', () => {
  it('needs the patient’s approval of the exact version and a second approver; only that version is exported', async () => {
    const nurse = await clinician('NURSE');
    const p = await consentingCase(nurse, { research: null, presentation: true, site: 'FOOT_SOLE', outcome: 'HEALED', name: 'Mona Adel' });
    const a = await staff('PRESENTATION_APPROVER');
    const b = await staff('PRESENTATION_APPROVER');
    expect((await a.req({ method: 'GET', url: '/v1/admin/wounds/presentation-candidates' })).json.error.code).toBe('FEATURE_DISABLED');
    await flag('wound.presentations', true);
    try {
      const candidates = (await a.req({ method: 'GET', url: '/v1/admin/wounds/presentation-candidates' })).json;
      const cand = candidates.find((x: { caseId: string }) => x.caseId === p.caseId);
      expect(cand).toMatchObject({ category: 'DIABETIC_FOOT', outcome: 'HEALED', audiences: ['INTERNAL_TRAINING'], organizations: ['ALIA_GROUP'] });
      expect(JSON.stringify(candidates)).not.toContain('Mona');
      const imgs = (await a.req({ method: 'GET', url: `/v1/admin/wounds/cases/${p.caseId}/images` })).json;
      expect(imgs).toHaveLength(2);
      expect((await fetchMedia((await a.req({ method: 'POST', url: `/v1/admin/wounds/presentation-images/${imgs[0].imageId}/link` })).json.url)).status).toBe(200);
      // Never the vault (and never an original).
      expect((await a.req({ method: 'POST', url: `/v1/wound-images/${imgs[0].imageId}/link`, body: { variant: 'original' } })).status).toBe(404);

      const nom = await a.req({ method: 'POST', url: '/v1/admin/wounds/presentations', body: { caseId: p.caseId } });
      expect(nom.json.status).toBe('NOMINATED');
      expect((await p.c.req({ method: 'GET', url: `/v1/patients/${p.patientId}/wound-presentations` })).json).toHaveLength(0);
      const body = {
        title: 'Diabetic foot ulcer — four-week follow-up',
        summaryEn: 'A plantar diabetic foot ulcer followed with regular dressing changes; clinician-confirmed outcome shown.',
        summaryAr: 'قرحة قدم سكري في باطن القدم تمت متابعتها مع تغيير الضماد بانتظام؛ النتيجة كما أكدها المختص.',
        audience: 'INTERNAL_TRAINING',
        organization: 'ALIA_GROUP',
        scopeNote: 'Alia Group nurse training sessions, internal only',
        validUntil: new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10),
        images: imgs.map((i: { imageId: string; day: number }) => ({ imageId: i.imageId, captionEn: `Day ${i.day}`, captionAr: `اليوم ${i.day}` })),
      };
      const prep = (x: object) => a.req({ method: 'POST', url: `/v1/admin/wounds/presentations/${nom.json.id}/prepare`, body: { ...body, ...x } });
      expect((await prep({ summaryEn: 'Mona recovered well with regular dressing changes over four weeks.' })).json.error.code).toBe('PRESENTATION_TEXT_IDENTIFIES');
      expect((await prep({ summaryEn: 'The gel cures diabetic foot ulcers in four weeks, guaranteed.' })).json.error.code).toBe('PRESENTATION_CLAIM_NOT_ALLOWED');
      expect((await prep({ audience: 'HEALTHCARE_PROFESSIONALS' })).json.error.code).toBe('PRESENTATION_AUDIENCE_NOT_PERMITTED');
      const first = await prep({});
      expect(first.status, JSON.stringify(first.json)).toBe(200);
      expect(first.json.status).toBe('AWAITING_PATIENT');

      // Not approved → never exported (and export stays disabled until approvals).
      expect((await b.req({ method: 'POST', url: `/v1/admin/wounds/presentations/${nom.json.id}/export`, body: { format: 'PDF' } })).json.error.code).toBe('FEATURE_DISABLED');
      await flag('wound.presentation_export', true);
      expect((await b.req({ method: 'POST', url: `/v1/admin/wounds/presentations/${nom.json.id}/export`, body: { format: 'PDF' } })).json.error.code).toBe('PRESENTATION_NOT_APPROVED');

      const req = (await p.c.req({ method: 'GET', url: `/v1/patients/${p.patientId}/wound-presentations` })).json[0];
      expect(req).toMatchObject({ status: 'AWAITING_PATIENT', audience: 'INTERNAL_TRAINING', organization: 'ALIA_GROUP', outcome: 'HEALED' });
      expect(req.images).toHaveLength(2);
      // The text changed after the person looked: their approval does not apply to the new version.
      const second = await prep({ title: 'Diabetic foot ulcer — follow-up' });
      expect((await p.c.req({ method: 'POST', url: `/v1/wound-presentations/${nom.json.id}/decision`, body: { decision: 'APPROVE', requestHash: req.requestHash } })).json.error.code).toBe('PRESENTATION_CHANGED');
      expect((await p.c.req({ method: 'POST', url: `/v1/wound-presentations/${nom.json.id}/decision`, body: { decision: 'APPROVE', requestHash: second.json.requestHash } })).status).toBe(200);

      const checklist = { noFace: true, noIdentifyingMarks: true, noJewelleryOrTattoos: true, noBackgroundDetails: true, noNamesDatesOrNumbers: true, outcomeClinicianConfirmed: true, noEfficacyClaims: true };
      expect((await a.req({ method: 'POST', url: `/v1/admin/wounds/presentations/${nom.json.id}/approve`, body: { checklist } })).json.error.code).toBe('SECOND_APPROVER_REQUIRED');
      expect((await b.req({ method: 'POST', url: `/v1/admin/wounds/presentations/${nom.json.id}/approve`, body: { checklist: { ...checklist, noFace: false } } })).status).toBe(400);
      expect((await b.req({ method: 'POST', url: `/v1/admin/wounds/presentations/${nom.json.id}/approve`, body: { checklist } })).status).toBe(200);

      const pdf = await app.inject({ method: 'POST', url: `/v1/admin/wounds/presentations/${nom.json.id}/export`, headers: { origin: 'http://localhost:8081', cookie: b.cookie, 'content-type': 'application/json' }, payload: JSON.stringify({ format: 'PDF' }) });
      expect(pdf.statusCode).toBe(200);
      expect(pdf.rawPayload.toString('latin1', 0, 8)).toBe('%PDF-1.4');
      expect(pdf.rawPayload.toString('latin1')).not.toContain('Mona');
      const pkg = await app.inject({ method: 'POST', url: `/v1/admin/wounds/presentations/${nom.json.id}/export`, headers: { origin: 'http://localhost:8081', cookie: b.cookie, 'content-type': 'application/json' }, payload: JSON.stringify({ format: 'IMAGE_PACKAGE' }) });
      expect(pkg.statusCode).toBe(200);
      expect(pkg.rawPayload.toString('latin1')).toContain('USE-RESTRICTIONS.txt');
      const history = (await b.req({ method: 'GET', url: `/v1/admin/wounds/presentations/${nom.json.id}` })).json.exports;
      expect(history.map((e: { format: string }) => e.format).sort()).toEqual(['IMAGE_PACKAGE', 'PDF']);

      // The person deletes one of the approved photos: the approved version is gone, nothing more is exported.
      expect((await p.c.req({ method: 'DELETE', url: `/v1/wound-images/${imgs[1].imageId}` })).status).toBe(200);
      expect((await b.req({ method: 'GET', url: `/v1/admin/wounds/presentations/${nom.json.id}` })).json).toMatchObject({ status: 'WITHDRAWN', closedReason: 'PHOTO_DELETED' });
      expect((await b.req({ method: 'POST', url: `/v1/admin/wounds/presentations/${nom.json.id}/export`, body: { format: 'PDF' } })).json.error.code).toBe('PRESENTATION_NOT_APPROVED');
      // Export history stays (what was handed out, when and by whom).
      expect((await owner.query('select count(*)::int as n from app.wound_presentation_exports where presentation_id = $1', [nom.json.id])).rows[0].n).toBe(2);
    } finally {
      await flag('wound.presentations', false);
      await flag('wound.presentation_export', false);
    }
  });

  it('withdrawing the presentation permission withdraws every open presentation at once', async () => {
    const nurse = await clinician('NURSE');
    const p = await consentingCase(nurse, { research: null, presentation: true, outcome: 'IMPROVING' });
    const a = await staff('PRESENTATION_APPROVER');
    await flag('wound.presentations', true);
    try {
      const nom = (await a.req({ method: 'POST', url: '/v1/admin/wounds/presentations', body: { caseId: p.caseId } })).json;
      expect((await withdraw(p.c, p.patientId, 'PRESENTATION')).status).toBe(200);
      expect((await a.req({ method: 'GET', url: `/v1/admin/wounds/presentations/${nom.id}` })).json).toMatchObject({ status: 'WITHDRAWN', closedReason: 'PERMISSION_WITHDRAWN' });
      expect((await a.req({ method: 'GET', url: '/v1/admin/wounds/presentation-candidates' })).json.map((x: { caseId: string }) => x.caseId)).not.toContain(p.caseId);
    } finally {
      await flag('wound.presentations', false);
    }
  });
});

describe('account deletion and AI', () => {
  it('account deletion removes wound data and stored objects, withdraws research use, keeps the audit trail', async () => {
    const nurse = await clinician('NURSE');
    const p = await consentingCase(nurse, { name: 'Leaving Person' });
    await flag('wound.research', true);
    try {
      const researcher = await staff('WOUND_RESEARCHER');
      const reviewer = await staff('CLINICAL_REVIEWER');
      const ds = (await researcher.req({ method: 'POST', url: '/v1/admin/wounds/datasets', body: { name: 'Deletion check', purpose: 'HEALING_TRAJECTORIES', recipient: 'DMW_CLINICAL_RESEARCH' } })).json;
      await researcher.req({ method: 'POST', url: `/v1/admin/wounds/datasets/${ds.id}/build` });
      const items = (await researcher.req({ method: 'GET', url: `/v1/admin/wounds/datasets/${ds.id}` })).json.items;
      for (const it of items) await reviewer.req({ method: 'POST', url: `/v1/admin/wounds/research-items/${it.id}/review`, body: { decision: 'ACCEPTED' } });
      await researcher.req({ method: 'POST', url: `/v1/admin/wounds/datasets/${ds.id}/freeze`, body: { approvalReference: 'ETHICS-2026-002', retentionUntil: '2028-01-01' } });
      const mine = (await owner.query('select i.id from app.wound_research_items i join app.wound_research_links l on l.item_id = i.id where l.case_id = $1', [p.caseId])).rows[0].id;
      const imgIds = (await owner.query('select id from app.wound_images where case_id = $1', [p.caseId])).rows.map((r) => r.id);

      const del = await p.c.req({ method: 'POST', url: '/v1/me/account-deletion', body: { confirmation: 'DELETE', password: PASSWORD } });
      expect(del.status, JSON.stringify(del.json)).toBe(200);
      expect((await owner.query('select count(*)::int as n from app.wound_cases where patient_id = $1', [p.patientId])).rows[0].n).toBe(0);
      expect((await owner.query('select status, snapshot from app.wound_research_items where id = $1', [mine])).rows[0]).toMatchObject({ status: 'WITHDRAWN', snapshot: { withdrawn: true } });
      await runWoundMaintenance(app);
      const left = await files('w');
      for (const id of imgIds) expect(left.filter((f) => f.startsWith(id))).toEqual([]);
      // Proof of what was permitted, and when, is retained (no content).
      expect((await owner.query("select count(*)::int as n from app.audit_log where action = 'wound.consent.grant' and patient_id = $1", [p.patientId])).rows[0].n).toBe(2);
    } finally {
      await flag('wound.research', false);
    }
  });

  it('no AI result exists — real or simulated: analysis is refused for every account and classification is the clinician’s', async () => {
    for (const internal of [false, true]) {
      const { c, patientId } = await patient({ internal });
      await scan(c, patientId);
      const cs = (await newCase(c, patientId)).json;
      await upload(c, cs.id);
      const r = await c.req({ method: 'POST', url: `/v1/wounds/${cs.id}/analyze` });
      expect(r.status).toBe(409);
      expect(r.json.error.code).toBe('FEATURE_DISABLED');
      const d = (await c.req({ method: 'GET', url: `/v1/wounds/${cs.id}` })).json;
      expect(d.ai).toEqual({ status: 'DISABLED', reason: 'NOT_VALIDATED' });
      expect(d.clinical).toBeNull();
      expect(d.outcome).toBeNull();
    }
    const status = await (await signUp(app, { role: 'PATIENT' })).req({ method: 'GET', url: '/v1/wounds/status' });
    expect(status.json.ai.status).toBe('DISABLED');
    expect(status.json.storage).toBe('DEV_ADAPTER');
  });
});
