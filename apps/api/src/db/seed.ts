/**
 * Development showcase seed — ENTIRELY SYNTHETIC.
 *
 * - Every row is flagged `is_demo = true`; emails use the reserved `.test` TLD.
 * - Credentials are issued by "Synthetic Demo Authority" with DEMO-* identifiers: they do not
 *   represent any real professional verification.
 * - TetraSol items are placeholders (slug `demo-*`, PENDING_APPROVAL) with no therapeutic claims;
 *   the real catalog must come from the brand owner.
 * - Refuses to run in production or when DEMO_MODE is not enabled.
 */
import pg from 'pg';
import { createAuth } from '../auth/auth';
import { loadEnv } from '../config/env';
import { createMessaging } from '../integrations/messaging';
import { createPools } from './client';

export const DEMO_PASSWORD = 'DressMyWound-Demo-2026';
export const DEMO_ACCOUNTS = {
  patient: { email: 'patient.demo@demo.ghayarly.test', name: 'Salma Hassan' },
  doctor: { email: 'doctor.demo@demo.ghayarly.test', name: 'Dr. Ahmed Fathy' },
  nurse: { email: 'nurse.demo@demo.ghayarly.test', name: 'Mariam Adel' },
  admin: { email: 'admin.demo@demo.ghayarly.test', name: 'Platform Admin' },
  pendingDoctor: { email: 'doctor.pending@demo.ghayarly.test', name: 'Dr. Karim Nabil' },
  pendingNurse: { email: 'nurse.pending@demo.ghayarly.test', name: 'Hoda Samir' },
} as const;

const CENTROIDS: Record<string, [number, number]> = {
  CAIRO: [31.2357, 30.0444],
  GIZA: [31.2109, 30.0131],
  ALEXANDRIA: [29.9187, 31.2001],
  QALYUBIA: [31.2422, 30.1792],
  DAKAHLIA: [31.3807, 31.0409],
};

type ProviderSeed = {
  key: string;
  type: 'DOCTOR' | 'NURSE';
  nameAr: string;
  nameEn: string;
  gender: 'FEMALE' | 'MALE';
  specialty?: string;
  subspecialty?: string;
  years: number;
  governorate: keyof typeof CENTROIDS;
  city: string;
  affiliation: string;
  feeEgp: number;
  availability: string;
  status: 'APPROVED' | 'SUBMITTED';
  completedVisits?: number;
  awayDays?: number;
  bioEn: string;
  bioAr: string;
  skills?: string[];
};

const LISTED_PROVIDERS: ProviderSeed[] = [
  { key: 'd1', type: 'DOCTOR', nameAr: 'د. منى الشريف', nameEn: 'Dr. Mona El-Sherif', gender: 'FEMALE', specialty: 'DERMATOLOGY', subspecialty: 'Chronic wounds', years: 14, governorate: 'CAIRO', city: 'Heliopolis', affiliation: 'Demo Clinic Heliopolis', feeEgp: 600, availability: 'ACCEPTING_NEW_PATIENTS', status: 'APPROVED', completedVisits: 0, bioEn: 'Synthetic demo profile. Focus on chronic wound follow-up.', bioAr: 'ملف تجريبي مُصطنع. متابعة الجروح المزمنة.' },
  { key: 'd2', type: 'DOCTOR', nameAr: 'د. عمر رضوان', nameEn: 'Dr. Omar Radwan', gender: 'MALE', specialty: 'VASCULAR_SURGERY', years: 19, governorate: 'CAIRO', city: 'Maadi', affiliation: 'Demo Vascular Center', feeEgp: 900, availability: 'FULLY_BOOKED', status: 'APPROVED', bioEn: 'Synthetic demo profile. Diabetic foot and vascular care.', bioAr: 'ملف تجريبي مُصطنع. القدم السكري ورعاية الأوعية.' },
  { key: 'd3', type: 'DOCTOR', nameAr: 'د. ليلى منصور', nameEn: 'Dr. Laila Mansour', gender: 'FEMALE', specialty: 'ENDOCRINOLOGY', years: 11, governorate: 'GIZA', city: 'Sheikh Zayed', affiliation: 'Demo Diabetes Clinic', feeEgp: 700, availability: 'LIMITED_AVAILABILITY', status: 'APPROVED', bioEn: 'Synthetic demo profile. Diabetes care programs.', bioAr: 'ملف تجريبي مُصطنع. برامج رعاية السكري.' },
  { key: 'd4', type: 'DOCTOR', nameAr: 'د. حسام عبد الله', nameEn: 'Dr. Hossam Abdallah', gender: 'MALE', specialty: 'PLASTIC_SURGERY', years: 16, governorate: 'ALEXANDRIA', city: 'Smouha', affiliation: 'Demo Reconstructive Unit', feeEgp: 850, availability: 'AWAY', awayDays: 10, status: 'APPROVED', bioEn: 'Synthetic demo profile. Burns and reconstructive care.', bioAr: 'ملف تجريبي مُصطنع. الحروق والجراحات الترميمية.' },
  { key: 'd5', type: 'DOCTOR', nameAr: 'د. سارة فؤاد', nameEn: 'Dr. Sara Fouad', gender: 'FEMALE', specialty: 'GERIATRICS', years: 9, governorate: 'CAIRO', city: 'Nasr City', affiliation: 'Demo Elderly Care Practice', feeEgp: 500, availability: 'ACCEPTING_NEW_PATIENTS', status: 'APPROVED', bioEn: 'Synthetic demo profile. Home-based elderly care.', bioAr: 'ملف تجريبي مُصطنع. رعاية كبار السن في المنزل.' },
  { key: 'd6', type: 'DOCTOR', nameAr: 'د. يوسف كامل', nameEn: 'Dr. Youssef Kamel', gender: 'MALE', specialty: 'INTERNAL_MEDICINE', years: 22, governorate: 'GIZA', city: 'Dokki', affiliation: 'Demo Internal Medicine', feeEgp: 650, availability: 'EXISTING_PATIENTS_ONLY', status: 'APPROVED', bioEn: 'Synthetic demo profile.', bioAr: 'ملف تجريبي مُصطنع.' },
  { key: 'n1', type: 'NURSE', nameAr: 'أمل يحيى', nameEn: 'Amal Yehia', gender: 'FEMALE', years: 8, governorate: 'CAIRO', city: 'Nasr City', affiliation: 'Demo Home Nursing', feeEgp: 300, availability: 'AVAILABLE_TODAY', status: 'APPROVED', bioEn: 'Synthetic demo profile. Wound dressing and post-op care.', bioAr: 'ملف تجريبي مُصطنع. الغيار على الجروح ورعاية ما بعد العمليات.', skills: ['Wound care', 'Vital signs'] },
  { key: 'n2', type: 'NURSE', nameAr: 'محمود سعيد', nameEn: 'Mahmoud Said', gender: 'MALE', years: 6, governorate: 'CAIRO', city: 'Maadi', affiliation: 'Demo Home Nursing', feeEgp: 280, availability: 'SCHEDULED_ONLY', status: 'APPROVED', bioEn: 'Synthetic demo profile. Elderly and chronic care.', bioAr: 'ملف تجريبي مُصطنع. رعاية المسنين والأمراض المزمنة.', skills: ['Elderly care'] },
  { key: 'n3', type: 'NURSE', nameAr: 'رانيا عادل', nameEn: 'Rania Adel', gender: 'FEMALE', years: 12, governorate: 'GIZA', city: 'Mohandessin', affiliation: 'Demo Nursing Team', feeEgp: 350, availability: 'FULLY_BOOKED', status: 'APPROVED', bioEn: 'Synthetic demo profile.', bioAr: 'ملف تجريبي مُصطنع.', skills: ['Diabetic care'] },
];

const SERVICES = [
  { code: 'BP_CHECK', ar: 'قياس ضغط الدم', en: 'Blood pressure measurement', min: 20, egp: 150, auth: false, sAr: 'قياس الضغط والنبض وتسجيلهما. لا يشمل تعديل العلاج.', sEn: 'Measure and record blood pressure and pulse. Does not include treatment changes.' },
  { code: 'GLUCOSE_CHECK', ar: 'قياس السكر', en: 'Blood glucose measurement', min: 20, egp: 150, auth: false, sAr: 'قياس سكر الدم بجهاز معتمد وتسجيله.', sEn: 'Capillary glucose measurement with an approved meter, recorded to the chart.' },
  { code: 'WOUND_DRESSING', ar: 'غيار على الجروح', en: 'Wound dressing', min: 45, egp: 350, auth: false, sAr: 'تنظيف الجرح وتغيير الضماد وفق خطة الرعاية وتوثيق حالته.', sEn: 'Wound cleansing and dressing change per the care plan, with documentation.' },
  { code: 'POST_OP_WOUND_CARE', ar: 'رعاية جروح ما بعد العمليات', en: 'Post-operative wound care', min: 60, egp: 450, auth: true, sAr: 'رعاية جرح جراحي وفق تعليمات الجراح المكتوبة.', sEn: 'Surgical wound care following the surgeon’s written instructions.' },
  { code: 'INJECTION', ar: 'إعطاء الحقن', en: 'Injection administration', min: 20, egp: 120, auth: true, sAr: 'إعطاء حقن موصوفة فقط بوجود وصفة طبية سارية.', sEn: 'Administer prescribed injections only with a valid prescription.' },
  { code: 'ELDERLY_CARE', ar: 'رعاية كبار السن', en: 'Elderly care visit', min: 120, egp: 600, auth: false, sAr: 'متابعة العلامات الحيوية والمساعدة في الرعاية اليومية.', sEn: 'Vital-sign monitoring and support with daily care.' },
  { code: 'CHRONIC_MONITORING', ar: 'متابعة الأمراض المزمنة', en: 'Chronic disease monitoring', min: 45, egp: 300, auth: false, sAr: 'متابعة دورية وفق خطة يضعها الطبيب.', sEn: 'Periodic monitoring according to a physician-defined plan.' },
  { code: 'HOME_NURSING', ar: 'تمريض منزلي', en: 'Home nursing (half day)', min: 240, egp: 900, auth: true, sAr: 'رعاية تمريضية منزلية لفترة محددة وفق خطة رعاية.', sEn: 'Home nursing block according to a care plan.' },
  { code: 'CUSTOM_REQUEST', ar: 'طلب تمريض خاص', en: 'Custom nursing request', min: 60, egp: 400, auth: true, sAr: 'طلب خاص يراجعه فريقنا الإكلينيكي قبل التأكيد.', sEn: 'Special request reviewed by our clinical team before confirmation.' },
];

const DEMO_PRODUCTS = [
  { slug: 'demo-tetrasol-placeholder-a', letterEn: 'A', letterAr: 'أ', variants: [{ en: 'Demo option 1', ar: 'خيار تجريبي ١', egp: 120, stock: 'IN_STOCK' }, { en: 'Demo option 2', ar: 'خيار تجريبي ٢', egp: 210, stock: 'LOW_STOCK' }] },
  { slug: 'demo-tetrasol-placeholder-b', letterEn: 'B', letterAr: 'ب', variants: [{ en: 'Demo option 1', ar: 'خيار تجريبي ١', egp: 95, stock: 'IN_STOCK' }] },
  { slug: 'demo-tetrasol-placeholder-c', letterEn: 'C', letterAr: 'ج', variants: [{ en: 'Demo option 1', ar: 'خيار تجريبي ١', egp: 260, stock: 'OUT_OF_STOCK' }] },
];

/** Records synthetic consent events (source `seed`) at the current document versions. */
export async function grantSeedConsents(client: pg.PoolClient | pg.Pool, userId: string, includeHealthData: boolean) {
  const { rows } = await client.query<{ value: Record<string, string> }>(`select value from app.settings where key = 'consent.current_versions'`);
  const versions = rows[0]!.value;
  const types = ['TERMS_OF_SERVICE', 'PRIVACY_POLICY', ...(includeHealthData ? ['HEALTH_DATA_PROCESSING'] : [])];
  for (const t of types) {
    await client.query(`insert into app.consent_events (user_id, consent_type, document_version, granted, source, locale) values ($1, $2, $3, true, 'seed', 'ar')`, [userId, t, versions[t]]);
  }
}

export async function seed(log: (line: string) => void = console.log) {
  const env = loadEnv();
  if (env.NODE_ENV === 'production') throw new Error('Refusing to seed synthetic data in production');
  if (!env.DEMO_MODE) throw new Error('Refusing to seed: DEMO_MODE must be true');
  if (!env.DATABASE_URL_OWNER) throw new Error('DATABASE_URL_OWNER is required for seeding');

  const pools = createPools(env);
  const owner = new pg.Pool({ connectionString: env.DATABASE_URL_OWNER });
  const auth = createAuth(env, pools.authPool, createMessaging(env, () => undefined));

  const ensureUser = async (email: string, name: string, password: string | null): Promise<string> => {
    const existing = await owner.query<{ id: string }>('select id from auth."user" where email = $1', [email]);
    if (existing.rows[0]) return existing.rows[0].id;
    if (password) {
      const res = await auth.api.signUpEmail({ body: { email, password, name } });
      await owner.query('update auth."user" set "emailVerified" = true where id = $1', [res.user.id]);
      return res.user.id;
    }
    // Listing-only synthetic providers: an identity row without any credential → cannot sign in.
    const id = `demo-${email.split('@')[0]}`;
    await owner.query('insert into auth."user" (id, name, email, "emailVerified") values ($1, $2, $3, false)', [id, name, email]);
    return id;
  };

  const client = await owner.connect();
  try {
    const ids: Record<keyof typeof DEMO_ACCOUNTS, string> = {} as never;
    for (const [key, acct] of Object.entries(DEMO_ACCOUNTS) as [keyof typeof DEMO_ACCOUNTS, { email: string; name: string }][]) {
      ids[key] = await ensureUser(acct.email, acct.name, DEMO_PASSWORD);
    }

    await client.query('BEGIN');
    const already = await client.query('select 1 from app.user_profiles where user_id = $1', [ids.patient]);
    if (already.rowCount) {
      await client.query('ROLLBACK');
      log('✓ demo data already present (run `pnpm db:reset` to rebuild)');
      return;
    }

    const role = (userId: string, r: string) =>
      client.query('insert into app.user_roles (user_id, role, granted_by_user_id) values ($1, $2, $1) on conflict do nothing', [userId, r]);
    const profile = (userId: string, name: string, activeRole: string, locale = 'ar') =>
      client.query(
        `insert into app.user_profiles (user_id, display_name, locale, active_role, onboarding_completed_at, is_demo)
         values ($1, $2, $3, $4, now(), true) on conflict (user_id) do nothing`,
        [userId, name, locale, activeRole],
      );

    // ---------------------------------------------------------------- accounts & roles
    await role(ids.patient, 'PATIENT');
    await profile(ids.patient, 'سلمى', 'PATIENT');
    await role(ids.doctor, 'DOCTOR');
    await profile(ids.doctor, 'د. أحمد فتحي', 'DOCTOR');
    await role(ids.nurse, 'NURSE');
    await profile(ids.nurse, 'مريم عادل', 'NURSE');
    await role(ids.admin, 'ADMIN');
    await role(ids.admin, 'CLINICAL_REVIEWER');
    await profile(ids.admin, 'Platform Admin', 'ADMIN', 'en');
    await role(ids.pendingDoctor, 'DOCTOR');
    await profile(ids.pendingDoctor, 'د. كريم نبيل', 'DOCTOR');
    await role(ids.pendingNurse, 'NURSE');
    await profile(ids.pendingNurse, 'هدى سمير', 'NURSE');

    // ---------------------------------------------------------------- consents (synthetic accounts accepted the draft documents)
    for (const userId of Object.values(ids)) await grantSeedConsents(client, userId, userId === ids.patient);

    // ---------------------------------------------------------------- patient & family
    const createPatient = async (p: { name: string; dob: string; sex: string; rel: string; level: string; basis: string; blood?: string; gov?: string; city?: string; self?: boolean }) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into app.patients (display_name, date_of_birth, sex, blood_type, blood_type_provenance, governorate, city, created_by_user_id, linked_user_id, is_demo, baseline_completed_at,
           emergency_contact_name, emergency_contact_phone, emergency_contact_relation, phone)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11, $12, $13, $14) returning id`,
        [
          p.name, p.dob, p.sex, p.blood ?? 'UNKNOWN', p.blood ? (p.self ? 'PATIENT_REPORTED' : 'CAREGIVER_REPORTED') : null,
          p.gov ?? null, p.city ?? null, ids.patient, p.self ? ids.patient : null, p.self ? new Date().toISOString() : null,
          p.self ? 'Khaled (demo)' : null, p.self ? '+201000000001' : null, p.self ? 'Brother' : null, p.self ? '+201000000000' : null,
        ],
      );
      const id = rows[0]!.id;
      await client.query(
        `insert into app.patient_access (patient_id, user_id, relationship, access_level, consent_basis, consent_statement_version, granted_by_user_id)
         values ($1, $2, $3, $4, $5, 'family-consent-v1', $2)`,
        [id, ids.patient, p.rel, p.level, p.basis],
      );
      return id;
    };
    const selfId = await createPatient({ name: 'سلمى حسن', dob: '1988-04-12', sex: 'FEMALE', rel: 'SELF', level: 'OWNER', basis: 'SELF', blood: 'O+', gov: 'CAIRO', city: 'Nasr City', self: true });
    const motherId = await createPatient({ name: 'نادية (الأم)', dob: '1956-09-03', sex: 'FEMALE', rel: 'MOTHER', level: 'CAREGIVER', basis: 'ADULT_CONSENT_ATTESTED', gov: 'CAIRO', city: 'Heliopolis' });
    const entry = (patientId: string, kind: string, title: string, note: string | null, provenance: string) =>
      client.query(
        `insert into app.patient_health_entries (patient_id, kind, title, note, provenance, recorded_by_user_id) values ($1, $2, $3, $4, $5, $6)`,
        [patientId, kind, title, note, provenance, ids.patient],
      );
    await entry(selfId, 'ALLERGY', 'Penicillin', 'Rash (self-reported)', 'PATIENT_REPORTED');
    await entry(motherId, 'CONDITION', 'Type 2 diabetes', 'Since 2015', 'CAREGIVER_REPORTED');
    await entry(motherId, 'MEDICATION', 'Metformin', '500 mg twice daily (as reported)', 'CAREGIVER_REPORTED');
    await entry(motherId, 'CONDITION', 'Hypertension', null, 'CAREGIVER_REPORTED');

    // ---------------------------------------------------------------- nursing service catalog (demo prices)
    const serviceIds: Record<string, string> = {};
    for (const [i, s] of SERVICES.entries()) {
      const { rows } = await client.query<{ id: string }>(
        `insert into app.nursing_services (code, name_ar, name_en, description_ar, description_en, scope_ar, scope_en, duration_minutes, base_price_piasters, requires_clinical_authorization, sort_order, is_demo)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true) returning id`,
        [s.code, s.ar, s.en, s.ar, s.en, s.sAr, s.sEn, s.min, s.egp * 100, s.auth, i * 10],
      );
      serviceIds[s.code] = rows[0]!.id;
    }

    // ---------------------------------------------------------------- providers
    const insertProvider = async (userId: string, p: ProviderSeed) => {
      const [lng, lat] = CENTROIDS[p.governorate]!;
      await client.query(
        `insert into app.provider_profiles (user_id, provider_type, display_name_ar, display_name_en, gender, specialty, subspecialty, years_experience,
           bio_ar, bio_en, current_affiliation, skills, governorate, city, service_area, fee_piasters, verification_status, submitted_at, verified_at, verified_by_user_id,
           availability_status, away_until, completed_visits, is_demo)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, ST_SetSRID(ST_MakePoint($15, $16), 4326)::geography, $17, $18,
           now() - interval '10 days', $19, $20, $21, $22, $23, true)`,
        [
          userId, p.type, p.nameAr, p.nameEn, p.gender, p.specialty ?? null, p.subspecialty ?? null, p.years, p.bioAr, p.bioEn, p.affiliation, p.skills ?? [],
          p.governorate, p.city, lng, lat, p.feeEgp * 100, p.status, p.status === 'APPROVED' ? new Date().toISOString() : null,
          p.status === 'APPROVED' ? ids.admin : null, p.availability,
          p.awayDays ? new Date(Date.now() + p.awayDays * 86400000).toISOString().slice(0, 10) : null, p.completedVisits ?? 0,
        ],
      );
      const kinds = p.type === 'DOCTOR' ? ['NATIONAL_ID', 'MEDICAL_LICENSE', 'MEDICAL_DEGREE'] : ['NATIONAL_ID', 'NURSING_LICENSE'];
      for (const [i, kind] of kinds.entries()) {
        await client.query(
          `insert into app.provider_credentials (provider_user_id, kind, issuer, identifier, issued_on, status, reviewed_by_user_id, reviewed_at)
           values ($1, $2, 'Synthetic Demo Authority', $3, '2015-06-01', $4, $5, $6)`,
          [userId, kind, `DEMO-${kind.slice(0, 3)}-${userId.slice(-4).toUpperCase()}${i}`, p.status === 'APPROVED' ? 'APPROVED' : 'PENDING',
            p.status === 'APPROVED' ? ids.admin : null, p.status === 'APPROVED' ? new Date().toISOString() : null],
        );
      }
      const hours = p.type === 'DOCTOR' ? [0, 1, 2, 3, 4].map((d) => [d, 17 * 60, 21 * 60]) : [6, 0, 1, 2, 3].map((d) => [d, 9 * 60, 17 * 60]);
      for (const [d, s, e] of hours) {
        await client.query('insert into app.provider_working_hours (provider_user_id, weekday, start_minute, end_minute) values ($1, $2, $3, $4)', [userId, d, s, e]);
      }
      if (p.type === 'NURSE') {
        for (const code of ['BP_CHECK', 'GLUCOSE_CHECK', 'WOUND_DRESSING', 'ELDERLY_CARE']) {
          await client.query('insert into app.provider_services (provider_user_id, service_id) values ($1, $2)', [userId, serviceIds[code]]);
        }
      }
    };

    await insertProvider(ids.doctor, { key: 'doctor', type: 'DOCTOR', nameAr: 'د. أحمد فتحي', nameEn: 'Dr. Ahmed Fathy', gender: 'MALE', specialty: 'GENERAL_SURGERY', subspecialty: 'Wound care & diabetic foot', years: 15, governorate: 'CAIRO', city: 'Nasr City', affiliation: 'Demo Surgical Center', feeEgp: 750, availability: 'ACCEPTING_NEW_PATIENTS', status: 'APPROVED', bioEn: 'Synthetic demo profile of a general surgeon focused on complex wounds.', bioAr: 'ملف تجريبي مُصطنع لجرّاح عام متخصص في الجروح المعقدة.' });
    await insertProvider(ids.nurse, { key: 'nurse', type: 'NURSE', nameAr: 'مريم عادل', nameEn: 'Mariam Adel', gender: 'FEMALE', years: 7, governorate: 'GIZA', city: 'Dokki', affiliation: 'Demo Home Nursing', feeEgp: 300, availability: 'AVAILABLE_TODAY', status: 'APPROVED', bioEn: 'Synthetic demo profile. Wound dressing and home visits.', bioAr: 'ملف تجريبي مُصطنع. الغيار على الجروح والزيارات المنزلية.', skills: ['Wound care', 'Vital signs', 'Diabetic care'] });
    await insertProvider(ids.pendingDoctor, { key: 'pd', type: 'DOCTOR', nameAr: 'د. كريم نبيل', nameEn: 'Dr. Karim Nabil', gender: 'MALE', specialty: 'GENERAL_SURGERY', years: 8, governorate: 'CAIRO', city: 'New Cairo', affiliation: 'Demo General Hospital', feeEgp: 500, availability: 'ACCEPTING_NEW_PATIENTS', status: 'SUBMITTED', bioEn: 'Synthetic demo submission awaiting review.', bioAr: 'طلب تجريبي مُصطنع في انتظار المراجعة.' });
    await insertProvider(ids.pendingNurse, { key: 'pn', type: 'NURSE', nameAr: 'هدى سمير', nameEn: 'Hoda Samir', gender: 'FEMALE', years: 4, governorate: 'CAIRO', city: 'Shubra', affiliation: 'Demo Nursing', feeEgp: 250, availability: 'SCHEDULED_ONLY', status: 'SUBMITTED', bioEn: 'Synthetic demo submission awaiting review.', bioAr: 'طلب تجريبي مُصطنع في انتظار المراجعة.' });
    for (const p of LISTED_PROVIDERS) {
      const userId = await ensureUser(`provider-${p.key}@demo.ghayarly.test`, p.nameEn, null);
      await insertProvider(userId, p);
    }

    // ---------------------------------------------------------------- demo nurse ledger (synthetic, flagged)
    const ledger = (amountEgp: number, status: string, daysAgo: number, type = 'VISIT_EARNING', description = 'Synthetic demo visit') =>
      client.query(
        `insert into app.provider_ledger_entries (provider_user_id, entry_type, status, amount_piasters, description, occurred_at, is_demo)
         values ($1, $2, $3, $4, $5, now() - ($6 || ' hours')::interval, true)`,
        [ids.nurse, type, status, Math.round(amountEgp * 100), description, String(daysAgo * 24)],
      );
    // Today: 3 completed visits, 2,350 EGP net (mirrors the product spec example).
    for (const [egp, hoursAgo] of [[750, 1], [600, 2], [1000, 3]] as const) {
      await client.query(
        `insert into app.provider_ledger_entries (provider_user_id, entry_type, status, amount_piasters, description, occurred_at, is_demo)
         values ($1, 'VISIT_EARNING', 'PENDING', $2, 'Synthetic demo visit', greatest(now() - ($3 || ' minutes')::interval, date_trunc('day', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo'), true)`,
        [ids.nurse, egp * 100, String(hoursAgo * 10)],
      );
    }
    for (const [egp, days] of [[1800, 8], [2200, 9], [1750, 10], [1500, 12], [1500, 13]] as const) await ledger(egp, 'AVAILABLE', days);
    await ledger(3200, 'PAID_OUT', 20);
    await ledger(-3200, 'PAID_OUT', 19, 'PAYOUT', 'Synthetic demo payout');

    // ---------------------------------------------------------------- TetraSol placeholders (NOT real products)
    for (const [i, p] of DEMO_PRODUCTS.entries()) {
      const { rows } = await client.query<{ id: string }>(
        `insert into app.products (slug, name_ar, name_en, summary_ar, summary_en, description_ar, description_en, usage_ar, usage_en, content_status, sort_order, is_demo)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING_APPROVAL', $10, true) returning id`,
        [
          p.slug,
          `TetraSol — عنصر تجريبي ${p.letterAr}`,
          `TetraSol — Demo item ${p.letterEn}`,
          'عنصر مُصطنع لتطوير الواجهة. ليس منتجًا حقيقيًا.',
          'Synthetic placeholder for interface development. Not a real product.',
          'هذا العنصر مُصطنع بالكامل. سيُستبدل بمعلومات المنتج المعتمدة من TetraSol. لا يتضمن أي ادعاء علاجي.',
          'This item is entirely synthetic. It will be replaced by brand-approved TetraSol product information. It makes no therapeutic claims.',
          'ستظهر تعليمات الاستخدام المعتمدة هنا عند توفيرها من العلامة التجارية.',
          'Approved usage instructions will appear here once provided by the brand.',
          i * 10,
        ],
      );
      for (const [j, v] of p.variants.entries()) {
        await client.query(
          `insert into app.product_variants (product_id, sku, label_ar, label_en, price_piasters, stock_status, sort_order) values ($1, $2, $3, $4, $5, $6, $7)`,
          [rows[0]!.id, `DEMO-${p.letterEn}-${j + 1}`, v.ar, v.en, v.egp * 100, v.stock, j],
        );
      }
    }

    await client.query('COMMIT');
    log('✓ synthetic demo data seeded');
    log(`  password for all demo accounts: ${DEMO_PASSWORD}`);
    for (const a of Object.values(DEMO_ACCOUNTS)) log(`  · ${a.email}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
    await owner.end();
    await pools.appPool.end();
    await pools.authPool.end();
  }
}

const isMain = /(^|[\\/])seed\.ts$/.test(process.argv[1] ?? '');
if (isMain) {
  seed().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
