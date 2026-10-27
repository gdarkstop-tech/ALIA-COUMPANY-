import OpenAI from 'openai';
import { AiProviderError, fullSystem, notConfigured, type AiProvider, type AiProviderCode, type AiResult } from './types';

type ChatCompletionsOptions = {
  code: Extract<AiProviderCode, 'QWEN' | 'KIMI' | 'MEDGEMMA'>;
  label: string;
  apiKey: string | undefined;
  /** Required: these endpoints are account-, region- or deployment-specific. */
  baseURL: string | undefined;
  timeoutMs: number;
  /** Adapter tests only (no network, no key). */
  fetchImpl?: typeof fetch;
};

// Provider-side content moderation reported as an error rather than a refusal (e.g. Qwen's
// `data_inspection_failed`): the answer was declined, not lost.
const MODERATION = /data_inspection_failed|content[_ ]filter|inappropriate|content_policy|sensitive/i;

/**
 * OpenAI-compatible Chat Completions endpoints, through the official OpenAI SDK with the
 * provider's base URL: Alibaba Cloud Model Studio (Qwen), Moonshot (Kimi), and a company-operated
 * MedGemma server (vLLM / TGI / a managed endpoint exposing the same API). Only documented fields
 * are sent. Not exercised against the live services in this build (no keys or endpoints).
 */
export function createChatCompletionsProvider(o: ChatCompletionsOptions): AiProvider {
  if (!o.apiKey || !o.baseURL) return notConfigured(o.code);
  const client = new OpenAI({ apiKey: o.apiKey, baseURL: o.baseURL, maxRetries: 2, timeout: o.timeoutMs, ...(o.fetchImpl ? { fetch: o.fetchImpl } : {}) });

  const toError = (e: unknown): AiProviderError => {
    if (e instanceof OpenAI.AuthenticationError || e instanceof OpenAI.PermissionDeniedError) return new AiProviderError(o.code, 'AUTH', `${o.label} rejected the credentials`);
    if (e instanceof OpenAI.RateLimitError) return new AiProviderError(o.code, 'RATE_LIMIT', `${o.label} rate limit`);
    if (e instanceof OpenAI.BadRequestError || e instanceof OpenAI.NotFoundError || e instanceof OpenAI.UnprocessableEntityError) return new AiProviderError(o.code, 'BAD_REQUEST', `${o.label} refused the request: ${e.message}`);
    if (e instanceof OpenAI.APIConnectionTimeoutError) return new AiProviderError(o.code, 'TIMEOUT', `${o.label} timed out`);
    if (e instanceof OpenAI.APIConnectionError) return new AiProviderError(o.code, 'NETWORK', `Could not reach ${o.label}`);
    if (e instanceof OpenAI.APIError) return new AiProviderError(o.code, (e.status ?? 500) >= 500 ? 'OVERLOADED' : 'UPSTREAM', `${o.label} error ${e.status ?? ''}`.trim());
    return new AiProviderError(o.code, 'UPSTREAM', `Unexpected ${o.label} failure`);
  };

  return {
    code: o.code,
    status: 'CONFIGURED',
    async complete(req): Promise<AiResult> {
      let res: OpenAI.Chat.Completions.ChatCompletion;
      try {
        res = await client.chat.completions.create({
          model: req.model,
          messages: [{ role: 'system', content: fullSystem(req) }, ...req.messages.map((m) => ({ role: m.role, content: m.content }))],
          max_tokens: req.maxOutputTokens,
        });
      } catch (e) {
        if (e instanceof OpenAI.BadRequestError && MODERATION.test(`${e.code ?? ''} ${e.message}`)) {
          return { outcome: 'REFUSED', text: '', servedModel: req.model, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }, refusalCategory: 'provider_moderation' };
        }
        throw toError(e);
      }
      // prompt_tokens includes cached tokens (Kimi documents cache reads under prompt_tokens_details).
      const cached = res.usage?.prompt_tokens_details?.cached_tokens ?? 0;
      const usage = { inputTokens: Math.max(0, (res.usage?.prompt_tokens ?? 0) - cached), outputTokens: res.usage?.completion_tokens ?? 0, cacheReadTokens: cached };
      const choice = res.choices[0];
      if (!choice) throw new AiProviderError(o.code, 'UPSTREAM', `${o.label} returned no choices`);
      if (choice.finish_reason === 'content_filter' || choice.message.refusal) {
        return { outcome: 'REFUSED', text: '', servedModel: res.model ?? req.model, usage, refusalCategory: 'content_filter' };
      }
      const text = (choice.message.content ?? '').trim();
      return { outcome: choice.finish_reason === 'length' ? 'TRUNCATED' : 'ANSWERED', text, servedModel: res.model ?? req.model, usage };
    },
    async healthCheck(model) {
      const checkedAt = new Date().toISOString();
      try {
        // Listing is the most widely implemented metadata call across compatible servers (no generation billed).
        const ids: string[] = [];
        for await (const m of client.models.list()) ids.push(m.id);
        return ids.includes(model) ? { ok: true, detail: `model ${model} available`, checkedAt } : { ok: false, detail: 'MODEL_NOT_LISTED', checkedAt };
      } catch (e) {
        return { ok: false, detail: toError(e).kind, checkedAt };
      }
    },
  };
}

export const KIMI_BASE_URL = 'https://api.moonshot.ai/v1';
