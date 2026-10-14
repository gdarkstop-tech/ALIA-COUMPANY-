import type { PatientSummary, ProductCard, ProviderCard } from './contracts';

/**
 * Dashboard payloads are assembled only from real persisted data. Sections whose feature
 * ships in a later milestone report `status: 'NOT_YET_AVAILABLE'` instead of inventing content.
 */
export type SectionStatus = 'READY' | 'EMPTY' | 'NOT_YET_AVAILABLE' | 'NOT_CONFIGURED';

export type PatientDashboard = {
  activePatient: PatientSummary;
  family: { patient: PatientSummary; highlights: { key: string; params?: Record<string, string | number> }[] }[];
  healthSnapshot: { allergies: number; conditions: number; medications: number; surgeries: number; profileCompleteness: number };
  todayTasks: { status: SectionStatus };
  appointments: { status: SectionStatus };
  nurseVisits: { status: SectionStatus };
  medicationReminders: { status: SectionStatus; activeMedications: number };
  careTeam: { status: SectionStatus };
  aiAssistant: { status: SectionStatus; assistantName: string | null };
  tetrasol: { status: SectionStatus; featured: ProductCard[] };
  suggestedProviders: ProviderCard[];
};

export type ClinicianDashboard = {
  providerType: 'DOCTOR' | 'NURSE';
  displayName: string;
  verificationStatus: string;
  availabilityStatus: string;
  bookable: boolean;
  mfaEnrolled: boolean;
  todayAppointments: { status: SectionStatus };
  activePatients: { status: SectionStatus };
  messages: { status: SectionStatus };
  careTasks: { status: SectionStatus };
  earnings: { todayNetPiasters: number; weekNetPiasters: number; availableForPayoutPiasters: number; containsDemoData: boolean };
  aiAssistant: { status: SectionStatus };
  loyalty: { status: SectionStatus };
  serviceCount: number;
  workingDays: number;
};
