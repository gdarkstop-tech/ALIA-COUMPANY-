import { describe, expect, it } from 'vitest';
import {
  ageInYears,
  canTransition,
  createPatientBody,
  decisionRequiresReason,
  formatEgp,
  hasPermission,
  isMinor,
  requiresMfa,
} from '../src';

describe('role permissions', () => {
  it('grants verification decisions to reviewers and admins only', () => {
    expect(hasPermission(['CLINICAL_REVIEWER'], 'provider.verification.decide')).toBe(true);
    expect(hasPermission(['ADMIN'], 'provider.verification.decide')).toBe(true);
    expect(hasPermission(['SUPPORT'], 'provider.verification.decide')).toBe(false);
    expect(hasPermission(['PATIENT', 'DOCTOR'], 'provider.verification.decide')).toBe(false);
  });
  it('requires MFA for clinicians and staff, not for patients', () => {
    expect(requiresMfa(['PATIENT'])).toBe(false);
    expect(requiresMfa(['NURSE'])).toBe(true);
    expect(requiresMfa(['COMMERCE_MANAGER'])).toBe(true);
  });
});

describe('verification state machine', () => {
  it('lets providers submit drafts but never approve themselves', () => {
    expect(canTransition('PROVIDER', 'DRAFT', 'SUBMITTED')).toBe(true);
    expect(canTransition('PROVIDER', 'SUBMITTED', 'APPROVED')).toBe(false);
    expect(canTransition('PROVIDER', 'DRAFT', 'APPROVED')).toBe(false);
  });
  it('lets reviewers decide submitted profiles but not suspend', () => {
    expect(canTransition('REVIEWER', 'SUBMITTED', 'APPROVED')).toBe(true);
    expect(canTransition('REVIEWER', 'APPROVED', 'SUSPENDED')).toBe(false);
    expect(canTransition('ADMIN', 'APPROVED', 'SUSPENDED')).toBe(true);
  });
  it('requires reasons for negative decisions', () => {
    expect(decisionRequiresReason('REJECT')).toBe(true);
    expect(decisionRequiresReason('APPROVE')).toBe(false);
  });
});

describe('patient creation contract', () => {
  const base = { displayName: 'Test', dateOfBirth: '1960-01-01', sex: 'FEMALE', consentAttested: true, consentStatementVersion: 'v1' } as const;
  it('rejects SELF relationship without SELF consent basis', () => {
    expect(createPatientBody.safeParse({ ...base, relationship: 'SELF', consentBasis: 'ADULT_CONSENT_ATTESTED' }).success).toBe(false);
  });
  it('requires explicit consent attestation', () => {
    expect(createPatientBody.safeParse({ ...base, relationship: 'MOTHER', consentBasis: 'ADULT_CONSENT_ATTESTED', consentAttested: false }).success).toBe(false);
    expect(createPatientBody.safeParse({ ...base, relationship: 'MOTHER', consentBasis: 'ADULT_CONSENT_ATTESTED' }).success).toBe(true);
  });
});

describe('helpers', () => {
  it('computes age and minority', () => {
    const today = new Date(Date.UTC(2026, 9, 14));
    expect(ageInYears('2008-10-15', today)).toBe(17);
    expect(isMinor('2008-10-15', today)).toBe(true);
    expect(isMinor('2008-10-14', today)).toBe(false);
  });
  it('formats piasters as EGP', () => {
    expect(formatEgp(235000, 'en')).toBe('2,350 EGP');
  });
});
