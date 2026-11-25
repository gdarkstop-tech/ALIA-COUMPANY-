import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IntegrationStatus } from '@ghayarly/shared';
import type { Env } from '../config/env';
import { IntegrationNotConfiguredError } from './errors';

/**
 * Paymob payment gateway (ADR 0022), from Paymob's developer documentation
 * (developers.paymob.com, "Create Intention", "Unified Checkout", "HMAC Transaction Callback",
 * "Transaction Inquiry", and the refund API of Paymob's integration guide):
 *  - Intention:  POST {base}/v1/intention/  Authorization: Token <secret key>; amount in piasters.
 *  - Checkout:   {checkout}/?publicKey=<public key>&clientSecret=<client secret> (hosted page).
 *  - Callbacks:  HMAC-SHA512 with the HMAC secret over 20 fields in a fixed order, hex, in `?hmac=`.
 *  - Inquiry:    GET {base}/api/acceptance/transactions/{id}  Bearer <token from /api/auth/tokens>.
 *  - Refund:     POST {base}/api/acceptance/void_refund/refund  Authorization: Token <secret key>.
 *
 * Invariants:
 *  - Raw card data never touches our servers: the customer pays on Paymob's hosted checkout.
 *  - A payment is PAID only after a signature-verified provider callback (and, when an API key is
 *    configured, a matching transaction inquiry) — never from the client or the redirect.
 *  - Test mode until the company has authorized live credentials (PAYMOB_LIVE_APPROVED).
 *  - Physical TetraSol orders only; digital subscriptions stay on Apple / Google billing.
 */
export type PaymentMode = 'TEST' | 'LIVE';

export type IntentionRequest = {
  /** Our order reference; returned by Paymob as merchant_order_id (special_reference). */
  reference: string;
  amountPiasters: number;
  items: { name: string; amountPiasters: number; quantity: number }[];
  billing: { firstName: string; lastName: string; phone: string; email: string; city: string; street: string; country: 'EG' };
  notificationUrl: string;
  redirectionUrl: string;
  expirationSeconds: number;
};
export type Intention = { intentionId: string; providerOrderId: string; clientSecret: string; checkoutUrl: string };

/** The transaction fields we act on (from a verified callback or an inquiry). */
export type ProviderTransaction = {
  id: string;
  providerOrderId: string;
  merchantOrderId: string | null;
  amountPiasters: number;
  currency: string;
  success: boolean;
  pending: boolean;
  isAuth: boolean;
  isVoided: boolean;
  isRefunded: boolean;
  refundedPiasters: number;
  isSettled: boolean;
  isLive: boolean | null;
  message: string | null;
};

export class PaymentProviderError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number | null = null,
  ) {
    super(code);
    this.name = 'PaymentProviderError';
  }
}

export interface PaymentGateway {
  readonly name: 'PAYMOB';
  readonly status: IntegrationStatus;
  readonly mode: PaymentMode | null;
  /** Why the gateway is not configured (never a secret). */
  readonly reason: string | null;
  /** True when transaction inquiry (verification / reconciliation) is available. */
  readonly canInquire: boolean;
  createIntention(req: IntentionRequest): Promise<Intention>;
  verifyCallbackHmac(obj: Record<string, unknown>, hmac: string | undefined, shape: 'PROCESSED' | 'RESPONSE'): boolean;
  getTransaction(id: string): Promise<ProviderTransaction>;
  /** Last transaction of a Paymob order (when the callback never arrived). Null when there is none. */
  getTransactionByOrder(providerOrderId: string): Promise<ProviderTransaction | null>;
  refund(transactionId: string, amountPiasters: number): Promise<{ success: boolean; reference: string | null; message: string | null }>;
}

// ---------------------------------------------------------------- HMAC (documented field order)
const HMAC_FIELDS_PROCESSED = ['amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction', 'id', 'integration_id', 'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded', 'is_standalone_payment', 'is_voided', 'order.id', 'owner', 'pending', 'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success'];
// The response (redirect) callback carries the same values as query parameters, with `order` for order.id.
const HMAC_FIELDS_RESPONSE = HMAC_FIELDS_PROCESSED.map((f) => (f === 'order.id' ? 'order' : f));

const read = (obj: Record<string, unknown>, path: string): unknown =>
  path in obj ? obj[path] : path.split('.').reduce<unknown>((cur, part) => (cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[part] : undefined), obj);
const value = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v));

export function paymobHmacString(obj: Record<string, unknown>, shape: 'PROCESSED' | 'RESPONSE'): string {
  return (shape === 'PROCESSED' ? HMAC_FIELDS_PROCESSED : HMAC_FIELDS_RESPONSE).map((f) => value(read(obj, f))).join('');
}
export function paymobHmac(secret: string, obj: Record<string, unknown>, shape: 'PROCESSED' | 'RESPONSE'): string {
  return createHmac('sha512', secret).update(paymobHmacString(obj, shape)).digest('hex');
}

const bool = (v: unknown) => v === true || v === 'true';
export function toProviderTransaction(obj: Record<string, unknown>): ProviderTransaction {
  const order = (obj.order ?? {}) as Record<string, unknown>;
  const data = (obj.data ?? {}) as Record<string, unknown>;
  return {
    id: String(obj.id ?? ''),
    providerOrderId: String(typeof obj.order === 'object' ? (order.id ?? '') : (obj.order ?? '')),
    merchantOrderId: typeof order.merchant_order_id === 'string' ? order.merchant_order_id : null,
    amountPiasters: Number(obj.amount_cents ?? 0),
    currency: String(obj.currency ?? ''),
    success: bool(obj.success),
    pending: bool(obj.pending),
    isAuth: bool(obj.is_auth),
    isVoided: bool(obj.is_voided),
    isRefunded: bool(obj.is_refunded),
    refundedPiasters: Number(obj.refunded_amount_cents ?? 0) || 0,
    isSettled: bool(obj.is_settled),
    isLive: typeof obj.is_live === 'boolean' ? obj.is_live : null,
    message: typeof data.message === 'string' ? data.message.slice(0, 120) : null,
  };
}

// ---------------------------------------------------------------- live adapter
export class PaymobGateway implements PaymentGateway {
  readonly name = 'PAYMOB' as const;
  readonly status: IntegrationStatus;
  readonly mode: PaymentMode | null;
  readonly reason: string | null;
  readonly canInquire: boolean;
  private token: { value: string; until: number } | null = null;

  constructor(
    private readonly env: Pick<Env, 'PAYMOB_SECRET_KEY' | 'PAYMOB_PUBLIC_KEY' | 'PAYMOB_HMAC_SECRET' | 'PAYMOB_INTEGRATION_IDS' | 'PAYMOB_API_KEY' | 'PAYMOB_BASE_URL' | 'PAYMOB_CHECKOUT_URL' | 'PAYMOB_LIVE_APPROVED'>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const { PAYMOB_SECRET_KEY: sk, PAYMOB_PUBLIC_KEY: pk, PAYMOB_HMAC_SECRET: hmac, PAYMOB_INTEGRATION_IDS: ids } = env;
    const skMode = sk ? (/_live_/.test(sk) ? 'LIVE' : 'TEST') : null;
    const pkMode = pk ? (/_live_/.test(pk) ? 'LIVE' : 'TEST') : null;
    let reason: string | null = null;
    if (!sk || !pk || !hmac || !ids) reason = 'MISSING_CREDENTIALS';
    else if (skMode !== pkMode) reason = 'KEY_MODE_MISMATCH';
    else if (skMode === 'LIVE' && !env.PAYMOB_LIVE_APPROVED) reason = 'LIVE_NOT_APPROVED';
    this.reason = reason;
    this.status = reason ? 'NOT_CONFIGURED' : 'CONFIGURED';
    this.mode = reason ? null : skMode;
    this.canInquire = !reason && Boolean(env.PAYMOB_API_KEY);
  }

  private base(path: string) {
    return `${this.env.PAYMOB_BASE_URL.replace(/\/$/, '')}${path}`;
  }
  private ensure() {
    if (this.status !== 'CONFIGURED') throw new IntegrationNotConfiguredError('payments');
  }

  async createIntention(req: IntentionRequest): Promise<Intention> {
    this.ensure();
    const body = {
      amount: req.amountPiasters,
      currency: 'EGP',
      payment_methods: this.env.PAYMOB_INTEGRATION_IDS!.split(',').map(Number),
      items: req.items.map((i) => ({ name: i.name.slice(0, 50), amount: i.amountPiasters, quantity: i.quantity })),
      billing_data: {
        first_name: req.billing.firstName,
        last_name: req.billing.lastName,
        phone_number: req.billing.phone,
        email: req.billing.email,
        city: req.billing.city,
        street: req.billing.street,
        country: req.billing.country,
        apartment: 'NA',
        floor: 'NA',
        building: 'NA',
        state: 'NA',
      },
      special_reference: req.reference,
      expiration: req.expirationSeconds,
      notification_url: req.notificationUrl,
      redirection_url: req.redirectionUrl,
    };
    let res: Response;
    try {
      res = await this.fetchImpl(this.base('/v1/intention/'), {
        method: 'POST',
        headers: { authorization: `Token ${this.env.PAYMOB_SECRET_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new PaymentProviderError('PAYMOB_UNREACHABLE');
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string; intention_order_id?: number | string; client_secret?: string };
    if (!res.ok || !json.client_secret || !json.id || json.intention_order_id === undefined) throw new PaymentProviderError(`PAYMOB_INTENTION_${res.status}`, res.status);
    const checkout = `${this.env.PAYMOB_CHECKOUT_URL.replace(/\/$/, '')}/?publicKey=${encodeURIComponent(this.env.PAYMOB_PUBLIC_KEY!)}&clientSecret=${encodeURIComponent(json.client_secret)}`;
    return { intentionId: json.id, providerOrderId: String(json.intention_order_id), clientSecret: json.client_secret, checkoutUrl: checkout };
  }

  verifyCallbackHmac(obj: Record<string, unknown>, hmac: string | undefined, shape: 'PROCESSED' | 'RESPONSE'): boolean {
    if (this.status !== 'CONFIGURED' || !hmac || !/^[0-9a-f]{128}$/i.test(hmac)) return false;
    const expected = Buffer.from(paymobHmac(this.env.PAYMOB_HMAC_SECRET!, obj, shape), 'hex');
    const given = Buffer.from(hmac, 'hex');
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  private async authToken(): Promise<string> {
    if (this.token && this.token.until > Date.now()) return this.token.value;
    let res: Response;
    try {
      res = await this.fetchImpl(this.base('/api/auth/tokens'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ api_key: this.env.PAYMOB_API_KEY }), signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new PaymentProviderError('PAYMOB_UNREACHABLE');
    }
    const json = (await res.json().catch(() => ({}))) as { token?: string };
    if (!res.ok || !json.token) throw new PaymentProviderError(`PAYMOB_AUTH_${res.status}`, res.status);
    // Tokens are short-lived; keep one for 30 minutes.
    this.token = { value: json.token, until: Date.now() + 30 * 60_000 };
    return json.token;
  }

  async getTransaction(id: string): Promise<ProviderTransaction> {
    this.ensure();
    if (!this.canInquire) throw new IntegrationNotConfiguredError('payments-inquiry');
    if (!/^\d{1,20}$/.test(id)) throw new PaymentProviderError('INVALID_TRANSACTION_ID');
    const token = await this.authToken();
    let res: Response;
    try {
      res = await this.fetchImpl(this.base(`/api/acceptance/transactions/${id}`), { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new PaymentProviderError('PAYMOB_UNREACHABLE');
    }
    if (!res.ok) throw new PaymentProviderError(`PAYMOB_INQUIRY_${res.status}`, res.status);
    return toProviderTransaction((await res.json()) as Record<string, unknown>);
  }

  async getTransactionByOrder(providerOrderId: string): Promise<ProviderTransaction | null> {
    this.ensure();
    if (!this.canInquire) throw new IntegrationNotConfiguredError('payments-inquiry');
    const token = await this.authToken();
    let res: Response;
    try {
      res = await this.fetchImpl(this.base('/api/ecommerce/orders/transaction_inquiry'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ auth_token: token, order_id: providerOrderId }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new PaymentProviderError('PAYMOB_UNREACHABLE');
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new PaymentProviderError(`PAYMOB_INQUIRY_${res.status}`, res.status);
    const json = (await res.json()) as Record<string, unknown>;
    return json && json.id !== undefined ? toProviderTransaction(json) : null;
  }

  async refund(transactionId: string, amountPiasters: number) {
    this.ensure();
    let res: Response;
    try {
      res = await this.fetchImpl(this.base('/api/acceptance/void_refund/refund'), {
        method: 'POST',
        headers: { authorization: `Token ${this.env.PAYMOB_SECRET_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ transaction_id: Number(transactionId), amount_cents: amountPiasters }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new PaymentProviderError('PAYMOB_UNREACHABLE');
    }
    const json = (await res.json().catch(() => ({}))) as { id?: number | string; success?: boolean; data?: { message?: string }; message?: string; detail?: string };
    const success = res.ok && json.success === true;
    return { success, reference: json.id !== undefined ? String(json.id) : null, message: (json.data?.message ?? json.message ?? json.detail ?? (success ? null : `HTTP_${res.status}`))?.slice(0, 120) ?? null };
  }
}

export function createPaymentGateway(env: Env, fetchImpl?: typeof fetch): PaymentGateway {
  return new PaymobGateway(env, fetchImpl);
}
