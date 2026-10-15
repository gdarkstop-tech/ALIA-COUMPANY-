import { spacing } from '@ghayarly/tokens';
import { useRouter, type Href } from 'expo-router';
import { Platform, View } from 'react-native';
import { useEntitlements, useStoreBilling } from '@/features/billing/useStoreBilling';
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
export default function Subscription() {
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
  const activeStore = ent.data?.entitlements.find((e) => e.source !== 'ADMIN_GRANT' && (e.status === 'ACTIVE' || e.status === 'GRACE_PERIOD'));

  return (
    <Screen testID="subscription-screen" header={<Header back title={t('billing.title')} subtitle={t('billing.subtitle')} />}>
      {billing.error ? <Notice tone="warning" body={billing.error === 'STORE_UNAVAILABLE' ? t('billing.storeUnavailable') : t('billing.verifyFailed')} /> : null}
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
                  const storePrice = productId ? billing.products[productId]?.displayPrice : undefined;
                  const label = storePrice ? t(o.period === 'MONTHLY' ? 'billing.perMonth' : 'billing.perYear', { price: storePrice }) : t('billing.referencePrice', { price: money(o.referencePricePiasters, locale) });
                  return (
                    <View key={o.period} style={{ gap: spacing.xs }}>
                      <Text variant="callout" weight="semibold" tabular>
                        {t(o.period === 'MONTHLY' ? 'billing.monthly' : 'billing.yearly')} · {label}
                      </Text>
                      {plan.purchasable && productId && storePrice && !isCurrent ? (
                        <Button
                          testID={`subscribe-${plan.code}-${o.period}`}
                          variant="accent"
                          label={t('billing.subscribe')}
                          loading={billing.busy}
                          onPress={async () => {
                            if (await billing.subscribe(productId)) toast(t('common.saved'));
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
        <Button
          testID="restore-purchases"
          variant="secondary"
          icon="refresh-cw"
          label={t('billing.restore')}
          loading={billing.busy}
          onPress={async () => {
            await billing.restore().catch(() => undefined);
            toast(t('billing.restored'));
          }}
        />
        {activeStore ? <Button testID="manage-subscription" variant="ghost" icon="external-link" label={t('billing.manage')} onPress={() => void billing.manage(activeStore.productId)} /> : null}
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
