import { z } from 'zod';
import type { AiAllowance, AiAssistantStatus } from './ai';
import { normalizeDigits, type LabRangeStatus } from './documents';
import type { Provenance } from './enums';

/**
 * Health readings, calculated trends and grounded AI summaries (migration 0022, ADR 0012).
 *
 * Four kinds of information are kept apart everywhere:
 *   MEASURED   — a value someone recorded (with its provenance),
 *   CALCULATED — statistics computed by the deterministic code below,
 *   AI         — a summary written by a model, only from numbered calculated facts, validated here,
 *   VERIFIED   — values a clinician verified (provenance PROFESSIONALLY_VERIFIED).
 * Trends are described as higher / lower / unchanged — never as better, worse or improving.
 */
export const OBSERVATION_KINDS = ['BLOOD_PRESSURE', 'HEART_RATE', 'BLOOD_GLUCOSE', 'WEIGHT', 'TEMPERATURE', 'OXYGEN_SATURATION', 'PAIN_SCORE'] as const;
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];
export const GLUCOSE_CONTEXTS = ['FASTING', 'BEFORE_MEAL', 'AFTER_MEAL', 'RANDOM', 'BEDTIME'] as const;
export type GlucoseContext = (typeof GLUCOSE_CONTEXTS)[number];

/** One fixed unit per kind (the database enforces it); bounds catch typing errors, they are not clinical ranges. */
export const OBSERVATION_SPEC: Record<ObservationKind, { unit: string; min: number; max: number; min2?: number; max2?: number; step: number; label: string }> = {
  BLOOD_PRESSURE: { unit: 'mmHg', min: 50, max: 300, min2: 20, max2: 200, step: 1, label: 'Blood pressure' },
  HEART_RATE: { unit: 'bpm', min: 20, max: 250, step: 1, label: 'Pulse' },
  BLOOD_GLUCOSE: { unit: 'mg/dL', min: 10, max: 1000, step: 1, label: 'Blood glucose' },
  WEIGHT: { unit: 'kg', min: 0.5, max: 400, step: 0.1, label: 'Weight' },
  TEMPERATURE: { unit: '°C', min: 30, max: 45, step: 0.1, label: 'Temperature' },
  OXYGEN_SATURATION: { unit: '%', min: 50, max: 100, step: 1, label: 'Oxygen saturation' },
  PAIN_SCORE: { unit: '/10', min: 0, max: 10, step: 1, label: 'Pain score' },
};

const iso = z.string().datetime({ offset: true });
export const createObservationBody = z
  .object({
    kind: z.enum(OBSERVATION_KINDS),
    value: z.number().finite(),
    value2: z.number().finite().nullable().optional(),
    context: z.enum(GLUCOSE_CONTEXTS).nullable().optional(),
    measuredAt: iso,
    note: z.string().trim().max(200).nullable().optional(),
  })
  .superRefine((b, ctx) => {
    const s = OBSERVATION_SPEC[b.kind];
    if (b.value < s.min || b.value > s.max) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Outside the plausible range' });
    if (b.kind === 'BLOOD_PRESSURE') {
      if (b.value2 == null || b.value2 < s.min2! || b.value2 > s.max2! || b.value2 >= b.value) ctx.addIssue({ code: 'custom', path: ['value2'], message: 'Enter both numbers (the second lower than the first)' });
    } else if (b.value2 != null) ctx.addIssue({ code: 'custom', path: ['value2'], message: 'Only blood pressure has a second value' });
    if (b.context && b.kind !== 'BLOOD_GLUCOSE') ctx.addIssue({ code: 'custom', path: ['context'], message: 'Only glucose readings have a context' });
    if (b.kind === 'PAIN_SCORE' && !Number.isInteger(b.value)) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Whole numbers only' });
  });
export type CreateObservationBody = z.infer<typeof createObservationBody>;

export type Observation = {
  id: string;
  patientId: string;
  kind: ObservationKind;
  value: number;
  value2: number | null;
  unit: string;
  context: GlucoseContext | null;
  measuredAt: string;
  note: string | null;
  provenance: Provenance;
  createdAt: string;
};

// ---------------------------------------------------------------- calculated statistics
export type SeriesPoint = { id: string; value: number; value2: number | null; at: string; provenance: Provenance | null };
export type SeriesStats = {
  count: number;
  latest: SeriesPoint;
  previous: SeriesPoint | null;
  /** latest − previous (null with one reading). */
  change: number | null;
  change2: number | null;
  mean: number;
  mean2: number | null;
  min: number;
  max: number;
  firstAt: string;
};
/** Rounded to one more decimal than the most precise reading (at most 2). */
const decimals = (xs: number[]) => Math.min(2, Math.max(0, ...xs.map((x) => (String(x).split('.')[1] ?? '').length)) + 1);
const round = (x: number, d: number) => Number(x.toFixed(d));

/** Statistics of one series (points in any order). Pure and deterministic. */
export function seriesStats(points: SeriesPoint[]): SeriesStats | null {
  if (!points.length) return null;
  const p = [...points].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const values = p.map((x) => x.value);
  const d = decimals(values);
  const latest = p[p.length - 1]!;
  const previous = p.length > 1 ? p[p.length - 2]! : null;
  const v2 = p.map((x) => x.value2).filter((x): x is number => x !== null);
  const d2 = v2.length ? decimals(v2) : 0;
  return {
    count: p.length,
    latest,
    previous,
    change: previous ? round(latest.value - previous.value, d) : null,
    change2: previous && latest.value2 !== null && previous.value2 !== null ? round(latest.value2 - previous.value2, d2) : null,
    mean: round(values.reduce((a, b) => a + b, 0) / values.length, d),
    mean2: v2.length === p.length ? round(v2.reduce((a, b) => a + b, 0) / v2.length, d2) : null,
    min: Math.min(...values),
    max: Math.max(...values),
    firstAt: p[0]!.at,
  };
}

export type SeriesDirection = 'HIGHER' | 'LOWER' | 'UNCHANGED';
/** Compared with the previous reading only; no judgement of whether that is good or bad. */
export const directionOf = (change: number | null): SeriesDirection | null => (change === null ? null : change > 0 ? 'HIGHER' : change < 0 ? 'LOWER' : 'UNCHANGED');

export type HealthSeries = {
  /** `VITAL:<kind>` or `LAB:<normalised test name>|<unit>` (units are never mixed). */
  key: string;
  source: 'VITAL' | 'LAB';
  kind: ObservationKind | null;
  label: string;
  unit: string;
  points: SeriesPoint[];
  stats: SeriesStats | null;
  /** Labs: the range printed on the most recent report, and the status computed against it. */
  printedRange: { text: string | null; low: number | null; high: number | null; latestStatus: LabRangeStatus } | null;
};
export type HealthAnalytics = { patientId: string; periodDays: number; generatedAt: string; series: HealthSeries[] };

export const labSeriesKey = (testName: string, unit: string | null) => `LAB:${normalizeDigits(testName).toLowerCase().replace(/\s+/g, ' ').trim()}|${(unit ?? '').trim()}`;

// ---------------------------------------------------------------- facts for the AI (the only data it sees)
/**
 * `text` is what the model receives (English, canonical); `display` lets the app show the same fact
 * in the person's language; `numbers` are the only values a summary point citing it may contain.
 */
export type HealthFactDisplay =
  | { kind: 'LATEST' | 'PREVIOUS'; value: string; date: string }
  | { kind: 'CHANGE'; direction: SeriesDirection; difference: string }
  | { kind: 'STATS'; count: number; days: number; mean: string; min: number; max: number }
  | { kind: 'RANGE'; status: LabRangeStatus; range: string };
export type HealthFact = { id: string; seriesKey: string; seriesLabel: string; unit: string; type: 'MEASURED' | 'CALCULATED'; text: string; numbers: number[]; display: HealthFactDisplay };

const fmt = (v: number, v2: number | null) => (v2 === null ? `${v}` : `${v}/${v2}`);
const signed = (x: number) => (x > 0 ? `+${x}` : `${x}`);
const day = (at: string) => at.slice(0, 10);
const dateNumbers = (at: string) => day(at).split('-').map(Number);
const PROVENANCE_TEXT: Record<Provenance, string> = { PATIENT_REPORTED: 'reported by the patient', CAREGIVER_REPORTED: 'reported by a caregiver', PROFESSIONALLY_VERIFIED: 'verified by a clinician', IMPORTED_DOCUMENT: 'confirmed from a lab report' };

/**
 * Numbered facts (F1, F2, …) built only from the statistics above: no names, notes or free text
 * typed by anyone, so nothing in them can act as an instruction.
 */
export function buildHealthFacts(series: HealthSeries[], periodDays: number): HealthFact[] {
  const facts: HealthFact[] = [];
  const add = (s: HealthSeries, type: HealthFact['type'], text: string, numbers: number[], display: HealthFactDisplay) =>
    facts.push({ id: `F${facts.length + 1}`, seriesKey: s.key, seriesLabel: s.label, unit: s.unit, type, text, numbers, display });
  for (const s of series) {
    const st = s.stats;
    if (!st) continue;
    const name = `${s.label} (${s.unit})`;
    const l = st.latest;
    add(s, 'MEASURED', `${name}: latest ${fmt(l.value, l.value2)} on ${day(l.at)}${l.provenance ? `, ${PROVENANCE_TEXT[l.provenance]}` : ''}.`, [l.value, ...(l.value2 !== null ? [l.value2] : []), ...dateNumbers(l.at)], { kind: 'LATEST', value: fmt(l.value, l.value2), date: day(l.at) });
    if (st.previous) {
      const p = st.previous;
      add(s, 'MEASURED', `${name}: previous ${fmt(p.value, p.value2)} on ${day(p.at)}.`, [p.value, ...(p.value2 !== null ? [p.value2] : []), ...dateNumbers(p.at)], { kind: 'PREVIOUS', value: fmt(p.value, p.value2), date: day(p.at) });
      const ch = st.change2 !== null ? `${signed(st.change!)}/${signed(st.change2)}` : signed(st.change!);
      const dir = directionOf(st.change)!;
      add(s, 'CALCULATED', dir === 'UNCHANGED' ? `${name}: the latest reading is the same as the previous one.` : `${name}: the latest reading is ${dir.toLowerCase()} than the previous one (difference ${ch}).`, [Math.abs(st.change!), ...(st.change2 !== null ? [Math.abs(st.change2)] : [])], { kind: 'CHANGE', direction: dir, difference: ch });
    }
    if (st.count >= 2)
      add(s, 'CALCULATED', `${name}: ${st.count} readings in the last ${periodDays} days, average ${fmt(st.mean, st.mean2)}, lowest ${st.min}, highest ${st.max}.`, [st.count, periodDays, st.mean, ...(st.mean2 !== null ? [st.mean2] : []), st.min, st.max], {
        kind: 'STATS',
        count: st.count,
        days: periodDays,
        mean: fmt(st.mean, st.mean2),
        min: st.min,
        max: st.max,
      });
    if (s.printedRange && (s.printedRange.low !== null || s.printedRange.high !== null)) {
      const status = { LOW: 'below', HIGH: 'above', IN_RANGE: 'within', UNKNOWN: 'not compared with' }[s.printedRange.latestStatus];
      add(s, 'CALCULATED', `${name}: the latest value is ${status} the range printed on the lab report (${s.printedRange.text}).`, [s.printedRange.low, s.printedRange.high].filter((x): x is number => x !== null), {
        kind: 'RANGE',
        status: s.printedRange.latestStatus,
        range: s.printedRange.text ?? '',
      });
    }
  }
  return facts;
}

// ---------------------------------------------------------------- what the model must return
export const HEALTH_SUMMARY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['points', 'questions'],
  properties: {
    points: {
      type: 'array',
      description: 'Two to six short plain-language observations, each based only on the facts it cites.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'facts'],
        properties: {
          text: { type: 'string', description: 'One or two sentences. Every number must appear in the cited facts.' },
          facts: { type: 'array', items: { type: 'string' }, description: 'IDs of the facts this point is based on, e.g. ["F1", "F3"].' },
        },
      },
    },
    questions: { type: 'array', items: { type: 'string' }, description: 'Up to three questions the person could ask their clinician. No numbers.' },
  },
} as const;

const summaryOutput = z.object({
  points: z.array(z.object({ text: z.string().trim().min(1).max(400), facts: z.array(z.string()).min(1).max(8) })).min(1).max(6),
  questions: z.array(z.string().trim().min(1).max(240)).max(3),
});
export type HealthSummaryPoint = { text: string; facts: string[] };
export type HealthSummaryContent = { points: HealthSummaryPoint[]; questions: string[] };

/** Claims a summary may not make: judgements of progress, normality, diagnoses or treatment. */
const FORBIDDEN = [
  /\b(improv\w*|better|worse\w*|deteriorat\w*|(ab)?normal(ly)?|healthy|unhealthy|diagnos\w*|prescri\w*|dosage|doses?|medications?)\b/iu,
  /(تحس[ّ]?ن|أفضل|أسوأ|تدهور|طبيعي|تشخيص|جرع|دواء|أدوية|علاج)/u,
];
const NUMBER = /\d+(?:[.,]\d+)?/g;

export type SummaryCheck = { ok: true; content: HealthSummaryContent } | { ok: false; reason: 'INVALID_JSON' | 'UNKNOWN_FACT' | 'UNGROUNDED_NUMBER' | 'FORBIDDEN_CLAIM'; detail: string };

/**
 * Validates a model's summary against the facts it was given: valid shape, cited facts exist,
 * every number in a point appears in the facts that point cites, questions contain no numbers,
 * and nothing claims improvement, normality, a diagnosis or a treatment.
 */
export function checkHealthSummary(text: string, facts: HealthFact[]): SummaryCheck {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'INVALID_JSON', detail: 'not JSON' };
  }
  const parsed = summaryOutput.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'INVALID_JSON', detail: parsed.error.issues[0]?.message ?? 'schema' };
  const byId = new Map(facts.map((f) => [f.id, f]));
  // Fact IDs are not values ("F3"); thousands separators are not decimals.
  const numbersIn = (s: string) => (normalizeDigits(s).replace(/\bF\d+\b/g, '').match(NUMBER) ?? []).map((n) => Number(n.replace(',', '.')));
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  for (const p of parsed.data.points) {
    const cited = p.facts.map((id) => byId.get(id));
    if (cited.some((f) => !f)) return { ok: false, reason: 'UNKNOWN_FACT', detail: p.facts.join(',') };
    const allowed = cited.flatMap((f) => f!.numbers);
    const bad = numbersIn(p.text).find((n) => !allowed.some((a) => close(a, n)));
    if (bad !== undefined) return { ok: false, reason: 'UNGROUNDED_NUMBER', detail: String(bad) };
  }
  for (const q of parsed.data.questions) if (numbersIn(q).length) return { ok: false, reason: 'UNGROUNDED_NUMBER', detail: q.slice(0, 40) };
  const all = [...parsed.data.points.map((p) => p.text), ...parsed.data.questions].join('\n');
  for (const re of FORBIDDEN) {
    const m = all.match(re);
    if (m) return { ok: false, reason: 'FORBIDDEN_CLAIM', detail: m[0] };
  }
  return { ok: true, content: parsed.data };
}

export const createHealthSummaryBody = z.object({ days: z.union([z.literal(30), z.literal(90)]).default(30) });
export type HealthSummary = {
  id: string;
  patientId: string;
  status: 'PENDING' | 'COMPLETED' | 'REFUSED' | 'FAILED';
  periodDays: number;
  language: 'ar' | 'en';
  facts: HealthFact[];
  content: HealthSummaryContent | null;
  createdAt: string;
  /** Written by the development simulator (never a real summary). */
  simulated: boolean;
};
export type HealthSummaryStatus = { unavailableReason: AiAssistantStatus['unavailableReason'] | 'HEALTH_CONSENT_REQUIRED'; allowance: AiAllowance | null };
