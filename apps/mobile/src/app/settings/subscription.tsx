import { ENTITLEMENT_ACCESS_STATUSES, STORE_MANAGED_STATUSES } from '@ghayarly/shared';
import { spacing } from '@ghayarly/tokens';
import { useRouter, type Href } from 'expo-router';
import { Platform, View } from 'react-native';
import { offerKey, useEntitlements, useStoreBilling } from '@/features/billing/useStoreBilling';
import { ConsentGate } from '@/features/compliance/ConsentGate';
import { errorKey } from '@/lib/api';
import { money } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Badge, Button, Card, ErrorState, Header, Icon, LoadingScreen, Notice, Screen, Text, useToast } from '@/ui';

/**
 * Plans & subscription. Digital plans are sold ONLY through the platform store inside the apps
 * (no external payment links — Egypt has no eligible programme). Prices shown for purchase are the
 * store's own localized prices; the reference price is shown only when the store has none.
 * Access changes only after the server verifies the purchase.
 */
/** Buying needs the current Terms (the server refuses purchases without them as well). */
export default function SubscriptionRoute() {
  return (
    <ConsentGate>
      <Subscription />
    </ConsentGate>
  );
}

function Subscription() {
  const { t, locale, pickL } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const billing = useStoreBilling();
  const ent = useEntitlements();
  const store = Platform.OS === 'ios' ? t('billing.appStore') : t('billing.googlePlay');

  if (billing.plans.isPending || ent.isPending) return <LoadingScreen />;
  if (billing.plans.error) return <ErrorState message={t(errorKey(billing.plans.error))} onRetry={() => void billing.plans.refetch()} />;
  const current = ent.data?.effectivePlan ?? 'SILVER';
  // The store-managed subscription, if any (including one in billing retry or paused: the store
  // still owns it and may recover it, so a second purchase would mean double billing).
  const managed = (ent.data?.entitlements ?? []).filter((e) => e.source !== 'ADMIN_GRANT' && STORE_MANAGED_STATUSES.includes(e.status));
  const activeStore = managed.find((e) => ENTITLEMENT_ACCESS_STATUSES.includes(e.status)) ?? managed[0];
  const thisStore = Platform.OS === 'ios' ? 'APPLE' : 'GOOGLE';
  const inOtherStore = Boolean(activeStore && activeStore.source !== thisStore);
  const subStore = activeStore?.source === 'APPLE' ? t('billing.appStore') : t('billing.googlePlay');
  // Billing retry / paused: the fix happens in the store (payment method, resume), not here.
  const needsStore = activeStore?.status === 'BILLING_RETRY' || activeStore?.status === 'PAUSED';

  return (
    <Screen testID="subscription-screen" header={<Header back title={t('billing.title')} subtitle={t('billing.subtitle')} />}>
      {billing.error ? <Notice tone="warning" testID="billing-error" body={t(`billing.error_${billing.error}`)} /> : null}
      {/* Billed in the other platform's store: only that store can change it, so no button here. */}
      {inOtherStore ? <Notice tone="info" testID="billing-other-store" body={t('billing.managedInOtherStore', { store: subStore })} /> : null}
      {needsStore ? (
        <Notice tone="warning" testID="billing-needs-store" body={t(activeStore?.status === 'PAUSED' ? 'billing.paused' : 'billing.billingRetry', { store: subStore })} />
      ) : null}
      {billing.plans.data.map((plan) => {
        const isCurrent = plan.code === current;
        return (
          <Card key={plan.code} testID={`plan-${plan.code}`} style={{ gap: spacing.md, borderWidth: isCurrent ? 1.5 : 0, borderColor: isCurrent ? colors.accent : 'transparent' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
              <Text variant="title3">{pickL(plan, 'name')}</Text>
              {isCurrent ? <Badge label={t('billing.currentPlan')} tone="primary" /> : plan.code === 'SILVER' ? <Badge label={t('billing.free')} /> : null}
            </View>
            {plan.benefits.map((b) => (
              <View key={b.key} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}>
                <Icon name="check" size={16} color="success" />
                <Text variant="footnote" color="textSecondary" style={{ flex: 1 }}>
                  {locale === 'ar' ? b.ar : b.en}
                  {b.kind === 'REAL_WORLD' ? ` · ${t('billing.realWorld')}` : ''}
                </Text>
              </View>
            ))}
            {plan.code !== 'SILVER'
              ? plan.offers.map((o) => {
                  const productId = Platform.OS === 'ios' ? o.appleProductId : o.googleProductId;
                  const offer = productId ? billing.products[offerKey(productId, o.googleBasePlanId)] : undefined;
                  const storePrice = offer?.displayPrice;
                  const label = storePrice ? t(o.period === 'MONTHLY' ? 'billing.perMonth' : 'billing.perYear', { price: storePrice }) : t('billing.referencePrice', { price: money(o.referencePricePiasters, locale) });
                  const canBuy = plan.purchasable && offer && !isCurrent && !inOtherStore && !needsStore;
                  return (
                    <View key={o.period} style={{ gap: spacing.xs }}>
                      <Text variant="callout" weight="semibold" tabular>
                        {t(o.period === 'MONTHLY' ? 'billing.monthly' : 'billing.yearly')} · {label}
                      </Text>
                      {canBuy ? (
                        <Button
                          testID={`${activeStore ? 'change-plan' : 'subscribe'}-${plan.code}-${o.period}`}
                          variant={activeStore ? 'secondary' : 'accent'}
                          label={t(activeStore ? 'billing.changePlan' : 'billing.subscribe')}
                          loading={billing.busy}
                          onPress={async () => {
                            // Same store: an in-place change (Play replaces the old purchase; StoreKit
                            // switches within the subscription group) — never a parallel subscription.
                            if (await billing.subscribe(offer, activeStore ? { productId: activeStore.productId } : null)) toast(t('common.saved'));
                          }}
                        />
                      ) : null}
                    </View>
                  );
                })
              : null}
            {plan.unavailableReason && plan.unavailableReason !== 'FREE_PLAN' ? (
              <Text variant="caption" color="textTertiary" testID={`plan-${plan.code}-unavailable`}>
                {t(`billing.unavailable_${plan.unavailableReason}`)}
              </Text>
            ) : null}
          </Card>
        );
      })}

      <View style={{ gap: spacing.sm }}>
        {billing.enabled ? (
          <Button
            testID="restore-purchases"
            variant="secondary"
            icon="refresh-cw"
            label={t('billing.restore')}
            loading={billing.busy}
            onPress={async () => {
              const result = await billing.restore().catch(() => null);
              if (!result) toast(t('billing.restoreFailed'), 'error');
              else if (result.restoreErrors.length) toast(t('billing.restoreIssues'), 'error');
              else if (!result.found) toast(t('billing.restoreNone', { store }));
              else toast(t('billing.restored'));
            }}
          />
        ) : null}
        {activeStore && !inOtherStore ? <Button testID="manage-subscription" variant="ghost" icon="external-link" label={t('billing.manage')} onPress={() => void billing.manage(activeStore.productId)} /> : null}
      </View>

      <Text variant="caption" color="textTertiary">
        {t('billing.disclosure', { store })}
      </Text>
      <View style={{ flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' }}>
        <Button label={t('legal.terms')} variant="ghost" size="sm" fullWidth={false} onPress={() => router.push('/legal/terms' as Href)} />
        <Button label={t('legal.privacy')} variant="ghost" size="sm" fullWidth={false} onPress={() => router.push('/legal/privacy' as Href)} />
      </View>
    </Screen>
  );
}
