import type { SystemStatus } from '@ghayarly/shared';
import type { Env } from '../config/env';
import type { AiProviders } from './ai';
import type { Messaging } from './messaging';
import type { PaymentGateway } from './payments';

/** A real provider key configured → CONFIGURED; only the development simulator → DEV_ADAPTER. */
function aiStatus(ai: AiProviders): SystemStatus['integrations']['ai'] {
  if (ai.ANTHROPIC.status === 'CONFIGURED' || ai.OPENAI.status === 'CONFIGURED' || ai.GEMINI.status === 'CONFIGURED') return 'CONFIGURED';
  return ai.SIMULATED.status === 'CONFIGURED' ? 'DEV_ADAPTER' : 'NOT_CONFIGURED';
}

export function integrationStatus(env: Env, messaging: Messaging, payments: PaymentGateway, ai: AiProviders): SystemStatus['integrations'] {
  return {
    payments: payments.status,
    sms: messaging.sms.status,
    email: messaging.email.status,
    storage: 'NOT_CONFIGURED',
    ai: aiStatus(ai),
    push: 'NOT_CONFIGURED',
    maps: 'NOT_CONFIGURED',
  };
}
