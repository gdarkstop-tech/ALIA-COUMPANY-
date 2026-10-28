import type { Env } from '../../../config/env';
import { AI_PROVIDER_CODES, type AiProviderCode } from '../types';
import { createOpenAiRealtimeProvider, notConfiguredRealtime } from './openai-realtime';
import { createSimulatedRealtimeProvider } from './simulated-realtime';
import type { RealtimeVoiceProvider } from './types';

export * from './types';
export { createOpenAiRealtimeProvider, notConfiguredRealtime, OPENAI_TRANSCRIPTION_MODEL } from './openai-realtime';
export type RealtimeProviders = Record<AiProviderCode, RealtimeVoiceProvider>;

/**
 * Realtime voice adapters. Only OpenAI has one in this build; every other provider is
 * NOT_CONFIGURED for voice even when its text key is set (Gemini Live and xAI voice have no adapter yet).
 */
export function createRealtimeProviders(env: Env): RealtimeProviders {
  const out = Object.fromEntries(AI_PROVIDER_CODES.map((c) => [c, notConfiguredRealtime(c)])) as RealtimeProviders;
  out.OPENAI = createOpenAiRealtimeProvider(env.AI_OPENAI_API_KEY, env.AI_REQUEST_TIMEOUT_MS);
  // Never available in production, whatever the database says.
  if (env.NODE_ENV !== 'production' && env.DEV_TOOLS_ENABLED) out.SIMULATED = createSimulatedRealtimeProvider();
  return out;
}

export function configuredRealtimeProviders(rt: RealtimeProviders): AiProviderCode[] {
  return (Object.keys(rt) as AiProviderCode[]).filter((c) => rt[c].status === 'CONFIGURED');
}
