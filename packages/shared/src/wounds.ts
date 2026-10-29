import { z } from 'zod';
import { findUnapprovedClaim } from './products';

/**
 * Wound Intelligence Registry (migration 0027, ADR 0015) — shared vocabulary, permission wording,
 * deterministic helpers and API contracts. The database enforces every rule again; this module is
 * never the security boundary on its own.
 */
export const WOUND_CATEGORIES = ['DIABETIC_FOOT', 'PRESSURE_ULCER', 'SURGICAL', 'BURN', 'CHRONIC', 'OTHER'] as const;
export type WoundCategory = (typeof WOUND_CATEGORIES)[number];
export const WOUND_REPORTED_CATEGORIES = [...WOUND_CATEGORIES, 'UNSURE'] as const;
export type WoundReportedCategory = (typeof WOUND_REPORTED_CATEGORIES)[number];
export const WOUND_BODY_SITES = [
  'FOOT_SOLE', 'HEEL', 'TOE', 'FOOT_TOP', 'ANKLE', 'KNEE_LOWER_LEG', 'HIP_THIGH', 'SACRUM_BUTTOCK', 'BACK', 'ABDOMEN', 'CHEST',
  'SHOULDER_ARM', 'HAND', 'NECK', 'HEAD_FACE', 'PERINEAL', 'OTHER',
] as const;
export type WoundBodySite = (typeof WOUND_BODY_SITES)[number];
/** Never used for research or presentations, whatever the permissions (identifiable / intimate). */
export const WOUND_SECONDARY_USE_EXCLUDED_SITES: readonly WoundBodySite[] = ['HEAD_FACE', 'NECK', 'PERINEAL'];
export const WOUND_BODY_SIDES = ['LEFT', 'RIGHT', 'MIDLINE', 'NOT_APPLICABLE'] as const;
export const WOUND_SIGNS = ['REDNESS', 'SWELLING', 'WARMTH', 'ODOUR', 'PUS', 'FEVER', 'BLEEDING', 'BLACK_TISSUE', 'NUMBNESS'] as const;
export type WoundSign = (typeof WOUND_SIGNS)[number];
/** Signs for which the app tells the person to contact a clinician promptly (guidance, not a diagnosis). */
export const WOUND_SIGNS_NEEDING_CLINICIAN: readonly WoundSign[] = ['PUS', 'FEVER', 'BLACK_TISSUE', 'NUMBNESS', 'WARMTH', 'ODOUR'];
export const WOUND_EXUDATE_LEVELS = ['NONE', 'LOW', 'MODERATE', 'HIGH'] as const;
export const WOUND_TREATMENT_KINDS = ['COMPANY_PRODUCT', 'DRESSING', 'MEDICATION', 'OFFLOADING', 'COMPRESSION', 'PROCEDURE', 'OTHER'] as const;
export type WoundTreatmentKind = (typeof WOUND_TREATMENT_KINDS)[number];
export const WOUND_OUTCOMES = ['HEALED', 'IMPROVING', 'NO_CHANGE', 'WORSENED', 'REFERRED', 'LOST_TO_FOLLOW_UP'] as const;
export type WoundOutcome = (typeof WOUND_OUTCOMES)[number];
export const WOUND_PHOTO_WARNINGS = ['TOO_DARK', 'TOO_BRIGHT', 'BLURRY', 'LOW_RESOLUTION'] as const;
export type WoundPhotoWarning = (typeof WOUND_PHOTO_WARNINGS)[number];
export type WoundImageQuality = { brightness: number; sharpness: number; warnings: WoundPhotoWarning[] };

export const WOUND_CONSENT_PURPOSES = ['SCAN', 'RESEARCH', 'PRESENTATION'] as const;
export type WoundConsentPurpose = (typeof WOUND_CONSENT_PURPOSES)[number];
export const WOUND_RESEARCH_PURPOSES = ['AI_EVALUATION', 'AI_IMPROVEMENT', 'CASE_COMPARISON', 'HEALING_TRAJECTORIES', 'CARE_PRACTICES', 'PRODUCT_OUTCOMES'] as const;
export type WoundResearchPurpose = (typeof WOUND_RESEARCH_PURPOSES)[number];
export const WOUND_RESEARCH_RECIPIENTS = ['DMW_CLINICAL_RESEARCH', 'ALIA_GROUP', 'TETRASOL'] as const;
export type WoundResearchRecipient = (typeof WOUND_RESEARCH_RECIPIENTS)[number];
export const WOUND_PRESENTATION_AUDIENCES = ['INTERNAL_TRAINING', 'HEALTHCARE_PROFESSIONALS', 'APPROVED_PARTNERS', 'EDUCATIONAL_CASE_STUDIES'] as const;
export type WoundPresentationAudience = (typeof WOUND_PRESENTATION_AUDIENCES)[number];
export const WOUND_PRESENTATION_ORGANIZATIONS = ['ALIA_GROUP', 'TETRASOL'] as const;
export type WoundPresentationOrganization = (typeof WOUND_PRESENTATION_ORGANIZATIONS)[number];
export const WOUND_DEIDENTIFICATION_CHECKS = ['noFace', 'noIdentifyingMarks', 'noJewelleryOrTattoos', 'noBackgroundDetails', 'noNamesDatesOrNumbers', 'outcomeClinicianConfirmed', 'noEfficacyClaims'] as const;

// ---------------------------------------------------------------- permission wording
/** Must match app.settings `wound.consent_versions`. Bump it on any material change: everyone is asked again. */
export const WOUND_CONSENT_VERSION = '2026-10-draft';
export const WOUND_CONSENT_STATUS = 'DRAFT_PENDING_LEGAL_REVIEW' as const;
type ConsentCopy = { title: string; summary: string; points: string[] };
export const WOUND_CONSENT_TEXT: Record<WoundConsentPurpose, { required: boolean; en: ConsentCopy; ar: ConsentCopy }> = {
  SCAN: {
    required: true,
    en: {
      title: 'A · Wound photos and tracking (needed for this feature)',
      summary: 'Store your wound photos and notes securely so you can follow healing over time.',
      points: [
        'Photos are encrypted and stored privately. Location and camera details are removed from them.',
        'Only you, the family members you have authorised on this profile, and clinicians you choose to share wound photos with can see them. Every view is recorded.',
        'Photos are not used to diagnose you automatically. Classification and outcome come only from a clinician.',
        'This permission is only for your own care. It does NOT allow research or company presentations — those are separate choices below, off unless you turn them on.',
        'You can withdraw at any time: no new photos will be added. You can also delete your wound data.',
      ],
    },
    ar: {
      title: 'أ · صور الجرح ومتابعته (مطلوبة لهذه الخاصية)',
      summary: 'تخزين صور جرحك وملاحظاتك بأمان لتتابع التئامه مع الوقت.',
      points: [
        'الصور مشفّرة ومحفوظة بشكل خاص، ويُحذف منها الموقع وبيانات الكاميرا.',
        'لا يراها إلا أنت، وأفراد الأسرة المصرّح لهم بهذا الملف، والأطباء أو التمريض الذين تختار مشاركة صور الجرح معهم. وكل مشاهدة تُسجَّل.',
        'لا تُستخدم الصور لتشخيصك تلقائياً. التصنيف والنتيجة يحددهما مختص فقط.',
        'هذه الموافقة لرعايتك أنت فقط، ولا تسمح بالبحث أو بالعروض التقديمية للشركة — فهذه اختيارات منفصلة بالأسفل، مغلقة ما لم تفعّلها.',
        'يمكنك سحب الموافقة في أي وقت فلا تُضاف صور جديدة، ويمكنك أيضاً حذف بيانات الجروح.',
      ],
    },
  },
  RESEARCH: {
    required: false,
    en: {
      title: 'B · Research and improving wound AI (optional)',
      summary: 'Allow a de-identified copy of your wound case to be used for the purposes and by the organisations you select.',
      points: [
        'Only cases a clinician has reviewed are used. Your name, contact details, ID numbers, dates and free-text notes are removed; your case gets a code instead.',
        'Coded (pseudonymised) data is not fully anonymous: it stays protected, access-controlled and audited, and is kept only for a limited, stated period.',
        'Used only for the purposes you select below, by the organisations you select. Never sent to outside AI companies, and never for unrestricted model training.',
        'Comparing cases: de-identified summaries (no photos) may be shown to clinicians on the platform for education.',
        'Saying no does not affect your care or any other service.',
        'You can withdraw at any time: your case leaves datasets in preparation and is removed from completed ones. Results already published in aggregate cannot be recalled.',
      ],
    },
    ar: {
      title: 'ب · البحث وتحسين الذكاء الاصطناعي للجروح (اختياري)',
      summary: 'السماح باستخدام نسخة من حالة جرحك بعد إزالة ما يدل على هويتك، للأغراض والجهات التي تختارها فقط.',
      points: [
        'لا تُستخدم إلا الحالات التي راجعها مختص. يُحذف اسمك وبيانات التواصل وأرقام الهوية والتواريخ والملاحظات المكتوبة، وتأخذ حالتك رمزاً بدلاً من ذلك.',
        'البيانات المرمّزة ليست مجهولة الهوية تماماً، لذلك تبقى محمية ومقيدة الوصول ومسجّلة، وتُحفظ لمدة محددة فقط.',
        'تُستخدم فقط للأغراض التي تختارها بالأسفل ومن الجهات التي تختارها. لا تُرسل أبداً إلى شركات ذكاء اصطناعي خارجية، ولا لتدريب غير مقيّد للنماذج.',
        'مقارنة الحالات: قد تُعرض ملخصات بلا صور ولا هوية على الأطباء في المنصة لأغراض تعليمية.',
        'الرفض لا يؤثر على رعايتك ولا على أي خدمة أخرى.',
        'يمكنك السحب في أي وقت: تُستبعد حالتك من مجموعات البيانات قيد الإعداد وتُزال من المكتملة. النتائج المنشورة بشكل مجمّع مسبقاً لا يمكن استرجاعها.',
      ],
    },
  },
  PRESENTATION: {
    required: false,
    en: {
      title: 'C · Company presentations and education (optional)',
      summary: 'Allow the company to ASK you about showing a de-identified before/after case to the audiences you select.',
      points: [
        'This alone never publishes anything. For every case, you will first see the exact photos, text, audience, purpose and end date, and decide yes or no.',
        'Photos of the face, neck or intimate areas are never used. Names, faces, contact details, ID numbers and photo metadata are never shown.',
        'Cases are never presented as proof that a product works.',
        'Saying no does not affect your care or any other service.',
        'You can withdraw at any time: future use stops. Copies already shown or handed out under an approval you gave cannot be recalled.',
      ],
    },
    ar: {
      title: 'ج · العروض التقديمية والتعليم في الشركة (اختياري)',
      summary: 'السماح للشركة بأن تطلب منك عرض حالة "قبل/بعد" بلا هوية على الجهات التي تختارها.',
      points: [
        'هذه الموافقة وحدها لا تنشر أي شيء. ستُعرض عليك أولاً لكل حالة الصور والنص والجمهور والغرض وتاريخ الانتهاء بالضبط، وتقرر نعم أو لا.',
        'لا تُستخدم صور الوجه أو الرقبة أو المناطق الحساسة أبداً، ولا تُعرض الأسماء أو الوجوه أو بيانات التواصل أو أرقام الهوية أو بيانات الصورة.',
        'لا تُعرض الحالات أبداً كدليل على أن منتجاً ما فعّال.',
        'الرفض لا يؤثر على رعايتك ولا على أي خدمة أخرى.',
        'يمكنك السحب في أي وقت فيتوقف أي استخدام لاحق. النسخ التي عُرضت أو وُزعت بموافقة سابقة منك لا يمكن استرجاعها.',
      ],
    },
  },
};

// ---------------------------------------------------------------- deterministic helpers
const dayMs = 86_400_000;
const dateOnly = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
/** Day 1 is the day of the first photo. */
export function woundDayNumber(firstDate: string, date: string): number {
  return Math.round((dateOnly(date) - dateOnly(firstDate)) / dayMs) + 1;
}
export type WoundFollowUp = { day: number; date: string; status: 'DONE' | 'DUE' | 'UPCOMING' | 'MISSED' };
/** Day 1 plus the scheduled follow-up days, each matched by a photo within ±1 day. */
export function woundFollowUpPlan(firstDate: string | null, followUpDays: number[], photoDates: string[], today: string): WoundFollowUp[] {
  if (!firstDate) return [];
  const days = [1, ...followUpDays.filter((d) => d > 1)].sort((a, b) => a - b);
  const taken = photoDates.map((d) => woundDayNumber(firstDate, d));
  const todayDay = woundDayNumber(firstDate, today);
  return [...new Set(days)].map((day) => {
    const date = new Date(dateOnly(firstDate) + (day - 1) * dayMs).toISOString().slice(0, 10);
    const done = taken.some((t) => Math.abs(t - day) <= 1);
    return { day, date, status: done ? 'DONE' : todayDay > day + 1 ? 'MISSED' : todayDay >= day - 1 ? 'DUE' : 'UPCOMING' };
  });
}

const EXTRA_PRESENTATION_CLAIMS = ['heals faster', 'faster healing', 'thanks to', 'because of the product', 'proves', 'proof that', 'effective in', 'success rate',
  'شفي بفضل', 'بفضل المنتج', 'يسرع الالتئام', 'التئام اسرع', 'دليل على', 'نسبه نجاح'];
/** Presentation text never claims efficacy (deterministic; the second approver checks again). */
export function presentationTextProblem(text: string): string | null {
  const claim = findUnapprovedClaim(text, EXTRA_PRESENTATION_CLAIMS);
  return claim ? `UNAPPROVED_CLAIM:${claim}` : null;
}

// ---------------------------------------------------------------- API contracts
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const researchScope = z.object({ purposes: z.array(z.enum(WOUND_RESEARCH_PURPOSES)).min(1).max(6), recipients: z.array(z.enum(WOUND_RESEARCH_RECIPIENTS)).min(1).max(3) });
const presentationScope = z.object({ audiences: z.array(z.enum(WOUND_PRESENTATION_AUDIENCES)).min(1).max(4), organizations: z.array(z.enum(WOUND_PRESENTATION_ORGANIZATIONS)).min(1).max(2) });
export const woundConsentBody = z.union([
  z.object({ purpose: z.literal('SCAN'), action: z.literal('GRANT'), version: z.string().max(40) }),
  z.object({ purpose: z.literal('RESEARCH'), action: z.literal('GRANT'), version: z.string().max(40), scope: researchScope }),
  z.object({ purpose: z.literal('PRESENTATION'), action: z.literal('GRANT'), version: z.string().max(40), scope: presentationScope }),
  z.object({ purpose: z.enum(WOUND_CONSENT_PURPOSES), action: z.literal('WITHDRAW'), version: z.string().max(40) }),
]);
export const createWoundCaseBody = z.object({
  patientId: z.string().uuid(),
  label: z.string().trim().min(1).max(60),
  bodySite: z.enum(WOUND_BODY_SITES),
  bodySide: z.enum(WOUND_BODY_SIDES).default('NOT_APPLICABLE'),
  reportedCategory: z.enum(WOUND_REPORTED_CATEGORIES),
  onsetDate: isoDate.nullable().optional(),
  followUpDays: z.array(z.number().int().min(2).max(366)).max(20).optional(),
});
export const updateWoundCaseBody = createWoundCaseBody.omit({ patientId: true }).partial().extend({ status: z.enum(['OPEN', 'CLOSED']).optional() });
export const uploadWoundImageBody = z.object({
  contentType: z.enum(['image/jpeg', 'image/png']),
  dataBase64: z.string().min(100).max(17_000_000),
  /** When the app knows the capture time (camera roll metadata read on the device). */
  capturedAt: z.string().datetime({ offset: true }).optional(),
  note: z.string().trim().max(300).optional(),
});
export const woundObservationBody = z
  .object({
    observedOn: isoDate,
    imageId: z.string().uuid().nullable().optional(),
    painScore: z.number().int().min(0).max(10).nullable().optional(),
    exudate: z.enum(WOUND_EXUDATE_LEVELS).nullable().optional(),
    signs: z.array(z.enum(WOUND_SIGNS)).max(WOUND_SIGNS.length).default([]),
    lengthMm: z.number().min(0.1).max(1000).nullable().optional(),
    widthMm: z.number().min(0.1).max(1000).nullable().optional(),
    depthMm: z.number().min(0.1).max(300).nullable().optional(),
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((b) => b.painScore != null || b.exudate != null || b.signs.length > 0 || b.lengthMm != null || b.widthMm != null || b.depthMm != null || !!b.note, {
    message: 'Add at least one observation',
  });
export const woundTreatmentBody = z
  .object({
    kind: z.enum(WOUND_TREATMENT_KINDS),
    productId: z.string().uuid().nullable().optional(),
    description: z.string().trim().min(1).max(200),
    frequency: z.string().trim().max(60).nullable().optional(),
    startedOn: isoDate,
    endedOn: isoDate.nullable().optional(),
  })
  .refine((b) => (b.kind === 'COMPANY_PRODUCT') === !!b.productId, { message: 'A company product needs productId (and only then)', path: ['productId'] });
export const woundClinicalBody = z.object({ category: z.enum(WOUND_CATEGORIES), diabetes: z.enum(['YES', 'NO', 'UNKNOWN']).nullable().optional() });
export const woundOutcomeBody = z.object({ outcome: z.enum(WOUND_OUTCOMES), on: isoDate });
export const presentationPrepareBody = z.object({
  title: z.string().trim().min(3).max(120),
  summaryEn: z.string().trim().min(10).max(2000),
  summaryAr: z.string().trim().min(10).max(2000),
  audience: z.enum(WOUND_PRESENTATION_AUDIENCES),
  organization: z.enum(WOUND_PRESENTATION_ORGANIZATIONS),
  scopeNote: z.string().trim().min(10).max(300),
  validUntil: isoDate,
  images: z.array(z.object({ imageId: z.string().uuid(), captionEn: z.string().trim().min(1).max(300), captionAr: z.string().trim().min(1).max(300) })).min(1).max(6),
});
export const presentationDecisionBody = z.object({ decision: z.enum(['APPROVE', 'DECLINE']), requestHash: z.string().regex(/^[0-9a-f]{64}$/) });
export const presentationApproveBody = z.object({ checklist: z.object(Object.fromEntries(WOUND_DEIDENTIFICATION_CHECKS.map((k) => [k, z.literal(true)])) as Record<(typeof WOUND_DEIDENTIFICATION_CHECKS)[number], z.ZodLiteral<true>>) });
export const researchDatasetBody = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(1000).optional(),
  purpose: z.enum(WOUND_RESEARCH_PURPOSES),
  recipient: z.enum(WOUND_RESEARCH_RECIPIENTS),
  criteria: z.object({ categories: z.array(z.enum(WOUND_CATEGORIES)).min(1).max(6).optional(), minImages: z.number().int().min(1).max(30).optional() }).default({}),
});
export const researchFreezeBody = z.object({ approvalReference: z.string().trim().min(3).max(300), retentionUntil: isoDate });
export const researchReviewBody = z.object({ decision: z.enum(['ACCEPTED', 'REJECTED']), note: z.string().trim().max(500).optional() });

// ---------------------------------------------------------------- DTOs
export type WoundConsentState = {
  purpose: WoundConsentPurpose;
  active: boolean;
  currentVersion: string;
  /** Scope of the active permission (research purposes / recipients, presentation audiences / organisations). */
  scope: { purposes?: WoundResearchPurpose[]; recipients?: WoundResearchRecipient[]; audiences?: WoundPresentationAudience[]; organizations?: WoundPresentationOrganization[] } | null;
  since: string | null;
  /** Whether the signed-in person may decide this for the profile (NOT_FOR_MINORS: B / C are unavailable for a minor). */
  decision: 'ALLOWED' | 'NOT_ALLOWED' | 'NOT_FOR_MINORS';
};
export type WoundConsentEvent = { id: string; purpose: WoundConsentPurpose; action: 'GRANT' | 'WITHDRAW'; version: string; scope: WoundConsentState['scope']; basis: string; reason: string | null; byMe: boolean; at: string };
export type WoundPermissions = {
  patientId: string;
  available: boolean;
  wordingVersion: string;
  wordingStatus: typeof WOUND_CONSENT_STATUS;
  consents: WoundConsentState[];
  history: WoundConsentEvent[];
};
export type WoundImage = {
  id: string;
  caseId: string;
  capturedAt: string;
  capturedAtSource: 'CAMERA' | 'DEVICE' | 'UPLOAD';
  day: number;
  uploaderRole: 'PATIENT' | 'CAREGIVER' | 'CLINICIAN';
  width: number;
  height: number;
  quality: WoundImageQuality;
  metadataRemoved: string[];
  note: string | null;
  canDelete: boolean;
};
export type WoundObservation = {
  id: string;
  observedOn: string;
  day: number | null;
  imageId: string | null;
  authorRole: 'PATIENT' | 'CAREGIVER' | 'CLINICIAN';
  provenance: 'PATIENT_REPORTED' | 'CAREGIVER_REPORTED' | 'PROFESSIONALLY_VERIFIED';
  painScore: number | null;
  exudate: (typeof WOUND_EXUDATE_LEVELS)[number] | null;
  signs: WoundSign[];
  lengthMm: number | null;
  widthMm: number | null;
  depthMm: number | null;
  note: string | null;
  mine: boolean;
};
export type WoundTreatment = {
  id: string;
  kind: WoundTreatmentKind;
  product: { id: string; slug: string; nameAr: string; nameEn: string; brand: string } | null;
  description: string;
  frequency: string | null;
  startedOn: string;
  endedOn: string | null;
  recorderRole: 'PATIENT' | 'CAREGIVER' | 'CLINICIAN';
  provenance: WoundObservation['provenance'];
  mine: boolean;
};
export type WoundCase = {
  id: string;
  patientId: string;
  label: string;
  bodySite: WoundBodySite;
  bodySide: (typeof WOUND_BODY_SIDES)[number];
  reportedCategory: WoundReportedCategory;
  onsetDate: string | null;
  status: 'OPEN' | 'CLOSED';
  followUpDays: number[];
  /** Set only by a clinician with a share that includes wound photos. */
  clinical: { category: WoundCategory; diabetes: 'YES' | 'NO' | 'UNKNOWN' | null; reviewedAt: string } | null;
  outcome: { outcome: WoundOutcome; on: string; recordedAt: string } | null;
  photoCount: number;
  firstPhotoAt: string | null;
  lastPhotoAt: string | null;
  nextDue: WoundFollowUp | null;
  createdAt: string;
};
/** One point per measurement: never a healing claim, only what was measured and by whom. */
export type WoundMeasurementPoint = { day: number; observedOn: string; lengthMm: number | null; widthMm: number | null; areaMm2: number | null; painScore: number | null; provenance: WoundObservation['provenance'] };
export type WoundCaseDetail = WoundCase & {
  images: WoundImage[];
  observations: WoundObservation[];
  treatments: WoundTreatment[];
  plan: WoundFollowUp[];
  measurements: WoundMeasurementPoint[];
  /** AI analysis of wound photos is not validated: always DISABLED (server-side flag ai.wound_assessment). */
  ai: { status: 'DISABLED'; reason: 'NOT_VALIDATED' };
  /** canAdd: may add photos, notes and treatments — needs the scanning permission (A) active now. */
  access: { canEdit: boolean; canAdd: boolean; scanActive: boolean; canDelete: boolean; asClinician: boolean };
};
export type WoundMediaLink = { url: string; expiresAt: string };
export type WoundPresentationView = {
  id: string;
  status: 'NOMINATED' | 'AWAITING_PATIENT' | 'PATIENT_APPROVED' | 'PATIENT_DECLINED' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
  caseId: string;
  title: string | null;
  summaryEn: string | null;
  summaryAr: string | null;
  audience: WoundPresentationAudience | null;
  organization: WoundPresentationOrganization | null;
  scopeNote: string | null;
  validUntil: string | null;
  category: WoundCategory | null;
  outcome: WoundOutcome | null;
  images: { imageId: string; position: number; day: number; captionEn: string; captionAr: string }[];
  requestHash: string | null;
  patientDecidedAt: string | null;
  approvedAt: string | null;
  closedReason: string | null;
  /** Staff only. */
  preparedByMe?: boolean;
  /** Staff only: the audiences and organisations the person's active permission (C) covers; null once withdrawn. */
  permitted?: { audiences: WoundPresentationAudience[]; organizations: WoundPresentationOrganization[] } | null;
  nominatedByMe?: boolean;
  exports?: { id: string; format: 'PDF' | 'IMAGE_PACKAGE'; exportedAt: string; byMe: boolean }[];
};
export type WoundPresentationCandidate = { caseId: string; category: WoundCategory; region: string; photoCount: number; spanDays: number; outcome: WoundOutcome; audiences: WoundPresentationAudience[]; organizations: WoundPresentationOrganization[] };
export type WoundResearchDataset = {
  id: string;
  lineageId: string;
  version: number;
  previousVersionId: string | null;
  name: string;
  description: string | null;
  purpose: WoundResearchPurpose;
  recipient: WoundResearchRecipient;
  criteria: { categories?: WoundCategory[]; minImages?: number };
  status: 'DRAFT' | 'FROZEN' | 'RETIRED';
  approvalReference: string | null;
  retentionUntil: string | null;
  frozenAt: string | null;
  retiredAt: string | null;
  createdAt: string;
  counts: { items: number; pending: number; accepted: number; rejected: number; withdrawn: number; images: number };
  exports: number;
};
export type WoundResearchItem = {
  id: string;
  pseudonym: string;
  snapshot: Record<string, unknown>;
  status: 'INCLUDED' | 'WITHDRAWN';
  qualityStatus: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  qualityNote: string | null;
  images: { id: string; day: number }[];
};
export type WoundProductOutcomeRow = {
  category: WoundCategory;
  product: string;
  productName: string;
  suppressed: boolean;
  cases?: number;
  withConfirmedOutcome?: number;
  outcomes?: Record<WoundOutcome, number>;
  medianDaysToConfirmedHealed?: number | null;
  withOtherTreatments?: number;
  followUpCompleteness?: number | null;
  missing?: { outcome: number; photos: number; productStart: number };
};
export type WoundSimilarCase = {
  ref: string;
  category: WoundCategory;
  region: string;
  ageBand: string;
  diabetes: string | null;
  photoCount: number;
  followUpDays: number | null;
  outcome: WoundOutcome | null;
  treatmentKinds: WoundTreatmentKind[];
  matchedOn: ('CATEGORY' | 'REGION' | 'DIABETES')[];
};
export type WoundRegistryOverview = {
  testData: boolean;
  cases: number;
  images: number;
  profiles: number;
  consents: { scan: number; research: number; presentation: number };
  clinicallyReviewed: number;
  withConfirmedOutcome: number;
  presentationEligible: number;
  byReportedCategory: Record<string, number>;
  byClinicalCategory: Record<string, number>;
  outcomes: Record<string, number>;
  followUpCompleteness: number | null;
  datasets: Record<string, number>;
  presentations: Record<string, number>;
  presentationExports: number;
  researchExports: number;
  storagePurgePending: number;
  flags: Record<string, boolean>;
  consentVersions: Record<WoundConsentPurpose, string>;
  storage: 'CONFIGURED' | 'DEV_ADAPTER' | 'NOT_CONFIGURED';
};
