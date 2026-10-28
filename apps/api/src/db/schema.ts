/**
 * Drizzle table definitions used for type-safe querying. The SQL migrations in
 * apps/api/db/migrations are the source of truth (including RLS, triggers and grants);
 * these definitions must mirror them. Never use drizzle-kit push against a real database.
 */
import { sql } from 'drizzle-orm';
import { bigint, boolean, customType, date, integer, jsonb, pgSchema, primaryKey, smallint, text, uuid } from 'drizzle-orm/pg-core';

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
export const observationKindEnum = appSchema.enum('observation_kind', ['BLOOD_PRESSURE', 'HEART_RATE', 'BLOOD_GLUCOSE', 'WEIGHT', 'TEMPERATURE', 'OXYGEN_SATURATION', 'PAIN_SCORE']);
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
export const publicationStatusEnum = appSchema.enum('publication_status', ['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED']);
export const stockReasonEnum = appSchema.enum('stock_reason', ['INITIAL', 'RESTOCK', 'SALE', 'RETURN', 'DAMAGE', 'CORRECTION']);
export const discountKindEnum = appSchema.enum('discount_kind', ['PERCENT', 'FIXED_AMOUNT']);
export const discountScopeEnum = appSchema.enum('discount_scope', ['ALL', 'CATEGORY', 'PRODUCT', 'VARIANT', 'BUNDLE']);
export const accountStatusEnum = appSchema.enum('account_status', ['ACTIVE', 'SUSPENDED', 'BLOCKED']);
export const statusReasonEnum = appSchema.enum('status_reason', [
  'SAFETY_CONCERN', 'FRAUD_SUSPECTED', 'TERMS_VIOLATION', 'CREDENTIAL_ISSUE', 'HARASSMENT', 'PAYMENT_ABUSE', 'LEGAL_REQUEST', 'IDENTITY_VERIFICATION', 'OTHER', 'RESOLVED', 'APPEAL_GRANTED',
]);
export const statusActionEnum = appSchema.enum('status_action', ['SUSPEND', 'BLOCK', 'REACTIVATE', 'RESTRICT_BOOKINGS', 'LIFT_BOOKING_RESTRICTION', 'APPEAL_GRANTED']);
export const appealStatusEnum = appSchema.enum('appeal_status', ['OPEN', 'GRANTED', 'DENIED', 'WITHDRAWN']);
export const aiProviderEnum = appSchema.enum('ai_provider', ['ANTHROPIC', 'OPENAI', 'GEMINI', 'SIMULATED', 'QWEN', 'GROK', 'KIMI', 'MEDGEMMA']);
export const aiMetricEnum = appSchema.enum('ai_metric', ['CHAT_MESSAGES', 'ANALYSES', 'VOICE_SECONDS', 'CLINICAL_DRAFTS']);
export const aiModelTierEnum = appSchema.enum('ai_model_tier', ['BASIC', 'ADVANCED', 'PREMIUM']);
export const commerceEventTypeEnum = appSchema.enum('commerce_event_type', ['PRODUCT_VIEW', 'ADD_TO_CART', 'CHECKOUT_PREVIEW', 'ORDER_PAID', 'ORDER_REFUNDED']);
export const ledgerEntryTypeEnum = appSchema.enum('ledger_entry_type', ['VISIT_EARNING', 'PLATFORM_FEE', 'ADJUSTMENT', 'PAYOUT']);
export const ledgerStatusEnum = appSchema.enum('ledger_status', ['PENDING', 'AVAILABLE', 'PAID_OUT']);
export const accountKindEnum = appSchema.enum('account_kind', ['STANDARD', 'REVIEW', 'INTERNAL_TEST']);
export const consentTypeEnum = appSchema.enum('consent_type', ['TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'HEALTH_DATA_PROCESSING', 'MARKETING_COMMUNICATIONS', 'AI_ASSISTANT_PROCESSING', 'AI_VOICE_PROCESSING', 'AI_DOCUMENT_PROCESSING', 'AI_CLINICAL_DOCUMENTATION']);
export const featureRiskEnum = appSchema.enum('feature_risk', ['LOW', 'MEDIUM', 'HIGH']);
export const planCodeEnum = appSchema.enum('plan_code', ['SILVER', 'GOLD', 'PLATINUM']);
export const paymentClassEnum = appSchema.enum('payment_class', ['PHYSICAL_PRODUCT', 'PHYSICAL_SERVICE', 'ELIGIBLE_PERSON_TO_PERSON_SERVICE', 'DIGITAL_SUBSCRIPTION', 'DIGITAL_FEATURE']);
export const billingPeriodEnum = appSchema.enum('billing_period', ['MONTHLY', 'YEARLY']);
export const entitlementSourceEnum = appSchema.enum('entitlement_source', ['APPLE', 'GOOGLE', 'ADMIN_GRANT']);
export const entitlementStatusEnum = appSchema.enum('entitlement_status', ['ACTIVE', 'GRACE_PERIOD', 'BILLING_RETRY', 'PAUSED', 'EXPIRED', 'REVOKED', 'REFUNDED']);

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

/** Written only by app.set_account_status() / app.decide_appeal() (migration 0009). No row = ACTIVE. */
export const accountStatus = appSchema.table('account_states', {
  userId: text('user_id').primaryKey(),
  status: accountStatusEnum('status').notNull(),
  bookingsRestricted: boolean('bookings_restricted').notNull(),
  reason: statusReasonEnum('reason'),
  publicMessage: text('public_message'),
  suspendedUntil: ts('suspended_until'),
  updatedByUserId: text('updated_by_user_id'),
  updatedAt: ts('updated_at').notNull(),
});

export const accountStatusEvents = appSchema.table('account_status_events', {
  id: uuid('id').primaryKey(),
  userId: text('user_id').notNull(),
  action: statusActionEnum('action').notNull(),
  fromStatus: accountStatusEnum('from_status').notNull(),
  toStatus: accountStatusEnum('to_status').notNull(),
  bookingsRestricted: boolean('bookings_restricted').notNull(),
  reason: statusReasonEnum('reason').notNull(),
  publicMessage: text('public_message'),
  staffNote: text('staff_note').notNull(),
  careContinuityNote: text('care_continuity_note'),
  suspendedUntil: ts('suspended_until'),
  actorUserId: text('actor_user_id'),
  appealId: uuid('appeal_id'),
  createdAt: ts('created_at').notNull(),
});

/** The person's own history without staff-internal notes (security-barrier view). */
export const myAccountStatusEvents = appSchema.view('my_account_status_events', {
  id: uuid('id').notNull(),
  action: statusActionEnum('action').notNull(),
  fromStatus: accountStatusEnum('from_status').notNull(),
  toStatus: accountStatusEnum('to_status').notNull(),
  bookingsRestricted: boolean('bookings_restricted').notNull(),
  reason: statusReasonEnum('reason').notNull(),
  publicMessage: text('public_message'),
  suspendedUntil: ts('suspended_until'),
  createdAt: ts('created_at').notNull(),
}).existing();

export const accountAppeals = appSchema.table('account_appeals', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  eventId: uuid('event_id'),
  message: text('message').notNull(),
  status: appealStatusEnum('status').notNull().default('OPEN'),
  decisionNote: text('decision_note'),
  decidedByUserId: text('decided_by_user_id'),
  decidedAt: ts('decided_at'),
  createdAt: ts('created_at').notNull().default(sql`now()`),
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
  aiModelTier: aiModelTierEnum('ai_model_tier').notNull().default('BASIC'),
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
  periodStartedAt: ts('period_started_at'),
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
export const productBrands = appSchema.table('product_brands', {
  name: text('name').primaryKey(),
  ownerEntity: text('owner_entity').notNull(),
  ownershipReference: text('ownership_reference').notNull(),
  active: boolean('active').notNull().default(true),
  createdByUserId: text('created_by_user_id'),
  createdAt: ts('created_at').notNull().default(sql`now()`),
});

export const productCategories = appSchema.table('product_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  sortOrder: integer('sort_order').notNull().default(100),
  active: boolean('active').notNull().default(true),
});

/** Lifecycle and approval columns are guarded by app.products_guard() (migration 0008). */
export const products = appSchema.table('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull(),
  brand: text('brand').notNull().default('TetraSol'),
  categoryId: uuid('category_id'),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  summaryAr: text('summary_ar').notNull(),
  summaryEn: text('summary_en').notNull(),
  descriptionAr: text('description_ar').notNull(),
  descriptionEn: text('description_en').notNull(),
  usageAr: text('usage_ar').notNull(),
  usageEn: text('usage_en').notNull(),
  approvedUsesAr: text('approved_uses_ar').notNull().default(''),
  approvedUsesEn: text('approved_uses_en').notNull().default(''),
  warningsAr: text('warnings_ar').notNull().default(''),
  warningsEn: text('warnings_en').notNull().default(''),
  contentStatus: contentApprovalStatusEnum('content_status').notNull().default('PENDING_APPROVAL'),
  publicationStatus: publicationStatusEnum('publication_status').notNull().default('DRAFT'),
  approvalReference: text('approval_reference'),
  approvedByUserId: text('approved_by_user_id'),
  approvedAt: ts('approved_at'),
  publishedAt: ts('published_at'),
  archivedAt: ts('archived_at'),
  regulatoryNote: text('regulatory_note'),
  sortOrder: integer('sort_order').notNull().default(100),
  isDemo: boolean('is_demo').notNull().default(false),
  createdByUserId: text('created_by_user_id'),
  updatedByUserId: text('updated_by_user_id'),
  createdAt: ts('created_at').notNull().default(sql`now()`),
  updatedAt: ts('updated_at').notNull().default(sql`now()`),
});

/** stock_quantity changes only through app.adjust_stock() (ledgered in stock_movements). */
export const productVariants = appSchema.table('product_variants', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull(),
  sku: text('sku').notNull(),
  labelAr: text('label_ar').notNull(),
  labelEn: text('label_en').notNull(),
  pricePiasters: integer('price_piasters').notNull(),
  stockStatus: stockStatusEnum('stock_status').notNull().default('UNKNOWN'),
  stockQuantity: integer('stock_quantity'),
  lowStockThreshold: integer('low_stock_threshold').notNull().default(5),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(100),
});

export const productImages = appSchema.table('product_images', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull(),
  contentType: text('content_type').notNull(),
  bytes: customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' })('bytes').notNull(),
  sha256: text('sha256').notNull(),
  width: integer('width'),
  height: integer('height'),
  altAr: text('alt_ar').notNull().default(''),
  altEn: text('alt_en').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(100),
  createdByUserId: text('created_by_user_id'),
  createdAt: ts('created_at').notNull().default(sql`now()`),
});

export const stockMovements = appSchema.table('stock_movements', {
  id: uuid('id').primaryKey().defaultRandom(),
  variantId: uuid('variant_id').notNull(),
  delta: integer('delta').notNull(),
  quantityAfter: integer('quantity_after').notNull(),
  reason: stockReasonEnum('reason').notNull(),
  note: text('note'),
  actorUserId: text('actor_user_id'),
  createdAt: ts('created_at').notNull(),
});

export const discounts = appSchema.table('discounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  code: text('code'),
  kind: discountKindEnum('kind').notNull(),
  value: integer('value').notNull(),
  scope: discountScopeEnum('scope').notNull(),
  targetId: uuid('target_id'),
  minSubtotalPiasters: integer('min_subtotal_piasters').notNull().default(0),
  startsAt: ts('starts_at').notNull().default(sql`now()`),
  endsAt: ts('ends_at'),
  active: boolean('active').notNull().default(false),
  createdByUserId: text('created_by_user_id'),
});

export const productBundles = appSchema.table('product_bundles', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  descriptionAr: text('description_ar').notNull().default(''),
  descriptionEn: text('description_en').notNull().default(''),
  pricePiasters: integer('price_piasters').notNull(),
  publicationStatus: publicationStatusEnum('publication_status').notNull().default('DRAFT'),
  publishedAt: ts('published_at'),
  createdByUserId: text('created_by_user_id'),
  createdAt: ts('created_at').notNull().default(sql`now()`),
});

export const productBundleItems = appSchema.table(
  'product_bundle_items',
  { bundleId: uuid('bundle_id').notNull(), variantId: uuid('variant_id').notNull(), quantity: integer('quantity').notNull() },
  (t) => [primaryKey({ columns: [t.bundleId, t.variantId] })],
);

/** Aggregate funnel events — no user identifiers by design. */
export const commerceEvents = appSchema.table('commerce_events', {
  id: integer('id').primaryKey(),
  eventType: commerceEventTypeEnum('event_type').notNull(),
  productId: uuid('product_id'),
  variantId: uuid('variant_id'),
  bundleId: uuid('bundle_id'),
  quantity: integer('quantity').notNull(),
  amountPiasters: integer('amount_piasters'),
  occurredAt: ts('occurred_at').notNull(),
});

/** A cart line is either a product variant or a bundle (CHECK cart_item_kind). */
export const cartItems = appSchema.table('cart_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  variantId: uuid('variant_id'),
  bundleId: uuid('bundle_id'),
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

// ------------------------------------------------------------------ AI gateway (migration 0011)
/** Prices: USD per 1M tokens in micro-dollars. Credentials never live in the database. */
export const aiModels = appSchema.table('ai_models', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: aiProviderEnum('provider').notNull(),
  modelId: text('model_id').notNull(),
  displayName: text('display_name').notNull(),
  inputPriceMicros: bigint('input_price_micros', { mode: 'number' }),
  outputPriceMicros: bigint('output_price_micros', { mode: 'number' }),
  cacheReadPriceMicros: bigint('cache_read_price_micros', { mode: 'number' }),
  priceSource: text('price_source'),
  priceVerifiedAt: ts('price_verified_at'),
  active: boolean('active').notNull().default(false),
  // Registry (migration 0013)
  capabilities: text('capabilities').array().notNull().default(sql`ARRAY['CHAT']`),
  medicalSpecialized: boolean('medical_specialized').notNull().default(false),
  hosting: text('hosting').notNull().default('PROVIDER_API'),
  dataRegion: text('data_region'),
  notes: text('notes'),
  patientDataApprovalRef: text('patient_data_approval_ref'),
  patientDataApprovedAt: ts('patient_data_approved_at'),
  // Audio-token prices for realtime voice models (migration 0018)
  audioInputPriceMicros: bigint('audio_input_price_micros', { mode: 'number' }),
  audioOutputPriceMicros: bigint('audio_output_price_micros', { mode: 'number' }),
  audioCacheReadPriceMicros: bigint('audio_cache_read_price_micros', { mode: 'number' }),
});

export const aiRoutes = appSchema.table('ai_routes', {
  key: text('key').primaryKey(),
  description: text('description').notNull(),
  featureFlag: text('feature_flag').notNull(),
  metric: aiMetricEnum('metric').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  maxOutputTokens: integer('max_output_tokens').notNull(),
  carriesPatientData: boolean('carries_patient_data').notNull(),
  requiredCapability: text('required_capability').notNull(),
  requireClinicalApproval: boolean('require_clinical_approval').notNull(),
  complexityRouting: boolean('complexity_routing').notNull(),
  simpleMaxChars: integer('simple_max_chars').notNull(),
  maxConcurrentPerUser: integer('max_concurrent_per_user').notNull(),
});

/** Ordered routing candidates per plan tier (migration 0013); the database picks eligible ones. */
export const aiRouteCandidates = appSchema.table('ai_route_candidates', {
  id: uuid('id').primaryKey().defaultRandom(),
  routeKey: text('route_key').notNull(),
  tier: aiModelTierEnum('tier').notNull(),
  model: uuid('model').notNull(),
  complexity: text('complexity').notNull().default('ANY'),
  language: text('language').notNull().default('ANY'),
  priority: integer('priority').notNull().default(100),
  effort: text('effort').notNull().default('medium'),
  enabled: boolean('enabled').notNull().default(true),
});

export const aiPlanBudgets = appSchema.table('ai_plan_budgets', {
  planCode: planCodeEnum('plan_code').primaryKey(),
  userMonthlyLimitMicros: bigint('user_monthly_limit_micros', { mode: 'number' }),
  planMonthlyLimitMicros: bigint('plan_monthly_limit_micros', { mode: 'number' }),
});

export const aiBudgetAlerts = appSchema.table('ai_budget_alerts', {
  id: uuid('id').primaryKey(),
  scope: text('scope').notNull(),
  planCode: planCodeEnum('plan_code'),
  month: text('month').notNull(),
  thresholdPct: integer('threshold_pct').notNull(),
  spendMicros: bigint('spend_micros', { mode: 'number' }).notNull(),
  limitMicros: bigint('limit_micros', { mode: 'number' }).notNull(),
  createdAt: ts('created_at').notNull(),
});

// ------------------------------------------------------------------ medical AI evaluation suite (migration 0013)
/** Synthetic cases only; they count once clinically reviewed. */
export const aiEvalCases = appSchema.table('ai_eval_cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull(),
  category: text('category').notNull(),
  language: text('language').notNull(),
  prompt: text('prompt').notNull(),
  context: text('context'),
  expectedBehavior: text('expected_behavior').notNull(),
  checks: jsonb('checks').$type<Record<string, unknown>>().notNull(),
  // Migration 0021: document-reading cases carry a synthetic report definition.
  routeKey: text('route_key').notNull().default('patient.chat'),
  documentSpec: jsonb('document_spec').$type<Record<string, unknown> | null>(),
  summarySpec: jsonb('summary_spec').$type<Record<string, unknown> | null>(),
  draftSpec: jsonb('draft_spec').$type<Record<string, unknown> | null>(),
  status: text('status').notNull().default('DRAFT'),
  version: integer('version').notNull().default(1),
  authoredByUserId: text('authored_by_user_id'),
  reviewedByUserId: text('reviewed_by_user_id'),
  reviewedAt: ts('reviewed_at'),
  updatedAt: ts('updated_at').notNull().default(sql`now()`),
});

export const aiEvalRuns = appSchema.table('ai_eval_runs', {
  id: uuid('id').primaryKey(),
  model: uuid('model').notNull(),
  provider: aiProviderEnum('provider').notNull(),
  modelId: text('model_id').notNull(),
  routeKey: text('route_key').notNull(),
  policyVersion: text('policy_version').notNull(),
  status: text('status').notNull(),
  failure: text('failure'),
  caseCount: integer('case_count').notNull(),
  completedCount: integer('completed_count').notNull(),
  automatedPassCount: integer('automated_pass_count').notNull(),
  inputTokens: bigint('input_tokens', { mode: 'number' }).notNull(),
  outputTokens: bigint('output_tokens', { mode: 'number' }).notNull(),
  costMicros: bigint('cost_micros', { mode: 'number' }).notNull(),
  costEstimated: boolean('cost_estimated').notNull(),
  startedByUserId: text('started_by_user_id'),
  startedAt: ts('started_at').notNull(),
  finishedAt: ts('finished_at'),
});

export const aiEvalResults = appSchema.table('ai_eval_results', {
  id: uuid('id').primaryKey(),
  runId: uuid('run_id').notNull(),
  caseId: uuid('case_id').notNull(),
  caseVersion: integer('case_version').notNull(),
  caseCode: text('case_code').notNull(),
  category: text('category').notNull(),
  language: text('language').notNull(),
  status: text('status').notNull(),
  output: text('output'),
  outcome: text('outcome'),
  servedModel: text('served_model'),
  latencyMs: integer('latency_ms'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  costMicros: bigint('cost_micros', { mode: 'number' }),
  automatedChecks: jsonb('automated_checks').$type<Record<string, unknown>>(),
  automatedPass: boolean('automated_pass'),
  reviewedByUserId: text('reviewed_by_user_id'),
  reviewedAt: ts('reviewed_at'),
  accuracy: integer('accuracy'),
  hallucination: boolean('hallucination'),
  unsafe: boolean('unsafe'),
  arabicQuality: integer('arabic_quality'),
  reviewNotes: text('review_notes'),
});

export const aiModelRouteApprovals = appSchema.table('ai_model_route_approvals', {
  id: uuid('id').primaryKey(),
  routeKey: text('route_key').notNull(),
  model: uuid('model').notNull(),
  runId: uuid('run_id').notNull(),
  policyVersion: text('policy_version').notNull(),
  summary: jsonb('summary').$type<Record<string, unknown>>().notNull(),
  note: text('note').notNull(),
  approvedByUserId: text('approved_by_user_id'),
  approvedAt: ts('approved_at').notNull(),
  revokedAt: ts('revoked_at'),
  revokeNote: text('revoke_note'),
});

export const aiPlanQuotas = appSchema.table(
  'ai_plan_quotas',
  { planCode: planCodeEnum('plan_code').notNull(), metric: aiMetricEnum('metric').notNull(), weeklyLimit: integer('weekly_limit').notNull() },
  (t) => [primaryKey({ columns: [t.planCode, t.metric] })],
);

export const aiRoleQuotas = appSchema.table(
  'ai_role_quotas',
  { role: roleEnum('role').notNull(), metric: aiMetricEnum('metric').notNull(), weeklyLimit: integer('weekly_limit').notNull() },
  (t) => [primaryKey({ columns: [t.role, t.metric] })],
);

export const aiBudget = appSchema.table('ai_budget', {
  id: boolean('id').primaryKey(),
  monthlyLimitMicros: bigint('monthly_limit_micros', { mode: 'number' }),
});

/** Written only by app.ai_reserve / ai_settle / ai_release. No content is stored here. */
export const aiUsage = appSchema.table('ai_usage', {
  id: uuid('id').primaryKey(),
  userId: text('user_id').notNull(),
  routeKey: text('route_key').notNull(),
  metric: aiMetricEnum('metric').notNull(),
  units: integer('units').notNull(),
  status: text('status').notNull(),
  provider: aiProviderEnum('provider'),
  modelId: text('model_id'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  costMicros: bigint('cost_micros', { mode: 'number' }),
  costEstimated: boolean('cost_estimated').notNull(),
  outcome: text('outcome'),
  reservedAt: ts('reserved_at').notNull(),
});

/** Private to their author (RLS); assistant messages are written only by app.ai_settle(). */
export const aiConversations = appSchema.table('ai_conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  routeKey: text('route_key').notNull(),
  patientId: uuid('patient_id'),
  title: text('title').notNull().default(''),
  createdAt: ts('created_at').notNull().default(sql`now()`),
  updatedAt: ts('updated_at').notNull().default(sql`now()`),
});

export const aiMessages = appSchema.table('ai_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull(),
  userId: text('user_id').notNull(),
  role: text('role').notNull(),
  kind: text('kind').notNull().default('MESSAGE'),
  /** VOICE = a transcript written by app.ai_voice_record() (migration 0018). */
  channel: text('channel').notNull().default('TEXT'),
  content: text('content').notNull(),
  createdAt: ts('created_at').notNull().default(sql`clock_timestamp()`),
});

/** Realtime voice sessions (migration 0018): metering only, never audio or content. Written by functions. */
export const aiVoiceSessions = appSchema.table('ai_voice_sessions', {
  id: uuid('id').primaryKey(),
  userId: text('user_id').notNull(),
  conversationId: uuid('conversation_id'),
  usageId: uuid('usage_id').notNull(),
  provider: aiProviderEnum('provider').notNull(),
  modelId: text('model_id').notNull(),
  locale: text('locale').notNull(),
  status: text('status').notNull(),
  createdAt: ts('created_at').notNull(),
  startedAt: ts('started_at'),
  endedAt: ts('ended_at'),
  usedSeconds: integer('used_seconds').notNull(),
  endReason: text('end_reason'),
});

// ------------------------------------------------------------------ AI preferences and reports (migration 0015)
export const aiPreferences = appSchema.table('ai_preferences', {
  userId: text('user_id').primaryKey(),
  replyLanguage: text('reply_language').notNull().default('auto'),
  detailLevel: text('detail_level').notNull().default('brief'),
  updatedAt: ts('updated_at').notNull().default(sql`now()`),
});

/** Snapshot columns are deliberately absent: content is read only through app.ai_report_detail(). */
export const aiResponseReports = appSchema.table('ai_response_reports', {
  id: uuid('id').primaryKey(),
  reporterUserId: text('reporter_user_id').notNull(),
  messageId: uuid('message_id'),
  reason: text('reason').notNull(),
  messageKind: text('message_kind').notNull(),
  provider: aiProviderEnum('provider'),
  modelId: text('model_id'),
  routeKey: text('route_key'),
  locale: text('locale'),
  status: text('status').notNull(),
  resolution: text('resolution'),
  assignedToUserId: text('assigned_to_user_id'),
  redactedAt: ts('redacted_at'),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
});

export const aiReportEvents = appSchema.table('ai_report_events', {
  id: uuid('id').primaryKey(),
  reportId: uuid('report_id').notNull(),
  actorUserId: text('actor_user_id'),
  event: text('event').notNull(),
  note: text('note'),
  createdAt: ts('created_at').notNull(),
});

// ------------------------------------------------------------------ curated medical knowledge (migration 0016)
export const knowledgeArticles = appSchema.table('knowledge_articles', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull(),
  locale: text('locale').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  body: text('body').notNull(),
  topics: text('topics').array().notNull().default(sql`'{}'`),
  sourcePublisher: text('source_publisher').notNull(),
  sourceTitle: text('source_title').notNull(),
  sourceUrl: text('source_url'),
  sourceDate: date('source_date', { mode: 'string' }),
  status: text('status').notNull().default('DRAFT'),
  editedByUserId: text('edited_by_user_id'),
  updatedAt: ts('updated_at').notNull().default(sql`now()`),
});

/** Immutable approved versions (database-enforced). */
export const knowledgeVersions = appSchema.table('knowledge_versions', {
  id: uuid('id').primaryKey(),
  articleId: uuid('article_id').notNull(),
  version: integer('version').notNull(),
  locale: text('locale').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  body: text('body').notNull(),
  sourcePublisher: text('source_publisher').notNull(),
  sourceTitle: text('source_title').notNull(),
  sourceUrl: text('source_url'),
  sourceDate: date('source_date', { mode: 'string' }),
  approvedByUserId: text('approved_by_user_id'),
  approvedAt: ts('approved_at').notNull(),
  approvalNote: text('approval_note').notNull(),
  supersededAt: ts('superseded_at'),
});

export const aiMessageCitations = appSchema.table(
  'ai_message_citations',
  { messageId: uuid('message_id').notNull(), versionId: uuid('version_id').notNull(), label: text('label').notNull() },
  (t) => [primaryKey({ columns: [t.messageId, t.versionId] })],
);

// ------------------------------------------------------------------ medical documents and lab results (migration 0021)
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
export const medicalDocuments = appSchema.table('medical_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull(),
  uploadedByUserId: text('uploaded_by_user_id').notNull(),
  kind: text('kind').notNull().default('LAB_REPORT'),
  title: text('title').notNull(),
  contentType: text('content_type').notNull(),
  bytes: bytea('bytes').notNull(),
  byteSize: integer('byte_size').notNull(),
  sha256: text('sha256').notNull(),
  documentDate: date('document_date', { mode: 'string' }),
  createdAt: ts('created_at').notNull().default(sql`now()`),
});

/** Written only by app.document_extraction_* functions. */
export const documentExtractions = appSchema.table('document_extractions', {
  id: uuid('id').primaryKey(),
  documentId: uuid('document_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  requestedByUserId: text('requested_by_user_id').notNull(),
  status: text('status').notNull(),
  provider: aiProviderEnum('provider'),
  modelId: text('model_id'),
  labName: text('lab_name'),
  collectedOn: date('collected_on', { mode: 'string' }),
  rowCount: integer('row_count').notNull(),
  failure: text('failure'),
  createdAt: ts('created_at').notNull(),
  completedAt: ts('completed_at'),
});

const numericNumber = customType<{ data: number | null; driverData: string | null }>({
  dataType: () => 'numeric',
  fromDriver: (v) => (v === null ? null : Number(v)),
  toDriver: (v) => (v === null ? null : String(v)),
});
export const labResults = appSchema.table('lab_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull(),
  documentId: uuid('document_id'),
  extractionId: uuid('extraction_id'),
  testName: text('test_name').notNull(),
  valueText: text('value_text').notNull(),
  valueNumeric: numericNumber('value_numeric'),
  unit: text('unit'),
  referenceText: text('reference_text'),
  referenceLow: numericNumber('reference_low'),
  referenceHigh: numericNumber('reference_high'),
  printedFlag: text('printed_flag'),
  rangeStatus: text('range_status').notNull().default('UNKNOWN'),
  observedOn: date('observed_on', { mode: 'string' }),
  source: text('source').notNull(),
  reviewStatus: text('review_status').notNull(),
  provenance: text('provenance'),
  corrected: boolean('corrected').notNull().default(false),
  recordedByUserId: text('recorded_by_user_id'),
  createdAt: ts('created_at').notNull().default(sql`now()`),
});

// Slice 6 (migration 0022): readings and AI summaries.
const numericRequired = customType<{ data: number; driverData: string }>({
  dataType: () => 'numeric',
  fromDriver: (v) => Number(v),
  toDriver: (v) => String(v),
});
export const healthObservations = appSchema.table('health_observations', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull(),
  kind: observationKindEnum('kind').notNull(),
  value: numericRequired('value').notNull(),
  value2: numericNumber('value2'),
  unit: text('unit').notNull(),
  context: text('context'),
  measuredAt: ts('measured_at').notNull(),
  note: text('note'),
  source: text('source').notNull().default('MANUAL'),
  provenance: provenanceEnum('provenance').notNull(),
  recordedByUserId: text('recorded_by_user_id').notNull(),
  verifiedAt: ts('verified_at'),
  status: recordStatusEnum('status').notNull().default('ACTIVE'),
  createdAt: ts('created_at').notNull().default(sql`now()`),
});

export const healthSummaries = appSchema.table('health_summaries', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull(),
  requestedByUserId: text('requested_by_user_id').notNull(),
  status: text('status').notNull(),
  periodDays: integer('period_days').notNull(),
  language: text('language').notNull(),
  facts: jsonb('facts').$type<unknown[]>().notNull(),
  content: jsonb('content').$type<Record<string, unknown> | null>(),
  provider: aiProviderEnum('provider'),
  modelId: text('model_id'),
  policyVersion: text('policy_version').notNull(),
  createdAt: ts('created_at').notNull(),
  completedAt: ts('completed_at'),
});

// Slice 7 (migration 0024): record shares and clinician drafts.
export const careShares = appSchema.table('care_shares', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull(),
  providerUserId: text('provider_user_id').notNull(),
  grantedByUserId: text('granted_by_user_id').notNull(),
  aiAllowed: boolean('ai_allowed').notNull(),
  testData: boolean('test_data').notNull(),
  providerType: text('provider_type').notNull(),
  providerNameAr: text('provider_name_ar').notNull(),
  providerNameEn: text('provider_name_en').notNull(),
  status: text('status').notNull(),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull(),
  revokedAt: ts('revoked_at'),
});

export const clinicalDrafts = appSchema.table('clinical_drafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull(),
  authorUserId: text('author_user_id').notNull(),
  authorRole: text('author_role').notNull(),
  authorNameAr: text('author_name_ar').notNull(),
  authorNameEn: text('author_name_en').notNull(),
  docType: text('doc_type').notNull(),
  status: text('status').notNull(),
  clinicianInput: text('clinician_input').notNull(),
  context: jsonb('context').$type<Record<string, unknown>>().notNull(),
  aiContent: jsonb('ai_content').$type<Record<string, unknown> | null>(),
  content: jsonb('content').$type<Record<string, unknown> | null>(),
  edited: boolean('edited').notNull(),
  provider: aiProviderEnum('provider'),
  modelId: text('model_id'),
  failure: text('failure'),
  signedAt: ts('signed_at'),
  createdAt: ts('created_at').notNull(),
});

// ------------------------------------------------------------------ company-product knowledge (migration 0025)
export const productKnowledge = appSchema.table('product_knowledge', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull(),
  kind: text('kind').notNull(),
  topic: text('topic'),
  titleAr: text('title_ar').notNull(),
  titleEn: text('title_en').notNull(),
  bodyAr: text('body_ar').notNull(),
  bodyEn: text('body_en').notNull(),
  evidenceReference: text('evidence_reference').notNull(),
  status: text('status').notNull().default('DRAFT'),
  editedByUserId: text('edited_by_user_id'),
  createdAt: ts('created_at').notNull().default(sql`now()`),
  updatedAt: ts('updated_at').notNull().default(sql`now()`),
});
export const productKnowledgeVersions = appSchema.table('product_knowledge_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  entryId: uuid('entry_id').notNull(),
  productId: uuid('product_id').notNull(),
  version: integer('version').notNull(),
  kind: text('kind').notNull(),
  topic: text('topic'),
  titleAr: text('title_ar').notNull(),
  titleEn: text('title_en').notNull(),
  bodyAr: text('body_ar').notNull(),
  bodyEn: text('body_en').notNull(),
  evidenceReference: text('evidence_reference').notNull(),
  editedByUserId: text('edited_by_user_id'),
  approvedByUserId: text('approved_by_user_id'),
  approvedAt: ts('approved_at').notNull(),
  approvalNote: text('approval_note').notNull(),
  supersededAt: ts('superseded_at'),
});
export const productKeywords = appSchema.table('product_keywords', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull(),
  indicationId: uuid('indication_id'),
  term: text('term').notNull(),
  termNormalized: text('term_normalized').notNull(),
  locale: text('locale').notNull(),
  variant: text('variant').notNull(),
  status: text('status').notNull().default('PENDING'),
  createdByUserId: text('created_by_user_id'),
  approvedByUserId: text('approved_by_user_id'),
  approvedAt: ts('approved_at'),
  retiredAt: ts('retired_at'),
  createdAt: ts('created_at').notNull().default(sql`now()`),
});
export const aiMessageProducts = appSchema.table(
  'ai_message_products',
  { messageId: uuid('message_id').notNull(), productId: uuid('product_id').notNull(), indicationVersionId: uuid('indication_version_id'), label: text('label').notNull() },
  (t) => [primaryKey({ columns: [t.messageId, t.productId] })],
);
