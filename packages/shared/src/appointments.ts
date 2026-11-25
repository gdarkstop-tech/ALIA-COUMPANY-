import { z } from 'zod';
import { GOVERNORATES } from './enums';

/** Bookings (ADR 0021). Times are ISO instants; slots are generated in Africa/Cairo local time. */
export const BOOKING_TIME_ZONE = 'Africa/Cairo';

export const APPOINTMENT_KINDS = ['DOCTOR_CLINIC', 'DOCTOR_HOME_VISIT', 'DOCTOR_ONLINE', 'NURSE_HOME_VISIT'] as const;
export type AppointmentKind = (typeof APPOINTMENT_KINDS)[number];
export const DOCTOR_OFFERING_KINDS = ['DOCTOR_CLINIC', 'DOCTOR_HOME_VISIT', 'DOCTOR_ONLINE'] as const;
export type DoctorOfferingKind = (typeof DOCTOR_OFFERING_KINDS)[number];

export const APPOINTMENT_STATUSES = ['REQUESTED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'DECLINED', 'CANCELLED', 'EXPIRED', 'NO_SHOW', 'VISIT_FAILED'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export const ACTIVE_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = ['REQUESTED', 'CONFIRMED', 'IN_PROGRESS'];

export const VISIT_FAILURE_CATEGORIES = ['PATIENT_NOT_AVAILABLE', 'ADDRESS_NOT_FOUND', 'UNSAFE_ENVIRONMENT', 'CLINICAL_ESCALATION', 'PROVIDER_UNABLE', 'OTHER'] as const;
export type VisitFailureCategory = (typeof VISIT_FAILURE_CATEGORIES)[number];
export const PATIENT_ISSUE_CATEGORIES = ['PROVIDER_DID_NOT_ARRIVE', 'PROVIDER_LATE', 'CONDUCT', 'PRICE_DISPUTE', 'OTHER'] as const;
export type PatientIssueCategory = (typeof PATIENT_ISSUE_CATEGORIES)[number];

/** Why a provider cannot be booked (null = bookable). */
export type BookingBlock =
  | 'FEATURE_DISABLED'
  | 'VIDEO_NOT_CONFIGURED'
  | 'NO_SCHEDULE'
  | 'NOT_OFFERED'
  | 'PROVIDER_NOT_AVAILABLE'
  | 'TEMPORARILY_UNAVAILABLE'
  | 'AWAY'
  | 'FULLY_BOOKED'
  | 'EXISTING_PATIENTS_ONLY'
  | 'AREA_NOT_SERVED';

export type BookingOption = {
  kind: AppointmentKind;
  /** Doctor offering id, or nursing service id for home nursing. */
  offeringId: string | null;
  serviceId: string | null;
  nameAr: string | null;
  nameEn: string | null;
  durationMinutes: number;
  pricePiasters: number;
  clinicAddressAr: string | null;
  clinicAddressEn: string | null;
  requiresClinicalAuthorization: boolean;
  bookable: boolean;
  blockedReason: BookingBlock | null;
};

export type AvailabilityResponse = {
  timeZone: typeof BOOKING_TIME_ZONE;
  bookable: boolean;
  blockedReason: BookingBlock | null;
  durationMinutes: number;
  pricePiasters: number;
  /** Only real free slots from the provider's published hours; empty when there are none. */
  slots: { startsAt: string; endsAt: string }[];
};

export const availabilityQuery = z.object({
  kind: z.enum(APPOINTMENT_KINDS),
  offeringId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  days: z.coerce.number().int().min(1).max(31).default(14),
});
export type AvailabilityQuery = z.input<typeof availabilityQuery>;

const homeAddress = z.object({
  governorate: z.enum(GOVERNORATES),
  city: z.string().trim().min(1).max(80),
  district: z.string().trim().max(80).optional().nullable(),
  address: z.string().trim().min(5).max(300),
});

export const createAppointmentBody = z
  .object({
    kind: z.enum(APPOINTMENT_KINDS),
    providerUserId: z.string().min(1).max(64),
    patientId: z.string().uuid(),
    offeringId: z.string().uuid().optional(),
    serviceId: z.string().uuid().optional(),
    startsAt: z.string().datetime({ offset: true }),
    visit: homeAddress.optional(),
    contactPhone: z.string().trim().min(6).max(20).optional(),
    note: z.string().trim().max(500).optional(),
    clinicalAuthorizationAttested: z.boolean().optional(),
  })
  .strict();
export type CreateAppointmentBody = z.infer<typeof createAppointmentBody>;

export const respondAppointmentBody = z.object({ accept: z.boolean(), reason: z.string().trim().max(500).optional() }).strict();
export const cancelAppointmentBody = z.object({ reason: z.string().trim().max(500).optional() }).strict();
export const rescheduleAppointmentBody = z.object({ startsAt: z.string().datetime({ offset: true }), reason: z.string().trim().max(500).optional() }).strict();
export const progressAppointmentBody = z
  .object({ action: z.enum(['START', 'COMPLETE', 'NO_SHOW', 'FAIL']), reason: z.string().trim().max(500).optional(), failureCategory: z.enum(VISIT_FAILURE_CATEGORIES).optional() })
  .strict();
export const reportAppointmentIssueBody = z.object({ category: z.enum(PATIENT_ISSUE_CATEGORIES) }).strict();

export type AppointmentEvent = {
  event: string;
  actorRole: 'PATIENT' | 'PROVIDER' | 'ADMIN' | 'SYSTEM';
  fromStatus: AppointmentStatus | null;
  toStatus: AppointmentStatus;
  oldStartsAt: string | null;
  newStartsAt: string | null;
  note: string | null;
  at: string;
};

export type Appointment = {
  id: string;
  reference: string;
  kind: AppointmentKind;
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  respondBy: string;
  provider: { userId: string; displayNameAr: string; displayNameEn: string; providerType: 'DOCTOR' | 'NURSE'; specialty: string | null };
  patient: { id: string; displayName: string };
  service: { id: string; nameAr: string; nameEn: string } | null;
  offeringId: string | null;
  clinicAddressAr: string | null;
  clinicAddressEn: string | null;
  pricePiasters: number;
  currency: 'EGP';
  paymentMethod: 'PAY_AT_VISIT';
  /** Home visits. The provider sees the street address only after accepting. */
  visit: { governorate: string; city: string; district: string | null; address: string | null; contactPhone: string | null } | null;
  note: string | null;
  statusReason: string | null;
  failureCategory: VisitFailureCategory | null;
  cancelledBy: 'PATIENT' | 'PROVIDER' | 'ADMIN' | null;
  rescheduleCount: number;
  /** What the viewer may do now (computed from the same rules the database enforces). */
  viewerRole: 'PATIENT' | 'PROVIDER' | 'ADMIN';
  can: { cancel: boolean; reschedule: boolean; respond: boolean; start: boolean; complete: boolean; noShow: boolean; fail: boolean; reportIssue: boolean };
  events?: AppointmentEvent[];
  createdAt: string;
};

// ---------------------------------------------------------------- provider self-service
export const doctorOfferingsBody = z.object({
  offerings: z
    .array(
      z.object({
        kind: z.enum(DOCTOR_OFFERING_KINDS),
        durationMinutes: z.union([z.literal(15), z.literal(20), z.literal(30), z.literal(45), z.literal(60), z.literal(90)]),
        pricePiasters: z.number().int().min(0).max(10_000_000),
        clinicAddressAr: z.string().trim().min(5).max(300).optional().nullable(),
        clinicAddressEn: z.string().trim().min(5).max(300).optional().nullable(),
        active: z.boolean().default(true),
      }),
    )
    .max(3),
});
export type DoctorOfferingsBody = z.input<typeof doctorOfferingsBody>;
export type DoctorOffering = {
  id: string;
  kind: DoctorOfferingKind;
  durationMinutes: number;
  pricePiasters: number;
  clinicAddressAr: string | null;
  clinicAddressEn: string | null;
  active: boolean;
};

export const coverageBody = z.object({
  areas: z.array(z.object({ governorate: z.enum(GOVERNORATES), city: z.string().trim().min(1).max(80).optional().nullable() })).max(30),
});
export type CoverageBody = z.input<typeof coverageBody>;

export const timeOffBody = z
  .object({ startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }), note: z.string().trim().max(200).optional() })
  .strict()
  .refine((b) => new Date(b.endsAt) > new Date(b.startsAt), { message: 'endsAt must be after startsAt' });
export type TimeOffBody = z.infer<typeof timeOffBody>;
export type TimeOff = { id: string; startsAt: string; endsAt: string; note: string | null };

// ---------------------------------------------------------------- operations
export type OpsAppointment = {
  id: string;
  reference: string;
  kind: AppointmentKind;
  status: AppointmentStatus;
  startsAt: string;
  providerName: string;
  providerUserId: string;
  patientDisplayName: string;
  governorate: string | null;
  pricePiasters: number;
  failureCategory: VisitFailureCategory | null;
  cancelledBy: string | null;
  createdAt: string;
};
export const INCIDENT_KINDS = ['VISIT_FAILED', 'PROVIDER_NO_SHOW', 'PATIENT_REPORTED_ISSUE', 'PAYMENT_MISMATCH', 'PAYMENT_WEBHOOK_REJECTED', 'REFUND_FAILED', 'ORDER_ISSUE', 'NOTIFICATION_FAILURES', 'OTHER'] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];
export type OpsIncident = {
  id: string;
  kind: IncidentKind;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  domain: 'CARE' | 'COMMERCE' | 'PLATFORM';
  title: string;
  detail: string | null;
  relatedType: string | null;
  relatedId: string | null;
  resolution: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
};
export const resolveIncidentBody = z.object({ resolution: z.string().trim().min(5).max(1000) }).strict();
export const homeCareRegionBody = z.object({ active: z.boolean(), note: z.string().trim().max(300).optional().nullable() }).strict();
