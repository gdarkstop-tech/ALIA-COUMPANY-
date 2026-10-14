import type { IntegrationStatus } from '@ghayarly/shared';
import type { Env } from '../config/env';
import { IntegrationNotConfiguredError } from './errors';

/**
 * Payment gateway abstraction (Paymob first; others later).
 *
 * Invariants (see docs/SECURITY.md):
 *  - Raw card data never touches our servers (hosted checkout only).
 *  - A payment is PAID only after a verified provider webhook/inquiry — never from a client callback.
 *  - Every intent carries an idempotency key.
 */
export type PaymentIntentRequest = {
  idempotencyKey: string;
  amountPiasters: number;
  currency: 'EGP';
  purpose: 'BOOKING' | 'ORDER' | 'SUBSCRIPTION';
  referenceId: string;
};

export type PaymentIntent = {
  provider: string;
  providerReference: string;
  checkoutUrl: string | null;
  status: 'REQUIRES_ACTION' | 'SIMULATED';
};

export interface PaymentGateway {
  readonly name: 'PAYMOB';
  readonly status: IntegrationStatus;
  createIntent(req: PaymentIntentRequest): Promise<PaymentIntent>;
  /** Verifies a provider webhook signature. Must be constant-time. */
  verifyWebhook(rawBody: string, signature: string | undefined): boolean;
}

export class PaymobGateway implements PaymentGateway {
  readonly name = 'PAYMOB' as const;
  readonly status: IntegrationStatus;
  constructor(private readonly env: Env) {
    // The live adapter lands in Milestone 2 together with booking payments. Until it is
    // implemented and verified against Paymob's sandbox we report NOT_CONFIGURED even if
    // credentials exist, so nothing can appear to charge a card.
    this.status = 'NOT_CONFIGURED';
  }
  async createIntent(): Promise<PaymentIntent> {
    throw new IntegrationNotConfiguredError('payments');
  }
  verifyWebhook(): boolean {
    return false;
  }
}

export function createPaymentGateway(env: Env): PaymentGateway {
  return new PaymobGateway(env);
}
