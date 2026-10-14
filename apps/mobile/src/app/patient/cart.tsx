import { radii, spacing } from '@ghayarly/tokens';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { useCart } from '@/features/store/hooks';
import { api, errorKey } from '@/lib/api';
import { money } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Badge, Button, Card, EmptyState, ErrorState, Header, Icon, LoadingScreen, Notice, PressableScale, Screen, Text } from '@/ui';

export default function Cart() {
  const { t, pickL, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const cart = useCart();
  const update = useMutation({
    mutationFn: ({ id, quantity }: { id: string; quantity: number }) => (quantity <= 0 ? api.store.removeCartItem(id) : api.store.updateCartItem(id, quantity)),
    onSuccess: (data) => qc.setQueryData(['cart'], data),
  });

  return (
    <Screen
      testID="cart-screen"
      header={<Header back title={t('store.cart')} />}
      footer={
        cart.data?.lines.length ? (
          <View style={{ gap: spacing.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="callout" color="textSecondary">{t('store.subtotal')}</Text>
              <Text variant="title3" tabular testID="cart-subtotal">{money(cart.data.subtotalPiasters, locale)}</Text>
            </View>
            <Button testID="go-checkout" label={t('store.checkout')} iconEnd="arrow-right" onPress={() => router.push('/patient/checkout')} />
          </View>
        ) : null
      }
    >
      {update.error ? <Notice tone="danger" body={t(errorKey(update.error))} /> : null}
      {cart.isPending ? (
        <LoadingScreen />
      ) : cart.error ? (
        <ErrorState message={t(errorKey(cart.error))} onRetry={() => void cart.refetch()} />
      ) : cart.data.lines.length === 0 ? (
        <EmptyState icon="shopping-cart" title={t('store.cartEmpty')} actionLabel={t('home.openStore')} onAction={() => router.replace('/patient/store')} />
      ) : (
        cart.data.lines.map((l) => (
          <Card key={l.id} testID={`cart-line-${l.productSlug}`}>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <View style={{ width: 56, height: 56, borderRadius: radii.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="mci:bandage" size={24} color="primary" />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text variant="callout" weight="semibold">{pickL(l, 'productName')}</Text>
                <Text variant="caption" color="textTertiary">{pickL(l, 'variantLabel')} · {money(l.unitPricePiasters, locale)}</Text>
                <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
                  {l.forPatientName ? <Badge label={`${t('store.forWhom')} ${l.forPatientName}`} tone="info" /> : null}
                  {l.isDemo ? <Badge label={t('app.demoBadge')} tone="demo" /> : null}
                </View>
              </View>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.xs }}>
                <PressableScale accessibilityRole="button" accessibilityLabel="-" onPress={() => update.mutate({ id: l.id, quantity: l.quantity - 1 })} style={{ padding: spacing.sm }}>
                  <Icon name={l.quantity === 1 ? 'trash-2' : 'minus'} size={16} />
                </PressableScale>
                <Text weight="semibold" tabular>{l.quantity}</Text>
                <PressableScale accessibilityRole="button" accessibilityLabel="+" onPress={() => update.mutate({ id: l.id, quantity: Math.min(20, l.quantity + 1) })} style={{ padding: spacing.sm }}>
                  <Icon name="plus" size={16} />
                </PressableScale>
              </View>
              <Text variant="callout" weight="bold" tabular>{money(l.lineTotalPiasters, locale)}</Text>
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}
