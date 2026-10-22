import { manageSubscriptionUrl, type PlanForClient } from '@ghayarly/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import * as IAP from './iap';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { reportError } from '@/lib/errorReporting';
import { useFeatures } from '@/features/compliance/hooks';

const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
const androidPackage = Constants.expoConfig?.android?.package;

/** A purchasable store offer. On Android one product can hold several base plans (monthly / yearly). */
export type StoreProduct = { id: string; displayPrice: string; offerToken?: string };

/** Key of one offer: the product id, plus the Google base plan when one is configured. */
export function offerKey(productId: string, basePlanId?: string | null): string {
  return platform === 'android' && basePlanId ? `${productId}#${basePlanId}` : productId;
}

/** Billing problems the subscription screen explains individually (see billing.error_* strings). */
export type BillingError =
  | 'STORE_UNAVAILABLE'
  | 'VERIFY_FAILED'
  | 'OTHER_ACCOUNT'
  | 'PENDING_APPROVAL'
  | 'NETWORK'
  | 'ALREADY_OWNED'
  | 'PURCHASE_FAILED'
  | 'CURRENT_PLAN_NOT_ON_DEVICE';

function purchaseErrorCode(code: unknown): BillingError {
  switch (code) {
    case 'deferred-payment':
    case 'pending':
      return 'PENDING_APPROVAL';
    case 'network-error':
      return 'NETWORK';
    case 'already-owned':
      return 'ALREADY_OWNED';
    default:
      return 'PURCHASE_FAILED';
  }
}

function verifyErrorCode(e: unknown): BillingError {
  if (e instanceof ApiError) {
    if (e.isNetwork) return 'NETWORK';
    if (e.code === 'PURCHASE_ACCOUNT_MISMATCH' || e.code === 'SUBSCRIPTION_BELONGS_TO_ANOTHER_ACCOUNT') return 'OTHER_ACCOUNT';
  }
  return 'VERIFY_FAILED';
}

export function usePlans() {
  return useQuery({ queryKey: ['billing-plans', platform], queryFn: () => api.billing.plans(platform) });
}

export function useEntitlements() {
  return useQuery({ queryKey: ['entitlements'], queryFn: () => api.billing.entitlements() });
}

function productIdsFor(plans: PlanForClient[] | undefined): string[] {
  const ids = (plans ?? []).flatMap((p) => p.offers.map((o) => (platform === 'ios' ? o.appleProductId : o.googleProductId))).filter((x): x is string => Boolean(x));
  return [...new Set(ids)];
}

type FetchedProduct = { id: string; displayPrice: string; subscriptionOffers?: { id: string; basePlanIdAndroid?: string | null; offerTokenAndroid?: string | null; displayPrice: string }[] | null };

/**
 * Store offers by key. On Android each base plan gets its own entry with its own price and offer
 * token, preferring the plain base-plan offer over promotional ones (no promotion is applied
 * unless the business configures one).
 */
function storeOffers(fetched: FetchedProduct[]): Record<string, StoreProduct> {
  const out: Record<string, StoreProduct> = {};
  for (const p of fetched) {
    const offers = [...(p.subscriptionOffers ?? [])].sort((a, b) => Number(isBaseOffer(b)) - Number(isBaseOffer(a)));
    out[p.id] = { id: p.id, displayPrice: p.displayPrice, offerToken: offers[0]?.offerTokenAndroid ?? undefined };
    if (platform !== 'android') continue;
    for (const o of offers) {
      const key = o.basePlanIdAndroid ? offerKey(p.id, o.basePlanIdAndroid) : null;
      if (key && !out[key] && o.offerTokenAndroid) out[key] = { id: p.id, displayPrice: o.displayPrice, offerToken: o.offerTokenAndroid };
    }
  }
  return out;
}
const isBaseOffer = (o: { id: string; basePlanIdAndroid?: string | null }) => !o.id || o.id === o.basePlanIdAndroid;

/**
 * Native store billing (StoreKit 2 / Play Billing via expo-iap). Only connects when the server
 * says store subscriptions are enabled; access is granted ONLY by the server after it verifies
 * the purchase — the app never unlocks anything from a client-side purchase result.
 */
export function useStoreBilling() {
  const qc = useQueryClient();
  const features = useFeatures();
  const plans = usePlans();
  const enabled = features['billing.store_subscriptions'] && platform !== 'web';
  const [products, setProducts] = useState<Record<string, StoreProduct>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BillingError | null>(null);
  const pending = useRef<((ok: boolean) => void) | null>(null);
  const ids = productIdsFor(plans.data);

  useEffect(() => {
    if (!enabled || !ids.length) return;
    let alive = true;
    const purchaseSub = IAP.purchaseUpdatedListener((purchase) => {
      void (async () => {
        // Ask to Buy / slow payment methods: nothing to verify yet. The store delivers the purchase
        // again once it is approved; it is NOT finished here.
        if (purchase.purchaseState === 'pending') {
          setError('PENDING_APPROVAL');
          pending.current?.(false);
          return;
        }
        try {
          if (platform === 'ios') await api.billing.verifyApple({ signedTransactionInfo: purchase.purchaseToken ?? '' });
          else await api.billing.verifyGoogle({ productId: purchase.productId, purchaseToken: purchase.purchaseToken ?? '' });
        } catch (e) {
          // Not finished: the store re-delivers the transaction, so it can be verified again later.
          setError(verifyErrorCode(e));
          pending.current?.(false);
          return;
        }
        await qc.invalidateQueries({ queryKey: ['entitlements'] });
        pending.current?.(true);
        // Finish only after the server has verified and recorded the purchase (it also acknowledges
        // Google purchases itself), so a failure here is logged, not shown as a failed purchase.
        try {
          await IAP.finishTransaction({ purchase, isConsumable: false });
        } catch (e) {
          reportError(e, { fatal: false, route: 'billing/finishTransaction' });
        }
      })();
    });
    const errorSub = IAP.purchaseErrorListener((e) => {
      if (!IAP.isUserCancelledError(e)) setError(purchaseErrorCode(e.code));
      pending.current?.(false);
    });
    void (async () => {
      try {
        await IAP.initConnection();
        const fetched = await IAP.fetchProducts({ skus: ids, type: 'subs' });
        if (alive) setProducts(storeOffers((fetched ?? []) as FetchedProduct[]));
      } catch {
        if (alive) setError('STORE_UNAVAILABLE');
      }
    })();
    return () => {
      alive = false;
      purchaseSub.remove();
      errorSub.remove();
      void IAP.endConnection().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ids.join(',')]);

  /**
   * Buys `offer`. `replacing` = the store subscription this account already pays for in THIS store:
   * on Android the change must replace that purchase in place (otherwise Play starts a second,
   * parallel subscription); on iOS StoreKit upgrades / downgrades within the subscription group.
   */
  const subscribe = useCallback(
    async (offer: StoreProduct, replacing?: { productId: string | null } | null) => {
      setError(null);
      setBusy(true);
      try {
        const { appAccountToken } = await api.billing.accountToken();
        let replace: { purchaseToken: string; oldProductId: string } | null = null;
        if (platform === 'android' && replacing) {
          // The old purchase token never leaves the device's Play account: read it from Play.
          const owned = ((await IAP.getAvailablePurchases()) ?? []).find((p) => p.productId === replacing.productId && p.purchaseToken);
          if (!owned) {
            setError('CURRENT_PLAN_NOT_ON_DEVICE');
            return false;
          }
          replace = { purchaseToken: owned.purchaseToken!, oldProductId: owned.productId };
        }
        const done = new Promise<boolean>((resolve) => (pending.current = resolve));
        await IAP.requestPurchase({
          type: 'subs',
          request:
            platform === 'ios'
              ? { apple: { sku: offer.id, appAccountToken } }
              : {
                  google: {
                    skus: [offer.id],
                    obfuscatedAccountId: appAccountToken,
                    ...(offer.offerToken ? { subscriptionOffers: [{ sku: offer.id, offerToken: offer.offerToken }] } : {}),
                    ...(replace
                      ? { purchaseToken: replace.purchaseToken, subscriptionProductReplacementParams: { oldProductId: replace.oldProductId, replacementMode: 'with-time-proration' as const } }
                      : {}),
                  },
                },
        });
        return await done;
      } catch {
        return false;
      } finally {
        setBusy(false);
        pending.current = null;
      }
    },
    [],
  );

  /** Restore Purchases: re-reads purchases from the store on this device; the server re-verifies each. */
  const restore = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      if (enabled) await IAP.initConnection();
      const purchases = enabled ? ((await IAP.getAvailablePurchases()) ?? []) : [];
      const tokens = purchases.map((p) => p.purchaseToken).filter((t): t is string => Boolean(t));
      const result = await api.billing.restore(platform === 'ios' ? { apple: tokens, google: [] } : { apple: [], google: purchases.filter((p) => p.purchaseToken).map((p) => ({ productId: p.productId, purchaseToken: p.purchaseToken! })) });
      await qc.invalidateQueries({ queryKey: ['entitlements'] });
      return { ...result, found: tokens.length };
    } finally {
      setBusy(false);
    }
  }, [enabled, qc]);

  /** Manage Subscription: the platform's own subscription management screen. */
  const manage = useCallback(async (productId?: string | null) => {
    try {
      if (enabled) {
        await IAP.deepLinkToSubscriptions(platform === 'android' ? { packageNameAndroid: androidPackage ?? null, skuAndroid: productId ?? null } : undefined);
        return;
      }
    } catch {
      // fall through to the public store URL
    }
    const url = manageSubscriptionUrl(platform, androidPackage, productId ?? undefined);
    if (url) await Linking.openURL(url).catch(() => undefined);
  }, [enabled]);

  return { enabled, plans, products, subscribe, restore, manage, busy, error };
}
