import type { Env } from '../../config/env';
import { createAnthropicProvider } from './anthropic';
import { createGeminiProvider } from './gemini';
import { createOpenAiProvider } from './openai';
import { createSimulatedProvider } from './simulated';
import { notConfigured, type AiProvider, type AiProviderCode } from './types';

export * from './types';
export type AiProviders = Record<AiProviderCode, AiProvider>;

/** Business-owned keys from the backend environment only; missing key → NOT_CONFIGURED. */
export function createAiProviders(env: Env): AiProviders {
  const timeout = env.AI_REQUEST_TIMEOUT_MS;
  return {
    ANTHROPIC: createAnthropicProvider(env.AI_ANTHROPIC_API_KEY, timeout),
    OPENAI: createOpenAiProvider(env.AI_OPENAI_API_KEY, timeout),
    GEMINI: createGeminiProvider(env.AI_GEMINI_API_KEY, timeout),
    // Never available in production, whatever the database says.
    SIMULATED: env.NODE_ENV !== 'production' && env.DEV_TOOLS_ENABLED ? createSimulatedProvider() : notConfigured('SIMULATED'),
  };
}
