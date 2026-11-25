import type { TranslationKey } from '@ghayarly/i18n';
import type { Order, OrderStatus, PaymentStatus } from '@ghayarly/shared';
import { spacing } from '@ghayarly/tokens';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { Platform, View } from 'react-native';
import { ApiError, api, errorKey } from '@/lib/api';
import { formatDate, money } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { Badge, Card, PressableScale, Text } from '@/ui';

const ORDER_ERRORS = new Set([
  'CART_EMPTY',
  'CART_HAS_UNAVAILABLE_ITEMS',
  'OUT_OF_STOCK',
  'INSUFFICIENT_STOCK',
  'PRICE_CHANGED',
  'DELIVERY_NOT_AVAILABLE',
  'INVALID_PHONE',
  'FEATURE_DISABLED',
  'PAYMENT_NOT_CONFIGURED',
  'PAYMENT_PROVIDER_UNAVAILABLE',
  'ORDER_NOT_PAYABLE',
  'ALREADY_PAID',
  'CANNOT_CANCEL',
  'ACCOUNT_RESTRICTED',
]);

export function orderErrorKey(err: unknown): TranslationKey {
  if (err instanceof ApiError && ORDER_ERRORS.has(err.code)) return `orders.err_${err.code}` as TranslationKey;
  return errorKey(err);
}

const STATUS_TONE: Record<OrderStatus, 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
  PENDING_PAYMENT: 'warning',
  CONFIRMED: 'primary',
  PROCESSING: 'primary',
  SHIPPED: 'info',
  DELIVERED: 'success',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
};
const PAY_TONE: Record<PaymentStatus, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  UNPAID: 'neutral',
  PENDING: 'info',
  AUTHORIZED: 'info',
  PAID: 'success',
  SETTLED: 'success',
  FAILED: 'danger',
  PARTIALLY_REFUNDED: 'warning',
  REFUNDED: 'neutral',
  VOIDED: 'neutral',
};

export function OrderStatusBadge({ status, testID }: { status: OrderStatus; testID?: string }) {
  const { t } = useI18n();
  return <Badge label={t(`orders.status_${status}`)} tone={STATUS_TONE[status]} testID={testID} />;
}

/** Payment state as recorded from verified provider data. "Paid" is shown only when the server says so. */
export function PaymentStatusBadge({ order, testID }: { order: Pick<Order, 'paymentStatus' | 'paid'>; testID?: string }) {
  const { t } = useI18n();
  const status = order.paid || (order.paymentStatus !== 'PAID' && order.paymentStatus !== 'SETTLED') ? order.paymentStatus : 'PENDING';
  return <Badge label={t(`orders.pay_${status}`)} tone={PAY_TONE[status]} testID={testID} />;
}

export function OrderCard({ order, onPress, testID }: { order: Order; onPress: () => void; testID?: string }) {
  const { t, locale } = useI18n();
  const items = order.lines.reduce((n, l) => n + l.quantity, 0);
  return (
    <PressableScale testID={testID} accessibilityRole="button" accessibilityLabel={`${t('orders.reference')} ${order.reference}`} onPress={onPress} scaleTo={0.99}>
      <Card>
        <View style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md }}>
            <Text variant="callout" weight="semibold" tabular>{order.reference}</Text>
            <OrderStatusBadge status={order.status} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md }}>
            <Text variant="footnote" color="textSecondary">{`${formatDate(order.createdAt, locale)} · ${items} × ${t('orders.items')}`}</Text>
            <Text variant="footnote" weight="semibold" tabular>{money(order.totalPiasters, locale)}</Text>
          </View>
        </View>
      </Card>
    </PressableScale>
  );
}

/**
 * Starts Paymob's hosted checkout for an order and opens it in the system browser. Card details are
 * entered on Paymob's page only. When the browser closes, the order is re-read from the server: the
 * app never decides on its own that an order was paid.
 */
export function useStartPayment(onReturn?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => {
      const session = await api.store.payOrder(orderId);
      if (Platform.OS === 'web') window.open(session.checkoutUrl, '_blank', 'noopener');
      else await WebBrowser.openBrowserAsync(session.checkoutUrl, { dismissButtonStyle: 'close', readerMode: false });
      return session;
    },
    onSettled: async (_d, _e, orderId) => {
      await qc.invalidateQueries({ queryKey: ['order', orderId] });
      await qc.invalidateQueries({ queryKey: ['orders'] });
      onReturn?.();
    },
  });
}
