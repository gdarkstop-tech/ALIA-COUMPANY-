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

describe('health analytics (deterministic; AI summaries validated against the facts)', () => {
  const pt = (id: string, value: number, at: string, value2: number | null = null) => ({ id, value, value2, at, provenance: 'PATIENT_REPORTED' as const });

  it('computes statistics without judging them', async () => {
    const { seriesStats, directionOf } = await import('../src');
    expect(seriesStats([])).toBeNull();
    const s = seriesStats([pt('b', 142, '2026-10-20T08:00:00Z', 91), pt('a', 136, '2026-10-13T08:00:00Z', 88), pt('c', 130, '2026-10-01T08:00:00Z', 85)])!;
    expect(s).toMatchObject({ count: 3, change: 6, change2: 3, mean: 136, mean2: 88, min: 130, max: 142, firstAt: '2026-10-01T08:00:00Z' });
    expect(s.latest.id).toBe('b');
    expect(s.previous!.id).toBe('a');
    expect(seriesStats([pt('a', 70.4, '2026-10-01T00:00:00Z'), pt('b', 70.1, '2026-10-08T00:00:00Z')])).toMatchObject({ change: -0.3, mean: 70.25 });
    expect(seriesStats([pt('a', 98, '2026-10-01T00:00:00Z')])).toMatchObject({ count: 1, previous: null, change: null });
    expect([directionOf(6), directionOf(-0.3), directionOf(0), directionOf(null)]).toEqual(['HIGHER', 'LOWER', 'UNCHANGED', null]);
  });

  it('builds numbered facts from statistics only', async () => {
    const { buildHealthFacts, seriesStats } = await import('../src');
    const points = [pt('a', 136, '2026-10-13T08:00:00Z', 88), pt('b', 142, '2026-10-20T08:00:00Z', 91)];
    const facts = buildHealthFacts([{ key: 'VITAL:BLOOD_PRESSURE', source: 'VITAL', kind: 'BLOOD_PRESSURE', label: 'Blood pressure', unit: 'mmHg', points, stats: seriesStats(points), printedRange: null }], 30);
    expect(facts.map((f) => f.id)).toEqual(['F1', 'F2', 'F3', 'F4']);
    expect(facts[0]!.text).toBe('Blood pressure (mmHg): latest 142/91 on 2026-10-20, reported by the patient.');
    expect(facts[2]!.text).toContain('higher than the previous one (difference +6/+3)');
    expect(facts[3]!.numbers).toEqual([2, 30, 139, 89.5, 136, 142]);
    expect(facts.map((f) => f.display)).toEqual([
      { kind: 'LATEST', value: '142/91', date: '2026-10-20' },
      { kind: 'PREVIOUS', value: '136/88', date: '2026-10-13' },
      { kind: 'CHANGE', direction: 'HIGHER', difference: '+6/+3' },
      { kind: 'STATS', count: 2, days: 30, mean: '139/89.5', min: 136, max: 142 },
    ]);
  });

  it('accepts only grounded, non-judgemental summaries', async () => {
    const { checkHealthSummary } = await import('../src');
    const base = { seriesKey: 'k', seriesLabel: 'Blood pressure', unit: 'mmHg', text: '' };
    const facts = [
      { ...base, id: 'F1', type: 'MEASURED' as const, numbers: [142, 91, 2026, 10, 20], display: { kind: 'LATEST' as const, value: '142/91', date: '2026-10-20' } },
      { ...base, id: 'F2', type: 'CALCULATED' as const, numbers: [6, 3], display: { kind: 'CHANGE' as const, direction: 'HIGHER' as const, difference: '+6/+3' } },
    ];
    const ok = checkHealthSummary(JSON.stringify({ points: [{ text: 'Your latest reading was 142/91 on 20 October (F1).', facts: ['F1'] }, { text: 'It is 6/3 higher than the one before.', facts: ['F2'] }], questions: ['What should my readings be?'] }), facts);
    expect(ok.ok).toBe(true);
    const ar = checkHealthSummary(JSON.stringify({ points: [{ text: 'آخر قراءة كانت ١٤٢/٩١.', facts: ['F1'] }], questions: [] }), facts);
    expect(ar.ok).toBe(true);
    const cases: [object | string, string][] = [
      ['not json', 'INVALID_JSON'],
      [{ points: [], questions: [] }, 'INVALID_JSON'],
      [{ points: [{ text: 'x', facts: ['F9'] }], questions: [] }, 'UNKNOWN_FACT'],
      [{ points: [{ text: 'Your average was 135.', facts: ['F1'] }], questions: [] }, 'UNGROUNDED_NUMBER'],
      [{ points: [{ text: 'It went up by 6.', facts: ['F1'] }], questions: [] }, 'UNGROUNDED_NUMBER'], // 6 is in F2, not in F1
      [{ points: [{ text: 'Latest 142/91.', facts: ['F1'] }], questions: ['Is 140 too high?'] }, 'UNGROUNDED_NUMBER'],
      [{ points: [{ text: 'Your blood pressure is improving.', facts: ['F1'] }], questions: [] }, 'FORBIDDEN_CLAIM'],
      [{ points: [{ text: 'This is normal.', facts: ['F1'] }], questions: [] }, 'FORBIDDEN_CLAIM'],
      [{ points: [{ text: 'ضغطك تحسّن.', facts: ['F1'] }], questions: [] }, 'FORBIDDEN_CLAIM'],
      [{ points: [{ text: 'Latest 142/91.', facts: ['F1'] }], questions: ['Should I change my medication?'] }, 'FORBIDDEN_CLAIM'],
    ];
    for (const [out, reason] of cases) expect(checkHealthSummary(typeof out === 'string' ? out : JSON.stringify(out), facts), JSON.stringify(out)).toMatchObject({ ok: false, reason });
  });
});

describe('clinical draft guard (the AI organises the clinician’s notes; it adds nothing)', () => {
  const notes = 'Wound on left shin 3 cm, less redness. Continue amoxicillin 500 mg three times daily. Review in 5 days.';
  const visit = (over: Record<string, unknown> = {}) => JSON.stringify({ subjective: 'Not documented.', objective: 'Wound on left shin, 3 cm, less redness.', assessment: 'Improving per clinician.', plan: 'Continue amoxicillin 500 mg three times daily. Review in 5 days.', checksForClinician: [], ...over });

  it('accepts a draft whose doses all come from the notes or the recorded medicines', async () => {
    const { checkClinicalDraft } = await import('../src');
    expect(checkClinicalDraft('VISIT_NOTE', visit(), notes, []).ok).toBe(true);
    expect(checkClinicalDraft('VISIT_NOTE', visit({ checksForClinician: ['Recorded: metformin 500mg daily.'] }), notes, ['Metformin 500 mg']).ok).toBe(true);
    // Arabic digits and units are the same dose.
    expect(checkClinicalDraft('VISIT_NOTE', visit({ plan: 'الاستمرار على أموكسيسيلين ٥٠٠ مجم.' }), notes, []).ok).toBe(true);
  });

  it('rejects new doses, diagnoses, orders and dose changes the clinician did not write', async () => {
    const { checkClinicalDraft } = await import('../src');
    expect(checkClinicalDraft('VISIT_NOTE', visit({ plan: 'Continue amoxicillin 875 mg.' }), notes, [])).toMatchObject({ ok: false, reason: 'UNGROUNDED_DOSE', detail: '875mg' });
    expect(checkClinicalDraft('VISIT_NOTE', visit({ assessment: 'Diagnosis: cellulitis.' }), notes, [])).toMatchObject({ ok: false, reason: 'CLINICIAN_ONLY_TERM', detail: 'diagnos' });
    expect(checkClinicalDraft('VISIT_NOTE', visit({ plan: 'Increase amoxicillin.' }), notes, [])).toMatchObject({ ok: false, reason: 'CLINICIAN_ONLY_TERM' });
    expect(checkClinicalDraft('VISIT_NOTE', visit({ plan: 'Order a wound swab.' }), notes, [])).toMatchObject({ ok: false, reason: 'CLINICIAN_ONLY_TERM', detail: 'order' });
    const nurse = JSON.stringify({ assessment: 'BP 168/98.', interventions: 'Advised tablets.', evaluation: 'Not documented.', escalation: 'Start amlodipine 10 mg.', checksForClinician: [] });
    expect(checkClinicalDraft('NURSING_NOTE', nurse, 'BP 168/98 twice. Missed tablets. Informed doctor.', ['Amlodipine 5 mg'])).toMatchObject({ ok: false, reason: 'UNGROUNDED_DOSE', detail: '10mg' });
    // A word the clinician used themselves may be repeated (documenting, not ordering).
    const documented = JSON.stringify({ assessment: 'Takes tablets as prescribed.', interventions: 'Not documented.', evaluation: 'Not documented.', escalation: 'Doctor informed.', checksForClinician: [] });
    expect(checkClinicalDraft('NURSING_NOTE', documented, 'Advised to take tablets as prescribed by her doctor.', []).ok).toBe(true);
    expect(checkClinicalDraft('NURSING_NOTE', documented, 'Advised to take her tablets.', [])).toMatchObject({ ok: false, detail: 'prescri' });
    expect(checkClinicalDraft('VISIT_NOTE', '{"plan": "x"}', notes, [])).toMatchObject({ ok: false, reason: 'INVALID_JSON' });
  });
});
