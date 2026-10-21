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

export type StoreProduct = { id: string; displayPrice: string };

/** Billing problems the subscription screen explains individually (see billing.error_* strings). */
export type BillingError = 'STORE_UNAVAILABLE' | 'VERIFY_FAILED' | 'OTHER_ACCOUNT' | 'PENDING_APPROVAL' | 'NETWORK' | 'ALREADY_OWNED' | 'PURCHASE_FAILED';

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
  return (plans ?? []).flatMap((p) => p.offers.map((o) => (platform === 'ios' ? o.appleProductId : o.googleProductId))).filter((x): x is string => Boolean(x));
}

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
        if (alive) setProducts(Object.fromEntries((fetched ?? []).map((p) => [p.id, { id: p.id, displayPrice: p.displayPrice }])));
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

  const subscribe = useCallback(async (productId: string) => {
    setError(null);
    setBusy(true);
    try {
      const { appAccountToken } = await api.billing.accountToken();
      const done = new Promise<boolean>((resolve) => (pending.current = resolve));
      await IAP.requestPurchase({
        type: 'subs',
        request: platform === 'ios' ? { apple: { sku: productId, appAccountToken } } : { google: { skus: [productId], obfuscatedAccountId: appAccountToken } },
      });
      return await done;
    } catch {
      return false;
    } finally {
      setBusy(false);
      pending.current = null;
    }
  }, []);

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
      return result;
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
