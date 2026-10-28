/**
 * API contracts shared by the API (validation), the mobile app and the admin console.
 * Request bodies are validated with these schemas on the server; response types are
 * inferred for the typed API client.
 */
import type { ProductKnowledgeItem } from './products';
import { z } from 'zod';
import {
  ACCESS_LEVELS,
  AVAILABILITY_STATUSES,
  BLOOD_TYPES,
  CONSENT_BASES,
  CONTENT_APPROVAL_STATUSES,
  CREDENTIAL_KINDS,
  CREDENTIAL_STATUSES,
  GOVERNORATES,
  HEALTH_ENTRY_KINDS,
  INTEGRATION_STATUSES,
  LEDGER_ENTRY_TYPES,
  LEDGER_STATUSES,
  PROVENANCES,
  PROVIDER_TYPES,
  RELATIONSHIPS,
  SEXES,
  SPECIALTIES,
  STOCK_STATUSES,
  VERIFICATION_STATUSES,
} from './enums';
import { ROLES, SELF_SELECTABLE_ROLES } from './roles';
import { VERIFICATION_DECISIONS } from './verification';

export const LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();
/** Egyptian mobile numbers in E.164 (+20 1x xxxx xxxx). */
/** Placeholder email domain for accounts created by phone-OTP sign-up (they have no password). */
export const PHONE_ONLY_EMAIL_DOMAIN = 'phone.ghayarly.invalid';

export const egyptPhone = z.string().regex(/^\+201[0125]\d{8}$/, 'Expected an Egyptian mobile number in +201XXXXXXXXX format');

// ---------------------------------------------------------------- identity / me
export const assignRoleBody = z.object({ role: z.enum(SELF_SELECTABLE_ROLES) });
export type AssignRoleBody = z.infer<typeof assignRoleBody>;

export const updateMeBody = z.object({
  displayName: trimmed(80).optional(),
  locale: z.enum(LOCALES).optional(),
  activeRole: z.enum(ROLES).optional(),
  assistantName: trimmed(40).optional(),
});
export type UpdateMeBody = z.infer<typeof updateMeBody>;

/** Required on the account holder's own (SELF) patient profile — migration 0019. */
export const SELF_CONTACT_FIELDS = ['GOVERNORATE', 'CITY', 'PHONE'] as const;
export type SelfContactField = (typeof SELF_CONTACT_FIELDS)[number];

export type MeResponse = {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    phoneNumber: string | null;
    phoneNumberVerified: boolean;
    twoFactorEnabled: boolean;
  };
  roles: (typeof ROLES)[number][];
  profile: {
    displayName: string;
    locale: Locale;
    activeRole: (typeof ROLES)[number] | null;
    assistantName: string | null;
    onboardingCompletedAt: string | null;
    /**
     * Patients: required details still missing from their own profile (governorate, city / area,
     * mobile number). Non-empty → the app sends them back to complete onboarding.
     */
    missingContactFields: SelfContactField[];
  };
  mfa: { required: boolean; enrolled: boolean; enforcement: 'required' | 'warn' };
  /** Suspended / blocked accounts can only see why, appeal, or delete the account. */
  account: import('./accounts').AccountStatusInfo;
  demoMode: boolean;
};

// ---------------------------------------------------------------- patients & family
export const createPatientBody = z
  .object({
    displayName: trimmed(80),
    dateOfBirth: isoDate,
    sex: z.enum(SEXES),
    relationship: z.enum(RELATIONSHIPS),
    consentBasis: z.enum(CONSENT_BASES),
    /** The caregiver explicitly confirms the consent statement shown in the UI. */
    consentAttested: z.literal(true),
    consentStatementVersion: z.string().min(1).max(40),
  })
  .refine((v) => (v.relationship === 'SELF') === (v.consentBasis === 'SELF'), {
    message: 'SELF relationship requires SELF consent basis and vice versa',
    path: ['consentBasis'],
  });
export type CreatePatientBody = z.infer<typeof createPatientBody>;

export const updatePatientBody = z.object({
  displayName: trimmed(80).optional(),
  dateOfBirth: isoDate.optional(),
  sex: z.enum(SEXES).optional(),
  bloodType: z.enum(BLOOD_TYPES).optional(),
  governorate: z.enum(GOVERNORATES).optional().nullable(),
  city: optionalText(80),
  phone: egyptPhone.optional().nullable(),
  emergencyContactName: optionalText(80),
  emergencyContactPhone: egyptPhone.optional().nullable(),
  emergencyContactRelation: optionalText(40),
  baselineCompleted: z.boolean().optional(),
});
export type UpdatePatientBody = z.infer<typeof updatePatientBody>;

export type PatientSummary = {
  id: string;
  displayName: string;
  dateOfBirth: string;
  ageYears: number;
  sex: (typeof SEXES)[number];
  bloodType: (typeof BLOOD_TYPES)[number];
  bloodTypeProvenance: (typeof PROVENANCES)[number] | null;
  governorate: (typeof GOVERNORATES)[number] | null;
  city: string | null;
  phone: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  baselineCompletedAt: string | null;
  relationship: (typeof RELATIONSHIPS)[number];
  accessLevel: (typeof ACCESS_LEVELS)[number];
  consentBasis: (typeof CONSENT_BASES)[number];
  isDemo: boolean;
};

export const createHealthEntryBody = z.object({
  kind: z.enum(HEALTH_ENTRY_KINDS),
  title: trimmed(120),
  detail: optionalText(500),
  /** e.g. severity for allergies, dose for medications, year for surgeries. Free text, patient-reported. */
  note: optionalText(200),
});
export type CreateHealthEntryBody = z.infer<typeof createHealthEntryBody>;

export type HealthEntry = {
  id: string;
  patientId: string;
  kind: (typeof HEALTH_ENTRY_KINDS)[number];
  title: string;
  detail: string | null;
  note: string | null;
  provenance: (typeof PROVENANCES)[number];
  recordedByName: string | null;
  verifiedAt: string | null;
  createdAt: string;
};

export type PatientAccessGrant = {
  userId: string;
  displayName: string;
  relationship: (typeof RELATIONSHIPS)[number];
  accessLevel: (typeof ACCESS_LEVELS)[number];
  consentBasis: (typeof CONSENT_BASES)[number];
  status: 'ACTIVE' | 'REVOKED';
  grantedAt: string;
};

// ---------------------------------------------------------------- providers
export const upsertProviderProfileBody = z.object({
  providerType: z.enum(PROVIDER_TYPES),
  displayNameAr: trimmed(80),
  displayNameEn: trimmed(80),
  gender: z.enum(['FEMALE', 'MALE']),
  specialty: z.enum(SPECIALTIES).optional().nullable(),
  subspecialty: optionalText(80),
  yearsExperience: z.number().int().min(0).max(60),
  bioAr: optionalText(600),
  bioEn: optionalText(600),
  currentAffiliation: optionalText(120),
  previousExperience: optionalText(600),
  governorate: z.enum(GOVERNORATES),
  city: trimmed(80),
  /** Consultation (doctor) or base visit (nurse) fee in EGP piasters. */
  feePiasters: z.number().int().min(0).max(10_000_000).optional().nullable(),
  skills: z.array(trimmed(60)).max(20).optional(),
});
export type UpsertProviderProfileBody = z.infer<typeof upsertProviderProfileBody>;

export const addCredentialBody = z.object({
  kind: z.enum(CREDENTIAL_KINDS),
  issuer: trimmed(120),
  identifier: trimmed(80),
  issuedOn: isoDate.optional().nullable(),
  expiresOn: isoDate.optional().nullable(),
});
export type AddCredentialBody = z.infer<typeof addCredentialBody>;

export const updateAvailabilityBody = z.object({
  availabilityStatus: z.enum(AVAILABILITY_STATUSES as unknown as [string, ...string[]]).optional(),
  maxDailyAppointments: z.number().int().min(0).max(80).optional(),
  serviceRadiusKm: z.number().int().min(1).max(100).optional(),
  awayUntil: isoDate.optional().nullable(),
  temporarilyUnavailable: z.boolean().optional(),
});
export type UpdateAvailabilityBody = z.infer<typeof updateAvailabilityBody>;

export const workingHoursBody = z.object({
  slots: z
    .array(
      z
        .object({
          weekday: z.number().int().min(0).max(6),
          startMinute: z.number().int().min(0).max(1439),
          endMinute: z.number().int().min(1).max(1440),
        })
        .refine((s) => s.endMinute > s.startMinute, { message: 'endMinute must be after startMinute' }),
    )
    .max(28),
});
export type WorkingHoursBody = z.infer<typeof workingHoursBody>;

export const providerServicesBody = z.object({
  services: z.array(z.object({ serviceId: z.string().uuid(), pricePiasters: z.number().int().min(0).max(10_000_000).nullable() })).max(30),
});
export type ProviderServicesBody = z.infer<typeof providerServicesBody>;

export const providerSearchQuery = z.object({
  type: z.enum(PROVIDER_TYPES).optional(),
  specialty: z.enum(SPECIALTIES).optional(),
  governorate: z.enum(GOVERNORATES).optional(),
  gender: z.enum(['FEMALE', 'MALE']).optional(),
  serviceId: z.string().uuid().optional(),
  acceptingOnly: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(60).optional(),
  sort: z.enum(['recommended', 'experience', 'price_low', 'price_high']).optional(),
});
export type ProviderSearchQuery = z.infer<typeof providerSearchQuery>;

export type ProviderCard = {
  userId: string;
  providerType: (typeof PROVIDER_TYPES)[number];
  displayNameAr: string;
  displayNameEn: string;
  gender: 'FEMALE' | 'MALE';
  specialty: (typeof SPECIALTIES)[number] | null;
  yearsExperience: number;
  governorate: (typeof GOVERNORATES)[number];
  city: string;
  currentAffiliation: string | null;
  feePiasters: number | null;
  availabilityStatus: string;
  acceptingNewPatients: boolean;
  verifiedCredentialCount: number;
  completedVisits: number;
  isDemo: boolean;
};

export type ProviderDetail = ProviderCard & {
  subspecialty: string | null;
  bioAr: string | null;
  bioEn: string | null;
  previousExperience: string | null;
  skills: string[];
  verifiedCredentials: { kind: (typeof CREDENTIAL_KINDS)[number]; issuer: string; verifiedAt: string }[];
  services: { serviceId: string; code: string; nameAr: string; nameEn: string; pricePiasters: number; durationMinutes: number }[];
  workingHours: { weekday: number; startMinute: number; endMinute: number }[];
  awayUntil: string | null;
  bookingAvailable: false;
  bookingUnavailableReason: 'BOOKING_NOT_YET_RELEASED';
};

export type Credential = {
  id: string;
  kind: (typeof CREDENTIAL_KINDS)[number];
  issuer: string;
  identifier: string;
  issuedOn: string | null;
  expiresOn: string | null;
  status: (typeof CREDENTIAL_STATUSES)[number];
  reviewNote: string | null;
  reviewedAt: string | null;
  documentStatus: 'NOT_UPLOADED' | 'UPLOADED';
  createdAt: string;
};

export type MyProviderProfile = {
  exists: boolean;
  profile: (UpsertProviderProfileBody & {
    userId: string;
    verificationStatus: (typeof VERIFICATION_STATUSES)[number];
    verificationNote: string | null;
    submittedAt: string | null;
    verifiedAt: string | null;
    availabilityStatus: string;
    maxDailyAppointments: number;
    serviceRadiusKm: number;
    awayUntil: string | null;
    temporarilyUnavailable: boolean;
    isDemo: boolean;
  }) | null;
  credentials: Credential[];
  workingHours: { weekday: number; startMinute: number; endMinute: number }[];
  checklist: { key: string; done: boolean }[];
  canSubmit: boolean;
  bookable: boolean;
};

// ---------------------------------------------------------------- admin verification
export const verificationDecisionBody = z.object({
  decision: z.enum(VERIFICATION_DECISIONS),
  reason: z.string().trim().max(1000).optional().nullable(),
});
export type VerificationDecisionBody = z.infer<typeof verificationDecisionBody>;

export const credentialDecisionBody = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().trim().max(1000).optional().nullable(),
});
export type CredentialDecisionBody = z.infer<typeof credentialDecisionBody>;

export type VerificationQueueItem = {
  userId: string;
  providerType: (typeof PROVIDER_TYPES)[number];
  displayNameEn: string;
  displayNameAr: string;
  specialty: string | null;
  governorate: string;
  verificationStatus: (typeof VERIFICATION_STATUSES)[number];
  submittedAt: string | null;
  credentialCount: number;
  pendingCredentialCount: number;
  isDemo: boolean;
};

// ---------------------------------------------------------------- services & store
export type NursingService = {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  scopeAr: string;
  scopeEn: string;
  durationMinutes: number;
  basePricePiasters: number;
  requiresClinicalAuthorization: boolean;
  isDemo: boolean;
};

export type ProductCard = {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  summaryAr: string;
  summaryEn: string;
  fromPricePiasters: number | null;
  stockStatus: (typeof STOCK_STATUSES)[number];
  contentStatus: (typeof CONTENT_APPROVAL_STATUSES)[number];
  isDemo: boolean;
  categoryId: string | null;
  /** First product image (GET /v1/store/images/:id), or null. */
  imageId: string | null;
};

export type StoreCategory = { id: string; slug: string; nameAr: string; nameEn: string };

export type ProductDetail = ProductCard & {
  descriptionAr: string;
  descriptionEn: string;
  usageAr: string;
  usageEn: string;
  approvalReference: string | null;
  regulatoryNote: string | null;
  /** Brand-approved uses and warnings (empty until the brand owner supplies them). */
  approvedUsesAr: string;
  approvedUsesEn: string;
  warningsAr: string;
  warningsEn: string;
  images: { id: string; altAr: string; altEn: string }[];
  variants: { id: string; sku: string; labelAr: string; labelEn: string; pricePiasters: number; stockStatus: (typeof STOCK_STATUSES)[number] }[];
  /** Live, clinically approved statements: official indications, contraindications, claims, FAQs, education. */
  knowledge: ProductKnowledgeItem[];
};

export type StoreBundle = {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  pricePiasters: number;
  /** What the items cost separately, at current prices (the saving is computed, never typed in). */
  itemsValuePiasters: number;
  items: { productNameAr: string; productNameEn: string; variantLabelAr: string; variantLabelEn: string; quantity: number }[];
};

/** A cart line is a product variant OR a bundle. */
export const addCartItemBody = z
  .object({
    variantId: z.string().uuid().optional(),
    bundleId: z.string().uuid().optional(),
    quantity: z.number().int().min(1).max(20),
    forPatientId: z.string().uuid().optional().nullable(),
  })
  .refine((b) => Boolean(b.variantId) !== Boolean(b.bundleId), { message: 'Choose a product option or a bundle', path: ['variantId'] });
export type AddCartItemBody = z.infer<typeof addCartItemBody>;

export const updateCartItemBody = z.object({ quantity: z.number().int().min(1).max(20) });

export type CartLine = {
  id: string;
  variantId: string | null;
  bundleId: string | null;
  productSlug: string;
  productNameAr: string;
  productNameEn: string;
  variantLabelAr: string;
  variantLabelEn: string;
  unitPricePiasters: number;
  quantity: number;
  lineTotalPiasters: number;
  forPatientId: string | null;
  forPatientName: string | null;
  isDemo: boolean;
};

export type CartResponse = { lines: CartLine[]; subtotalPiasters: number; itemCount: number };

export const checkoutPreviewBody = z.object({ discountCode: z.string().trim().max(24).optional() }).default({});

export type CheckoutPreview = {
  lines: CartLine[];
  subtotalPiasters: number;
  /** At most one discount applies: the largest saving among automatic discounts and the entered code. */
  discount: { nameAr: string; nameEn: string; amountPiasters: number; code: string | null } | null;
  /** Set when a code was entered but does not apply (unknown, expired, minimum not reached, or not the best). */
  discountCodeRejected: boolean;
  deliveryFeePiasters: number | null;
  totalPiasters: number;
  currency: 'EGP';
  payment: {
    provider: 'PAYMOB';
    status: (typeof INTEGRATION_STATUSES)[number];
    /** Always true until a real, verified payment-provider integration is configured. */
    simulated: boolean;
    canPlaceRealOrder: boolean;
  };
  notices: string[];
};

// ---------------------------------------------------------------- earnings
export type EarningsSummary = {
  currency: 'EGP';
  todayNetPiasters: number;
  todayCompletedVisits: number;
  weekNetPiasters: number;
  availableForPayoutPiasters: number;
  pendingPiasters: number;
  entries: {
    id: string;
    entryType: (typeof LEDGER_ENTRY_TYPES)[number];
    status: (typeof LEDGER_STATUSES)[number];
    amountPiasters: number;
    description: string;
    occurredAt: string;
    isDemo: boolean;
  }[];
  containsDemoData: boolean;
  payoutsEnabled: boolean;
};

// ---------------------------------------------------------------- system
export type SystemStatus = {
  environment: string;
  demoMode: boolean;
  integrations: Record<'payments' | 'sms' | 'email' | 'storage' | 'ai' | 'push' | 'maps', (typeof INTEGRATION_STATUSES)[number]>;
};

export type AuditLogEntry = {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ApiErrorBody = { error: { code: string; message: string; details?: unknown } };
