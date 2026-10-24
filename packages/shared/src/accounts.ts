import { z } from 'zod';
import type { ROLES } from './roles';

/**
 * Account status management (migration 0009). Every change is made by app.set_account_status()
 * in the database: permission-checked, never on oneself, staff targets only by an ADMIN, always
 * with a reason and an internal note, and — for clinicians — a care-continuity note.
 */
export const ACCOUNT_STATUSES = ['ACTIVE', 'SUSPENDED', 'BLOCKED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];
/** Reasons staff can choose when restricting an account. */
export const RESTRICTION_REASONS = ['SAFETY_CONCERN', 'FRAUD_SUSPECTED', 'TERMS_VIOLATION', 'CREDENTIAL_ISSUE', 'HARASSMENT', 'PAYMENT_ABUSE', 'LEGAL_REQUEST', 'IDENTITY_VERIFICATION', 'OTHER'] as const;
export const STATUS_REASONS = [...RESTRICTION_REASONS, 'RESOLVED', 'APPEAL_GRANTED'] as const;
export type StatusReason = (typeof STATUS_REASONS)[number];
export const STATUS_ACTIONS = ['SUSPEND', 'BLOCK', 'REACTIVATE', 'RESTRICT_BOOKINGS', 'LIFT_BOOKING_RESTRICTION'] as const;
export type StatusAction = (typeof STATUS_ACTIONS)[number] | 'APPEAL_GRANTED';
export const APPEAL_STATUSES = ['OPEN', 'GRANTED', 'DENIED', 'WITHDRAWN'] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

export const accountStatusActionBody = z
  .object({
    action: z.enum(STATUS_ACTIONS),
    reason: z.enum(STATUS_REASONS),
    /** Shown to the person: plain language, no internal detail. Required to suspend or block. */
    publicMessage: z.string().trim().max(500).optional(),
    /** Staff-internal justification (never shown to the person). */
    staffNote: z.string().trim().min(10).max(2000),
    suspendedUntil: z.string().datetime({ offset: true }).nullable().optional(),
    /** Clinicians: what happens to their current patients while they are out of service. */
    careContinuityNote: z.string().trim().max(2000).optional(),
  })
  .refine((b) => !['SUSPEND', 'BLOCK'].includes(b.action) || Boolean(b.publicMessage), { message: 'A message for the person is required', path: ['publicMessage'] });
export type AccountStatusActionBody = z.infer<typeof accountStatusActionBody>;

export const appealBody = z.object({ message: z.string().trim().min(10).max(2000), eventId: z.string().uuid().optional() });
export const appealDecisionBody = z.object({ decision: z.enum(['GRANTED', 'DENIED']), note: z.string().trim().min(10).max(2000) });

export const adminUsersQuery = z.object({
  q: z.string().trim().max(120).optional(),
  role: z.enum(['PATIENT', 'DOCTOR', 'NURSE', 'STAFF', 'ANY']).default('ANY'),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'BLOCKED', 'BOOKINGS_RESTRICTED', 'ANY']).default('ANY'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export type AccountStatusInfo = {
  status: AccountStatus;
  bookingsRestricted: boolean;
  reason: StatusReason | null;
  publicMessage: string | null;
  suspendedUntil: string | null;
};

export type AdminUserListItem = {
  id: string;
  name: string;
  email: string;
  phoneNumber: string | null;
  roles: (typeof ROLES)[number][];
  twoFactorEnabled: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  deleted: boolean;
  isDemo: boolean;
  accountKind: 'STANDARD' | 'REVIEW' | 'INTERNAL_TEST';
  account: AccountStatusInfo;
  providerVerification: string | null;
};

export type AdminStatusEvent = {
  id: string;
  action: StatusAction;
  fromStatus: AccountStatus;
  toStatus: AccountStatus;
  bookingsRestricted: boolean;
  reason: StatusReason;
  publicMessage: string | null;
  staffNote: string;
  careContinuityNote: string | null;
  suspendedUntil: string | null;
  actorName: string | null;
  createdAt: string;
};

export type Appeal = {
  id: string;
  userId: string;
  userName?: string;
  eventId: string | null;
  message: string;
  status: AppealStatus;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
};

export type AdminUserDetail = AdminUserListItem & {
  emailVerified: boolean;
  phoneNumberVerified: boolean;
  events: AdminStatusEvent[];
  appeals: Appeal[];
  /** Counts only — staff never get blanket access to medical records from this screen. */
  patientProfiles: number;
  isSelf: boolean;
};

export type MyAccountStatus = {
  account: AccountStatusInfo;
  events: { id: string; action: StatusAction; fromStatus: AccountStatus; toStatus: AccountStatus; bookingsRestricted: boolean; reason: StatusReason; publicMessage: string | null; suspendedUntil: string | null; createdAt: string }[];
  appeals: Appeal[];
  canAppeal: boolean;
};
