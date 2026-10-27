import { describe, expect, it } from 'vitest';
import { createAnthropicProvider } from '../src/integrations/ai/anthropic';
import { createChatCompletionsProvider } from '../src/integrations/ai/chat-completions';
import { createAiProviders } from '../src/integrations/ai';
import { createGrokProvider, createOpenAiProvider } from '../src/integrations/ai/openai';
import { loadEnv } from '../src/config/env';
import { AiProviderError, type AiRequest } from '../src/integrations/ai/types';

/**
 * The real provider adapters against a stubbed HTTP layer: no key, no network, no cost. Proves the
 * request we send and how responses (usage, refusals, truncation, errors) are mapped. It does not
 * prove the live APIs accept the request — that needs a business-owned key (NOT_CONFIGURED here).
 */
type Captured = { url: string; headers: Headers; body: Record<string, unknown> };

function stub(responses: { status: number; body: unknown }[]) {
  const calls: Captured[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : {} });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json', 'retry-after-ms': '1', 'request-id': 'req_test' } });
  }) as typeof fetch;
  return { impl, calls };
}

const request: AiRequest = {
  model: 'claude-opus-5-5',
  system: 'POLICY',
  messages: [{ role: 'user', content: 'How do I keep a dressing dry?' }],
  maxOutputTokens: 1024,
  effort: 'low',
  requestId: 'r1',
  endUserRef: 'ref-abc',
};

const message = (over: Record<string, unknown> = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [{ type: 'text', text: ' Keep it covered. ' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  ...over,
});

describe('Anthropic adapter', () => {
  it('sends the cached policy, effort, end-user reference and server-side fallback; no sampling or thinking params', async () => {
    const { impl, calls } = stub([{ status: 200, body: message() }]);
    const r = await createAnthropicProvider('sk-ant-test-key', 5000, impl).complete(request);
    expect(r).toMatchObject({ outcome: 'ANSWERED', text: 'Keep it covered.', servedModel: 'claude-opus-5-5', usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0 } });
    const [c] = calls;
    expect(c!.url).toContain('/v1/messages');
    expect(c!.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(c!.body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 1024,
      system: [{ type: 'text', text: 'POLICY', cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low' },
      metadata: { user_id: 'ref-abc' },
      fallbacks: 'default',
    });
    for (const absent of ['temperature', 'top_p', 'top_k', 'thinking', 'betas']) expect(c!.body).not.toHaveProperty(absent);
  });

  it('meters every attempt when a declined attempt was re-run on a fallback model', async () => {
    const { impl } = stub([
      {
        status: 200,
        body: message({
          model: 'claude-sonnet-5-5',
          usage: {
            input_tokens: 120, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
            iterations: [
              { type: 'fallback_message', input_tokens: 110, output_tokens: 5, cache_read_input_tokens: 20, cache_creation_input_tokens: 0 },
              { type: 'message', input_tokens: 120, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 10 },
            ],
          },
        }),
      },
    ]);
    const r = await createAnthropicProvider('sk-ant-test-key', 5000, impl).complete(request);
    expect(r.servedModel).toBe('claude-sonnet-5-5');
    expect(r.usage).toEqual({ inputTokens: 240, outputTokens: 85, cacheReadTokens: 20 });
  });

  it('maps refusals (with category) and truncation', async () => {
    const refused = stub([{ status: 200, body: message({ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' } }) }]);
    expect(await createAnthropicProvider('sk-ant-test-key', 5000, refused.impl).complete(request)).toMatchObject({ outcome: 'REFUSED', text: '', refusalCategory: 'cyber' });
    const cut = stub([{ status: 200, body: message({ stop_reason: 'max_tokens' }) }]);
    expect((await createAnthropicProvider('sk-ant-test-key', 5000, cut.impl).complete(request)).outcome).toBe('TRUNCATED');
  });

  it('does not ask for the server-side fallback on models that do not support it', async () => {
    const { impl, calls } = stub([{ status: 200, body: message({ model: 'claude-haiku-5-5' }) }]);
    await createAnthropicProvider('sk-ant-test-key', 5000, impl).complete({ ...request, model: 'claude-haiku-5-5' });
    expect(calls[0]!.headers.get('anthropic-beta') ?? '').not.toContain('server-side-fallback');
    expect(calls[0]!.body).not.toHaveProperty('fallbacks');
  });

  it('classifies errors: credentials are not retried by the gateway, overload is', async () => {
    const auth = stub([{ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }]);
    const e1 = await createAnthropicProvider('sk-ant-test-key', 5000, auth.impl).complete(request).catch((e) => e);
    expect(e1).toBeInstanceOf(AiProviderError);
    expect(e1).toMatchObject({ kind: 'AUTH', retryable: false });
    expect(auth.calls).toHaveLength(1);
    const busy = stub([{ status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } }]);
    const e2 = await createAnthropicProvider('sk-ant-test-key', 5000, busy.impl).complete(request).catch((e) => e);
    expect(e2).toMatchObject({ kind: 'OVERLOADED', retryable: true });
    expect(busy.calls).toHaveLength(3); // the SDK's own 2 retries, then the gateway decides on a fallback
  });

  it('is NOT_CONFIGURED without a key and never calls out', async () => {
    const p = createAnthropicProvider(undefined, 5000);
    expect(p.status).toBe('NOT_CONFIGURED');
    await expect(p.complete(request)).rejects.toMatchObject({ kind: 'NOT_CONFIGURED' });
    expect((await p.healthCheck('claude-opus-5-5')).ok).toBe(false);
  });
});

describe('OpenAI adapter', () => {
  const response = (over: Record<string, unknown> = {}) => ({
    id: 'resp_1',
    object: 'response',
    created_at: 1,
    model: 'gpt-test',
    status: 'completed',
    output: [{ type: 'message', id: 'm1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Keep it dry.', annotations: [] }] }],
    usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 40 }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 120 },
    ...over,
  });

  it('sends instructions separately, does not store the conversation, and splits cached input', async () => {
    const { impl, calls } = stub([{ status: 200, body: response() }]);
    const r = await createOpenAiProvider('sk-openai-test', 5000, impl).complete({ ...request, model: 'gpt-test' });
    expect(r).toMatchObject({ outcome: 'ANSWERED', text: 'Keep it dry.', usage: { inputTokens: 60, outputTokens: 20, cacheReadTokens: 40 } });
    expect(calls[0]!.url).toContain('/responses');
    expect(calls[0]!.body).toMatchObject({ model: 'gpt-test', instructions: 'POLICY', max_output_tokens: 1024, safety_identifier: 'ref-abc', store: false });
  });

  it('maps refusals and truncation', async () => {
    const refused = stub([{ status: 200, body: response({ output: [{ type: 'message', id: 'm1', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: 'no' }] }] }) }]);
    expect((await createOpenAiProvider('sk-openai-test', 5000, refused.impl).complete(request)).outcome).toBe('REFUSED');
    const cut = stub([{ status: 200, body: response({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }) }]);
    expect((await createOpenAiProvider('sk-openai-test', 5000, cut.impl).complete(request)).outcome).toBe('TRUNCATED');
  });
});

describe('xAI (Grok) adapter', () => {
  const response = { id: 'resp_x', object: 'response', created_at: 1, model: 'grok-4.3', status: 'completed', output: [{ type: 'message', id: 'm', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Keep it clean.', annotations: [] }] }], usage: { input_tokens: 50, input_tokens_details: { cached_tokens: 0 }, output_tokens: 10, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 60 } };
  it('uses the xAI base URL, sends the policy as a system message, stores nothing and sends no undocumented fields', async () => {
    const { impl, calls } = stub([{ status: 200, body: response }]);
    const r = await createGrokProvider('xai-test-key-0000', 5000, undefined, impl).complete({ ...request, model: 'grok-4.3' });
    expect(r).toMatchObject({ outcome: 'ANSWERED', text: 'Keep it clean.', usage: { inputTokens: 50, outputTokens: 10 } });
    expect(calls[0]!.url).toBe('https://api.x.ai/v1/responses');
    expect(calls[0]!.body).toMatchObject({ model: 'grok-4.3', store: false, max_output_tokens: 1024, input: [{ role: 'system', content: 'POLICY' }, { role: 'user' }] });
    for (const absent of ['instructions', 'safety_identifier', 'temperature']) expect(calls[0]!.body).not.toHaveProperty(absent);
  });
});

describe('Chat Completions adapters (Qwen, Kimi, MedGemma endpoint)', () => {
  const completion = (over: Record<string, unknown> = {}) => ({
    id: 'c1', object: 'chat.completion', created: 1, model: 'kimi-k3',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: ' Rinse with clean water. ', refusal: null } }],
    usage: { prompt_tokens: 373, completion_tokens: 112, total_tokens: 485, prompt_tokens_details: { cached_tokens: 100 } },
    ...over,
  });
  const make = (code: 'QWEN' | 'KIMI' | 'MEDGEMMA', baseURL: string, impl: typeof fetch) => createChatCompletionsProvider({ code, label: code, apiKey: 'test-key-0000000000000', baseURL, timeoutMs: 5000, fetchImpl: impl });

  it('sends the policy as the system message to the configured base URL and splits cached input', async () => {
    const { impl, calls } = stub([{ status: 200, body: completion() }]);
    const r = await make('KIMI', 'https://api.moonshot.ai/v1', impl).complete({ ...request, model: 'kimi-k3' });
    expect(r).toMatchObject({ outcome: 'ANSWERED', text: 'Rinse with clean water.', usage: { inputTokens: 273, outputTokens: 112, cacheReadTokens: 100 } });
    expect(calls[0]!.url).toBe('https://api.moonshot.ai/v1/chat/completions');
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer test-key-0000000000000');
    expect(calls[0]!.body).toMatchObject({ model: 'kimi-k3', max_tokens: 1024, messages: [{ role: 'system', content: 'POLICY' }, { role: 'user', content: request.messages[0]!.content }] });
    for (const absent of ['user', 'temperature', 'tools']) expect(calls[0]!.body).not.toHaveProperty(absent);
  });

  it('maps truncation, content filtering and provider moderation errors', async () => {
    const cut = stub([{ status: 200, body: completion({ choices: [{ index: 0, finish_reason: 'length', message: { role: 'assistant', content: 'Partial', refusal: null } }] }) }]);
    expect((await make('QWEN', 'https://ws.example.invalid/compatible-mode/v1', cut.impl).complete(request)).outcome).toBe('TRUNCATED');
    const filtered = stub([{ status: 200, body: completion({ choices: [{ index: 0, finish_reason: 'content_filter', message: { role: 'assistant', content: null, refusal: null } }] }) }]);
    expect((await make('QWEN', 'https://ws.example.invalid/compatible-mode/v1', filtered.impl).complete(request)).outcome).toBe('REFUSED');
    const moderated = stub([{ status: 400, body: { error: { code: 'data_inspection_failed', message: 'Input data may contain inappropriate content.' } } }]);
    expect(await make('QWEN', 'https://ws.example.invalid/compatible-mode/v1', moderated.impl).complete(request)).toMatchObject({ outcome: 'REFUSED', refusalCategory: 'provider_moderation' });
    const auth = stub([{ status: 401, body: { error: { message: 'bad key' } } }]);
    await expect(make('MEDGEMMA', 'https://medgemma.example.invalid/v1', auth.impl).complete(request)).rejects.toMatchObject({ kind: 'AUTH', retryable: false });
  });

  it('health check lists models (no generation) and reports a missing model', async () => {
    const { impl, calls } = stub([{ status: 200, body: { object: 'list', data: [{ id: 'google/medgemma-1.5-4b-it', object: 'model', created: 1, owned_by: 'vllm' }] } }]);
    const p = make('MEDGEMMA', 'https://medgemma.example.invalid/v1', impl);
    expect((await p.healthCheck('google/medgemma-1.5-4b-it')).ok).toBe(true);
    expect((await p.healthCheck('other-model')).detail).toBe('MODEL_NOT_LISTED');
    expect(calls.every((c) => c.url.endsWith('/v1/models'))).toBe(true);
  });
});

describe('configuration', () => {
  const base = { ...process.env } as Record<string, string>;
  it('a provider is NOT_CONFIGURED until every required secret is present (Qwen needs its workspace URL)', () => {
    const ai = createAiProviders(loadEnv({ ...base, AI_QWEN_API_KEY: 'sk-qwen-test-0000', AI_KIMI_API_KEY: 'sk-kimi-test-0000' }));
    expect(ai.QWEN.status).toBe('NOT_CONFIGURED');
    expect(ai.KIMI.status).toBe('CONFIGURED');
    expect(ai.MEDGEMMA.status).toBe('NOT_CONFIGURED');
    expect(createAiProviders(loadEnv({ ...base, AI_QWEN_API_KEY: 'sk-qwen-test-0000', AI_QWEN_BASE_URL: 'https://ws.example.invalid/compatible-mode/v1' })).QWEN.status).toBe('CONFIGURED');
  });
  it('blank values copied from .env.example mean "not set"', () => {
    expect(createAiProviders(loadEnv({ ...base, AI_QWEN_API_KEY: '', AI_QWEN_BASE_URL: '', AI_MEDGEMMA_BASE_URL: '' })).QWEN.status).toBe('NOT_CONFIGURED');
  });
  it('production refuses plaintext endpoints for patient data', () => {
    const prod = { ...base, NODE_ENV: 'production', DEMO_MODE: 'false', DEV_TOOLS_ENABLED: 'false', MFA_ENFORCEMENT: 'required', AUTH_REQUIRE_EMAIL_VERIFICATION: 'true', DATABASE_URL_OWNER: '', BETTER_AUTH_SECRET: 'prod-like-secret-0123456789abcdefghijklmnopqrstuvwxyz' };
    expect(() => loadEnv({ ...prod, AI_MEDGEMMA_BASE_URL: 'http://10.0.0.5:8000/v1', AI_MEDGEMMA_API_KEY: 'medgemma-key-000000' })).toThrow(/AI_MEDGEMMA_BASE_URL must use https/);
  });
});
