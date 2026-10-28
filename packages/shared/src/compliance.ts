/**
 * Store & healthcare compliance contracts: consents, feature flags, account deletion,
 * emergency information. Server-side enforcement lives in apps/api/db/migrations/0006.
 */
import { z } from 'zod';

// ---------------------------------------------------------------- consents
export const CONSENT_TYPES = ['TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'HEALTH_DATA_PROCESSING', 'MARKETING_COMMUNICATIONS', 'AI_ASSISTANT_PROCESSING', 'AI_VOICE_PROCESSING', 'AI_DOCUMENT_PROCESSING', 'AI_CLINICAL_DOCUMENTATION'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];
/** Consents without which an account cannot use the product (marketing is always optional). */
export const REQUIRED_ACCOUNT_CONSENTS: readonly ConsentType[] = ['TERMS_OF_SERVICE', 'PRIVACY_POLICY'];
/** Explicit consent required before ANY health data is stored (Egypt PDPL: health data is sensitive). */
export const HEALTH_DATA_CONSENT: ConsentType = 'HEALTH_DATA_PROCESSING';
/** Optional, explicit consent before anything typed to the AI assistant is sent to an AI provider (migration 0010). */
export const AI_ASSISTANT_CONSENT: ConsentType = 'AI_ASSISTANT_PROCESSING';
/** Optional, explicit consent before the person's voice is streamed to an AI provider (migration 0017), in addition to AI_ASSISTANT_CONSENT. */
export const AI_VOICE_CONSENT: ConsentType = 'AI_VOICE_PROCESSING';
/** Optional, explicit consent before a medical document is sent to an AI provider to be read (migration 0020). */
export const AI_DOCUMENT_CONSENT: ConsentType = 'AI_DOCUMENT_PROCESSING';
export const AI_CLINICAL_CONSENT: ConsentType = 'AI_CLINICAL_DOCUMENTATION';
export const CONSENT_SOURCES = ['ios', 'android', 'web'] as const;

export const recordConsentBody = z.object({
  consents: z
    .array(
      z.object({
        type: z.enum(CONSENT_TYPES),
        /** Must equal the current document version (GET /v1/me/consents) — stale versions are rejected. */
        version: z.string().regex(/^[A-Za-z0-9._-]{1,40}$/),
        granted: z.boolean(),
      }),
    )
    .min(1)
    .max(CONSENT_TYPES.length),
  source: z.enum(CONSENT_SOURCES),
  locale: z.enum(['ar', 'en']),
});
export type RecordConsentBody = z.infer<typeof recordConsentBody>;

export type ConsentState = {
  type: ConsentType;
  currentVersion: string;
  granted: boolean;
  /** Version the user last answered; null when never asked. */
  answeredVersion: string | null;
  answeredAt: string | null;
  required: boolean;
};
export type ConsentsResponse = { consents: ConsentState[]; missingRequired: ConsentType[]; healthDataConsented: boolean };

// ---------------------------------------------------------------- feature flags
export const FEATURE_KEYS = [
  'ai.assistant',
  'ai.wound_assessment',
  'clinical.diagnostic_suggestions',
  'care.home_visit_booking',
  'care.video_consultation',
  'commerce.checkout',
  'billing.store_subscriptions',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type FeatureFlags = Record<FeatureKey, boolean>;
/** Safe default for clients before the server answers: everything off. */
export const FEATURES_OFF: FeatureFlags = Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])) as FeatureFlags;

export type FeatureFlagAdmin = {
  key: string;
  enabled: boolean;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  requiresRegulatoryEvidence: boolean;
  evidenceRef: string | null;
  description: string;
  updatedAt: string;
};
export const updateFeatureFlagBody = z.object({
  enabled: z.boolean(),
  evidenceRef: z.string().trim().min(3).max(300).optional().nullable(),
});

// ---------------------------------------------------------------- account deletion
export const ACCOUNT_DELETION_CONFIRMATION = 'DELETE';
export const deleteAccountBody = z.object({
  /** User must type the word exactly (case-insensitive) — protects against accidental taps. */
  confirmation: z.string().trim().transform((v) => v.toUpperCase()).pipe(z.literal(ACCOUNT_DELETION_CONFIRMATION)),
  /** Required for accounts with a password. Phone-only accounts must instead have signed in within the last 15 minutes. */
  password: z.string().min(1).max(128).optional(),
});
export type DeleteAccountBody = z.input<typeof deleteAccountBody>;
export type DeleteAccountResponse = {
  deleted: true;
  summary: {
    deletedPatientProfiles: number;
    detachedSharedProfiles: number;
    providerProfileDeleted: boolean;
    providerRecordsRetainedForLegalObligations: boolean;
  };
};

// ---------------------------------------------------------------- emergency
/**
 * Emergency number shown in the app (the app is NOT an emergency service). Only the ambulance
 * number is used: 123 is the Ministry of Health / Egyptian Ambulance Organization hotline per
 * official foreign-government travel guidance (evidence: docs/release/evidence, 2026-10-14). Other
 * services' numbers were contradictory across sources and are deliberately not shown.
 * Re-confirm with the Ministry of Health before every release (docs/release/HEALTHCARE_REVIEW.md).
 */
export const EMERGENCY_NUMBERS = { ambulance: '123' } as const;

// ---------------------------------------------------------------- client error reports
export const clientErrorReportBody = z.object({
  /** Error name + message only; never form values, health data or tokens. */
  message: z.string().max(500),
  name: z.string().max(100).optional(),
  stack: z.string().max(4000).optional(),
  route: z.string().max(200).optional(),
  platform: z.enum(['ios', 'android', 'web']),
  appVersion: z.string().max(40),
  appVariant: z.string().max(20),
  fatal: z.boolean(),
});
export type ClientErrorReport = z.infer<typeof clientErrorReportBody>;
