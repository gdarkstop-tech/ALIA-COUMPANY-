import OpenAI from 'openai';
import { AiProviderError, fullSystem, notConfigured, type AiProvider, type AiProviderCode, type AiResult } from './types';

type ResponsesOptions = {
  code: Extract<AiProviderCode, 'OPENAI' | 'GROK'>;
  label: string;
  apiKey: string | undefined;
  baseURL?: string;
  timeoutMs: number;
  /** OpenAI takes `instructions`; xAI's documented examples send the system prompt as an input message. */
  systemAs: 'instructions' | 'message';
  /** OpenAI's documented abuse-monitoring identifier; not sent where it is not documented. */
  sendSafetyIdentifier: boolean;
  /** Adapter tests only (no network, no key). */
  fetchImpl?: typeof fetch;
};

/**
 * Responses API through the official OpenAI SDK — OpenAI itself, and xAI, whose API follows the
 * same shape at its own base URL. `store: false` everywhere: neither provider keeps the exchange for
 * later retrieval (xAI otherwise stores responses for 30 days). Not exercised against the live APIs
 * in this build (no business-owned keys); mapping is covered by adapter tests with a stubbed HTTP layer.
 */
export function createResponsesProvider(o: ResponsesOptions): AiProvider {
  if (!o.apiKey) return notConfigured(o.code);
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
      let res: OpenAI.Responses.Response;
      try {
        const last = req.messages.length - 1;
        const turns = req.messages.map((m, i) =>
          i === last && m.role === 'user' && req.attachments?.length
            ? {
                role: 'user' as const,
                content: [
                  ...req.attachments.map((a) =>
                    a.contentType === 'application/pdf'
                      ? { type: 'input_file' as const, filename: a.filename, file_data: `data:application/pdf;base64,${a.data.toString('base64')}` }
                      : { type: 'input_image' as const, image_url: `data:${a.contentType};base64,${a.data.toString('base64')}`, detail: 'high' as const },
                  ),
                  { type: 'input_text' as const, text: m.content },
                ],
              }
            : { role: m.role, content: m.content },
        );
        res = await client.responses.create({
          model: req.model,
          ...(o.systemAs === 'instructions' ? { instructions: fullSystem(req), input: turns } : { input: [{ role: 'system' as const, content: fullSystem(req) }, ...turns] }),
          max_output_tokens: req.maxOutputTokens,
          ...(req.jsonSchema ? { text: { format: { type: 'json_schema' as const, name: req.jsonSchema.name, schema: req.jsonSchema.schema, strict: true } } } : {}),
          ...(o.sendSafetyIdentifier ? { safety_identifier: req.endUserRef } : {}),
          store: false,
        });
      } catch (e) {
        throw toError(e);
      }
      const cached = res.usage?.input_tokens_details?.cached_tokens ?? 0;
      const usage = { inputTokens: (res.usage?.input_tokens ?? 0) - cached, outputTokens: res.usage?.output_tokens ?? 0, cacheReadTokens: cached };
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

export function createOpenAiProvider(apiKey: string | undefined, timeoutMs: number, fetchImpl?: typeof fetch): AiProvider {
  return createResponsesProvider({ code: 'OPENAI', label: 'OpenAI', apiKey, timeoutMs, systemAs: 'instructions', sendSafetyIdentifier: true, fetchImpl });
}

export const XAI_BASE_URL = 'https://api.x.ai/v1';

export function createGrokProvider(apiKey: string | undefined, timeoutMs: number, baseURL = XAI_BASE_URL, fetchImpl?: typeof fetch): AiProvider {
  return createResponsesProvider({ code: 'GROK', label: 'xAI', apiKey, baseURL, timeoutMs, systemAs: 'message', sendSafetyIdentifier: false, fetchImpl });
}
