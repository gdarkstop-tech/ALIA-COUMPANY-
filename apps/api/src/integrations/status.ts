import type { SystemStatus } from '@ghayarly/shared';
import type { Env } from '../config/env';
import type { AiProviders } from './ai';
import type { PaymentGateway } from './payments';
import type { ObjectStore } from './storage';

/** Any real provider key configured → CONFIGURED; only the development simulator → DEV_ADAPTER. */
function aiStatus(ai: AiProviders): SystemStatus['integrations']['ai'] {
  if ((Object.keys(ai) as (keyof AiProviders)[]).some((code) => code !== 'SIMULATED' && ai[code].status === 'CONFIGURED')) return 'CONFIGURED';
  return ai.SIMULATED.status === 'CONFIGURED' ? 'DEV_ADAPTER' : 'NOT_CONFIGURED';
}

export function integrationStatus(env: Env, delivery: { email: SystemStatus['integrations']['email']; sms: SystemStatus['integrations']['sms'] }, payments: PaymentGateway, ai: AiProviders, objects?: ObjectStore): SystemStatus['integrations'] {
  return {
    payments: payments.status,
    sms: delivery.sms,
    email: delivery.email,
    // Medical-image storage: the encrypted local adapter is development-only (DEV_ADAPTER).
    storage: objects?.status ?? 'NOT_CONFIGURED',
    ai: aiStatus(ai),
    push: 'NOT_CONFIGURED',
    maps: 'NOT_CONFIGURED',
  };
}
