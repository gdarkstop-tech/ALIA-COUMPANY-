/**
 * Provider-independent AI gateway contracts. Providers are replaceable adapters; nothing outside
 * src/integrations/ai knows which vendor answered. Credentials stay in the backend environment
 * (secret manager) and never reach the database, the logs, the model prompt or the apps.
 */
export const AI_PROVIDER_CODES = ['ANTHROPIC', 'OPENAI', 'GEMINI', 'QWEN', 'GROK', 'KIMI', 'MEDGEMMA', 'SIMULATED'] as const;
export type AiProviderCode = (typeof AI_PROVIDER_CODES)[number];
export type AiEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type AiTurn = { role: 'user' | 'assistant'; content: string };

export type AiRequest = {
  model: string;
  /** Operator instructions (our safety policy). Never contains user-supplied text. */
  system: string;
  messages: AiTurn[];
  maxOutputTokens: number;
  effort: AiEffort;
  requestId: string;
  /** Opaque, non-reversible reference to the person (abuse monitoring at the provider). */
  endUserRef: string;
};

export type AiUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number };

export type AiResult = {
  /** REFUSED = the provider's own safety system declined; TRUNCATED = hit the output limit. */
  outcome: 'ANSWERED' | 'REFUSED' | 'TRUNCATED';
  text: string;
  /** The model that actually produced the answer (a provider-side fallback can differ). */
  servedModel: string;
  usage: AiUsage;
  refusalCategory?: string | null;
};

export type AiErrorKind = 'NOT_CONFIGURED' | 'AUTH' | 'RATE_LIMIT' | 'OVERLOADED' | 'BAD_REQUEST' | 'TIMEOUT' | 'NETWORK' | 'UPSTREAM';

export class AiProviderError extends Error {
  constructor(
    public readonly provider: AiProviderCode,
    public readonly kind: AiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
  /** Worth trying the route's fallback model (another provider) for. */
  get retryable() {
    return this.kind === 'RATE_LIMIT' || this.kind === 'OVERLOADED' || this.kind === 'TIMEOUT' || this.kind === 'NETWORK' || this.kind === 'UPSTREAM';
  }
}

export type AiHealth = { ok: boolean; detail: string; checkedAt: string };

export interface AiProvider {
  readonly code: AiProviderCode;
  /** CONFIGURED only when the business-owned key is present in the backend environment. */
  readonly status: 'CONFIGURED' | 'NOT_CONFIGURED';
  complete(req: AiRequest): Promise<AiResult>;
  /** Free metadata call (no generation is billed) proving the key works and the model exists. */
  healthCheck(model: string): Promise<AiHealth>;
}

export const notConfigured = (code: AiProviderCode): AiProvider => ({
  code,
  status: 'NOT_CONFIGURED',
  complete: async () => {
    throw new AiProviderError(code, 'NOT_CONFIGURED', `${code} is not configured`);
  },
  healthCheck: async () => ({ ok: false, detail: 'NOT_CONFIGURED', checkedAt: new Date().toISOString() }),
});
