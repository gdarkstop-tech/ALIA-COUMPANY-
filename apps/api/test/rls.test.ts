/**
 * Database-level security tests. These connect directly as the application role
 * (`ghayarly_app`) — exactly what the API uses — and prove that Row Level Security, column
 * privileges and guard triggers hold even if application code forgets a WHERE clause.
 */
import { ROLE_PERMISSIONS, ROLES, PERMISSIONS } from '@ghayarly/shared';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertRlsEffective } from '../src/db/client';
import { createTestServer, grantRole, ownerPool, signUp, type Client } from './helpers';

let app: FastifyInstance;
let appPool: pg.Pool;
let owner: pg.Pool;
let alice: Client;
let bob: Client;
let alicePatientId: string;

/** Run statements as ghayarly_app with a given request context, always rolled back. */
async function as<T>(userId: string | null, fn: (c: pg.PoolClient) => Promise<T>, demo = true): Promise<T> {
  const c = await appPool.connect();
  try {
    await c.query('BEGIN');
    await c.query("select set_config('app.user_id', $1, true), set_config('app.demo_mode', $2, true)", [userId ?? '', demo ? 'on' : 'off']);
    return await fn(c);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}

async function expectDenied(p: Promise<unknown>, code?: RegExp) {
  await expect(p).rejects.toThrow(code ?? /row-level security|permission denied|NOT_ALLOWED|FORBIDDEN|PROTECTED_FIELD|INVALID|STAFF_CANNOT/i);
}

beforeAll(async () => {
  app = await createTestServer();
  appPool = new pg.Pool({ connectionString: process.env.DATABASE_URL_APP });
  owner = ownerPool();
  alice = await signUp(app, { role: 'PATIENT', name: 'Alice' });
  bob = await signUp(app, { role: 'PATIENT', name: 'Bob' });
  const created = await alice.req({
    method: 'POST',
    url: '/v1/patients',
    body: { displayName: 'Alice', dateOfBirth: '1990-01-01', sex: 'FEMALE', relationship: 'SELF', consentBasis: 'SELF', consentAttested: true, consentStatementVersion: 'v1' },
  });
  alicePatientId = created.json.id;
});

afterAll(async () => {
  await appPool.end();
  await owner.end();
  await app.close();
});

describe('connection role', () => {
  it('the application role is not superuser, has no BYPASSRLS and owns no tables', async () => {
    await expect(assertRlsEffective(appPool)).resolves.toBeUndefined();
  });

  it('the server refuses to start if pointed at the owner role', async () => {
    await expect(assertRlsEffective(owner)).rejects.toThrow(/bypasses Row Level Security/);
  });

  it('cannot read Better Auth secrets (sessions, accounts, 2FA, password hashes)', async () => {
    await as(alice.userId, async (c) => {
      await expectDenied(c.query('select * from auth.session'), /permission denied/);
    });
    await as(alice.userId, async (c) => {
      await expectDenied(c.query('select password from auth.account'), /permission denied/);
    });
    await as(alice.userId, async (c) => {
      await expectDenied(c.query('select secret from auth."twoFactor"'), /permission denied/);
    });
    await as(alice.userId, async (c) => {
      await expectDenied(c.query('select "updatedAt" from auth."user"'), /permission denied/);
    });
  });

  it('sees only its own auth user row', async () => {
    const rows = await as(alice.userId, (c) => c.query('select id from auth."user"'));
    expect(rows.rows.map((r) => r.id)).toEqual([alice.userId]);
  });
});

describe('patient data isolation', () => {
  it('returns nothing without an authenticated context', async () => {
    const res = await as(null, (c) => c.query('select * from app.patients'));
    expect(res.rowCount).toBe(0);
  });

  it('another user cannot see, update or add records to a patient they are not authorized for', async () => {
    const seen = await as(bob.userId, (c) => c.query('select id from app.patients where id = $1', [alicePatientId]));
    expect(seen.rowCount).toBe(0);
    const updated = await as(bob.userId, (c) => c.query("update app.patients set display_name = 'pwned' where id = $1", [alicePatientId]));
    expect(updated.rowCount).toBe(0);
    await as(bob.userId, async (c) => {
      await expectDenied(
        c.query(
          "insert into app.patient_health_entries (patient_id, kind, title, provenance, recorded_by_user_id) values ($1, 'ALLERGY', 'x', 'PATIENT_REPORTED', $2)",
          [alicePatientId, bob.userId],
        ),
      );
    });
  });

  it('the API returns 404 (not 403) for patients the caller cannot see', async () => {
    const res = await bob.req({ method: 'GET', url: `/v1/patients/${alicePatientId}` });
    expect(res.status).toBe(404);
    const entries = await bob.req({ method: 'GET', url: `/v1/patients/${alicePatientId}/health-entries` });
    expect(entries.status).toBe(404);
  });

  it('cannot forge professional verification of a health entry', async () => {
    await as(alice.userId, async (c) => {
      await expectDenied(
        c.query(
          "insert into app.patient_health_entries (patient_id, kind, title, provenance, recorded_by_user_id, verified_by_user_id, verified_at) values ($1, 'ALLERGY', 'x', 'PROFESSIONALLY_VERIFIED', $2, $2, now())",
          [alicePatientId, alice.userId],
        ),
      );
    });
  });

  it('cannot grant itself access to someone else’s patient', async () => {
    await as(bob.userId, async (c) => {
      await expectDenied(
        c.query(
          "insert into app.patient_access (patient_id, user_id, relationship, access_level, consent_basis, consent_statement_version, granted_by_user_id) values ($1, $2, 'OTHER', 'CAREGIVER', 'ADULT_CONSENT_ATTESTED', 'v1', $2)",
          [alicePatientId, bob.userId],
        ),
      );
    });
  });

  it('cannot hard-delete medical records', async () => {
    await as(alice.userId, async (c) => {
      await expectDenied(c.query('delete from app.patient_health_entries where patient_id = $1', [alicePatientId]), /permission denied/);
    });
    await as(alice.userId, async (c) => {
      await expectDenied(c.query('delete from app.patients where id = $1', [alicePatientId]), /permission denied/);
    });
  });
});

describe('roles and permissions', () => {
  it('a user cannot self-assign an internal role', async () => {
    await as(bob.userId, async (c) => {
      await expectDenied(c.query("insert into app.user_roles (user_id, role, granted_by_user_id) values ($1, 'ADMIN', $1)", [bob.userId]));
    });
  });

  it('a user cannot assign roles to another user', async () => {
    await as(bob.userId, async (c) => {
      await expectDenied(c.query("insert into app.user_roles (user_id, role, granted_by_user_id) values ($1, 'PATIENT', $2)", [alice.userId, bob.userId]));
    });
  });

  it('SQL permission matrix matches the shared TypeScript matrix', async () => {
    const mismatches: string[] = [];
    for (const role of ROLES) {
      for (const permission of PERMISSIONS) {
        const { rows } = await owner.query<{ ok: boolean }>('select app.role_has_permission($1::app.role, $2) as ok', [role, permission]);
        const expected = ROLE_PERMISSIONS[role].includes(permission);
        if (rows[0]!.ok !== expected) mismatches.push(`${role}:${permission}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('audit log is append-only and readable only with audit.read', async () => {
    const own = await as(alice.userId, (c) => c.query('select count(*)::int as n from app.audit_log'));
    expect(own.rows[0].n).toBe(0);
    await as(alice.userId, async (c) => {
      await expectDenied(c.query("insert into app.audit_log (actor_user_id, action, entity_type) values ($1, 'forged.action', 'x')", [bob.userId]));
    });
    await expect(owner.query("update app.audit_log set action = 'tampered.action'")).rejects.toThrow(/append-only/);
  });
});

describe('provider verification guardrails', () => {
  let doc: Client;
  beforeAll(async () => {
    doc = await signUp(app, { role: 'DOCTOR' });
    await doc.req({
      method: 'PUT',
      url: '/v1/provider/me',
      body: { providerType: 'DOCTOR', displayNameAr: 'د. تجربة', displayNameEn: 'Dr. Test', gender: 'FEMALE', specialty: 'DERMATOLOGY', yearsExperience: 5, governorate: 'CAIRO', city: 'Zamalek' },
    });
  });

  it('a provider cannot approve or verify themselves', async () => {
    await as(doc.userId, async (c) => {
      await expectDenied(c.query("update app.provider_profiles set verification_status = 'APPROVED' where user_id = $1", [doc.userId]), /INVALID_VERIFICATION_TRANSITION/);
    });
    await as(doc.userId, async (c) => {
      await expectDenied(c.query('update app.provider_profiles set completed_visits = 999 where user_id = $1', [doc.userId]), /PROTECTED_FIELD/);
    });
    await as(doc.userId, async (c) => {
      await expectDenied(
        c.query("insert into app.provider_verification_events (provider_user_id, to_status) values ($1, 'APPROVED')", [doc.userId]),
        /permission denied/,
      );
    });
  });

  it('unverified providers are invisible to patients', async () => {
    const res = await as(alice.userId, (c) => c.query('select user_id from app.provider_profiles where user_id = $1', [doc.userId]));
    expect(res.rowCount).toBe(0);
  });

  it('credentials (licence numbers) are not readable by patients', async () => {
    await doc.req({ method: 'POST', url: '/v1/provider/me/credentials', body: { kind: 'MEDICAL_LICENSE', issuer: 'Authority', identifier: 'LIC-1' } });
    const res = await as(alice.userId, (c) => c.query('select identifier from app.provider_credentials where provider_user_id = $1', [doc.userId]));
    expect(res.rowCount).toBe(0);
  });

  it('support staff can review but not decide', async () => {
    const support = await signUp(app);
    await grantRole(support.userId, 'SUPPORT');
    await as(support.userId, async (c) => {
      const visible = await c.query('select user_id from app.provider_profiles where user_id = $1', [doc.userId]);
      expect(visible.rowCount).toBe(1);
    });
    await as(support.userId, async (c) => {
      const res = await c.query("update app.provider_profiles set verification_status = 'UNDER_REVIEW' where user_id = $1", [doc.userId]);
      expect(res.rowCount).toBe(0);
    });
  });

  it('the app role cannot write ledger entries', async () => {
    await as(doc.userId, async (c) => {
      await expectDenied(
        c.query("insert into app.provider_ledger_entries (provider_user_id, entry_type, status, amount_piasters, description) values ($1, 'VISIT_EARNING', 'AVAILABLE', 100000, 'x')", [doc.userId]),
        /permission denied/,
      );
    });
  });
});

describe('TetraSol-only commerce', () => {
  it('rejects any non-TetraSol product, even from a commerce manager', async () => {
    const cm = await signUp(app);
    await grantRole(cm.userId, 'COMMERCE_MANAGER');
    await as(cm.userId, async (c) => {
      await expect(
        c.query(
          "insert into app.products (slug, brand, name_ar, name_en, summary_ar, summary_en, description_ar, description_en, usage_ar, usage_en) values ('other-brand', 'OtherBrand', 'a','a','a','a','a','a','a','a')",
        ),
      ).rejects.toThrow(/check constraint/);
    });
  });

  it('cannot mark a product APPROVED without a brand approval reference', async () => {
    await expect(
      owner.query(
        "insert into app.products (slug, name_ar, name_en, summary_ar, summary_en, description_ar, description_en, usage_ar, usage_en, content_status) values ('no-ref', 'a','a','a','a','a','a','a','a','APPROVED')",
      ),
    ).rejects.toThrow(/approved_requires_reference/);
  });

  it('demo products are never visible outside demo mode', async () => {
    await owner.query(
      "insert into app.products (slug, name_ar, name_en, summary_ar, summary_en, description_ar, description_en, usage_ar, usage_en, is_demo) values ('demo-rls-check', 'a','a','a','a','a','a','a','a', true) on conflict do nothing",
    );
    const inDemo = await as(alice.userId, (c) => c.query("select slug from app.products where slug = 'demo-rls-check'"), true);
    const outOfDemo = await as(alice.userId, (c) => c.query("select slug from app.products where slug = 'demo-rls-check'"), false);
    expect(inDemo.rowCount).toBe(1);
    expect(outOfDemo.rowCount).toBe(0);
  });

  it('a demo product can never be flagged as brand-approved', async () => {
    await expect(
      owner.query(
        "insert into app.products (slug, name_ar, name_en, summary_ar, summary_en, description_ar, description_en, usage_ar, usage_en, is_demo, content_status, approval_reference, approved_at) values ('demo-fake-approved', 'a','a','a','a','a','a','a','a', true, 'APPROVED', 'REF', now())",
      ),
    ).rejects.toThrow(/demo_items_identifiable/);
  });
});
