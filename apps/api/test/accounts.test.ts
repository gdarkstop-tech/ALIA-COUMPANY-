/**
 * Admin user management (migration 0009): suspend / block / reactivate, clinician booking
 * restrictions, history without internal notes for the person, appeals, and the guarantees
 * around them (never on oneself, staff only by an ADMIN, sessions revoked, records kept).
 */
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientFor, createTestServer, grantRole, ownerPool, signIn, signUp, type Client } from './helpers';

let app: FastifyInstance;
let owner: pg.Pool;
let admin: Client;
let admin2: Client;
let tns: Client;
let support: Client;

const suspend = (by: Client, id: string, extra: Record<string, unknown> = {}) =>
  by.req({ method: 'POST', url: `/v1/admin/users/${id}/status`, body: { action: 'SUSPEND', reason: 'TERMS_VIOLATION', publicMessage: 'Your account is paused while we review a report.', staffNote: 'Report #42 — repeated abusive messages', ...extra } });

beforeAll(async () => {
  app = await createTestServer();
  owner = ownerPool();
  admin = await signUp(app);
  await grantRole(admin.userId, 'ADMIN');
  admin2 = await signUp(app);
  await grantRole(admin2.userId, 'ADMIN');
  tns = await signUp(app);
  await grantRole(tns.userId, 'TRUST_AND_SAFETY');
  support = await signUp(app);
  await grantRole(support.userId, 'SUPPORT');
});
afterAll(async () => {
  await owner.end();
  await app.close();
});

describe('searching users', () => {
  it('finds people by e-mail or name and filters by role and status — without medical records', async () => {
    const p = await signUp(app, { role: 'PATIENT', name: 'Searchable Person' });
    const res = await support.req({ method: 'GET', url: `/v1/admin/users?q=${encodeURIComponent(p.email)}` });
    expect(res.status).toBe(200);
    expect(res.json).toHaveLength(1);
    expect(res.json[0]).toMatchObject({ id: p.userId, roles: ['PATIENT'], account: { status: 'ACTIVE', bookingsRestricted: false } });
    const detail = await support.req({ method: 'GET', url: `/v1/admin/users/${p.userId}` });
    expect(detail.status).toBe(200);
    expect(detail.json).not.toHaveProperty('healthEntries');
    expect(typeof detail.json.patientProfiles).toBe('number');
    // Support can look, but not change anyone's status.
    expect((await suspend(support, p.userId)).status).toBe(403);
    // Patients cannot search users at all.
    expect((await p.req({ method: 'GET', url: '/v1/admin/users' })).status).toBe(403);
  });
});

describe('suspending, blocking and reactivating', () => {
  it('a suspension signs the person out, refuses their requests and keeps their records', async () => {
    const p = await signUp(app, { role: 'PATIENT' });
    const created = await p.req({ method: 'POST', url: '/v1/patients', body: { displayName: 'Kept', dateOfBirth: '1990-01-01', sex: 'FEMALE', relationship: 'SELF', consentBasis: 'SELF', consentAttested: true, consentStatementVersion: 'v1' } });
    expect(created.status).toBe(201);

    expect((await suspend(tns, p.userId)).json.status).toBe('SUSPENDED');
    // Old session no longer works.
    expect((await p.req({ method: 'GET', url: '/v1/me' })).status).toBe(401);

    // Signing in again shows why, and only why.
    const again = await signIn(app, p.email);
    const c = clientFor(app, again.cookie, p.userId, p.email);
    const me = await c.req({ method: 'GET', url: '/v1/me' });
    expect(me.json.account).toMatchObject({ status: 'SUSPENDED', reason: 'TERMS_VIOLATION', publicMessage: 'Your account is paused while we review a report.' });
    const blocked = await c.req({ method: 'GET', url: '/v1/patients' });
    expect(blocked.status).toBe(403);
    expect(blocked.json.error.code).toBe('ACCOUNT_SUSPENDED');
    const own = await c.req({ method: 'GET', url: '/v1/me/account-status' });
    expect(own.json.events[0]).toMatchObject({ action: 'SUSPEND', toStatus: 'SUSPENDED' });
    expect(JSON.stringify(own.json)).not.toContain('Report #42'); // internal note never shown to the person

    // Records are retained.
    const kept = await owner.query('select count(*)::int as n from app.patients where id = $1', [created.json.id]);
    expect(kept.rows[0].n).toBe(1);

    // Reactivation needs a note too; afterwards everything works again.
    expect((await tns.req({ method: 'POST', url: `/v1/admin/users/${p.userId}/status`, body: { action: 'REACTIVATE', reason: 'RESOLVED', staffNote: 'short' } })).status).toBe(400);
    expect((await tns.req({ method: 'POST', url: `/v1/admin/users/${p.userId}/status`, body: { action: 'REACTIVATE', reason: 'RESOLVED', staffNote: 'Report reviewed — no violation found' } })).json.status).toBe('ACTIVE');
    expect((await c.req({ method: 'GET', url: '/v1/patients' })).status).toBe(200);
    const history = await tns.req({ method: 'GET', url: `/v1/admin/users/${p.userId}` });
    expect(history.json.events.map((e: { action: string }) => e.action)).toEqual(['REACTIVATE', 'SUSPEND']);
    const audit = await owner.query("select action from app.audit_log where entity_id = $1 and action like 'users.status.%' order by occurred_at", [p.userId]);
    expect(audit.rows.map((r) => r.action)).toEqual(['users.status.suspend', 'users.status.reactivate']);
  });

  it('a timed suspension lapses on its own', async () => {
    const p = await signUp(app, { role: 'PATIENT' });
    await suspend(tns, p.userId, { suspendedUntil: new Date(Date.now() + 60_000).toISOString() });
    await owner.query("update app.account_states set suspended_until = now() - interval '1 second' where user_id = $1", [p.userId]);
    const again = await signIn(app, p.email);
    const c = clientFor(app, again.cookie, p.userId, p.email);
    expect((await c.req({ method: 'GET', url: '/v1/me' })).json.account.status).toBe('ACTIVE');
    expect((await c.req({ method: 'GET', url: '/v1/patients' })).status).toBe(200);
  });

  it('nobody can act on their own account, and staff accounts need an ADMIN', async () => {
    expect((await suspend(admin, admin.userId)).status).toBe(422);
    const staff = await signUp(app);
    await grantRole(staff.userId, 'COMMERCE_MANAGER');
    const byTns = await suspend(tns, staff.userId);
    expect(byTns.status).toBe(403);
    expect(byTns.json.error.code).toBe('STAFF_TARGET_REQUIRES_ADMIN');
    expect((await suspend(admin, staff.userId)).status).toBe(200);
  });

  it('a suspended staff member loses their permissions in the database, not only in the API', async () => {
    const staff = await signUp(app);
    await grantRole(staff.userId, 'SUPPORT');
    await suspend(admin, staff.userId);
    const appPool = new pg.Pool({ connectionString: process.env.DATABASE_URL_APP });
    const cl = await appPool.connect();
    try {
      await cl.query('BEGIN');
      await cl.query("select set_config('app.user_id', $1, true)", [staff.userId]);
      const r = await cl.query("select app.has_permission('users.read') as ok, app.has_role('SUPPORT') as role");
      expect(r.rows[0]).toEqual({ ok: false, role: false });
    } finally {
      await cl.query('ROLLBACK');
      cl.release();
      await appPool.end();
    }
  });

  it('blocking requires a message for the person and an internal reason', async () => {
    const p = await signUp(app, { role: 'PATIENT' });
    expect((await tns.req({ method: 'POST', url: `/v1/admin/users/${p.userId}/status`, body: { action: 'BLOCK', reason: 'FRAUD_SUSPECTED', staffNote: 'Chargeback ring, case 77' } })).status).toBe(400);
    const ok = await tns.req({ method: 'POST', url: `/v1/admin/users/${p.userId}/status`, body: { action: 'BLOCK', reason: 'FRAUD_SUSPECTED', publicMessage: 'This account has been closed for security reasons.', staffNote: 'Chargeback ring, case 77' } });
    expect(ok.json.status).toBe('BLOCKED');
    const again = await signIn(app, p.email);
    const res = await clientFor(app, again.cookie, p.userId, p.email).req({ method: 'GET', url: '/v1/store/products' });
    expect(res.json.error.code).toBe('ACCOUNT_BLOCKED');
  });
});

describe('clinicians', () => {
  it('a booking restriction hides the clinician from discovery without suspending them, and needs a care-continuity note', async () => {
    const doc = await signUp(app, { role: 'DOCTOR' });
    await owner.query(
      `insert into app.provider_profiles (user_id, provider_type, display_name_ar, display_name_en, gender, specialty, years_experience, governorate, city, availability_status, verification_status, verified_at)
       values ($1, 'DOCTOR', 'د. اختبار', 'Dr. Restrict', 'FEMALE', 'DERMATOLOGY', 5, 'CAIRO', 'Cairo', 'ACCEPTING_NEW_PATIENTS', 'APPROVED', now())`,
      [doc.userId],
    );
    const patient = await signUp(app, { role: 'PATIENT' });
    const visible = async () => (await patient.req({ method: 'GET', url: `/v1/providers/${doc.userId}` })).status;
    expect(await visible()).toBe(200);

    const missing = await tns.req({ method: 'POST', url: `/v1/admin/users/${doc.userId}/status`, body: { action: 'RESTRICT_BOOKINGS', reason: 'CREDENTIAL_ISSUE', staffNote: 'Licence renewal pending' } });
    expect(missing.status).toBe(422);
    expect(missing.json.error.code).toBe('CARE_CONTINUITY_NOTE_REQUIRED');
    const ok = await tns.req({ method: 'POST', url: `/v1/admin/users/${doc.userId}/status`, body: { action: 'RESTRICT_BOOKINGS', reason: 'CREDENTIAL_ISSUE', staffNote: 'Licence renewal pending', careContinuityNote: 'No open bookings exist yet; existing patients keep their records.' } });
    expect(ok.json.status).toBe('ACTIVE');
    expect(await visible()).toBe(404);
    // The clinician still works normally (not suspended) and still sees their own profile.
    expect((await doc.req({ method: 'GET', url: '/v1/provider/me' })).status).toBe(200);

    await tns.req({ method: 'POST', url: `/v1/admin/users/${doc.userId}/status`, body: { action: 'LIFT_BOOKING_RESTRICTION', reason: 'RESOLVED', staffNote: 'Licence renewed and verified' } });
    expect(await visible()).toBe(200);
  });
});

describe('appeals', () => {
  it('the person can appeal once at a time; a different reviewer decides, and granting restores the account', async () => {
    const p = await signUp(app, { role: 'PATIENT' });
    await suspend(admin, p.userId);
    const again = await signIn(app, p.email);
    const c = clientFor(app, again.cookie, p.userId, p.email);
    const status = await c.req({ method: 'GET', url: '/v1/me/account-status' });
    expect(status.json.canAppeal).toBe(true);
    const appeal = await c.req({ method: 'POST', url: '/v1/me/appeals', body: { message: 'This was a misunderstanding — please review the thread.', eventId: status.json.events[0].id } });
    expect(appeal.status).toBe(201);
    expect((await c.req({ method: 'POST', url: '/v1/me/appeals', body: { message: 'Second appeal while the first is open' } })).status).toBe(409);

    // The admin who suspended cannot decide the appeal.
    const self = await admin.req({ method: 'POST', url: `/v1/admin/appeals/${appeal.json.id}/decision`, body: { decision: 'GRANTED', note: 'Reviewed the thread again' } });
    expect(self.status).toBe(403);
    expect(self.json.error.code).toBe('APPEAL_REVIEWER_MUST_DIFFER');
    const open = await admin2.req({ method: 'GET', url: '/v1/admin/appeals' });
    expect(open.json.some((a: { id: string }) => a.id === appeal.json.id)).toBe(true);
    const granted = await admin2.req({ method: 'POST', url: `/v1/admin/appeals/${appeal.json.id}/decision`, body: { decision: 'GRANTED', note: 'Context shows no violation' } });
    expect(granted.json.status).toBe('GRANTED');
    expect((await c.req({ method: 'GET', url: '/v1/me' })).json.account.status).toBe('ACTIVE');
    expect((await c.req({ method: 'GET', url: '/v1/patients' })).status).toBe(200);
  });

  it('an active, unrestricted person has nothing to appeal', async () => {
    const p = await signUp(app, { role: 'PATIENT' });
    expect((await p.req({ method: 'POST', url: '/v1/me/appeals', body: { message: 'Nothing to appeal here at all' } })).status).toBe(403);
  });
});
