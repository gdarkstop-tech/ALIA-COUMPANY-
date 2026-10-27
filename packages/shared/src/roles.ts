/**
 * Role model.
 *
 * The three primary experiences (PATIENT, DOCTOR, NURSE) may be self-selected by a user.
 * Internal roles are granted only by an ADMIN and are enforced again by PostgreSQL RLS —
 * this module is the shared vocabulary, never the security boundary on its own.
 */
export const ROLES = [
  'PATIENT',
  'DOCTOR',
  'NURSE',
  'ADMIN',
  'CLINICAL_REVIEWER',
  'SUPPORT',
  'TRUST_AND_SAFETY',
  'COMMERCE_MANAGER',
] as const;
export type Role = (typeof ROLES)[number];

export const SELF_SELECTABLE_ROLES = ['PATIENT', 'DOCTOR', 'NURSE'] as const satisfies readonly Role[];
export type SelfSelectableRole = (typeof SELF_SELECTABLE_ROLES)[number];

export const CLINICIAN_ROLES = ['DOCTOR', 'NURSE'] as const satisfies readonly Role[];
export const STAFF_ROLES = [
  'ADMIN',
  'CLINICAL_REVIEWER',
  'SUPPORT',
  'TRUST_AND_SAFETY',
  'COMMERCE_MANAGER',
] as const satisfies readonly Role[];
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Roles for which multi-factor authentication is mandatory in production. */
export const MFA_REQUIRED_ROLES: readonly Role[] = [...CLINICIAN_ROLES, ...STAFF_ROLES];

export const PERMISSIONS = [
  'provider.verification.review',
  'provider.verification.decide',
  'provider.capacity.manage_any',
  'catalog.tetrasol.manage',
  'catalog.services.manage',
  'audit.read',
  'users.read',
  'users.roles.grant',
  'safety.reports.read',
  /** Approve customer-facing medical product text (separately from editing it). */
  'catalog.content.approve',
  /** Register company-owned brands the store may sell. */
  'catalog.brands.manage',
  /** Suspend / block / reactivate accounts and restrict clinician bookings. */
  'users.status.manage',
  'users.appeals.decide',
  /** AI providers, model routing, prices, quotas and budgets. */
  'ai.config.manage',
  'ai.usage.read',
  /** Write evaluation cases and run evaluations (spends company AI budget). */
  'ai.eval.manage',
  /** Approve sending patient data to an AI provider (DPA / privacy terms on file). */
  'ai.data.approve',
  /** Clinically review evaluation cases and answers; approve a model for a medical route. */
  'ai.clinical.review',
  /** Work the queue of reported AI answers (content access is audited). */
  'ai.safety.review',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Least-privilege matrix for internal operations. Note what is *absent*: no staff role has
 * blanket read access to patient medical records. Clinical access is granted only through
 * patient consent / active care relationships (Milestone 3).
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  PATIENT: [],
  DOCTOR: [],
  NURSE: [],
  ADMIN: [
    'provider.verification.review',
    'provider.verification.decide',
    'provider.capacity.manage_any',
    'catalog.tetrasol.manage',
    'catalog.services.manage',
    'audit.read',
    'users.read',
    'users.roles.grant',
    'catalog.content.approve',
    'catalog.brands.manage',
    'users.status.manage',
    'users.appeals.decide',
    'ai.config.manage',
    'ai.usage.read',
    'ai.eval.manage',
    'ai.data.approve',
  ],
  // Clinical reviewers approve medical product text and AI models for medical routes; commerce
  // managers can edit product text but never approve it.
  CLINICAL_REVIEWER: ['provider.verification.review', 'provider.verification.decide', 'catalog.content.approve', 'ai.clinical.review', 'ai.safety.review'],
  SUPPORT: ['users.read', 'provider.verification.review'],
  TRUST_AND_SAFETY: ['audit.read', 'safety.reports.read', 'users.read', 'users.status.manage', 'users.appeals.decide', 'ai.safety.review'],
  COMMERCE_MANAGER: ['catalog.tetrasol.manage'],
};

export function permissionsFor(roles: readonly Role[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const role of roles) for (const p of ROLE_PERMISSIONS[role]) out.add(p);
  return out;
}

export function hasPermission(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((r) => ROLE_PERMISSIONS[r].includes(permission));
}

export function isStaff(roles: readonly Role[]): boolean {
  return roles.some((r) => (STAFF_ROLES as readonly Role[]).includes(r));
}

export function requiresMfa(roles: readonly Role[]): boolean {
  return roles.some((r) => MFA_REQUIRED_ROLES.includes(r));
}
