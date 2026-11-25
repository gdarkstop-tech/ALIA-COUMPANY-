import type { TranslationKey } from '@ghayarly/i18n';
import type { Order } from '@ghayarly/shared';
import { spacing } from '@ghayarly/tokens';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { cairoDay, cairoTime } from '@/features/booking/shared';
import { OrderStatusBadge, PaymentStatusBadge, orderErrorKey, useStartPayment } from '@/features/store/orders';
import { api, errorKey } from '@/lib/api';
import { ltr, money } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Button, Card, ErrorState, Header, LoadingScreen, Notice, Screen, Section, Sheet, Text, useToast } from '@/ui';

const CHECK_WINDOW_MS = 3 * 60_000;

/**
 * One order. After the customer returns from Paymob's page the order is re-read from the server
 * every few seconds for a short while; "paid" appears only once the server has verified the
 * payment with Paymob (callback signature + transaction inquiry), never from the redirect alone.
 */
export default function OrderDetail() {
  const { id, pay } = useLocalSearchParams<{ id: string; pay?: string }>();
  const { t, locale, pickL } = useI18n();
  const { colors } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const [checkUntil, setCheckUntil] = useState(0);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const order = useQuery({
    queryKey: ['order', id],
    queryFn: () => api.store.order(id),
    refetchInterval: (q) => {
      const o = q.state.data;
      if (!o || o.status !== 'PENDING_PAYMENT') return false;
      return o.paymentStatus === 'PENDING' || o.paymentStatus === 'AUTHORIZED' || Date.now() < checkUntil ? 4000 : false;
    },
  });
  const o = order.data;

  const startPayment = useStartPayment(() => setCheckUntil(Date.now() + CHECK_WINDOW_MS));
  const startPay = () => {
    setError(null);
    startPayment.mutate(id, { onError: (e) => setError(t(orderErrorKey(e))) });
  };
  // Coming straight from checkout: open Paymob once (native only; a browser blocks pop-ups that no tap opened).
  const autoStarted = useRef(false);
  useEffect(() => {
    if (pay === '1' && o?.can.pay && !autoStarted.current && Platform.OS !== 'web') {
      autoStarted.current = true;
      startPay();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pay, o?.can.pay]);

  const cancel = useMutation({
    mutationFn: () => api.store.cancelOrder(id),
    onSuccess: async (updated) => {
      qc.setQueryData(['order', id], updated);
      await qc.invalidateQueries({ queryKey: ['orders'] });
      setConfirmCancel(false);
      toast(t('orders.cancelled'));
    },
    onError: (e) => {
      setConfirmCancel(false);
      setError(t(orderErrorKey(e)));
    },
  });

  if (order.isPending) return <Screen header={<Header back title="" large={false} />}><LoadingScreen /></Screen>;
  if (order.error || !o) return <Screen header={<Header back title="" large={false} />}><ErrorState message={t(errorKey(order.error))} onRetry={() => void order.refetch()} /></Screen>;

  const checking = o.status === 'PENDING_PAYMENT' && (o.paymentStatus === 'PENDING' || o.paymentStatus === 'AUTHORIZED' || Date.now() < checkUntil);
  const testMode = o.payments?.some((p) => p.mode === 'TEST');
  const deadlinePassed = o.status === 'PENDING_PAYMENT' && new Date(o.paymentExpiresAt).getTime() < Date.now();

  return (
    <Screen
      testID="order-screen"
      header={<Header back title={`${t('orders.reference')} ${o.reference}`} large={false} />}
      footer={
        o.can.pay || o.can.cancel ? (
          <View style={{ gap: spacing.sm }}>
            {o.can.pay ? <Button testID="order-pay" label={t('orders.payNow')} icon="lock" onPress={startPay} loading={startPayment.isPending} /> : null}
            {o.can.cancel ? <Button testID="order-cancel" label={t('orders.cancel')} variant="secondary" onPress={() => setConfirmCancel(true)} /> : null}
          </View>
        ) : null
      }
    >
      <Card>
        <View style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md }}>
            <OrderStatusBadge status={o.status} testID="order-status" />
            <PaymentStatusBadge order={o} testID="order-payment-status" />
          </View>
          {o.status === 'PENDING_PAYMENT' && !deadlinePassed ? (
            <Text variant="footnote" color="textSecondary">{t('orders.payBy', { time: `${cairoDay(o.paymentExpiresAt, locale)} ${cairoTime(o.paymentExpiresAt, locale)}` })}</Text>
          ) : null}
          {deadlinePassed ? <Text variant="footnote" color="textSecondary">{t('orders.paymentDeadlinePassed')}</Text> : null}
          {checking ? <Text variant="footnote" color="textSecondary" testID="order-checking" accessibilityLiveRegion="polite">{t('orders.checking')}</Text> : null}
          {o.trackingReference ? <Text variant="footnote">{`${t('orders.tracking')}: `}<Text variant="footnote" weight="semibold">{ltr(o.trackingReference)}</Text></Text> : null}
        </View>
      </Card>
      {o.paymentStatus === 'FAILED' && o.can.pay ? <Notice tone="warning" body={t('orders.paymentFailedRetry')} testID="order-payment-failed" /> : null}
      {testMode ? <Notice tone="demo" body={t('orders.testMode')} testID="order-test-mode" /> : null}
      {o.isDemo ? <Notice tone="demo" body={t('store.demoProductNotice')} /> : null}
      {error ? <Notice tone="danger" body={error} testID="order-error" /> : null}

      <Section title={t('orders.items')}>
        <Card padded={false}>
          {o.lines.map((l, i) => (
            <View key={l.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, padding: spacing.lg, borderTopWidth: i ? 1 : 0, borderTopColor: colors.divider }}>
              <View style={{ flex: 1 }}>
                <Text variant="footnote" weight="semibold">{pickL(l, 'name')}</Text>
                <Text variant="caption" color="textTertiary">{`${pickL(l, 'label')} × ${l.quantity}`}</Text>
              </View>
              <Text variant="footnote" weight="semibold" tabular>{money(l.lineTotalPiasters, locale)}</Text>
            </View>
          ))}
        </Card>
      </Section>

      <Card>
        <View style={{ gap: spacing.md }}>
          <Row label={t('store.subtotal')} value={money(o.subtotalPiasters, locale)} />
          {o.discountPiasters ? <Row label={[t('store.discount'), o.discount ? ((locale === 'ar' ? o.discount.nameAr : o.discount.nameEn) ?? o.discount.code) : null].filter(Boolean).join(' · ')} value={`− ${money(o.discountPiasters, locale)}`} /> : null}
          <Row label={t('store.delivery')} value={money(o.deliveryFeePiasters, locale)} />
          <View style={{ height: 1, backgroundColor: colors.divider }} />
          <Row label={t('orders.total')} value={money(o.totalPiasters, locale)} strong testID="order-total" />
          {o.refundedPiasters ? <Row label={t('orders.refunded')} value={money(o.refundedPiasters, locale)} testID="order-refunded" /> : null}
        </View>
      </Card>

      <Section title={t('orders.deliveryTitle')}>
        <Card>
          <View style={{ gap: spacing.xs }}>
            <Text variant="footnote" weight="semibold">{o.delivery.recipientName}</Text>
            <Text variant="footnote" color="textSecondary">{ltr(o.delivery.phone)}</Text>
            <Text variant="footnote" color="textSecondary">{[t(`governorate.${o.delivery.governorate}` as TranslationKey), o.delivery.city, o.delivery.district].filter(Boolean).join(' · ')}</Text>
            <Text variant="footnote" color="textSecondary">{o.delivery.address}</Text>
            {o.delivery.notes ? <Text variant="caption" color="textTertiary">{o.delivery.notes}</Text> : null}
          </View>
        </Card>
      </Section>

      {o.events?.length ? (
        <Section title={t('orders.history')}>
          <Card>
            <View style={{ gap: spacing.md }}>
              {o.events.map((e, i) => (
                <View key={`${e.at}-${i}`} style={{ gap: 2 }}>
                  <Text variant="footnote" weight="semibold">{eventLabel(t, e)}</Text>
                  <Text variant="caption" color="textTertiary">{`${cairoDay(e.at, locale)} ${cairoTime(e.at, locale)}`}</Text>
                </View>
              ))}
            </View>
          </Card>
        </Section>
      ) : null}

      <Sheet visible={confirmCancel} onClose={() => setConfirmCancel(false)} title={t('orders.cancel')} testID="order-cancel-sheet">
        <Text variant="callout">{t('orders.cancelConfirm')}</Text>
        <Button testID="order-cancel-confirm" label={t('orders.cancel')} variant="danger" loading={cancel.isPending} onPress={() => cancel.mutate()} />
      </Sheet>
    </Screen>
  );
}

const KNOWN_EVENTS = new Set(['PLACED', 'PAYMENT_STARTED', 'PAID', 'PAID_AFTER_CLOSE', 'AUTHORIZED', 'SETTLED', 'VOIDED', 'PAYMENT_FAILED', 'EXPIRED', 'CANCELLED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'REFUND_REQUESTED', 'REFUND_FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED']);
function eventLabel(t: (k: TranslationKey) => string, e: NonNullable<Order['events']>[number]) {
  return KNOWN_EVENTS.has(e.event) ? t(`orders.ev_${e.event}` as TranslationKey) : t(`orders.status_${e.status}`);
}

function Row({ label, value, strong, testID }: { label: string; value: string; strong?: boolean; testID?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
      <Text variant={strong ? 'callout' : 'footnote'} weight={strong ? 'semibold' : 'regular'} color="textSecondary">{label}</Text>
      <Text variant={strong ? 'title3' : 'footnote'} weight={strong ? 'bold' : 'medium'} tabular testID={testID}>{value}</Text>
    </View>
  );
}
