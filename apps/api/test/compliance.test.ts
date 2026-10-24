/**
 * Store & healthcare compliance: explicit health-data consent (enforced in the database),
 * server-side feature flags with regulatory gating, review-account isolation, and in-app
 * account deletion with re-authentication.
 */
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, clientFor, createTestServer, grantConsents, grantRole, ownerPool, signIn, signUp, type Client } from './helpers';

let app: FastifyInstance;
let owner: pg.Pool;
let appPool: pg.Pool;

const SELF = { displayName: 'Self', dateOfBirth: '1990-01-01', sex: 'FEMALE', relationship: 'SELF', consentBasis: 'SELF', consentAttested: true, consentStatementVersion: 'v1' };
const MOTHER = { displayName: 'Mother', dateOfBirth: '1955-05-05', sex: 'FEMALE', relationship: 'MOTHER', consentBasis: 'ADULT_CONSENT_ATTESTED', consentAttested: true, consentStatementVersion: 'family-consent-v1' };

beforeAll(async () => {
  app = await createTestServer();
  owner = ownerPool();
  appPool = new pg.Pool({ connectionString: process.env.DATABASE_URL_APP });
});

afterAll(async () => {
  await appPool.end();
  await owner.end();
  await app.close();
});

describe('consents', () => {
  it('refuses writes until the current Terms and Privacy Policy are accepted (server-enforced)', async () => {
    const c = await signUp(app, { consents: false });
    const before = await c.req({ method: 'GET', url: '/v1/me/consents' });
    expect(before.status).toBe(200);
    expect(before.json.missingRequired).toEqual(['TERMS_OF_SERVICE', 'PRIVACY_POLICY']);
    // A deep link or another client cannot skip the consent screen: every write is refused…
    const role = await c.req({ method: 'POST', url: '/v1/me/roles', body: { role: 'PATIENT' } });
    expect(role.status).toBe(403);
    expect(role.json.error.code).toBe('CONSENT_REQUIRED');
    // …except answering the documents and deleting the account.
    await grantConsents(c, false);
    expect((await c.req({ method: 'POST', url: '/v1/me/roles', body: { role: 'PATIENT' } })).status).toBe(200);
  });

  it('blocks health data until explicit health-data consent is given (database-enforced)', async () => {
    const c = await signUp(app, { consents: false });
    await grantConsents(c, false);
    await c.req({ method: 'POST', url: '/v1/me/roles', body: { role: 'PATIENT' } });
    const before = await c.req({ method: 'GET', url: '/v1/me/consents' });
    expect(before.json.missingRequired).toEqual([]);
    expect(before.json.healthDataConsented).toBe(false);

    const denied = await c.req({ method: 'POST', url: '/v1/patients', body: SELF });
    expect(denied.status).toBe(403);
    expect(denied.json.error.code).toBe('HEALTH_DATA_CONSENT_REQUIRED');

    await grantConsents(c, true);
    const ok = await c.req({ method: 'POST', url: '/v1/patients', body: SELF });
    expect(ok.status).toBe(201);
  });

  it('rejects stale document versions and refuses to "withdraw" terms (that is account deletion)', async () => {
    const c = await signUp(app, { role: 'PATIENT' });
    const stale = await c.req({ method: 'POST', url: '/v1/me/consents', body: { consents: [{ type: 'PRIVACY_POLICY', version: 'old-1', granted: true }], source: 'ios', locale: 'ar' } });
    expect(stale.status).toBe(422);
    expect(stale.json.error.code).toBe('STALE_CONSENT_VERSION');
    const state = await c.req({ method: 'GET', url: '/v1/me/consents' });
    const terms = state.json.consents.find((x: { type: string }) => x.type === 'TERMS_OF_SERVICE');
    const withdraw = await c.req({ method: 'POST', url: '/v1/me/consents', body: { consents: [{ type: 'TERMS_OF_SERVICE', version: terms.currentVersion, granted: false }], source: 'ios', locale: 'ar' } });
    expect(withdraw.status).toBe(422);
    expect(withdraw.json.error.code).toBe('REQUIRED_CONSENT_USE_ACCOUNT_DELETION');
  });

  it('withdrawing health-data consent stops new health entries; history stays append-only', async () => {
    const c = await signUp(app, { role: 'PATIENT' });
    const p = await c.req({ method: 'POST', url: '/v1/patients', body: SELF });
    const earlier = await c.req({ method: 'POST', url: `/v1/patients/${p.json.id}/health-entries`, body: { kind: 'MEDICATION', title: 'Metformin' } });
    const state = await c.req({ method: 'GET', url: '/v1/me/consents' });
    const health = state.json.consents.find((x: { type: string }) => x.type === 'HEALTH_DATA_PROCESSING');
    const w = await c.req({ method: 'POST', url: '/v1/me/consents', body: { consents: [{ type: 'HEALTH_DATA_PROCESSING', version: health.currentVersion, granted: false }], source: 'android', locale: 'en' } });
    expect(w.status).toBe(200);
    expect(w.json.healthDataConsented).toBe(false);
    const entry = await c.req({ method: 'POST', url: `/v1/patients/${p.json.id}/health-entries`, body: { kind: 'ALLERGY', title: 'Penicillin' } });
    expect(entry.status).toBe(403);
    expect(entry.json.error.code).toBe('HEALTH_DATA_CONSENT_REQUIRED');
    // Editing the profile (blood type, contacts) stores health-context data as well.
    const edit = await c.req({ method: 'PATCH', url: `/v1/patients/${p.json.id}`, body: { bloodType: 'A+' } });
    expect(edit.status).toBe(403);
    expect(edit.json.error.code).toBe('HEALTH_DATA_CONSENT_REQUIRED');
    // Corrections stay possible: an earlier entry can still be marked entered-in-error.
    expect((await c.req({ method: 'DELETE', url: `/v1/patients/${p.json.id}/health-entries/${earlier.json.id}` })).status).toBeLessThan(300);
    // Ledger is append-only even for the application role.
    const cl = await appPool.connect();
    try {
      await cl.query('BEGIN');
      await cl.query("select set_config('app.user_id', $1, true)", [c.userId]);
      await expect(cl.query('update app.consent_events set granted = true where user_id = $1', [c.userId])).rejects.toThrow(/permission denied|append-only/);
      await cl.query('ROLLBACK');
      await cl.query('BEGIN');
      await cl.query("select set_config('app.user_id', $1, true)", [c.userId]);
      // Rewriting an entry's content without consent is refused by the database itself.
      await expect(cl.query('update app.patient_health_entries set title = $2 where patient_id = $1', [p.json.id, 'Changed'])).rejects.toThrow(/HEALTH_DATA_CONSENT_REQUIRED/);
    } finally {
      await cl.query('ROLLBACK');
      cl.release();
    }
  });
});

describe('feature flags', () => {
  it('exposes every regulated feature as OFF by default', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/system/features' });
    expect(res.statusCode).toBe(200);
    const flags = JSON.parse(res.body);
    expect(flags['ai.wound_assessment']).toBe(false);
    expect(flags['clinical.diagnostic_suggestions']).toBe(false);
    expect(Object.values(flags).every((v) => v === false)).toBe(true);
  });

  it('only admins manage flags, and HIGH-risk features need a regulatory evidence reference', async () => {
    const patient = await signUp(app, { role: 'PATIENT' });
    expect((await patient.req({ method: 'PATCH', url: '/v1/admin/features/ai.assistant', body: { enabled: true } })).status).toBe(403);

    const admin = await signUp(app, {});
    await grantRole(admin.userId, 'ADMIN');
    const noEvidence = await admin.req({ method: 'PATCH', url: '/v1/admin/features/ai.wound_assessment', body: { enabled: true } });
    expect(noEvidence.status).toBe(422);
    expect(noEvidence.json.error.code).toBe('REGULATORY_EVIDENCE_REQUIRED');

    // Low-risk-of-regulation flag toggles fine (and is audited).
    const ok = await admin.req({ method: 'PATCH', url: '/v1/admin/features/commerce.checkout', body: { enabled: true } });
    expect(ok.status).toBe(200);
    expect(ok.json.enabled).toBe(true);
    await admin.req({ method: 'PATCH', url: '/v1/admin/features/commerce.checkout', body: { enabled: false } });
    const audit = await owner.query(`select count(*)::int as n from app.audit_log where action = 'feature.flag.updated' and entity_id = 'commerce.checkout'`);
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(2);
    const by = await owner.query(`select updated_by_user_id from app.feature_flags where key = 'commerce.checkout'`);
    expect(by.rows[0].updated_by_user_id).toBe(admin.userId);

    // Even bypassing the API, the database refuses to enable a regulated feature without evidence.
    const cl = await appPool.connect();
    try {
      await cl.query('BEGIN');
      await cl.query("select set_config('app.user_id', $1, true)", [admin.userId]);
      await expect(cl.query(`update app.feature_flags set enabled = true where key = 'clinical.diagnostic_suggestions'`)).rejects.toThrow(/regulated_feature_needs_evidence/);
    } finally {
      await cl.query('ROLLBACK');
      cl.release();
    }
  });
});

describe('review account isolation', () => {
  it('review accounts see only synthetic catalogue rows; real accounts never see them', async () => {
    const real = await signUp(app, { role: 'DOCTOR', name: 'Real Doctor' });
    const reviewer = await signUp(app, { role: 'PATIENT', name: 'Store Reviewer' });
    const demoDoc = await signUp(app, { role: 'DOCTOR', name: 'Synthetic Doctor' });
    // Approve one real and one synthetic provider directly (owner).
    for (const [userId, demo] of [[real.userId, false], [demoDoc.userId, true]] as const) {
      await owner.query(
        `insert into app.provider_profiles (user_id, provider_type, display_name_ar, display_name_en, gender, specialty, years_experience, governorate, city, availability_status, verification_status, is_demo)
         values ($1, 'DOCTOR', 'طبيب', 'Doctor', 'MALE', 'DERMATOLOGY', 5, 'CAIRO', 'Cairo', 'ACCEPTING_NEW_PATIENTS', 'APPROVED', $2)`,
        [userId, demo],
      );
    }
    await owner.query(`update app.user_profiles set account_kind = 'REVIEW' where user_id = $1`, [reviewer.userId]);

    const visible = async (userId: string, demoMode: boolean) => {
      const cl = await appPool.connect();
      try {
        await cl.query('BEGIN');
        await cl.query("select set_config('app.user_id', $1, true), set_config('app.demo_mode', $2, true)", [userId, demoMode ? 'on' : 'off']);
        const { rows } = await cl.query<{ user_id: string }>('select user_id from app.provider_profiles where user_id = any($1)', [[real.userId, demoDoc.userId]]);
        return rows.map((r) => r.user_id).sort();
      } finally {
        await cl.query('ROLLBACK');
        cl.release();
      }
    };
    expect(await visible(reviewer.userId, false)).toEqual([demoDoc.userId]);
    expect(await visible(reviewer.userId, true)).toEqual([demoDoc.userId]);
    const outsider = await signUp(app, { role: 'PATIENT' });
    expect(await visible(outsider.userId, false)).toEqual([real.userId]);

    // The public TetraSol catalogue is not personal data: reviewers review what real users get.
    const slug = `review-visible-${Date.now()}`;
    await owner.query(
      `insert into app.products (slug, brand, name_ar, name_en, summary_ar, summary_en, description_ar, description_en, usage_ar, usage_en, content_status, approval_reference, approved_at, publication_status)
       values ($1, 'TetraSol', 'a','a','a','a','a','a','a','a', 'APPROVED', 'TEST-REF-1', now(), 'PUBLISHED')`,
      [slug],
    );
    const cl = await appPool.connect();
    try {
      await cl.query('BEGIN');
      await cl.query("select set_config('app.user_id', $1, true), set_config('app.demo_mode', 'off', true)", [reviewer.userId]);
      const { rows } = await cl.query('select slug from app.products where slug = $1', [slug]);
      expect(rows.length).toBe(1);
    } finally {
      await cl.query('ROLLBACK');
      cl.release();
    }
  });

  it('users cannot promote themselves to a review account', async () => {
    const c = await signUp(app, { role: 'PATIENT' });
    const cl = await appPool.connect();
    try {
      await cl.query('BEGIN');
      await cl.query("select set_config('app.user_id', $1, true)", [c.userId]);
      await expect(cl.query(`update app.user_profiles set account_kind = 'REVIEW' where user_id = $1`, [c.userId])).rejects.toThrow(/permission denied/);
    } finally {
      await cl.query('ROLLBACK');
      cl.release();
    }
  });
});

describe('account deletion', () => {
  it('requires typed confirmation and the current password', async () => {
    const c = await signUp(app, { role: 'PATIENT' });
    expect((await c.req({ method: 'POST', url: '/v1/me/account-deletion', body: { confirmation: 'nope', password: PASSWORD } })).status).toBe(400);
    const missing = await c.req({ method: 'POST', url: '/v1/me/account-deletion', body: { confirmation: 'DELETE' } });
    expect(missing.json.error.code).toBe('PASSWORD_REQUIRED');
    const wrong = await c.req({ method: 'POST', url: '/v1/me/account-deletion', body: { confirmation: 'DELETE', password: 'wrong-password-123' } });
    expect(wrong.status).toBe(403);
    expect(wrong.json.error.code).toBe('INVALID_PASSWORD');
    expect((await c.req({ method: 'GET', url: '/v1/me' })).status).toBe(200);
  });

  it('erases the user’s own health records, keeps shared profiles for others, revokes sessions and credentials', async () => {
    const holder = await signUp(app, { role: 'PATIENT', name: 'Leaving User' });
    const self = await holder.req({ method: 'POST', url: '/v1/patients', body: SELF });
    const mother = await holder.req({ method: 'POST', url: '/v1/patients', body: MOTHER });
    await holder.req({ method: 'POST', url: `/v1/patients/${self.json.id}/health-entries`, body: { kind: 'ALLERGY', title: 'Penicillin' } });

    // A second caregiver also manages the mother's profile → it must survive for them.
    const sibling = await signUp(app, { role: 'PATIENT', name: 'Sibling' });
    await owner.query(
      `insert into app.patient_access (patient_id, user_id, relationship, access_level, consent_basis, consent_statement_version, granted_by_user_id)
       values ($1, $2, 'MOTHER', 'CAREGIVER', 'ADULT_CONSENT_ATTESTED', 'family-consent-v1', $3)`,
      [mother.json.id, sibling.userId, holder.userId],
    );

    const res = await holder.req({ method: 'POST', url: '/v1/me/account-deletion', body: { confirmation: 'delete', password: PASSWORD } });
    expect(res.status).toBe(200);
    expect(res.json.deleted).toBe(true);
    expect(res.json.summary.deletedPatientProfiles).toBe(1);
    expect(res.json.summary.detachedSharedProfiles).toBe(1);

    // Session is gone, credentials no longer work.
    expect((await holder.req({ method: 'GET', url: '/v1/me' })).status).toBe(401);
    expect((await signIn(app, holder.email)).status).not.toBe(200);

    // Own health record deleted; shared profile kept and still reachable by the sibling.
    const remaining = await owner.query('select id from app.patients where id = any($1)', [[self.json.id, mother.json.id]]);
    expect(remaining.rows.map((r) => r.id)).toEqual([mother.json.id]);
    expect((await sibling.req({ method: 'GET', url: `/v1/patients/${mother.json.id}` })).status).toBe(200);
    const entries = await owner.query('select count(*)::int as n from app.patient_health_entries where patient_id = $1', [self.json.id]);
    expect(entries.rows[0].n).toBe(0);

    // Identity row is an anonymous tombstone; no secrets remain.
    const u = await owner.query('select name, email, "phoneNumber" from auth."user" where id = $1', [holder.userId]);
    expect(u.rows[0]).toEqual({ name: 'Deleted account', email: `deleted-${holder.userId}@deleted.invalid`, phoneNumber: null });
    const secrets = await owner.query(
      `select (select count(*) from auth."account" where "userId" = $1)::int + (select count(*) from auth."session" where "userId" = $1)::int as n`,
      [holder.userId],
    );
    expect(secrets.rows[0].n).toBe(0);
    const record = await owner.query('select status, method from app.account_deletions where user_id = $1', [holder.userId]);
    expect(record.rows[0]).toEqual({ status: 'COMPLETED', method: 'IN_APP' });
    const audit = await owner.query(`select count(*)::int as n from app.audit_log where action = 'account.deletion.completed' and entity_id = $1`, [holder.userId]);
    expect(audit.rows[0].n).toBe(1);
  });

  it('also erases profiles the user created and left earlier, and pending password-reset tokens', async () => {
    const c = await signUp(app, { role: 'PATIENT' });
    const mother = await c.req({ method: 'POST', url: '/v1/patients', body: MOTHER });
    await c.req({ method: 'POST', url: `/v1/patients/${mother.json.id}/health-entries`, body: { kind: 'ALLERGY', title: 'Latex' } });
    const left = await c.req({ method: 'DELETE', url: `/v1/patients/${mother.json.id}/access/${c.userId}` });
    expect(left.status).toBeLessThan(300);
    await owner.query(`insert into auth."verification" (id, identifier, value, "expiresAt") values ($1, $2, $3, now() + interval '30 minutes')`, [
      `v-${c.userId}`,
      `reset-password:tok-${c.userId}`,
      c.userId,
    ]);
    const res = await c.req({ method: 'POST', url: '/v1/me/account-deletion', body: { confirmation: 'DELETE', password: PASSWORD } });
    expect(res.status).toBe(200);
    expect(res.json.summary.deletedPatientProfiles).toBe(1);
    expect((await owner.query('select count(*)::int as n from app.patients where id = $1', [mother.json.id])).rows[0].n).toBe(0);
    expect((await owner.query(`select count(*)::int as n from auth."verification" where value = $1`, [c.userId])).rows[0].n).toBe(0);
  });

  it('a deleted account cannot be signed back into, and the email can be registered again', async () => {
    const c = await signUp(app, { role: 'PATIENT' });
    await c.req({ method: 'POST', url: '/v1/me/account-deletion', body: { confirmation: 'DELETE', password: PASSWORD } });
    const again = await signUp(app, { email: c.email, role: 'PATIENT' });
    expect(again.userId).not.toBe(c.userId);
    const stale = clientFor(app, c.cookie);
    expect((await stale.req({ method: 'GET', url: '/v1/me' })).status).toBe(401);
  });

  it('providers with financial ledger entries are suspended and scrubbed, records retained', async () => {
    const nurse: Client = await signUp(app, { role: 'NURSE', name: 'Nurse With Ledger' });
    await owner.query(
      `insert into app.provider_profiles (user_id, provider_type, display_name_ar, display_name_en, gender, years_experience, governorate, city, availability_status, verification_status, bio_en)
       values ($1, 'NURSE', 'ممرضة', 'Nurse', 'FEMALE', 3, 'CAIRO', 'Cairo', 'AVAILABLE_TODAY', 'APPROVED', 'Personal bio')`,
      [nurse.userId],
    );
    await owner.query(
      `insert into app.provider_ledger_entries (provider_user_id, entry_type, status, amount_piasters, description, occurred_at) values ($1, 'VISIT_EARNING', 'PAID_OUT', 10000, 'Visit', now())`,
      [nurse.userId],
    );
    await owner.query(`insert into app.provider_credentials (provider_user_id, kind, issuer, identifier, status) values ($1, 'NATIONAL_ID', 'Civil Registry', '29001011234567', 'APPROVED')`, [nurse.userId]);
    const res = await nurse.req({ method: 'POST', url: '/v1/me/account-deletion', body: { confirmation: 'DELETE', password: PASSWORD } });
    expect(res.status).toBe(200);
    expect(res.json.summary.providerRecordsRetainedForLegalObligations).toBe(true);
    const p = await owner.query('select verification_status, display_name_en, bio_en from app.provider_profiles where user_id = $1', [nurse.userId]);
    expect(p.rows[0]).toEqual({ verification_status: 'SUSPENDED', display_name_en: 'Deleted account', bio_en: null });
    const ledger = await owner.query('select count(*)::int as n from app.provider_ledger_entries where provider_user_id = $1', [nurse.userId]);
    expect(ledger.rows[0].n).toBe(1);
    // Identity documents (national ID / licence numbers) are not needed to keep payout records.
    const creds = await owner.query('select count(*)::int as n from app.provider_credentials where provider_user_id = $1', [nurse.userId]);
    expect(creds.rows[0].n).toBe(0);
  });
});
