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

describe('lab report parsing (deterministic, never the model)', () => {
  it('parses printed values, including Arabic digits and decimal commas; bounds are not measurements', async () => {
    const { parseLabValue } = await import('../src');
    expect(parseLabValue('13.8')).toEqual({ numeric: 13.8, qualified: false });
    expect(parseLabValue('١٣٫٥')).toEqual({ numeric: 13.5, qualified: false });
    expect(parseLabValue('13,5')).toEqual({ numeric: 13.5, qualified: false });
    expect(parseLabValue('1,250')).toEqual({ numeric: 1250, qualified: false });
    expect(parseLabValue('< 0.5')).toEqual({ numeric: 0.5, qualified: true });
    expect(parseLabValue('Positive')).toEqual({ numeric: null, qualified: false });
    expect(parseLabValue('12.5 H')).toEqual({ numeric: null, qualified: false });
  });

  it('derives stored values from the printed text only; a bound never becomes a number', async () => {
    const { deriveLabRow } = await import('../src');
    expect(deriveLabRow({ testName: 'CRP', value: '< 5', unit: 'mg/L', referenceRange: '< 5', flag: null })).toMatchObject({ valueNumeric: null, rangeStatus: 'UNKNOWN' });
    expect(deriveLabRow({ testName: 'Hb', value: '9.1', unit: '', referenceRange: '12 - 16', flag: 'L' })).toEqual({
      testName: 'Hb', valueText: '9.1', valueNumeric: 9.1, unit: null, referenceText: '12 - 16', referenceLow: 12, referenceHigh: 16, printedFlag: 'L', rangeStatus: 'LOW',
    });
  });

  it('reads printed reference ranges and compares only against them', async () => {
    const { parseReferenceRange, rangeStatus, isPrintedCritical, safeIsoDate } = await import('../src');
    expect(parseReferenceRange('12.0 - 16.0')).toMatchObject({ low: 12, high: 16 });
    expect(parseReferenceRange('12–16 g/dL')).toMatchObject({ low: 12, high: 16 });
    expect(parseReferenceRange('< 5.7')).toMatchObject({ low: null, high: 5.7, highExclusive: true });
    expect(parseReferenceRange('> 90')).toMatchObject({ low: 90, high: null, lowExclusive: true });
    expect(parseReferenceRange('أقل من ٢٠٠')).toMatchObject({ high: 200 });
    expect(parseReferenceRange('see comment')).toMatchObject({ low: null, high: null });
    expect(parseReferenceRange('16 - 12')).toMatchObject({ low: null, high: null }); // inverted: not trusted
    expect(rangeStatus('9.1', '12.0 - 16.0')).toBe('LOW');
    expect(rangeStatus('14.5', '4.0 - 11.0')).toBe('HIGH');
    expect(rangeStatus('16.0', '12.0 - 16.0')).toBe('IN_RANGE');
    expect(rangeStatus('5.7', '< 5.7')).toBe('HIGH');
    expect(rangeStatus('90', '> 90')).toBe('LOW');
    expect(rangeStatus('< 0.5', '0 - 1')).toBe('UNKNOWN');
    expect(rangeStatus('Negative', 'Negative')).toBe('UNKNOWN');
    expect(rangeStatus('7', null)).toBe('UNKNOWN');
    expect(isPrintedCritical('CRITICAL')).toBe(true);
    expect(isPrintedCritical('H')).toBe(false);
    expect(safeIsoDate('2026-09-14')).toBe('2026-09-14');
    expect(safeIsoDate('2026-02-30')).toBeNull();
    expect(safeIsoDate('14/09/2026')).toBeNull();
  });
});
