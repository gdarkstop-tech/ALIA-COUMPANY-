/**
 * Payment classification — the ONE place that decides which payment rail a purchase may use.
 * Policy basis (verified 2026-10-14, see docs/release/PAYMENT_COMPLIANCE.md):
 *   - Apple 3.1.1: unlocking in-app features / subscriptions / premium content → In-App Purchase.
 *   - Apple 3.1.3(e): physical goods and services consumed outside the app → NOT IAP.
 *   - Apple 3.1.3(d): real-time 1:1 person-to-person services (incl. medical consultations) may use
 *     non-IAP payment.
 *   - Google Play Payments policy §3: physical goods/services must NOT use Play Billing; regulated
 *     clinical services should not use Play Billing; digital goods/subscriptions MUST use it.
 *   - Egypt is in neither Apple's external-purchase-link storefronts nor any Google alternative
 *     billing programme → no in-app links/buttons steering digital purchases elsewhere.
 */
import { z } from 'zod';

export const PAYMENT_CLASSES = ['PHYSICAL_PRODUCT', 'PHYSICAL_SERVICE', 'ELIGIBLE_PERSON_TO_PERSON_SERVICE', 'DIGITAL_SUBSCRIPTION', 'DIGITAL_FEATURE'] as const;
export type PaymentClass = (typeof PAYMENT_CLASSES)[number];

export const PAYMENT_RAILS = ['EXTERNAL_GATEWAY', 'APPLE_IAP', 'GOOGLE_PLAY_BILLING'] as const;
export type PaymentRail = (typeof PAYMENT_RAILS)[number];
export type ClientPlatform = 'ios' | 'android' | 'web';

/** What each class means, with an example from this product. */
export const PAYMENT_CLASS_RULES: Record<PaymentClass, { digital: boolean; example: string }> = {
  PHYSICAL_PRODUCT: { digital: false, example: 'TetraSol dressings delivered to the home' },
  PHYSICAL_SERVICE: { digital: false, example: 'A nurse home visit for wound dressing' },
  ELIGIBLE_PERSON_TO_PERSON_SERVICE: { digital: false, example: 'A real-time 1:1 consultation with one licensed doctor' },
  DIGITAL_SUBSCRIPTION: { digital: true, example: 'Gold / Platinum plans (unlock in-app features)' },
  DIGITAL_FEATURE: { digital: true, example: 'A one-off unlock of an in-app feature' },
};

/**
 * Resolves the only permitted rail. Digital purchases inside the iOS/Android apps go through the
 * platform store; physical goods/services and eligible 1:1 services use the external gateway
 * (Paymob). There is deliberately no override parameter.
 */
export function resolvePaymentRail(cls: PaymentClass, platform: ClientPlatform): PaymentRail {
  if (!PAYMENT_CLASS_RULES[cls].digital) return 'EXTERNAL_GATEWAY';
  if (platform === 'ios') return 'APPLE_IAP';
  if (platform === 'android') return 'GOOGLE_PLAY_BILLING';
  return 'EXTERNAL_GATEWAY';
}

/**
 * Whether the app may show a link or button that sends the user outside the store to pay.
 * Never for digital purchases in the native apps (Egypt has no eligible programme).
 */
export function mayLinkOutForPayment(cls: PaymentClass, platform: ClientPlatform): boolean {
  return platform === 'web' || !PAYMENT_CLASS_RULES[cls].digital;
}

// ---------------------------------------------------------------- plans
export const PLAN_CODES = ['SILVER', 'GOLD', 'PLATINUM'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];
export const BILLING_PERIODS = ['MONTHLY', 'YEARLY'] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

export type PlanOffer = {
  period: BillingPeriod;
  /** Business reference price (EGP piasters). The store shows its own localized price point. */
  referencePricePiasters: number;
  appleProductId: string | null;
  googleProductId: string | null;
  googleBasePlanId: string | null;
};

export type BillingPlan = {
  code: PlanCode;
  nameEn: string;
  nameAr: string;
  paymentClass: PaymentClass;
  /** Benefits are display data, editable by admins; each is classified for review. */
  benefits: { key: string; en: string; ar: string; kind: 'DIGITAL' | 'REAL_WORLD' }[];
  familyProfileLimit: number | null;
  offers: PlanOffer[];
  active: boolean;
};

export type PlanForClient = BillingPlan & {
  rail: PaymentRail | null;
  purchasable: boolean;
  /** Why it can't be bought right now (feature flag off, store not configured, …). */
  unavailableReason: 'FREE_PLAN' | 'FEATURE_DISABLED' | 'STORE_NOT_CONFIGURED' | null;
};

// ---------------------------------------------------------------- entitlements
export const ENTITLEMENT_SOURCES = ['APPLE', 'GOOGLE', 'ADMIN_GRANT'] as const;
export const ENTITLEMENT_STATUSES = ['ACTIVE', 'GRACE_PERIOD', 'BILLING_RETRY', 'PAUSED', 'EXPIRED', 'REVOKED', 'REFUNDED'] as const;
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];
/** Statuses that grant access. BILLING_RETRY grants nothing (Apple/Google stop service unless in grace). */
export const ENTITLEMENT_ACCESS_STATUSES: readonly EntitlementStatus[] = ['ACTIVE', 'GRACE_PERIOD'];
/**
 * Statuses in which the store still owns the subscription (it may recover, resume or renew): the
 * app must send the user to the store to manage it instead of offering a second purchase.
 */
export const STORE_MANAGED_STATUSES: readonly EntitlementStatus[] = ['ACTIVE', 'GRACE_PERIOD', 'BILLING_RETRY', 'PAUSED'];

export type Entitlement = {
  planCode: PlanCode;
  source: (typeof ENTITLEMENT_SOURCES)[number];
  status: EntitlementStatus;
  productId: string | null;
  expiresAt: string | null;
  autoRenew: boolean | null;
  lastVerifiedAt: string;
};
export type EntitlementsResponse = { effectivePlan: PlanCode; entitlements: Entitlement[]; storeManaged: boolean };

export const appleVerifyBody = z.object({ signedTransactionInfo: z.string().min(20).max(20_000) });
export const googleVerifyBody = z.object({ productId: z.string().min(1).max(200), purchaseToken: z.string().min(10).max(4_000) });

/** Store "manage subscription" destinations — the only subscription links the apps show. */
export function manageSubscriptionUrl(platform: ClientPlatform, androidPackage?: string, productId?: string): string | null {
  if (platform === 'ios') return 'https://apps.apple.com/account/subscriptions';
  if (platform === 'android') {
    const q = [productId ? `sku=${encodeURIComponent(productId)}` : '', androidPackage ? `package=${encodeURIComponent(androidPackage)}` : ''].filter(Boolean).join('&');
    return `https://play.google.com/store/account/subscriptions${q ? `?${q}` : ''}`;
  }
  return null;
}
