import { spacing } from '@ghayarly/tokens';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { OrderCard } from '@/features/store/orders';
import { api, errorKey } from '@/lib/api';
import { useI18n } from '@/providers/i18n';
import { EmptyState, ErrorState, Header, LoadingScreen, Screen } from '@/ui';

/** The customer's TetraSol orders, newest first. Statuses come from the server only. */
export default function MyOrders() {
  const { t } = useI18n();
  const router = useRouter();
  const q = useQuery({ queryKey: ['orders'], queryFn: () => api.store.orders() });
  return (
    <Screen testID="orders-screen" header={<Header back title={t('orders.myOrders')} />}>
      {q.isPending ? (
        <LoadingScreen />
      ) : q.error ? (
        <ErrorState message={t(errorKey(q.error))} onRetry={() => void q.refetch()} />
      ) : !q.data.length ? (
        <EmptyState icon="shopping-bag" title={t('orders.none')} body={t('orders.noneBody')} actionLabel={t('nav.store')} onAction={() => router.push('/patient/store')} testID="orders-empty" />
      ) : (
        <View style={{ gap: spacing.sm }}>
          {q.data.map((o, i) => (
            <OrderCard key={o.id} order={o} testID={`order-row-${i}`} onPress={() => router.push({ pathname: '/patient/orders/[id]', params: { id: o.id } })} />
          ))}
        </View>
      )}
    </Screen>
  );
}
