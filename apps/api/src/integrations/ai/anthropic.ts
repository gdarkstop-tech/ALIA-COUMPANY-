import Anthropic from '@anthropic-ai/sdk';
import { AiProviderError, notConfigured, type AiProvider, type AiResult } from './types';

// Models that accept the server-side refusal fallback (`fallbacks: "default"`): on a safety
// decline the API re-runs the request on Anthropic's recommended model for that category.
const SERVER_FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

type IterationUsage = { type?: string; input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };

/**
 * Anthropic Messages API through the official SDK (retries 408/409/429/5xx itself, 2 times).
 * `fetchImpl` exists for adapter tests only (no network, no key).
 */
export function createAnthropicProvider(apiKey: string | undefined, timeoutMs: number, fetchImpl?: typeof fetch): AiProvider {
  if (!apiKey) return notConfigured('ANTHROPIC');
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: timeoutMs, ...(fetchImpl ? { fetch: fetchImpl } : {}) });

  const toError = (e: unknown): AiProviderError => {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new AiProviderError('ANTHROPIC', 'AUTH', 'Anthropic rejected the credentials');
    if (e instanceof Anthropic.RateLimitError) return new AiProviderError('ANTHROPIC', 'RATE_LIMIT', 'Anthropic rate limit');
    if (e instanceof Anthropic.BadRequestError || e instanceof Anthropic.NotFoundError || e instanceof Anthropic.UnprocessableEntityError) return new AiProviderError('ANTHROPIC', 'BAD_REQUEST', `Anthropic refused the request: ${e.message}`);
    if (e instanceof Anthropic.APIConnectionTimeoutError) return new AiProviderError('ANTHROPIC', 'TIMEOUT', 'Anthropic timed out');
    if (e instanceof Anthropic.APIConnectionError) return new AiProviderError('ANTHROPIC', 'NETWORK', 'Could not reach Anthropic');
    if (e instanceof Anthropic.APIError) return new AiProviderError('ANTHROPIC', (e.status ?? 500) >= 500 ? 'OVERLOADED' : 'UPSTREAM', `Anthropic error ${e.status ?? ''}`.trim());
    return new AiProviderError('ANTHROPIC', 'UPSTREAM', 'Unexpected Anthropic failure');
  };

  return {
    code: 'ANTHROPIC',
    status: 'CONFIGURED',
    async complete(req): Promise<AiResult> {
      const fallback = SERVER_FALLBACK_MODELS.has(req.model);
      let res: Anthropic.Beta.BetaMessage;
      try {
        res = await client.beta.messages.create({
          model: req.model,
          max_tokens: req.maxOutputTokens,
          // Stable policy text first and cached; thinking is left at the model's default (adaptive).
          system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }, ...(req.systemExtra ? [{ type: 'text' as const, text: req.systemExtra }] : [])],
          messages: req.messages.map((m, i) =>
            i === req.messages.length - 1 && m.role === 'user' && req.attachments?.length
              ? {
                  role: 'user' as const,
                  // Documents and images first, then the instruction text.
                  content: [
                    ...req.attachments.map((a) =>
                      a.contentType === 'application/pdf'
                        ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: a.data.toString('base64') } }
                        : { type: 'image' as const, source: { type: 'base64' as const, media_type: a.contentType, data: a.data.toString('base64') } },
                    ),
                    { type: 'text' as const, text: m.content },
                  ],
                }
              : { role: m.role, content: m.content },
          ),
          output_config: { effort: req.effort, ...(req.jsonSchema ? { format: { type: 'json_schema' as const, schema: req.jsonSchema.schema } } : {}) },
          metadata: { user_id: req.endUserRef },
          ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        });
      } catch (e) {
        throw toError(e);
      }
      // Meter every attempt (a declined attempt plus its fallback), never only the final one.
      const iterations = (res.usage.iterations ?? []) as IterationUsage[];
      const attempts: IterationUsage[] = iterations.length ? iterations.filter((i) => i.type !== 'compaction') : [res.usage as IterationUsage];
      const usage = attempts.reduce(
        (acc, i) => ({
          // Cache writes are billed as input (at a premium the price table does not model; small here).
          inputTokens: acc.inputTokens + (i.input_tokens ?? 0) + (i.cache_creation_input_tokens ?? 0),
          outputTokens: acc.outputTokens + (i.output_tokens ?? 0),
          cacheReadTokens: acc.cacheReadTokens + (i.cache_read_input_tokens ?? 0),
        }),
        { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
      );
      // Always check the stop reason before reading content.
      if (res.stop_reason === 'refusal') {
        return { outcome: 'REFUSED', text: '', servedModel: res.model, usage, refusalCategory: res.stop_details?.category ?? null };
      }
      const text = res.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { outcome: res.stop_reason === 'max_tokens' ? 'TRUNCATED' : 'ANSWERED', text, servedModel: res.model, usage };
    },
    async healthCheck(model) {
      const checkedAt = new Date().toISOString();
      try {
        const m = await client.models.retrieve(model);
        return { ok: true, detail: `model ${m.id} available`, checkedAt };
      } catch (e) {
        return { ok: false, detail: toError(e).kind, checkedAt };
      }
    },
  };
}
