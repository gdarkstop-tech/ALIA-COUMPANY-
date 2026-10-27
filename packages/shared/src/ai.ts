import { z } from 'zod';

/**
 * AI gateway contracts (migrations 0010–0011). Providers are replaceable; the apps never see
 * provider credentials, model prices or which vendor answered beyond a display label.
 */
export const AI_PROVIDERS = ['ANTHROPIC', 'OPENAI', 'GEMINI', 'QWEN', 'GROK', 'KIMI', 'MEDGEMMA', 'SIMULATED'] as const;
/** Providers an administrator can register models for (the simulator is built in). */
export const AI_REAL_PROVIDERS = ['ANTHROPIC', 'OPENAI', 'GEMINI', 'QWEN', 'GROK', 'KIMI', 'MEDGEMMA'] as const;
export const AI_CAPABILITIES = ['CHAT', 'VISION', 'DOCUMENT_EXTRACTION', 'REALTIME_VOICE', 'SPEECH_TO_TEXT', 'TEXT_TO_SPEECH', 'EMBEDDING'] as const;
export type AiCapability = (typeof AI_CAPABILITIES)[number];
export const AI_HOSTING = ['PROVIDER_API', 'MANAGED_ENDPOINT', 'SELF_HOSTED', 'LOCAL'] as const;
export const AI_COMPLEXITIES = ['ANY', 'SIMPLE', 'COMPLEX'] as const;
export const AI_CANDIDATE_LANGUAGES = ['ANY', 'ar', 'en'] as const;
export type AiProviderCode = (typeof AI_PROVIDERS)[number];
export const AI_METRICS = ['CHAT_MESSAGES', 'ANALYSES', 'VOICE_SECONDS'] as const;
export type AiMetric = (typeof AI_METRICS)[number];
export const AI_MODEL_TIERS = ['BASIC', 'ADVANCED', 'PREMIUM'] as const;
export type AiModelTier = (typeof AI_MODEL_TIERS)[number];
export const AI_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
/** A single message the person types (characters). */
export const AI_MESSAGE_MAX_CHARS = 4000;

// ---------------------------------------------------------------- patient assistant
export const createConversationBody = z.object({
  /** Share this authorized profile's summary (age, sex, allergies, conditions, medications) as context. */
  patientId: z.string().uuid().nullable().optional(),
});
export const sendMessageBody = z.object({ content: z.string().trim().min(1).max(AI_MESSAGE_MAX_CHARS) });

export type AiAllowance = {
  metric: AiMetric;
  weeklyLimit: number;
  used: number;
  remaining: number;
  resetsAt: string;
  tier: AiModelTier;
  plan: 'SILVER' | 'GOLD' | 'PLATINUM';
};

export type AiAssistantStatus = {
  /** Why the assistant cannot be used right now (null = available). */
  unavailableReason: 'FEATURE_DISABLED' | 'CONSENT_REQUIRED' | 'NOT_CONFIGURED' | 'PAUSED' | null;
  allowance: AiAllowance | null;
};

export type AiMessageKind = 'MESSAGE' | 'EMERGENCY_GUIDANCE' | 'REFUSAL' | 'SIMULATED';
/** An approved knowledge version the answer cited (label matches the [K1] marker in the text). */
export type AiCitation = { label: string; versionId: string; title: string; locale: 'ar' | 'en'; version: number; sourcePublisher: string; sourceTitle: string; sourceUrl: string | null; sourceDate: string | null };
export type AiChatMessage = { id: string; role: 'user' | 'assistant'; kind: AiMessageKind; content: string; createdAt: string; reported: boolean; citations: AiCitation[] };
export type AiConversation = { id: string; title: string; patientId: string | null; createdAt: string; updatedAt: string };
export type AiConversationDetail = AiConversation & { messages: AiChatMessage[] };
export type AiReply = { message: AiChatMessage; allowance: AiAllowance | null };

// ---------------------------------------------------------------- AI control centre (admin)
export type AiProviderStatus = { code: AiProviderCode; configured: boolean; productionAllowed: boolean; envVars: string[] };
export type AiModelAdmin = {
  id: string;
  provider: AiProviderCode;
  modelId: string;
  displayName: string;
  /** USD per 1M tokens, micro-dollars (1 USD = 1,000,000); null = unknown. */
  inputPriceMicros: number | null;
  outputPriceMicros: number | null;
  cacheReadPriceMicros: number | null;
  priceSource: string | null;
  priceVerifiedAt: string | null;
  active: boolean;
  capabilities: AiCapability[];
  medicalSpecialized: boolean;
  hosting: (typeof AI_HOSTING)[number];
  dataRegion: string | null;
  notes: string | null;
  /** Approval to send patient data to this provider (DPA / privacy terms reference). */
  patientDataApprovalRef: string | null;
  patientDataApprovedAt: string | null;
  /** Routes on which a clinical reviewer approved this model (active approvals). */
  clinicalApprovals: { routeKey: string; approvalId: string; approvedAt: string; runId: string }[];
};
export type AiRouteAdmin = {
  key: string;
  description: string;
  featureFlag: string;
  featureEnabled: boolean;
  metric: AiMetric;
  enabled: boolean;
  maxOutputTokens: number;
  carriesPatientData: boolean;
  requiredCapability: AiCapability;
  requireClinicalApproval: boolean;
  complexityRouting: boolean;
  simpleMaxChars: number;
  maxConcurrentPerUser: number;
  candidates: AiRouteCandidate[];
};
export type AiRouteCandidate = {
  id: string;
  tier: AiModelTier;
  modelId: string;
  complexity: (typeof AI_COMPLEXITIES)[number];
  language: (typeof AI_CANDIDATE_LANGUAGES)[number];
  priority: number;
  effort: (typeof AI_EFFORTS)[number];
  enabled: boolean;
  /** Why the router would skip it for STANDARD accounts right now (empty = eligible). */
  blockers: ('MODEL_INACTIVE' | 'PROVIDER_NOT_CONFIGURED' | 'CAPABILITY_MISSING' | 'NO_PATIENT_DATA_APPROVAL' | 'NO_CLINICAL_APPROVAL' | 'DISABLED')[];
};
export type AiQuotaAdmin = { plans: { plan: 'SILVER' | 'GOLD' | 'PLATINUM'; tier: AiModelTier; limits: Record<AiMetric, number> }[]; clinicians: { role: 'DOCTOR' | 'NURSE'; limits: Partial<Record<AiMetric, number>> }[] };
export type AiUsageSummary = {
  monthLimitMicros: number | null;
  monthSpendMicros: number;
  days: number;
  byModel: { provider: AiProviderCode; modelId: string; requests: number; inputTokens: number; outputTokens: number; costMicros: number; estimated: boolean }[];
  byOutcome: { outcome: string; requests: number }[];
  /** No personal data: counts only. */
  activeUsers: number;
};
export type AiPlanBudget = { plan: 'SILVER' | 'GOLD' | 'PLATINUM'; userMonthlyLimitMicros: number | null; planMonthlyLimitMicros: number | null; planMonthSpendMicros: number };
export type AiBudgetAlert = { scope: 'COMPANY' | 'PLAN'; plan: string | null; month: string; thresholdPct: number; spendMicros: number; limitMicros: number; createdAt: string };
export type AiControlCentre = {
  providers: AiProviderStatus[];
  models: AiModelAdmin[];
  routes: AiRouteAdmin[];
  quotas: AiQuotaAdmin;
  usage: AiUsageSummary;
  planBudgets: AiPlanBudget[];
  alerts: AiBudgetAlert[];
};

const micros = z.number().int().min(0).max(1_000_000_000_000);
const capabilities = z.array(z.enum(AI_CAPABILITIES)).min(1).max(7);
export const aiModelCreateBody = z.object({
  provider: z.enum(AI_REAL_PROVIDERS),
  modelId: z.string().trim().regex(/^[A-Za-z0-9._:/-]{2,100}$/),
  displayName: z.string().trim().min(2).max(80),
  inputPriceMicros: micros.nullable(),
  outputPriceMicros: micros.nullable(),
  cacheReadPriceMicros: micros.nullable().optional(),
  /** Where the price comes from (the provider's pricing page, contract, date). */
  priceSource: z.string().trim().min(3).max(300),
  capabilities: capabilities.default(['CHAT']),
  medicalSpecialized: z.boolean().default(false),
  hosting: z.enum(['PROVIDER_API', 'MANAGED_ENDPOINT', 'SELF_HOSTED']).default('PROVIDER_API'),
  dataRegion: z.string().trim().min(2).max(80).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export const aiModelPatchBody = z
  .object({
    displayName: z.string().trim().min(2).max(80),
    inputPriceMicros: micros.nullable(),
    outputPriceMicros: micros.nullable(),
    cacheReadPriceMicros: micros.nullable(),
    priceSource: z.string().trim().min(3).max(300),
    /** true = "I checked these prices against the provider today" (records who and when). */
    verifyPrice: z.boolean(),
    active: z.boolean(),
    capabilities,
    medicalSpecialized: z.boolean(),
    hosting: z.enum(['PROVIDER_API', 'MANAGED_ENDPOINT', 'SELF_HOSTED']),
    dataRegion: z.string().trim().min(2).max(80).nullable(),
    notes: z.string().trim().max(1000).nullable(),
    /** Data-processing approval (ai.data.approve): a DPA / privacy-terms reference, or null to withdraw it. */
    patientDataApprovalRef: z.string().trim().min(3).max(300).nullable(),
  })
  .partial();
export const aiRoutePatchBody = z
  .object({
    enabled: z.boolean(),
    maxOutputTokens: z.number().int().min(256).max(32_000),
    complexityRouting: z.boolean(),
    simpleMaxChars: z.number().int().min(20).max(4000),
    maxConcurrentPerUser: z.number().int().min(1).max(10),
  })
  .partial();
export const aiCandidateCreateBody = z.object({
  tier: z.enum(AI_MODEL_TIERS),
  modelId: z.string().uuid(),
  complexity: z.enum(AI_COMPLEXITIES).default('ANY'),
  language: z.enum(AI_CANDIDATE_LANGUAGES).default('ANY'),
  priority: z.number().int().min(1).max(1000).default(100),
  effort: z.enum(AI_EFFORTS).default('medium'),
});
export const aiCandidatePatchBody = z
  .object({
    complexity: z.enum(AI_COMPLEXITIES),
    language: z.enum(AI_CANDIDATE_LANGUAGES),
    priority: z.number().int().min(1).max(1000),
    effort: z.enum(AI_EFFORTS),
    enabled: z.boolean(),
  })
  .partial();
export const aiPlanBudgetBody = z.object({
  plan: z.enum(['SILVER', 'GOLD', 'PLATINUM']),
  userMonthlyLimitMicros: micros.nullable(),
  planMonthlyLimitMicros: micros.nullable(),
});
export const aiQuotaPatchBody = z.object({
  plan: z.enum(['SILVER', 'GOLD', 'PLATINUM']).optional(),
  role: z.enum(['DOCTOR', 'NURSE']).optional(),
  metric: z.enum(AI_METRICS),
  weeklyLimit: z.number().int().min(0).max(1_000_000),
}).refine((b) => Boolean(b.plan) !== Boolean(b.role), { message: 'Choose a plan or a clinician role', path: ['plan'] });
export const aiBudgetBody = z.object({ monthlyLimitMicros: micros.nullable() });

// ---------------------------------------------------------------- medical AI evaluation suite
export const AI_EVAL_CATEGORIES = ['EMERGENCY', 'LAB_REPORT', 'WOUND_CARE', 'MEDICATION', 'PATIENT_HISTORY', 'TERMINOLOGY', 'DOCUMENTATION', 'PRODUCT_INFO', 'PROMPT_INJECTION', 'PRIVACY'] as const;
export type AiEvalCategory = (typeof AI_EVAL_CATEGORIES)[number];
/** Deterministic screens (case-insensitive regular expressions); clinicians judge accuracy. */
export const aiEvalChecks = z
  .object({
    mustIncludeAll: z.array(z.string().min(1).max(300)).max(10),
    mustIncludeAny: z.array(z.string().min(1).max(300)).max(10),
    mustNotInclude: z.array(z.string().min(1).max(300)).max(10),
    requireLanguage: z.enum(['ar', 'en']),
    maxChars: z.number().int().min(50).max(12_000),
  })
  .partial()
  .strict()
  .refine((c) => [...(c.mustIncludeAll ?? []), ...(c.mustIncludeAny ?? []), ...(c.mustNotInclude ?? [])].every(isValidRegex), { message: 'Every check must be a valid regular expression' });
export type AiEvalChecks = z.infer<typeof aiEvalChecks>;
function isValidRegex(p: string) {
  try {
    new RegExp(p, 'iu');
    return true;
  } catch {
    return false;
  }
}
export const aiEvalCaseBody = z.object({
  code: z.string().trim().regex(/^[A-Z0-9][A-Z0-9_-]{2,40}$/),
  category: z.enum(AI_EVAL_CATEGORIES),
  language: z.enum(['ar', 'en']),
  prompt: z.string().trim().min(3).max(4000),
  context: z.string().trim().max(8000).nullable().optional(),
  expectedBehavior: z.string().trim().min(10).max(2000),
  checks: aiEvalChecks.default({}),
});
export const aiEvalResultReviewBody = z.object({
  accuracy: z.number().int().min(1).max(5),
  hallucination: z.boolean(),
  unsafe: z.boolean(),
  arabicQuality: z.number().int().min(1).max(5).nullable().optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type AiEvalCase = {
  id: string;
  code: string;
  category: AiEvalCategory;
  language: 'ar' | 'en';
  prompt: string;
  context: string | null;
  expectedBehavior: string;
  checks: AiEvalChecks;
  status: 'DRAFT' | 'REVIEWED' | 'RETIRED';
  version: number;
  authoredByMe: boolean;
  reviewedAt: string | null;
};
export type AiEvalSummary = { cases: number; done: number; automatedPassRate: number | null; reviewed: number; unsafe: number; hallucinations: number; meanAccuracy: number | null; meanArabicQuality: number | null; meanLatencyMs: number | null };
export type AiEvalRun = {
  id: string;
  modelRef: string;
  provider: AiProviderCode;
  modelId: string;
  routeKey: string;
  policyVersion: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  failure: string | null;
  caseCount: number;
  completedCount: number;
  automatedPassCount: number;
  costMicros: number;
  costEstimated: boolean;
  startedAt: string;
  finishedAt: string | null;
  summary: AiEvalSummary;
};
export type AiEvalResult = {
  id: string;
  caseCode: string;
  caseVersion: number;
  category: AiEvalCategory;
  language: 'ar' | 'en';
  status: 'PENDING' | 'DONE' | 'ERROR';
  prompt: string | null;
  expectedBehavior: string | null;
  output: string | null;
  outcome: string | null;
  latencyMs: number | null;
  costMicros: number | null;
  automatedChecks: { name: string; passed: boolean; detail?: string }[] | null;
  automatedPass: boolean | null;
  review: { accuracy: number; hallucination: boolean; unsafe: boolean; arabicQuality: number | null; notes: string | null; reviewedAt: string } | null;
};
export type AiModelApproval = { id: string; routeKey: string; modelRef: string; modelId: string; provider: AiProviderCode; runId: string; policyVersion: string; note: string; approvedAt: string; revokedAt: string | null; revokeNote: string | null };
export type AiEvaluationOverview = {
  cases: AiEvalCase[];
  runs: AiEvalRun[];
  approvals: AiModelApproval[];
  thresholds: { minCases: number; minAutomatedPassRate: number; minMeanAccuracy: number; maxHallucinationRate: number };
  currentPolicyVersion: string;
};

// ---------------------------------------------------------------- personal preferences
export const AI_REPLY_LANGUAGES = ['auto', 'ar', 'en'] as const;
export const AI_DETAIL_LEVELS = ['brief', 'detailed'] as const;
export type AiPreferences = { replyLanguage: (typeof AI_REPLY_LANGUAGES)[number]; detailLevel: (typeof AI_DETAIL_LEVELS)[number]; assistantName: string | null };
export const aiPreferencesBody = z.object({ replyLanguage: z.enum(AI_REPLY_LANGUAGES), detailLevel: z.enum(AI_DETAIL_LEVELS) }).partial();

// ---------------------------------------------------------------- "Report AI response"
export const AI_REPORT_REASONS = ['INACCURATE', 'UNSAFE', 'MISSED_EMERGENCY', 'INAPPROPRIATE', 'PRIVACY', 'PRODUCT_PROMOTION', 'OTHER'] as const;
export type AiReportReason = (typeof AI_REPORT_REASONS)[number];
export const AI_REPORT_RESOLUTIONS = ['MODEL_ERROR', 'POLICY_GAP', 'SAFETY_ESCALATION', 'PRIVACY_ISSUE', 'NO_ISSUE', 'OTHER'] as const;
export type AiReportResolution = (typeof AI_REPORT_RESOLUTIONS)[number];
export const aiReportBody = z.object({
  reason: z.enum(AI_REPORT_REASONS),
  note: z.string().trim().max(1000).optional(),
  /** Share the question that led to the answer with the reviewers too (explicit choice). */
  includeQuestion: z.boolean().default(false),
});
export const aiReportTransitionBody = z.object({
  status: z.enum(['IN_REVIEW', 'RESOLVED', 'DISMISSED', 'NOTE']),
  resolution: z.enum(AI_REPORT_RESOLUTIONS).optional(),
  note: z.string().trim().max(2000).optional(),
});
export type AiReportStatus = 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'DISMISSED';
export type AiReportListItem = {
  id: string;
  reason: AiReportReason;
  status: AiReportStatus;
  resolution: AiReportResolution | null;
  messageKind: string;
  provider: AiProviderCode | null;
  modelId: string | null;
  routeKey: string | null;
  locale: string | null;
  assignedToMe: boolean;
  redacted: boolean;
  createdAt: string;
  updatedAt: string;
};
export type AiReportDetail = AiReportListItem & {
  answer: string;
  question: string | null;
  note: string | null;
  events: { event: string; note: string | null; createdAt: string; byMe: boolean }[];
};

// ---------------------------------------------------------------- curated medical knowledge
export const knowledgeArticleBody = z.object({
  slug: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
  locale: z.enum(['ar', 'en']),
  title: z.string().trim().min(3).max(200),
  summary: z.string().trim().max(500).default(''),
  body: z.string().trim().min(50).max(20_000),
  topics: z.array(z.string().trim().min(2).max(60)).max(20).default([]),
  sourcePublisher: z.string().trim().min(2).max(200),
  sourceTitle: z.string().trim().min(2).max(300),
  sourceUrl: z.string().trim().regex(/^https:\/\/\S{4,500}$/).nullable().optional(),
  sourceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
export type KnowledgeStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'RETIRED';
export type KnowledgeArticleAdmin = {
  id: string;
  slug: string;
  locale: 'ar' | 'en';
  title: string;
  summary: string;
  body: string;
  topics: string[];
  sourcePublisher: string;
  sourceTitle: string;
  sourceUrl: string | null;
  sourceDate: string | null;
  status: KnowledgeStatus;
  editedByMe: boolean;
  updatedAt: string;
  live: { versionId: string; version: number; approvedAt: string; approvedByMe: boolean } | null;
  versions: { version: number; approvedAt: string; supersededAt: string | null; note: string }[];
};
/** A live, clinically approved version as shown to patients. */
export type KnowledgeVersion = {
  id: string;
  slug: string;
  locale: 'ar' | 'en';
  version: number;
  title: string;
  summary: string;
  body: string;
  sourcePublisher: string;
  sourceTitle: string;
  sourceUrl: string | null;
  sourceDate: string | null;
  approvedAt: string;
};
