/**
 * Drizzle table definitions used for type-safe querying. The SQL migrations in
 * apps/api/db/migrations are the source of truth (including RLS, triggers and grants);
 * these definitions must mirror them. Never use drizzle-kit push against a real database.
 */
import { sql } from 'drizzle-orm';
import { boolean, customType, date, integer, jsonb, pgSchema, primaryKey, smallint, text, uuid } from 'drizzle-orm/pg-core';

export const authSchema = pgSchema('auth');
export const appSchema = pgSchema('app');

/** Normalises PostgreSQL `timestamptz` text output ("2026-10-14 08:08:47.9+00") to ISO-8601. */
export function toIsoTimestamp(value: string): string {
  const normalised = value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  const d = new Date(normalised);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

const timestamptz = customType<{ data: string; driverData: string }>({
  dataType: () => 'timestamp with time zone',
  fromDriver: (value) => toIsoTimestamp(String(value)),
  toDriver: (value) => value,
});
const ts = (name: string) => timestamptz(name);

// ------------------------------------------------------------------ enums
export const roleEnum = appSchema.enum('role', ['PATIENT', 'DOCTOR', 'NURSE', 'ADMIN', 'CLINICAL_REVIEWER', 'SUPPORT', 'TRUST_AND_SAFETY', 'COMMERCE_MANAGER']);
export const localeEnum = appSchema.enum('locale', ['ar', 'en']);
export const sexEnum = appSchema.enum('sex', ['FEMALE', 'MALE', 'UNSPECIFIED']);
export const genderEnum = appSchema.enum('gender', ['FEMALE', 'MALE']);
export const bloodTypeEnum = appSchema.enum('blood_type', ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'UNKNOWN']);
export const provenanceEnum = appSchema.enum('provenance', ['PATIENT_REPORTED', 'CAREGIVER_REPORTED', 'PROFESSIONALLY_VERIFIED', 'IMPORTED_DOCUMENT']);
export const governorateEnum = appSchema.enum('governorate', ['CAIRO', 'GIZA', 'ALEXANDRIA', 'QALYUBIA', 'SHARQIA', 'DAKAHLIA', 'RED_SEA', 'SOUTH_SINAI']);
export const relationshipEnum = appSchema.enum('relationship', ['SELF', 'MOTHER', 'FATHER', 'SPOUSE', 'CHILD', 'SIBLING', 'GRANDPARENT', 'OTHER']);
export const accessLevelEnum = appSchema.enum('access_level', ['OWNER', 'GUARDIAN', 'CAREGIVER']);
export const consentBasisEnum = appSchema.enum('consent_basis', ['SELF', 'GUARDIAN_OF_MINOR', 'ADULT_CONSENT_ATTESTED', 'LEGAL_AUTHORITY_ATTESTED']);
export const accessStatusEnum = appSchema.enum('access_status', ['ACTIVE', 'REVOKED']);
export const healthEntryKindEnum = appSchema.enum('health_entry_kind', ['ALLERGY', 'CONDITION', 'MEDICATION', 'SURGERY']);
export const recordStatusEnum = appSchema.enum('record_status', ['ACTIVE', 'ENTERED_IN_ERROR']);
export const providerTypeEnum = appSchema.enum('provider_type', ['DOCTOR', 'NURSE']);
export const verificationStatusEnum = appSchema.enum('verification_status', ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED']);
export const availabilityStatusEnum = appSchema.enum('availability_status', [
  'ACCEPTING_NEW_PATIENTS', 'LIMITED_AVAILABILITY', 'EXISTING_PATIENTS_ONLY', 'FULLY_BOOKED', 'AWAY',
  'AVAILABLE_NOW', 'AVAILABLE_TODAY', 'SCHEDULED_ONLY',
]);
export const credentialKindEnum = appSchema.enum('credential_kind', ['NATIONAL_ID', 'MEDICAL_LICENSE', 'MEDICAL_DEGREE', 'SPECIALTY_BOARD', 'NURSING_LICENSE', 'NURSING_DEGREE', 'CERTIFICATION']);
export const credentialStatusEnum = appSchema.enum('credential_status', ['PENDING', 'APPROVED', 'REJECTED']);
export const specialtyEnum = appSchema.enum('specialty', [
  'GENERAL_PRACTICE', 'INTERNAL_MEDICINE', 'GENERAL_SURGERY', 'PLASTIC_SURGERY', 'VASCULAR_SURGERY', 'DERMATOLOGY',
  'ENDOCRINOLOGY', 'GERIATRICS', 'ORTHOPEDICS', 'CARDIOLOGY', 'PEDIATRICS', 'FAMILY_MEDICINE',
]);
export const stockStatusEnum = appSchema.enum('stock_status', ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK', 'UNKNOWN']);
export const contentApprovalStatusEnum = appSchema.enum('content_approval_status', ['PENDING_APPROVAL', 'APPROVED', 'RETIRED']);
export const ledgerEntryTypeEnum = appSchema.enum('ledger_entry_type', ['VISIT_EARNING', 'PLATFORM_FEE', 'ADJUSTMENT', 'PAYOUT']);
export const ledgerStatusEnum = appSchema.enum('ledger_status', ['PENDING', 'AVAILABLE', 'PAID_OUT']);
export const accountKindEnum = appSchema.enum('account_kind', ['STANDARD', 'REVIEW', 'INTERNAL_TEST']);
export const consentTypeEnum = appSchema.enum('consent_type', ['TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'HEALTH_DATA_PROCESSING', 'MARKETING_COMMUNICATIONS']);
export const featureRiskEnum = appSchema.enum('feature_risk', ['LOW', 'MEDIUM', 'HIGH']);
export const planCodeEnum = appSchema.enum('plan_code', ['SILVER', 'GOLD', 'PLATINUM']);
export const paymentClassEnum = appSchema.enum('payment_class', ['PHYSICAL_PRODUCT', 'PHYSICAL_SERVICE', 'ELIGIBLE_PERSON_TO_PERSON_SERVICE', 'DIGITAL_SUBSCRIPTION', 'DIGITAL_FEATURE']);
export const billingPeriodEnum = appSchema.enum('billing_period', ['MONTHLY', 'YEARLY']);
export const entitlementSourceEnum = appSchema.enum('entitlement_source', ['APPLE', 'GOOGLE', 'ADMIN_GRANT']);
export const entitlementStatusEnum = appSchema.enum('entitlement_status', ['ACTIVE', 'GRACE_PERIOD', 'BILLING_RETRY', 'EXPIRED', 'REVOKED', 'REFUNDED']);

// ------------------------------------------------------------------ auth (read-only subset for the app role)
export const authUsers = authSchema.table('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  emailVerified: boolean('emailVerified').notNull(),
  phoneNumber: text('phoneNumber'),
  phoneNumberVerified: boolean('phoneNumberVerified'),
  twoFactorEnabled: boolean('twoFactorEnabled'),
  createdAt: ts('createdAt').notNull(),
});

// ------------------------------------------------------------------ identity
export const userRoles = appSchema.table(
  'user_roles',
  {
    userId: text('user_id').notNull(),
    role: roleEnum('role').notNull(),
    grantedByUserId: text('granted_by_user_id'),
    grantedAt: ts('granted_at').notNull().default(sql`now()`),
    revokedAt: ts('revoked_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

export const userProfiles = appSchema.table('user_profiles', {
  userId: text('user_id').primaryKey(),
  displayName: text('display_name').notNull(),
  locale: localeEnum('locale').notNull().default('ar'),
  activeRole: roleEnum('active_role'),
  assistantName: text('assistant_name'),
  onboardingCompletedAt: ts('onboarding_completed_at'),
  isDemo: boolean('is_demo').notNull().default(false),
  /** STANDARD for everyone; REVIEW / INTERNAL_TEST only via the owner-run review seed (migration 0006). */
  accountKind: accountKindEnum('account_kind').notNull().default('STANDARD'),
  createdAt: ts('created_at').notNull().default(sql`now()`),
  updatedAt: ts('updated_at').notNull().default(sql`now()`),
});

export const settings = appSchema.table('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  description: text('description'),
});

export const auditLog = appSchema.table('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  occurredAt: ts('occurred_at').notNull().default(sql`clock_timestamp()`),
  actorUserId: text('actor_user_id'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  patientId: uuid('patient_id'),
  requestId: text('request_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
});

// ------------------------------------------------------------------ compliance (migration 0006)
export const consentEvents = appSchema.table('consent_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  consentType: consentTypeEnum('consent_type').notNull(),
  documentVersion: text('document_version').notNull(),
  granted: boolean('granted').notNull(),
  source: text('source').notNull(),
  locale: localeEnum('locale').notNull().default('ar'),
  occurredAt: ts('occurred_at').notNull().default(sql`clock_timestamp()`),
});

export const featureFlags = appSchema.table('feature_flags', {
  key: text('key').primaryKey(),
  enabled: boolean('enabled').notNull(),
  risk: featureRiskEnum('risk').notNull(),
  requiresRegulatoryEvidence: boolean('requires_regulatory_evidence').notNull(),
  evidenceRef: text('evidence_ref'),
  description: text('description').notNull(),
  updatedByUserId: text('updated_by_user_id'),
  updatedAt: ts('updated_at').notNull(),
});

// ------------------------------------------------------------------ billing (migration 0007)
export const billingPlans = appSchema.table('billing_plans', {
  code: planCodeEnum('code').primaryKey(),
  nameEn: text('name_en').notNull(),
  nameAr: text('name_ar').notNull(),
  paymentClass: paymentClassEnum('payment_class').notNull(),
  benefits: jsonb('benefits').notNull(),
  familyProfileLimit: integer('family_profile_limit'),
  sortOrder: integer('sort_order').notNull(),
  active: boolean('active').notNull(),
  updatedAt: ts('updated_at').notNull(),
});

export const billingPlanOffers = appSchema.table(
  'billing_plan_offers',
  {
    planCode: planCodeEnum('plan_code').notNull(),
    period: billingPeriodEnum('period').notNull(),
    referencePricePiasters: integer('reference_price_piasters').notNull(),
    appleProductId: text('apple_product_id'),
    googleProductId: text('google_product_id'),
    googleBasePlanId: text('google_base_plan_id'),
  },
  (t) => [primaryKey({ columns: [t.planCode, t.period] })],
);

/** Read-only for the API role: rows are written exclusively by app.billing_apply_event(). */
export const entitlements = appSchema.table('entitlements', {
  id: uuid('id').primaryKey(),
  userId: text('user_id').notNull(),
  planCode: planCodeEnum('plan_code').notNull(),
  source: entitlementSourceEnum('source').notNull(),
  status: entitlementStatusEnum('status').notNull(),
  productId: text('product_id'),
  externalRef: text('external_ref'),
  expiresAt: ts('expires_at'),
  autoRenew: boolean('auto_renew'),
  lastEventAt: ts('last_event_at').notNull(),
  lastVerifiedAt: ts('last_verified_at').notNull(),
});

// ------------------------------------------------------------------ patients
export const patients = appSchema.table('patients', {
  id: uuid('id').primaryKey().defaultRandom(),
  displayName: text('display_name').notNull(),
  dateOfBirth: date('date_of_birth', { mode: 'string' }).notNull(),
  sex: sexEnum('sex').notNull(),
  bloodType: bloodTypeEnum('blood_type').notNull().default('UNKNOWN'),
  bloodTypeProvenance: provenanceEnum('blood_type_provenance'),
  governorate: governorateEnum('governorate'),
  city: text('city'),
  phone: text('phone'),
  emergencyContactName: text('emergency_contact_name'),
  emergencyContactPhone: text('emergency_contact_phone'),
  emergencyContactRelation: text('emergency_contact_relation'),
  baselineCompletedAt: ts('baseline_completed_at'),
  linkedUserId: text('linked_user_id'),
  createdByUserId: text('created_by_user_id').notNull(),
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: ts('created_at').notNull().default(sql`now()`),
  updatedAt: ts('updated_at').notNull().default(sql`now()`),
});

export const patientAccess = appSchema.table(
  'patient_access',
  {
    patientId: uuid('patient_id').notNull(),
    userId: text('user_id').notNull(),
    relationship: relationshipEnum('relationship').notNull(),
    accessLevel: accessLevelEnum('access_level').notNull(),
    consentBasis: consentBasisEnum('consent_basis').notNull(),
    consentStatementVersion: text('consent_statement_version').notNull(),
    consentAttestedAt: ts('consent_attested_at').notNull(),
    status: accessStatusEnum('status').notNull().default('ACTIVE'),
    grantedByUserId: text('granted_by_user_id').notNull(),
    grantedAt: ts('granted_at').notNull(),
    revokedAt: ts('revoked_at'),
    revokedByUserId: text('revoked_by_user_id'),
  },
  (t) => [primaryKey({ columns: [t.patientId, t.userId] })],
);

export const patientHealthEntries = appSchema.table('patient_health_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull(),
  kind: healthEntryKindEnum('kind').notNull(),
  title: text('title').notNull(),
  detail: text('detail'),
  note: text('note'),
  provenance: provenanceEnum('provenance').notNull(),
  recordedByUserId: text('recorded_by_user_id').notNull(),
  verifiedByUserId: text('verified_by_user_id'),
  verifiedAt: ts('verified_at'),
  status: recordStatusEnum('status').notNull().default('ACTIVE'),
  createdAt: ts('created_at').notNull().default(sql`now()`),
  updatedAt: ts('updated_at').notNull().default(sql`now()`),
});

// ------------------------------------------------------------------ providers
export const providerProfiles = appSchema.table('provider_profiles', {
  userId: text('user_id').primaryKey(),
  providerType: providerTypeEnum('provider_type').notNull(),
  displayNameAr: text('display_name_ar').notNull(),
  displayNameEn: text('display_name_en').notNull(),
  gender: genderEnum('gender').notNull(),
  specialty: specialtyEnum('specialty'),
  subspecialty: text('subspecialty'),
  yearsExperience: integer('years_experience').notNull(),
  bioAr: text('bio_ar'),
  bioEn: text('bio_en'),
  currentAffiliation: text('current_affiliation'),
  previousExperience: text('previous_experience'),
  skills: text('skills').array().notNull().default(sql`'{}'`),
  governorate: governorateEnum('governorate').notNull(),
  city: text('city').notNull(),
  feePiasters: integer('fee_piasters'),
  verificationStatus: verificationStatusEnum('verification_status').notNull().default('DRAFT'),
  verificationNote: text('verification_note'),
  submittedAt: ts('submitted_at'),
  verifiedAt: ts('verified_at'),
  verifiedByUserId: text('verified_by_user_id'),
  availabilityStatus: availabilityStatusEnum('availability_status').notNull(),
  maxDailyAppointments: integer('max_daily_appointments').notNull().default(8),
  serviceRadiusKm: integer('service_radius_km').notNull().default(10),
  awayUntil: date('away_until', { mode: 'string' }),
  temporarilyUnavailable: boolean('temporarily_unavailable').notNull().default(false),
  completedVisits: integer('completed_visits').notNull().default(0),
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: ts('created_at').notNull().default(sql`now()`),
  updatedAt: ts('updated_at').notNull().default(sql`now()`),
});

export const providerCredentials = appSchema.table('provider_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  providerUserId: text('provider_user_id').notNull(),
  kind: credentialKindEnum('kind').notNull(),
  issuer: text('issuer').notNull(),
  identifier: text('identifier').notNull(),
  issuedOn: date('issued_on', { mode: 'string' }),
  expiresOn: date('expires_on', { mode: 'string' }),
  documentObjectKey: text('document_object_key'),
  status: credentialStatusEnum('status').notNull().default('PENDING'),
  reviewNote: text('review_note'),
  reviewedByUserId: text('reviewed_by_user_id'),
  reviewedAt: ts('reviewed_at'),
  createdAt: ts('created_at').notNull().default(sql`now()`),
  updatedAt: ts('updated_at').notNull().default(sql`now()`),
});

export const providerVerificationEvents = appSchema.table('provider_verification_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  providerUserId: text('provider_user_id').notNull(),
  actorUserId: text('actor_user_id'),
  fromStatus: verificationStatusEnum('from_status'),
  toStatus: verificationStatusEnum('to_status').notNull(),
  note: text('note'),
  createdAt: ts('created_at').notNull(),
});

export const providerWorkingHours = appSchema.table('provider_working_hours', {
  id: uuid('id').primaryKey().defaultRandom(),
  providerUserId: text('provider_user_id').notNull(),
  weekday: smallint('weekday').notNull(),
  startMinute: smallint('start_minute').notNull(),
  endMinute: smallint('end_minute').notNull(),
});

export const publicProviderCredentials = appSchema.view('public_provider_credentials', {
  providerUserId: text('provider_user_id').notNull(),
  kind: credentialKindEnum('kind').notNull(),
  issuer: text('issuer').notNull(),
  verifiedAt: ts('verified_at').notNull(),
}).existing();

// ------------------------------------------------------------------ services
export const nursingServices = appSchema.table('nursing_services', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  descriptionAr: text('description_ar').notNull(),
  descriptionEn: text('description_en').notNull(),
  scopeAr: text('scope_ar').notNull(),
  scopeEn: text('scope_en').notNull(),
  eligibleProviderTypes: providerTypeEnum('eligible_provider_types').array().notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  basePricePiasters: integer('base_price_piasters').notNull(),
  requiresClinicalAuthorization: boolean('requires_clinical_authorization').notNull().default(false),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(100),
  isDemo: boolean('is_demo').notNull().default(false),
});

export const providerServices = appSchema.table(
  'provider_services',
  {
    providerUserId: text('provider_user_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    pricePiasters: integer('price_piasters'),
    createdAt: ts('created_at').notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.providerUserId, t.serviceId] })],
);

// ------------------------------------------------------------------ commerce
export const products = appSchema.table('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull(),
  brand: text('brand').notNull().default('TetraSol'),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  summaryAr: text('summary_ar').notNull(),
  summaryEn: text('summary_en').notNull(),
  descriptionAr: text('description_ar').notNull(),
  descriptionEn: text('description_en').notNull(),
  usageAr: text('usage_ar').notNull(),
  usageEn: text('usage_en').notNull(),
  contentStatus: contentApprovalStatusEnum('content_status').notNull().default('PENDING_APPROVAL'),
  approvalReference: text('approval_reference'),
  approvedAt: ts('approved_at'),
  regulatoryNote: text('regulatory_note'),
  sortOrder: integer('sort_order').notNull().default(100),
  isDemo: boolean('is_demo').notNull().default(false),
});

export const productVariants = appSchema.table('product_variants', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull(),
  sku: text('sku').notNull(),
  labelAr: text('label_ar').notNull(),
  labelEn: text('label_en').notNull(),
  pricePiasters: integer('price_piasters').notNull(),
  stockStatus: stockStatusEnum('stock_status').notNull().default('UNKNOWN'),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(100),
});

export const cartItems = appSchema.table('cart_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  variantId: uuid('variant_id').notNull(),
  quantity: integer('quantity').notNull(),
  forPatientId: uuid('for_patient_id'),
  createdAt: ts('created_at').notNull().default(sql`now()`),
  updatedAt: ts('updated_at').notNull().default(sql`now()`),
});

export const providerLedgerEntries = appSchema.table('provider_ledger_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  providerUserId: text('provider_user_id').notNull(),
  entryType: ledgerEntryTypeEnum('entry_type').notNull(),
  status: ledgerStatusEnum('status').notNull(),
  amountPiasters: integer('amount_piasters').notNull(),
  currency: text('currency').notNull().default('EGP'),
  description: text('description').notNull(),
  bookingId: uuid('booking_id'),
  occurredAt: ts('occurred_at').notNull().default(sql`now()`),
  isDemo: boolean('is_demo').notNull().default(false),
});
