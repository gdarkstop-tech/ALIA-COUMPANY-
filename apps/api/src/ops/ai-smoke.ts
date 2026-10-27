/**
 * Operator check that a provider really answers with the company key in this environment:
 *
 *   pnpm --filter @ghayarly/api ai:smoke -- --provider ANTHROPIC --model claude-haiku-5-5
 *
 * Sends ONE short, non-patient question with the production policy and prints the outcome, the
 * provider-reported usage and the latency. It costs a few tokens on the company account, writes
 * nothing to the database and prints no secrets. Exit code 2 = NOT_CONFIGURED, 1 = provider error.
 */
import { loadEnv } from '../config/env';
import { AI_PROVIDER_CODES, AiProviderError, createAiProviders, type AiProviderCode } from '../integrations/ai';
import { ASSISTANT_POLICY } from '../modules/ai/safety';

const QUESTION = { en: 'In one sentence, what is a sterile gauze dressing used for?', ar: 'في جملة واحدة: ما فائدة الشاش الطبي المعقّم؟' };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const provider = (arg('provider') ?? '').toUpperCase() as AiProviderCode;
  const model = arg('model');
  const lang = arg('lang') === 'ar' ? 'ar' : 'en';
  if (!AI_PROVIDER_CODES.includes(provider) || provider === 'SIMULATED' || !model) {
    console.error(`Usage: ai:smoke --provider <${AI_PROVIDER_CODES.filter((c) => c !== 'SIMULATED').join('|')}> --model <model id> [--lang ar|en]`);
    process.exit(64);
  }
  const ai = createAiProviders(loadEnv());
  const p = ai[provider];
  if (p.status !== 'CONFIGURED') {
    console.log(JSON.stringify({ provider, model, status: 'NOT_CONFIGURED', detail: 'The business-owned key / endpoint for this provider is not set in this environment (see docs/release/AI_GATEWAY.md).' }, null, 2));
    process.exit(2);
  }
  const started = Date.now();
  try {
    const r = await p.complete({ model, system: ASSISTANT_POLICY, messages: [{ role: 'user', content: QUESTION[lang] }], maxOutputTokens: 300, effort: 'low', requestId: `smoke-${started}`, endUserRef: 'dmw-operator-smoke-test' });
    console.log(JSON.stringify({ provider, requestedModel: model, servedModel: r.servedModel, status: r.outcome, latencyMs: Date.now() - started, usage: r.usage, answerPreview: r.text.slice(0, 300) }, null, 2));
  } catch (e) {
    console.log(JSON.stringify({ provider, model, status: 'PROVIDER_ERROR', kind: e instanceof AiProviderError ? e.kind : 'UNKNOWN', latencyMs: Date.now() - started }, null, 2));
    process.exit(1);
  }
}

void main();
