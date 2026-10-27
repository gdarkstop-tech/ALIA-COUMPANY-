import type { Env } from '../../config/env';
import { createAnthropicProvider } from './anthropic';
import { createChatCompletionsProvider, KIMI_BASE_URL } from './chat-completions';
import { createGeminiProvider } from './gemini';
import { createGrokProvider, createOpenAiProvider, XAI_BASE_URL } from './openai';
import { createSimulatedProvider } from './simulated';
import { notConfigured, type AiProvider, type AiProviderCode } from './types';

export * from './types';
export type AiProviders = Record<AiProviderCode, AiProvider>;

/** Backend secrets each provider needs (names only — shown in the control centre as setup steps). */
export const PROVIDER_ENV_VARS: Record<AiProviderCode, string[]> = {
  ANTHROPIC: ['AI_ANTHROPIC_API_KEY'],
  OPENAI: ['AI_OPENAI_API_KEY'],
  GEMINI: ['AI_GEMINI_API_KEY'],
  QWEN: ['AI_QWEN_API_KEY', 'AI_QWEN_BASE_URL'],
  GROK: ['AI_GROK_API_KEY'],
  KIMI: ['AI_KIMI_API_KEY'],
  MEDGEMMA: ['AI_MEDGEMMA_BASE_URL', 'AI_MEDGEMMA_API_KEY'],
  SIMULATED: [],
};

/** Business-owned keys from the backend environment only; missing key → NOT_CONFIGURED. */
export function createAiProviders(env: Env): AiProviders {
  const timeout = env.AI_REQUEST_TIMEOUT_MS;
  return {
    ANTHROPIC: createAnthropicProvider(env.AI_ANTHROPIC_API_KEY, timeout),
    OPENAI: createOpenAiProvider(env.AI_OPENAI_API_KEY, timeout),
    GEMINI: createGeminiProvider(env.AI_GEMINI_API_KEY, timeout),
    QWEN: createChatCompletionsProvider({ code: 'QWEN', label: 'Qwen (Alibaba Cloud)', apiKey: env.AI_QWEN_API_KEY, baseURL: env.AI_QWEN_BASE_URL, timeoutMs: timeout }),
    GROK: createGrokProvider(env.AI_GROK_API_KEY, timeout, env.AI_GROK_BASE_URL ?? XAI_BASE_URL),
    KIMI: createChatCompletionsProvider({ code: 'KIMI', label: 'Kimi (Moonshot)', apiKey: env.AI_KIMI_API_KEY, baseURL: env.AI_KIMI_BASE_URL ?? KIMI_BASE_URL, timeoutMs: timeout }),
    MEDGEMMA: createChatCompletionsProvider({ code: 'MEDGEMMA', label: 'MedGemma endpoint', apiKey: env.AI_MEDGEMMA_API_KEY, baseURL: env.AI_MEDGEMMA_BASE_URL, timeoutMs: timeout }),
    // Never available in production, whatever the database says.
    SIMULATED: env.NODE_ENV !== 'production' && env.DEV_TOOLS_ENABLED ? createSimulatedProvider() : notConfigured('SIMULATED'),
  };
}

/** Providers this server can call right now (passed to the database router). */
export function configuredProviders(ai: AiProviders): AiProviderCode[] {
  return (Object.keys(ai) as AiProviderCode[]).filter((code) => ai[code].status === 'CONFIGURED');
}
