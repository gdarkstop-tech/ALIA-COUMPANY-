import { z } from 'zod';
import type { AiAllowance, AiAssistantStatus } from './ai';
import { normalizeDigits } from './documents';

/**
 * Record shares and the clinician documentation copilot (migration 0024, ADR 0013).
 *
 * The AI only ORGANISES the clinician's own notes into a note for their role. The guard below
 * rejects any draft that contains a dose not written in the notes or the recorded medicines, or a
 * diagnosis / order / prescribing / dose-change word the clinician did not use. Drafts stay drafts
 * until the clinician signs them.
 */
export type ClinicianRole = 'DOCTOR' | 'NURSE';
export const CLINICAL_DOC_TYPES = ['VISIT_NOTE', 'NURSING_NOTE', 'WOUND_CARE_NOTE', 'PATIENT_INSTRUCTIONS'] as const;
export type ClinicalDocType = (typeof CLINICAL_DOC_TYPES)[number];
/** What each role may draft (the database enforces the same rule). */
export const DOC_TYPES_BY_ROLE: Record<ClinicianRole, readonly ClinicalDocType[]> = {
  DOCTOR: ['VISIT_NOTE', 'PATIENT_INSTRUCTIONS'],
  NURSE: ['NURSING_NOTE', 'WOUND_CARE_NOTE', 'PATIENT_INSTRUCTIONS'],
};
/** Text sections of each note, in display order (instructions are lists). */
export const DOC_SECTIONS: Record<ClinicalDocType, readonly string[]> = {
  VISIT_NOTE: ['subjective', 'objective', 'assessment', 'plan'],
  NURSING_NOTE: ['assessment', 'interventions', 'evaluation', 'escalation'],
  WOUND_CARE_NOTE: ['woundObservations', 'careProvided', 'patientResponse', 'nextDressing', 'escalation'],
  PATIENT_INSTRUCTIONS: ['instructions', 'whenToSeekHelp'],
};
const LIST_SECTIONS = new Set(['instructions', 'whenToSeekHelp', 'checksForClinician']);

const SECTION_HELP: Record<string, string> = {
  subjective: "What the patient reported, from the clinician's notes.",
  objective: 'Findings and measurements the clinician recorded, exactly as written.',
  assessment: "The clinician's assessment exactly as stated in the notes; never a new diagnosis.",
  plan: "The clinician's plan exactly as written; no new medicines, doses, tests or orders.",
  interventions: 'Nursing care given, as written.',
  evaluation: 'How the patient responded, as written.',
  escalation: 'What was or will be reported to the physician, as written. Never an order.',
  woundObservations: 'Wound appearance and measurements as written.',
  careProvided: 'Wound care performed, as written.',
  patientResponse: 'Pain and tolerance as written.',
  nextDressing: 'When the next dressing is due, as written.',
  instructions: 'Short plain-language instructions for the patient, only from the notes.',
  whenToSeekHelp: 'Warning signs the clinician mentioned, in plain language.',
  checksForClinician: 'Points for the clinician to verify, e.g. a recorded allergy that may relate to a medicine in the notes. Empty if none.',
};

/** Strict JSON schema for one note type (every property required; "Not documented." where empty). */
export function clinicalDraftJsonSchema(docType: ClinicalDocType): Record<string, unknown> {
  const keys = [...DOC_SECTIONS[docType], 'checksForClinician'];
  return {
    type: 'object',
    additionalProperties: false,
    required: keys,
    properties: Object.fromEntries(keys.map((k) => [k, LIST_SECTIONS.has(k) ? { type: 'array', items: { type: 'string' }, description: SECTION_HELP[k] } : { type: 'string', description: SECTION_HELP[k] }])),
  };
}
export type ClinicalDraftContent = Record<string, string | string[]>;

/** Validates the shape of a draft (model output or the clinician's edit). */
export function clinicalContentSchema(docType: ClinicalDocType) {
  const keys = [...DOC_SECTIONS[docType], 'checksForClinician'];
  return z
    .object(Object.fromEntries(keys.map((k) => [k, LIST_SECTIONS.has(k) ? z.array(z.string().trim().max(400)).max(12) : z.string().trim().max(3000)])))
    .strict();
}

// ---------------------------------------------------------------- the guard
const norm = (s: string) => normalizeDigits(s).toLowerCase().replace(/[٫,](?=\d)/g, '.').replace(/\s+/g, ' ');
const UNIT: [RegExp, string][] = [
  [/^(mg|ملغ|ملجم|مجم|مغ)$/, 'mg'],
  [/^(mcg|µg|ميكروغرام|ميكروجرام)$/, 'mcg'],
  [/^(g|gm|غ|جم|جرام)$/, 'g'],
  [/^(ml|مل|ملل)$/, 'ml'],
  [/^(units?|iu|وحدة|وحدات)$/, 'unit'],
];
const DOSE = /(\d+(?:\.\d+)?)\s*(mg|mcg|µg|ml|units?|iu|gm|g|ملغ|ملجم|مجم|مغ|ميكروغرام|ميكروجرام|جرام|جم|غ|ملل|مل|وحدات|وحدة)(?![a-z])/giu;
function doses(text: string): string[] {
  return [...norm(text).matchAll(DOSE)].map((m) => `${Number(m[1])}${UNIT.find(([re]) => re.test(m[2]!))?.[1] ?? m[2]}`);
}
/** Words the AI may only use if the clinician used them (stem must appear in the notes). */
const CLINICIAN_ONLY: [RegExp, string][] = [
  [/\bdiagnos/u, 'diagnos'],
  [/\bprescri/u, 'prescri'],
  [/\border(ed|s)?\b/u, 'order'],
  [/\bincreas/u, 'increas'],
  [/\bdecreas/u, 'decreas'],
  [/\breduc/u, 'reduc'],
  [/\bdiscontinu/u, 'discontinu'],
  [/\bstop(ped|ping)?\b/u, 'stop'],
  [/\bstart(ed|ing)?\b/u, 'start'],
  [/\bswitch/u, 'switch'],
  [/\bdose\b|\bdosage\b/u, 'dose'],
  [/تشخيص/u, 'تشخيص'],
  [/وصف/u, 'وصف'],
  [/روشت/u, 'روشت'],
  [/زيادة الجرع/u, 'زيادة'],
  [/تقليل الجرع|إنقاص الجرع/u, 'تقليل'],
  [/إيقاف|ايقاف|وقف الدواء/u, 'يقاف'],
  [/جرع/u, 'جرع'],
];

export type DraftCheck = { ok: true; content: ClinicalDraftContent } | { ok: false; reason: 'INVALID_JSON' | 'UNGROUNDED_DOSE' | 'CLINICIAN_ONLY_TERM'; detail: string };

export function checkClinicalDraft(docType: ClinicalDocType, text: string, notes: string, medications: string[]): DraftCheck {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'INVALID_JSON', detail: 'not JSON' };
  }
  const parsed = clinicalContentSchema(docType).safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'INVALID_JSON', detail: parsed.error.issues[0]?.message ?? 'schema' };
  const content = parsed.data as ClinicalDraftContent;
  const all = Object.values(content).flat().join('\n');
  const source = norm(`${notes}\n${medications.join('\n')}`);
  const known = new Set(doses(source));
  const bad = doses(all).find((d) => !known.has(d));
  if (bad) return { ok: false, reason: 'UNGROUNDED_DOSE', detail: bad };
  const lower = norm(all);
  for (const [re, stem] of CLINICIAN_ONLY) if (re.test(lower) && !source.includes(stem)) return { ok: false, reason: 'CLINICIAN_ONLY_TERM', detail: stem };
  return { ok: true, content };
}

// ---------------------------------------------------------------- API contracts
export const grantShareBody = z.object({ patientId: z.string().uuid(), providerUserId: z.string().min(1).max(64), days: z.union([z.literal(7), z.literal(30), z.literal(90)]), aiAllowed: z.boolean().default(false) });
export const createDraftBody = z.object({ docType: z.enum(CLINICAL_DOC_TYPES), notes: z.string().trim().min(10).max(6000) });
export const updateDraftBody = z.object({ action: z.enum(['SAVE', 'SIGN', 'DISCARD']), content: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional() });

export type CareShare = {
  id: string;
  patientId: string;
  providerUserId: string;
  providerName: string | null;
  providerType: ClinicianRole | null;
  aiAllowed: boolean;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  expiresAt: string;
  createdAt: string;
};
export type ClinicianPatient = {
  shareId: string;
  patientId: string;
  displayName: string;
  ageYears: number;
  sex: 'FEMALE' | 'MALE' | 'UNSPECIFIED';
  bloodType: string | null;
  governorate: string | null;
  isDemo: boolean;
  aiAllowed: boolean;
  expiresAt: string;
};
export type ClinicalDraft = {
  id: string;
  patientId: string;
  authorRole: ClinicianRole;
  authorName: string | null;
  docType: ClinicalDocType;
  status: 'GENERATING' | 'DRAFT' | 'SIGNED' | 'DISCARDED' | 'FAILED';
  clinicianInput: string | null;
  content: ClinicalDraftContent | null;
  edited: boolean;
  failure: string | null;
  signedAt: string | null;
  createdAt: string;
  /** Written by the development simulator (never a real draft). */
  simulated: boolean;
};
export type ClinicianCopilotStatus = { unavailableReason: AiAssistantStatus['unavailableReason'] | 'CLINICIAN_TERMS_REQUIRED' | 'NOT_VERIFIED'; allowance: AiAllowance | null; role: ClinicianRole | null };
