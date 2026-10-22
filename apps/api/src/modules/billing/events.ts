/**
 * Store event normalization — pure functions, unit-tested (test/billing.test.ts).
 * Inputs are ALREADY VERIFIED payloads (Apple JWS verified by the App Store Server Library;
 * Google data fetched from the Play Developer API with our service account). Nothing here trusts
 * the mobile client.
 */
import type { EntitlementStatus } from '@ghayarly/shared';

export type StoreSource = 'APPLE' | 'GOOGLE';

export type NormalizedStoreEvent = {
  source: StoreSource;
  /** Idempotency key (Apple notificationUUID / Pub/Sub messageId / synthetic for client verifies). */
  eventId: string;
  eventType: string;
  eventAt: Date;
  /** Apple originalTransactionId, Google purchaseToken (latest in a linked chain). */
  externalRef: string;
  productId: string;
  /** Google base plan id (null for Apple). */
  basePlanId: string | null;
  status: EntitlementStatus;
  expiresAt: Date | null;
  /**
   * Start of the billing period this event describes (Apple purchaseDate of the transaction).
   * Orders events about different periods; null for Google, whose state is always re-fetched.
   */
  periodStart: Date | null;
  autoRenew: boolean | null;
  /** StoreKit appAccountToken / Play obfuscatedExternalAccountId — binds a purchase to our account. */
  accountToken: string | null;
  /** Sandbox / test purchase (accepted in production only for review & internal-test accounts). */
  sandbox: boolean;
};

// ---------------------------------------------------------------- Apple
type AppleTx = {
  originalTransactionId?: string;
  transactionId?: string;
  productId?: string;
  /** Start of this transaction's billing period (renewals get a new purchaseDate). */
  purchaseDate?: number;
  expiresDate?: number;
  revocationDate?: number;
  appAccountToken?: string;
  environment?: string;
  signedDate?: number;
  type?: string;
  /** Set on a transaction replaced by an upgrade; the upgrade's own transaction carries access. */
  isUpgraded?: boolean;
};
type AppleRenewal = { autoRenewStatus?: number; isInBillingRetryPeriod?: boolean; gracePeriodExpiresDate?: number };

/**
 * Notification types that carry a transaction but say nothing new about access: a refund REQUEST
 * (CONSUMPTION_REQUEST) or a DECLINED refund must not be read as a fresh grant / expiry.
 */
const APPLE_INFORMATIONAL = new Set(['CONSUMPTION_REQUEST', 'REFUND_DECLINED']);
/** Apple notification types that tell us something about access (others are recorded but ignored). */
const APPLE_TERMINAL: Record<string, EntitlementStatus> = { REFUND: 'REFUNDED', REVOKE: 'REVOKED', EXPIRED: 'EXPIRED', GRACE_PERIOD_EXPIRED: 'EXPIRED' };

export function appleStatus(tx: AppleTx, renewal: AppleRenewal | undefined, notificationType: string | undefined, now: Date): { status: EntitlementStatus; expiresAt: Date | null } {
  const expires = tx.expiresDate ? new Date(tx.expiresDate) : null;
  if (tx.revocationDate) return { status: notificationType === 'REVOKE' ? 'REVOKED' : 'REFUNDED', expiresAt: expires };
  if (notificationType && APPLE_TERMINAL[notificationType]) return { status: APPLE_TERMINAL[notificationType]!, expiresAt: expires };
  const grace = renewal?.gracePeriodExpiresDate ? new Date(renewal.gracePeriodExpiresDate) : null;
  if (renewal?.isInBillingRetryPeriod && grace && grace > now) return { status: 'GRACE_PERIOD', expiresAt: grace };
  if (renewal?.isInBillingRetryPeriod) return { status: 'BILLING_RETRY', expiresAt: expires };
  if (expires && expires > now) return { status: 'ACTIVE', expiresAt: expires };
  return { status: 'EXPIRED', expiresAt: expires };
}

export function normalizeApple(args: {
  tx: AppleTx;
  renewal?: AppleRenewal;
  notification?: { notificationType?: string; subtype?: string; notificationUUID?: string; signedDate?: number };
  now: Date;
}): NormalizedStoreEvent | null {
  const { tx, renewal, notification, now } = args;
  if (!tx.originalTransactionId || !tx.productId) return null;
  if (tx.type && tx.type !== 'Auto-Renewable Subscription') return null;
  // A superseded transaction (re-signed later via Transaction.all) must never restore access.
  if (tx.isUpgraded) return null;
  if (notification?.notificationType && APPLE_INFORMATIONAL.has(notification.notificationType)) return null;
  const { status, expiresAt } = appleStatus(tx, renewal, notification?.notificationType, now);
  const signed = notification?.signedDate ?? tx.signedDate ?? now.getTime();
  return {
    source: 'APPLE',
    eventId: notification?.notificationUUID ?? `verify:${tx.transactionId ?? tx.originalTransactionId}:${tx.signedDate ?? signed}`,
    eventType: notification?.notificationType ? [notification.notificationType, notification.subtype].filter(Boolean).join('_').slice(0, 40) : 'CLIENT_VERIFY',
    eventAt: new Date(signed),
    externalRef: tx.originalTransactionId,
    productId: tx.productId,
    basePlanId: null,
    status,
    expiresAt,
    periodStart: tx.purchaseDate ? new Date(tx.purchaseDate) : null,
    autoRenew: renewal?.autoRenewStatus === undefined ? null : renewal.autoRenewStatus === 1,
    accountToken: tx.appAccountToken ?? null,
    sandbox: tx.environment !== undefined && tx.environment !== 'Production',
  };
}

// ---------------------------------------------------------------- Google
export type GoogleSubscriptionV2 = {
  subscriptionState?: string;
  latestOrderId?: string;
  startTime?: string;
  testPurchase?: object | null;
  linkedPurchaseToken?: string;
  acknowledgementState?: string;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  lineItems?: { productId?: string; expiryTime?: string; autoRenewingPlan?: { autoRenewEnabled?: boolean }; offerDetails?: { basePlanId?: string } }[];
};

export function googleStatus(state: string | undefined, expiresAt: Date | null, now: Date): EntitlementStatus | null {
  switch (state) {
    case 'SUBSCRIPTION_STATE_ACTIVE':
      return 'ACTIVE';
    case 'SUBSCRIPTION_STATE_CANCELED': // cancelled = will not renew, but paid time remains
      return expiresAt && expiresAt > now ? 'ACTIVE' : 'EXPIRED';
    case 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD':
      return 'GRACE_PERIOD';
    case 'SUBSCRIPTION_STATE_ON_HOLD':
      return 'BILLING_RETRY';
    case 'SUBSCRIPTION_STATE_PAUSED': // no access while paused, but the store will resume it
      return 'PAUSED';
    case 'SUBSCRIPTION_STATE_EXPIRED':
      return 'EXPIRED';
    default: // PENDING, PENDING_PURCHASE_CANCELED, UNSPECIFIED → nothing to grant
      return null;
  }
}

export function normalizeGoogle(args: { purchaseToken: string; sub: GoogleSubscriptionV2; eventId: string; eventType: string; eventAt: Date; now: Date; voided?: boolean }): NormalizedStoreEvent | null {
  const { sub, now } = args;
  const item = sub.lineItems?.[0];
  if (!item?.productId) return null;
  const expiresAt = item.expiryTime ? new Date(item.expiryTime) : null;
  const status = args.voided ? 'REFUNDED' : googleStatus(sub.subscriptionState, expiresAt, now);
  if (!status) return null;
  return {
    source: 'GOOGLE',
    eventId: args.eventId,
    eventType: args.eventType,
    eventAt: args.eventAt,
    externalRef: args.purchaseToken,
    productId: item.productId,
    basePlanId: item.offerDetails?.basePlanId ?? null,
    status,
    expiresAt,
    periodStart: null,
    autoRenew: item.autoRenewingPlan?.autoRenewEnabled ?? null,
    accountToken: sub.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null,
    sandbox: Boolean(sub.testPurchase),
  };
}

/** Google RTDN subscriptionNotification.notificationType → readable name (for the event log). */
export const GOOGLE_NOTIFICATION_TYPES: Record<number, string> = {
  1: 'RECOVERED', 2: 'RENEWED', 3: 'CANCELED', 4: 'PURCHASED', 5: 'ON_HOLD', 6: 'IN_GRACE_PERIOD', 7: 'RESTARTED',
  8: 'PRICE_CHANGE_CONFIRMED', 9: 'DEFERRED', 10: 'PAUSED', 11: 'PAUSE_SCHEDULE_CHANGED', 12: 'REVOKED', 13: 'EXPIRED',
  19: 'PRICE_CHANGE_UPDATED', 20: 'PENDING_PURCHASE_CANCELED',
};
