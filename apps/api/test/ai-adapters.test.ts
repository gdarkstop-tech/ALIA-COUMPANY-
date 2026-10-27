import { describe, expect, it } from 'vitest';
import { createAnthropicProvider } from '../src/integrations/ai/anthropic';
import { createOpenAiProvider } from '../src/integrations/ai/openai';
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
