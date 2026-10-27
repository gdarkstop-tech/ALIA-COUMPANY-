import { z } from 'zod';

/**
 * AI gateway contracts (migrations 0010–0011). Providers are replaceable; the apps never see
 * provider credentials, model prices or which vendor answered beyond a display label.
 */
export const AI_PROVIDERS = ['ANTHROPIC', 'OPENAI', 'GEMINI', 'SIMULATED'] as const;
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
  unavailableReason: 'FEATURE_DISABLED' | 'CONSENT_REQUIRED' | 'NOT_CONFIGURED' | null;
  allowance: AiAllowance | null;
};

export type AiMessageKind = 'MESSAGE' | 'EMERGENCY_GUIDANCE' | 'REFUSAL' | 'SIMULATED';
export type AiChatMessage = { id: string; role: 'user' | 'assistant'; kind: AiMessageKind; content: string; createdAt: string };
export type AiConversation = { id: string; title: string; patientId: string | null; createdAt: string; updatedAt: string };
export type AiConversationDetail = AiConversation & { messages: AiChatMessage[] };
export type AiReply = { message: AiChatMessage; allowance: AiAllowance | null };

// ---------------------------------------------------------------- AI control centre (admin)
export type AiProviderStatus = { code: AiProviderCode; configured: boolean; productionAllowed: boolean; envVar: string | null };
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
};
export type AiRouteAdmin = {
  key: string;
  description: string;
  featureFlag: string;
  featureEnabled: boolean;
  metric: AiMetric;
  enabled: boolean;
  maxOutputTokens: number;
  tiers: { tier: AiModelTier; modelId: string; fallbackModelId: string | null; effort: (typeof AI_EFFORTS)[number] }[];
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
export type AiControlCentre = { providers: AiProviderStatus[]; models: AiModelAdmin[]; routes: AiRouteAdmin[]; quotas: AiQuotaAdmin; usage: AiUsageSummary };

const micros = z.number().int().min(0).max(1_000_000_000_000);
export const aiModelCreateBody = z.object({
  provider: z.enum(['ANTHROPIC', 'OPENAI', 'GEMINI']),
  modelId: z.string().trim().regex(/^[A-Za-z0-9._:/-]{2,100}$/),
  displayName: z.string().trim().min(2).max(80),
  inputPriceMicros: micros.nullable(),
  outputPriceMicros: micros.nullable(),
  cacheReadPriceMicros: micros.nullable().optional(),
  /** Where the price comes from (the provider's pricing page, contract, date). */
  priceSource: z.string().trim().min(3).max(300),
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
  })
  .partial();
export const aiRoutePatchBody = z
  .object({
    enabled: z.boolean(),
    maxOutputTokens: z.number().int().min(256).max(32_000),
    tiers: z.array(z.object({ tier: z.enum(AI_MODEL_TIERS), modelId: z.string().uuid(), fallbackModelId: z.string().uuid().nullable(), effort: z.enum(AI_EFFORTS) })).max(3),
  })
  .partial();
export const aiQuotaPatchBody = z.object({
  plan: z.enum(['SILVER', 'GOLD', 'PLATINUM']).optional(),
  role: z.enum(['DOCTOR', 'NURSE']).optional(),
  metric: z.enum(AI_METRICS),
  weeklyLimit: z.number().int().min(0).max(1_000_000),
}).refine((b) => Boolean(b.plan) !== Boolean(b.role), { message: 'Choose a plan or a clinician role', path: ['plan'] });
export const aiBudgetBody = z.object({ monthlyLimitMicros: micros.nullable() });
