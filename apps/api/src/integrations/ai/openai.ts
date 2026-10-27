import OpenAI from 'openai';
import { AiProviderError, notConfigured, type AiProvider, type AiResult } from './types';

/**
 * OpenAI Responses API through the official SDK. Not exercised against the live API in this
 * build (no business-owned key is configured); request/response mapping is covered by adapter
 * tests with a stubbed HTTP layer. Reasoning-effort options are model-specific and are not sent.
 */
export function createOpenAiProvider(apiKey: string | undefined, timeoutMs: number, fetchImpl?: typeof fetch): AiProvider {
  if (!apiKey) return notConfigured('OPENAI');
  const client = new OpenAI({ apiKey, maxRetries: 2, timeout: timeoutMs, ...(fetchImpl ? { fetch: fetchImpl } : {}) });

  const toError = (e: unknown): AiProviderError => {
    if (e instanceof OpenAI.AuthenticationError || e instanceof OpenAI.PermissionDeniedError) return new AiProviderError('OPENAI', 'AUTH', 'OpenAI rejected the credentials');
    if (e instanceof OpenAI.RateLimitError) return new AiProviderError('OPENAI', 'RATE_LIMIT', 'OpenAI rate limit');
    if (e instanceof OpenAI.BadRequestError || e instanceof OpenAI.NotFoundError || e instanceof OpenAI.UnprocessableEntityError) return new AiProviderError('OPENAI', 'BAD_REQUEST', `OpenAI refused the request: ${e.message}`);
    if (e instanceof OpenAI.APIConnectionTimeoutError) return new AiProviderError('OPENAI', 'TIMEOUT', 'OpenAI timed out');
    if (e instanceof OpenAI.APIConnectionError) return new AiProviderError('OPENAI', 'NETWORK', 'Could not reach OpenAI');
    if (e instanceof OpenAI.APIError) return new AiProviderError('OPENAI', (e.status ?? 500) >= 500 ? 'OVERLOADED' : 'UPSTREAM', `OpenAI error ${e.status ?? ''}`.trim());
    return new AiProviderError('OPENAI', 'UPSTREAM', 'Unexpected OpenAI failure');
  };

  return {
    code: 'OPENAI',
    status: 'CONFIGURED',
    async complete(req): Promise<AiResult> {
      let res: OpenAI.Responses.Response;
      try {
        res = await client.responses.create({
          model: req.model,
          instructions: req.system,
          input: req.messages.map((m) => ({ role: m.role, content: m.content })),
          max_output_tokens: req.maxOutputTokens,
          safety_identifier: req.endUserRef,
          store: false,
        });
      } catch (e) {
        throw toError(e);
      }
      const usage = {
        inputTokens: (res.usage?.input_tokens ?? 0) - (res.usage?.input_tokens_details?.cached_tokens ?? 0),
        outputTokens: res.usage?.output_tokens ?? 0,
        cacheReadTokens: res.usage?.input_tokens_details?.cached_tokens ?? 0,
      };
      const refused = res.output.some((item) => item.type === 'message' && item.content.some((c) => c.type === 'refusal'));
      if (refused) return { outcome: 'REFUSED', text: '', servedModel: res.model, usage, refusalCategory: null };
      const truncated = res.status === 'incomplete' && res.incomplete_details?.reason === 'max_output_tokens';
      return { outcome: truncated ? 'TRUNCATED' : 'ANSWERED', text: res.output_text.trim(), servedModel: res.model, usage };
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
