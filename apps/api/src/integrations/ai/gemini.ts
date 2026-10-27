import { ApiError, FinishReason, GoogleGenAI } from '@google/genai';
import { AiProviderError, fullSystem, notConfigured, type AiProvider, type AiResult } from './types';

const BLOCKED: readonly string[] = [FinishReason.SAFETY, FinishReason.PROHIBITED_CONTENT, FinishReason.BLOCKLIST, FinishReason.SPII, FinishReason.RECITATION];

/**
 * Google Gemini API through the official SDK. Not exercised against the live API in this build
 * (no business-owned key is configured); covered by type checking and the shared gateway tests.
 */
export function createGeminiProvider(apiKey: string | undefined, timeoutMs: number): AiProvider {
  if (!apiKey) return notConfigured('GEMINI');
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: timeoutMs } });

  const toError = (e: unknown): AiProviderError => {
    if (e instanceof ApiError) {
      if (e.status === 401 || e.status === 403) return new AiProviderError('GEMINI', 'AUTH', 'Gemini rejected the credentials');
      if (e.status === 429) return new AiProviderError('GEMINI', 'RATE_LIMIT', 'Gemini rate limit');
      if (e.status >= 500) return new AiProviderError('GEMINI', 'OVERLOADED', `Gemini error ${e.status}`);
      return new AiProviderError('GEMINI', 'BAD_REQUEST', `Gemini refused the request (${e.status})`);
    }
    if (e instanceof Error && /abort|timeout/i.test(e.message)) return new AiProviderError('GEMINI', 'TIMEOUT', 'Gemini timed out');
    return new AiProviderError('GEMINI', 'NETWORK', 'Could not reach Gemini');
  };

  return {
    code: 'GEMINI',
    status: 'CONFIGURED',
    async complete(req): Promise<AiResult> {
      let res: Awaited<ReturnType<typeof ai.models.generateContent>>;
      try {
        res = await ai.models.generateContent({
          model: req.model,
          contents: req.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          config: { systemInstruction: fullSystem(req), maxOutputTokens: req.maxOutputTokens },
        });
      } catch (e) {
        throw toError(e);
      }
      const meta = res.usageMetadata;
      const cached = meta?.cachedContentTokenCount ?? 0;
      const usage = {
        inputTokens: (meta?.promptTokenCount ?? 0) - cached,
        // Thinking tokens are billed as output.
        outputTokens: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
        cacheReadTokens: cached,
      };
      const finish = res.candidates?.[0]?.finishReason;
      const servedModel = res.modelVersion ?? req.model;
      if (res.promptFeedback?.blockReason || (finish && BLOCKED.includes(finish))) return { outcome: 'REFUSED', text: '', servedModel, usage, refusalCategory: String(res.promptFeedback?.blockReason ?? finish) };
      return { outcome: finish === FinishReason.MAX_TOKENS ? 'TRUNCATED' : 'ANSWERED', text: (res.text ?? '').trim(), servedModel, usage };
    },
    async healthCheck(model) {
      const checkedAt = new Date().toISOString();
      try {
        const m = await ai.models.get({ model });
        return { ok: true, detail: `model ${m.name ?? model} available`, checkedAt };
      } catch (e) {
        return { ok: false, detail: toError(e).kind, checkedAt };
      }
    },
  };
}
