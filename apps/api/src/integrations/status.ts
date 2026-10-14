import type { SystemStatus } from '@ghayarly/shared';
import type { Env } from '../config/env';
import type { Messaging } from './messaging';
import type { PaymentGateway } from './payments';

export function integrationStatus(env: Env, messaging: Messaging, payments: PaymentGateway): SystemStatus['integrations'] {
  return {
    payments: payments.status,
    sms: messaging.sms.status,
    email: messaging.email.status,
    storage: 'NOT_CONFIGURED',
    ai: 'DISABLED',
    push: 'NOT_CONFIGURED',
    maps: 'NOT_CONFIGURED',
  };
}
