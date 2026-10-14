/** Domain enumerations. Mirrors PostgreSQL enum types in apps/api/db/migrations. */

export const PROVIDER_TYPES = ['DOCTOR', 'NURSE'] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const VERIFICATION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const DOCTOR_AVAILABILITY = [
  'ACCEPTING_NEW_PATIENTS',
  'LIMITED_AVAILABILITY',
  'EXISTING_PATIENTS_ONLY',
  'FULLY_BOOKED',
  'AWAY',
] as const;
export type DoctorAvailability = (typeof DOCTOR_AVAILABILITY)[number];

export const NURSE_AVAILABILITY = [
  'AVAILABLE_NOW',
  'AVAILABLE_TODAY',
  'SCHEDULED_ONLY',
  'FULLY_BOOKED',
  'AWAY',
] as const;
export type NurseAvailability = (typeof NURSE_AVAILABILITY)[number];

export const AVAILABILITY_STATUSES = [
  ...new Set([...DOCTOR_AVAILABILITY, ...NURSE_AVAILABILITY]),
] as readonly (DoctorAvailability | NurseAvailability)[];
export type AvailabilityStatus = DoctorAvailability | NurseAvailability;

export function availabilityOptionsFor(type: ProviderType): readonly AvailabilityStatus[] {
  return type === 'DOCTOR' ? DOCTOR_AVAILABILITY : NURSE_AVAILABILITY;
}

/** Statuses in which a provider stays discoverable but cannot take *new* patients. */
export function acceptsNewPatients(status: AvailabilityStatus): boolean {
  return ['ACCEPTING_NEW_PATIENTS', 'LIMITED_AVAILABILITY', 'AVAILABLE_NOW', 'AVAILABLE_TODAY', 'SCHEDULED_ONLY'].includes(
    status,
  );
}

export const CREDENTIAL_KINDS = [
  'NATIONAL_ID',
  'MEDICAL_LICENSE',
  'MEDICAL_DEGREE',
  'SPECIALTY_BOARD',
  'NURSING_LICENSE',
  'NURSING_DEGREE',
  'CERTIFICATION',
] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

/** Credential kinds that must be present (and approved) before a provider can be approved. */
export const REQUIRED_CREDENTIALS: Record<ProviderType, readonly CredentialKind[]> = {
  DOCTOR: ['NATIONAL_ID', 'MEDICAL_LICENSE', 'MEDICAL_DEGREE'],
  NURSE: ['NATIONAL_ID', 'NURSING_LICENSE'],
};

export const CREDENTIAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];

export const SEXES = ['FEMALE', 'MALE', 'UNSPECIFIED'] as const;
export type Sex = (typeof SEXES)[number];

export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'UNKNOWN'] as const;
export type BloodType = (typeof BLOOD_TYPES)[number];

/**
 * Provenance of medical information. A questionnaire answer is always PATIENT_REPORTED —
 * it can never be promoted to PROFESSIONALLY_VERIFIED except by a verified clinician.
 */
export const PROVENANCES = ['PATIENT_REPORTED', 'CAREGIVER_REPORTED', 'PROFESSIONALLY_VERIFIED', 'IMPORTED_DOCUMENT'] as const;
export type Provenance = (typeof PROVENANCES)[number];

export const HEALTH_ENTRY_KINDS = ['ALLERGY', 'CONDITION', 'MEDICATION', 'SURGERY'] as const;
export type HealthEntryKind = (typeof HEALTH_ENTRY_KINDS)[number];

/** FHIR R4 resource each entry kind maps to (future interoperability). */
export const HEALTH_ENTRY_FHIR: Record<HealthEntryKind, string> = {
  ALLERGY: 'AllergyIntolerance',
  CONDITION: 'Condition',
  MEDICATION: 'MedicationStatement',
  SURGERY: 'Procedure',
};

export const RELATIONSHIPS = ['SELF', 'MOTHER', 'FATHER', 'SPOUSE', 'CHILD', 'SIBLING', 'GRANDPARENT', 'OTHER'] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

export const ACCESS_LEVELS = ['OWNER', 'GUARDIAN', 'CAREGIVER'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

/**
 * Legal basis under which a user manages another person's profile.
 * - SELF: the account holder's own profile.
 * - GUARDIAN_OF_MINOR: parent/legal guardian of a person under 18.
 * - ADULT_CONSENT_ATTESTED: the adult has consented (attested by the caregiver; the adult can
 *   later claim the profile and revoke access).
 * - LEGAL_AUTHORITY_ATTESTED: caregiver attests legal authority (e.g. guardianship order) for an
 *   adult who cannot consent. Requires review before any clinician sharing (Milestone 3).
 */
export const CONSENT_BASES = ['SELF', 'GUARDIAN_OF_MINOR', 'ADULT_CONSENT_ATTESTED', 'LEGAL_AUTHORITY_ATTESTED'] as const;
export type ConsentBasis = (typeof CONSENT_BASES)[number];

export const ACCESS_STATUSES = ['ACTIVE', 'REVOKED'] as const;
export type AccessStatus = (typeof ACCESS_STATUSES)[number];

export const STOCK_STATUSES = ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK', 'UNKNOWN'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

/** Product content may only be shown to customers once APPROVED by the brand owner. */
export const CONTENT_APPROVAL_STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'RETIRED'] as const;
export type ContentApprovalStatus = (typeof CONTENT_APPROVAL_STATUSES)[number];

export const LEDGER_ENTRY_TYPES = ['VISIT_EARNING', 'PLATFORM_FEE', 'ADJUSTMENT', 'PAYOUT'] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export const LEDGER_STATUSES = ['PENDING', 'AVAILABLE', 'PAID_OUT'] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];

export const INTEGRATION_STATUSES = ['CONFIGURED', 'NOT_CONFIGURED', 'DEV_ADAPTER', 'DISABLED'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export const SPECIALTIES = [
  'GENERAL_PRACTICE',
  'INTERNAL_MEDICINE',
  'GENERAL_SURGERY',
  'PLASTIC_SURGERY',
  'VASCULAR_SURGERY',
  'DERMATOLOGY',
  'ENDOCRINOLOGY',
  'GERIATRICS',
  'ORTHOPEDICS',
  'CARDIOLOGY',
  'PEDIATRICS',
  'FAMILY_MEDICINE',
] as const;
export type Specialty = (typeof SPECIALTIES)[number];

export const GOVERNORATES = ['CAIRO', 'GIZA', 'ALEXANDRIA', 'QALYUBIA', 'SHARQIA', 'DAKAHLIA', 'RED_SEA', 'SOUTH_SINAI'] as const;
export type Governorate = (typeof GOVERNORATES)[number];
