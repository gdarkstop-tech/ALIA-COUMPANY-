import { radii, spacing } from '@ghayarly/tokens';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { stockTone, useCart } from '@/features/store/hooks';
import { ProductVisual } from '@/features/store/ProductVisual';
import { api, errorKey } from '@/lib/api';
import { money } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Badge, Card, EmptyState, ErrorState, Header, Icon, LoadingScreen, Notice, PressableScale, Screen, Text } from '@/ui';

export default function TetraSolStore() {
  const { t, pickL, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const products = useQuery({ queryKey: ['products'], queryFn: () => api.store.products() });
  const cart = useCart();
  const count = cart.data?.itemCount ?? 0;

  return (
    <Screen
      testID="tetrasol-store"
      header={
        <Header
          title={t('store.title')}
          subtitle={t('store.subtitle')}
          right={
            <PressableScale testID="open-cart" accessibilityRole="button" accessibilityLabel={t('store.cart')} onPress={() => router.push('/patient/cart')} style={{ width: 44, height: 44, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="shopping-cart" size={20} />
              {count > 0 ? (
                <View style={{ position: 'absolute', top: -2, end: -2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
                  <Text variant="micro" weight="bold" color="textOnPrimary" testID="cart-count">{count}</Text>
                </View>
              ) : null}
            </PressableScale>
          }
        />
      }
      refreshing={products.isRefetching}
      onRefresh={() => void products.refetch()}
    >
      <Notice tone="info" icon="mci:shield-check-outline" body={t('store.exclusive')} />
      {products.data?.some((p) => p.isDemo) ? <Notice tone="demo" body={t('store.demoProductNotice')} testID="store-demo-notice" /> : null}
      {products.isPending ? (
        <LoadingScreen />
      ) : products.error ? (
        <ErrorState message={t(errorKey(products.error))} onRetry={() => void products.refetch()} />
      ) : products.data.length === 0 ? (
        <EmptyState icon="mci:bandage" title={t('store.title')} body={t('store.catalogEmpty')} />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }} testID="product-grid">
          {products.data.map((p, i) => (
            <Animated.View key={p.id} entering={FadeInDown.delay(i * 60).duration(350)} style={{ width: '47.5%', flexGrow: 1 }}>
              <Card onPress={() => router.push({ pathname: '/patient/product/[slug]', params: { slug: p.slug } })} testID={`product-${p.slug}`} style={{ padding: spacing.md, gap: spacing.sm }}>
                <ProductVisual height={110} demo={p.isDemo} />
                <Text variant="footnote" weight="semibold" numberOfLines={2} style={{ minHeight: 40 }}>{pickL(p, 'name')}</Text>
                <Text variant="caption" color="textTertiary" numberOfLines={2}>{pickL(p, 'summary')}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs }}>
                  <Text variant="callout" weight="bold" tabular>{money(p.fromPricePiasters, locale)}</Text>
                </View>
                <Badge label={t(`store.stock_${p.stockStatus}`)} tone={stockTone(p.stockStatus)} />
              </Card>
            </Animated.View>
          ))}
        </View>
      )}
    </Screen>
  );
}
