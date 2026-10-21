/**
 * Provisions App Store / Google Play REVIEW accounts (Patient, Doctor, Nurse) — idempotent.
 *
 * Isolation (migration 0006): review accounts have account_kind = 'REVIEW'. Every patient and
 * clinician they see is synthetic (is_demo = true) and real users never see those rows; the public
 * catalogue (approved TetraSol products, nursing service types) is the same one real users see.
 * Review accounts may be deleted by reviewers (account deletion is part of review); re-run this
 * script to recreate them. Re-running also rotates the password and signs out old sessions.
 *
 * Usage (operator, with the OWNER database URL from the secret manager):
 *   REVIEW_ACCOUNT_PASSWORD='<strong unique password>' REVIEW_EMAIL_DOMAIN='review.example.com' \
 *     pnpm --filter @ghayarly/api review:seed [--confirm-production]
 *
 * Never commit the password. Give it to Apple/Google only through App Store Connect / Play Console.
 */
import pg from 'pg';
import { createAuth } from '../auth/auth';
import { loadEnv } from '../config/env';
import { createMessaging } from '../integrations/messaging';
import { createPools } from './client';
import { grantSeedConsents } from './seed';

const REVIEW = [
  { key: 'patient', local: 'review.patient', name: 'Review Patient', role: 'PATIENT' },
  { key: 'doctor', local: 'review.doctor', name: 'Review Doctor', role: 'DOCTOR' },
  { key: 'nurse', local: 'review.nurse', name: 'Review Nurse', role: 'NURSE' },
] as const;

export async function seedReviewAccounts(log: (line: string) => void = console.log) {
  // The server refuses to run in production with an owner URL; this operator script needs it, so
  // it is kept out of the validated server environment.
  const { DATABASE_URL_OWNER: ownerUrl, ...serverEnv } = process.env;
  const env = loadEnv(serverEnv);
  if (!ownerUrl) throw new Error('DATABASE_URL_OWNER is required');
  if (env.NODE_ENV === 'production' && !process.argv.includes('--confirm-production')) throw new Error('Refusing to touch production without --confirm-production');
  const password = process.env.REVIEW_ACCOUNT_PASSWORD ?? '';
  if (password.length < 16 || /demo|password|review/i.test(password)) throw new Error('REVIEW_ACCOUNT_PASSWORD must be ≥ 16 characters and not a guessable word');
  const domain = process.env.REVIEW_EMAIL_DOMAIN;
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) throw new Error('REVIEW_EMAIL_DOMAIN must be a domain the company controls (e.g. review.example.com)');

  const pools = createPools(env);
  const owner = new pg.Pool({ connectionString: ownerUrl });
  const auth = createAuth(env, pools.authPool, createMessaging(env, () => undefined));
  const ctx = await auth.$context;
  try {
    const ids: Record<string, string> = {};
    for (const a of REVIEW) {
      const email = `${a.local}@${domain}`;
      const existing = await owner.query<{ id: string; kind: string | null }>(
        'select u.id, p.account_kind::text as kind from auth."user" u left join app.user_profiles p on p.user_id = u.id where u.email = $1',
        [email],
      );
      let id = existing.rows[0]?.id;
      if (id && existing.rows[0]!.kind !== 'REVIEW') {
        // Someone registered this address first (the pattern is public). Never adopt that account.
        throw new Error(`${email} already belongs to a non-review account — use another REVIEW_EMAIL_DOMAIN or investigate`);
      }
      if (!id) {
        const res = await auth.api.signUpEmail({ body: { email, password, name: a.name } });
        id = res.user.id;
      } else {
        // Rotation: the credentials handed to Apple / Google must be the ones just provided.
        const hash = await ctx.password.hash(password);
        const updated = await owner.query(`update auth."account" set password = $2, "updatedAt" = now() where "userId" = $1 and "providerId" = 'credential'`, [id, hash]);
        if (!updated.rowCount) {
          await owner.query(`insert into auth."account" (id, "accountId", "providerId", "userId", password) values (gen_random_uuid()::text, $1, 'credential', $1, $2)`, [id, hash]);
        }
        await owner.query('delete from auth."session" where "userId" = $1', [id]);
      }
      await owner.query('update auth."user" set "emailVerified" = true where id = $1', [id]);
      await owner.query('insert into app.user_roles (user_id, role, granted_by_user_id) values ($1, $2, $1) on conflict do nothing', [id, a.role]);
      await owner.query(
        `insert into app.user_profiles (user_id, display_name, locale, active_role, onboarding_completed_at, is_demo, account_kind)
         values ($1, $2, 'en', $3, now(), true, 'REVIEW')
         on conflict (user_id) do update set account_kind = 'REVIEW', is_demo = true`,
        [id, a.name, a.role],
      );
      const consents = await owner.query('select 1 from app.consent_events where user_id = $1 limit 1', [id]);
      if (!consents.rowCount) await grantSeedConsents(owner, id, a.role === 'PATIENT');
      ids[a.key] = id;
      log(`✓ ${a.role.padEnd(7)} ${email}`);
    }

    // Synthetic, clearly-labelled clinician profiles for the reviewer doctor/nurse (approved so the
    // dashboards are populated; visible only to review accounts because is_demo = true).
    const provider = async (userId: string, type: 'DOCTOR' | 'NURSE') => {
      await owner.query(
        `insert into app.provider_profiles (user_id, provider_type, display_name_ar, display_name_en, gender, specialty, years_experience, governorate, city,
            availability_status, verification_status, verified_at, bio_en, bio_ar, is_demo)
         values ($1, $2, $3, $4, 'FEMALE', $5, 10, 'CAIRO', 'Cairo', $6, 'APPROVED', now(),
            'Synthetic review profile — not a real clinician.', 'ملف مراجعة مُصطنع — ليس مقدم رعاية حقيقيًا.', true)
         on conflict (user_id) do nothing`,
        [userId, type, type === 'DOCTOR' ? 'د. مراجعة' : 'ممرضة مراجعة', type === 'DOCTOR' ? 'Dr. Review' : 'Nurse Review', type === 'DOCTOR' ? 'DERMATOLOGY' : null, type === 'DOCTOR' ? 'ACCEPTING_NEW_PATIENTS' : 'AVAILABLE_TODAY'],
      );
    };
    await provider(ids.doctor!, 'DOCTOR');
    await provider(ids.nurse!, 'NURSE');
    log('✓ review accounts ready (account_kind = REVIEW; synthetic people only, password set)');
  } finally {
    await owner.end();
    await pools.appPool.end();
    await pools.authPool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedReviewAccounts().catch((err: Error) => {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  });
}
