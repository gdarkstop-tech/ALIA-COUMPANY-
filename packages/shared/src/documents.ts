import { z } from 'zod';
import type { AiAllowance, AiAssistantStatus } from './ai';

/**
 * Medical documents, AI reading of lab reports and lab results (migration 0021, ADR 0011).
 *
 * The AI only TRANSCRIBES the results table (strict JSON). Everything numeric — parsing the value,
 * the printed reference range and whether the value is outside it — is done by the deterministic
 * functions below, never by the model. Nothing becomes a health record until the person confirms it.
 */
export const DOCUMENT_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export type DocumentContentType = (typeof DOCUMENT_CONTENT_TYPES)[number];
export const DOCUMENT_KINDS = ['LAB_REPORT', 'OTHER'] as const;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_EXTRACTED_ROWS = 80;
export const LAB_RANGE_STATUSES = ['LOW', 'HIGH', 'IN_RANGE', 'UNKNOWN'] as const;
export type LabRangeStatus = (typeof LAB_RANGE_STATUSES)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const uploadDocumentBody = z.object({
  patientId: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  kind: z.enum(DOCUMENT_KINDS).default('LAB_REPORT'),
  contentType: z.enum(DOCUMENT_CONTENT_TYPES),
  /** The file, base64 (≤ 10 MB decoded). Its type is checked from the bytes, not from this field. */
  dataBase64: z.string().min(100).max(Math.ceil((MAX_DOCUMENT_BYTES * 4) / 3) + 8),
  documentDate: isoDate.nullable().optional(),
});
export const reviewLabResultBody = z.object({
  decision: z.enum(['CONFIRM', 'REJECT']),
  /** Optional corrections (the AI's reading is kept for comparison). */
  testName: z.string().trim().min(1).max(120).optional(),
  valueText: z.string().trim().min(1).max(40).optional(),
  unit: z.string().trim().max(30).nullable().optional(),
  referenceText: z.string().trim().max(60).nullable().optional(),
  observedOn: isoDate.nullable().optional(),
});
export const manualLabResultBody = z.object({
  patientId: z.string().uuid(),
  testName: z.string().trim().min(1).max(120),
  valueText: z.string().trim().min(1).max(40),
  unit: z.string().trim().max(30).nullable().optional(),
  referenceText: z.string().trim().max(60).nullable().optional(),
  observedOn: isoDate,
  documentId: z.string().uuid().nullable().optional(),
});

export type DocumentExtraction = {
  id: string;
  status: 'PENDING' | 'COMPLETED' | 'NOT_A_LAB_REPORT' | 'REFUSED' | 'FAILED';
  labName: string | null;
  collectedOn: string | null;
  rowCount: number;
  createdAt: string;
  completedAt: string | null;
  /** Read by the development simulator (never a real reading). */
  simulated: boolean;
};
export type MedicalDocument = {
  id: string;
  patientId: string;
  kind: (typeof DOCUMENT_KINDS)[number];
  title: string;
  contentType: DocumentContentType;
  byteSize: number;
  documentDate: string | null;
  createdAt: string;
  latestExtraction: DocumentExtraction | null;
  pendingReview: number;
};
export type LabResult = {
  id: string;
  patientId: string;
  documentId: string | null;
  testName: string;
  valueText: string;
  valueNumeric: number | null;
  unit: string | null;
  referenceText: string | null;
  referenceLow: number | null;
  referenceHigh: number | null;
  printedFlag: string | null;
  /** The report itself marks the value as critical / panic (we only repeat what is printed). */
  printedCritical: boolean;
  rangeStatus: LabRangeStatus;
  observedOn: string | null;
  source: 'AI_EXTRACTED' | 'MANUAL';
  reviewStatus: 'PENDING_REVIEW' | 'CONFIRMED' | 'REJECTED';
  provenance: 'PATIENT_REPORTED' | 'CAREGIVER_REPORTED' | 'PROFESSIONALLY_VERIFIED' | 'IMPORTED_DOCUMENT' | null;
  corrected: boolean;
};
export type MedicalDocumentDetail = MedicalDocument & { results: LabResult[] };
export type DocumentAiStatus = {
  unavailableReason: AiAssistantStatus['unavailableReason'] | 'DOCUMENT_CONSENT_REQUIRED';
  /** Weekly ANALYSES allowance. */
  allowance: AiAllowance | null;
};

// ---------------------------------------------------------------- what the model must return
/** Strict JSON schema for the transcription (every property required; nulls where not printed). */
export const LAB_EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['documentType', 'labName', 'collectedOn', 'results'],
  properties: {
    documentType: { type: 'string', enum: ['LAB_REPORT', 'OTHER'], description: 'LAB_REPORT only if the document contains laboratory test results.' },
    labName: { type: ['string', 'null'], description: 'Laboratory name exactly as printed, or null.' },
    collectedOn: { type: ['string', 'null'], description: 'Sample or report date as YYYY-MM-DD when printed unambiguously, otherwise null.' },
    results: {
      type: 'array',
      description: 'One item per printed result row, in printed order. Empty when documentType is OTHER.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['testName', 'value', 'unit', 'referenceRange', 'flag'],
        properties: {
          testName: { type: 'string', description: 'Test name exactly as printed.' },
          value: { type: 'string', description: 'Result exactly as printed (digits, < > signs, words such as Positive).' },
          unit: { type: ['string', 'null'], description: 'Unit exactly as printed, or null.' },
          referenceRange: { type: ['string', 'null'], description: 'Reference / normal range exactly as printed, or null.' },
          flag: { type: ['string', 'null'], description: 'Flag printed next to the result (e.g. H, L, *, Critical), or null.' },
        },
      },
    },
  },
} as const;

const clip = (n: number) => z.string().transform((s) => s.trim().slice(0, n));
/** Validates (and bounds) what a model returned; anything else is a failed reading. */
export const labExtractionSchema = z.object({
  documentType: z.enum(['LAB_REPORT', 'OTHER']),
  labName: clip(120).nullable(),
  collectedOn: z.string().nullable(),
  results: z
    .array(z.object({ testName: clip(120), value: clip(40), unit: clip(30).nullable(), referenceRange: clip(60).nullable(), flag: clip(20).nullable() }))
    .max(MAX_EXTRACTED_ROWS),
});
export type LabExtraction = z.infer<typeof labExtractionSchema>;

// ---------------------------------------------------------------- deterministic parsing
/** Arabic-Indic / Eastern Arabic-Indic digits and the Arabic decimal separator → ASCII. */
export function normalizeDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',');
}

function toNumber(raw: string): number | null {
  let s = raw.trim();
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, ''); // 1,250 / 12,500.5
  else if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.'); // 13,5 (decimal comma)
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** A printed result: a plain number, a number with < / > (a bound, not a measurement), or text. */
export function parseLabValue(text: string): { numeric: number | null; qualified: boolean } {
  const s = normalizeDigits(text).trim();
  const m = s.match(/^(<=|>=|<|>|≤|≥)?\s*(-?[\d.,]+)\s*$/);
  if (!m) return { numeric: null, qualified: false };
  const n = toNumber(m[2]!);
  return { numeric: n, qualified: n !== null && Boolean(m[1]) };
}

export type ParsedRange = { low: number | null; high: number | null; lowExclusive: boolean; highExclusive: boolean };
/** "12 - 16", "12.0–16.0 g/dL", "< 5.7", "> 40", "up to 200", "أقل من 100". Unrecognised → no bounds. */
export function parseReferenceRange(text: string | null | undefined): ParsedRange {
  const none = { low: null, high: null, lowExclusive: false, highExclusive: false };
  if (!text) return none;
  const s = normalizeDigits(text).trim().toLowerCase();
  const num = '(-?\\d+(?:[.,]\\d+)?)';
  const tail = '\\s*[^\\d<>=≤≥-]*$';
  let m = s.match(new RegExp(`^${num}\\s*(?:-|–|—|to|الى|إلى)\\s*${num}${tail}`));
  if (m) {
    const a = toNumber(m[1]!);
    const b = toNumber(m[2]!);
    if (a === null || b === null || a > b) return none;
    return { low: a, high: b, lowExclusive: false, highExclusive: false };
  }
  m = s.match(new RegExp(`^(<=|≤|<|up to|less than|below|أقل من)\\s*${num}${tail}`));
  if (m) {
    const b = toNumber(m[2]!);
    return b === null ? none : { low: null, high: b, lowExclusive: false, highExclusive: m[1] === '<' || m[1] === 'less than' || m[1] === 'below' || m[1] === 'أقل من' };
  }
  m = s.match(new RegExp(`^(>=|≥|>|more than|greater than|above|over|أكثر من)\\s*${num}${tail}`));
  if (m) {
    const a = toNumber(m[2]!);
    return a === null ? none : { low: a, high: null, lowExclusive: m[1] !== '>=' && m[1] !== '≥', highExclusive: false };
  }
  return none;
}

/** Compared with the report's own printed range only. No range or no plain number → UNKNOWN. */
export function rangeStatus(valueText: string, referenceText: string | null | undefined): LabRangeStatus {
  const v = parseLabValue(valueText);
  const r = parseReferenceRange(referenceText);
  if (v.numeric === null || v.qualified || (r.low === null && r.high === null)) return 'UNKNOWN';
  if (r.low !== null && (r.lowExclusive ? v.numeric <= r.low : v.numeric < r.low)) return 'LOW';
  if (r.high !== null && (r.highExclusive ? v.numeric >= r.high : v.numeric > r.high)) return 'HIGH';
  return 'IN_RANGE';
}

/** The lab printed a critical / panic marker (repeated to the person, never inferred). */
export const isPrintedCritical = (flag: string | null | undefined) => Boolean(flag && /crit|panic|حرج|خطر/i.test(flag));

/** A date as printed → YYYY-MM-DD if valid and not in the future; otherwise null. */
export function safeIsoDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const s = normalizeDigits(text).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s || s < '1950-01-01' || d.getTime() > Date.now() + 86_400_000) return null;
  return s;
}

/** Row values the database stores, derived from the printed text. */
export function deriveLabRow(row: { testName: string; value: string; unit: string | null; referenceRange: string | null; flag: string | null }) {
  const v = parseLabValue(row.value);
  const r = parseReferenceRange(row.referenceRange);
  return {
    testName: row.testName,
    valueText: row.value,
    // A bound ("< 5") is not a measurement: it never becomes a number for trends.
    valueNumeric: v.qualified ? null : v.numeric,
    unit: row.unit || null,
    referenceText: row.referenceRange || null,
    referenceLow: r.low,
    referenceHigh: r.high,
    printedFlag: row.flag || null,
    rangeStatus: rangeStatus(row.value, row.referenceRange),
  };
}
