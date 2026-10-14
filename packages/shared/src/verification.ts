import type { VerificationStatus } from './enums';

/**
 * Provider verification state machine.
 *
 * Shared so UIs can show the right affordances; the authoritative enforcement is the
 * `app.enforce_provider_verification_transition` trigger in PostgreSQL.
 */
export type VerificationActor = 'PROVIDER' | 'REVIEWER' | 'ADMIN';

export const VERIFICATION_DECISIONS = ['START_REVIEW', 'APPROVE', 'REJECT', 'REQUEST_CHANGES', 'SUSPEND', 'REINSTATE'] as const;
export type VerificationDecision = (typeof VERIFICATION_DECISIONS)[number];

const TRANSITIONS: Record<VerificationActor, Partial<Record<VerificationStatus, readonly VerificationStatus[]>>> = {
  PROVIDER: {
    DRAFT: ['SUBMITTED'],
    CHANGES_REQUESTED: ['SUBMITTED'],
    REJECTED: ['SUBMITTED'],
  },
  REVIEWER: {
    SUBMITTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED'],
    UNDER_REVIEW: ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'],
  },
  ADMIN: {
    SUBMITTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED'],
    UNDER_REVIEW: ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'],
    APPROVED: ['SUSPENDED'],
    SUSPENDED: ['APPROVED'],
  },
};

export function canTransition(actor: VerificationActor, from: VerificationStatus, to: VerificationStatus): boolean {
  return TRANSITIONS[actor][from]?.includes(to) ?? false;
}

export function decisionTarget(decision: VerificationDecision): VerificationStatus {
  switch (decision) {
    case 'START_REVIEW':
      return 'UNDER_REVIEW';
    case 'APPROVE':
      return 'APPROVED';
    case 'REJECT':
      return 'REJECTED';
    case 'REQUEST_CHANGES':
      return 'CHANGES_REQUESTED';
    case 'SUSPEND':
      return 'SUSPENDED';
    case 'REINSTATE':
      return 'APPROVED';
  }
}

/** Decisions that must carry a written reason (shown to the provider and kept in the audit log). */
export function decisionRequiresReason(decision: VerificationDecision): boolean {
  return decision === 'REJECT' || decision === 'REQUEST_CHANGES' || decision === 'SUSPEND';
}

export function isBookable(status: VerificationStatus): boolean {
  return status === 'APPROVED';
}
