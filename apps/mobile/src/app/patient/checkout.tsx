import { GOVERNORATES, type Governorate } from '@ghayarly/shared';
import { spacing } from '@ghayarly/tokens';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { orderErrorKey } from '@/features/store/orders';
import { ApiError, api, errorKey } from '@/lib/api';
import { money } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Badge, Button, Card, ErrorState, Header, LoadingScreen, Notice, Screen, Section, Select, Text, TextField } from '@/ui';

const newAttemptKey = () => `co-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/**
 * Checkout. Every amount comes from the server (cart, discount, delivery zone); the app sends only
 * the discount code, the delivery address and the total the customer saw — a different server total
 * is refused (PRICE_CHANGED). Payment happens on Paymob's hosted page; the order shows as paid only
 * after the server has verified the payment with Paymob.
 */
export default function Checkout() {
  const { t, pickL, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const [codeInput, setCodeInput] = useState('');
  const [code, setCode] = useState('');
  const [governorate, setGovernorate] = useState<Governorate | null>(null);
  const [recipient, setRecipient] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [district, setDistrict] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  // One key per checkout attempt: a double tap or a retry after a lost response returns the same order.
  const attemptKey = useRef(newAttemptKey());

  // Prefill from the account holder's own profile when it is available; never required.
  const patients = useQuery({ queryKey: ['patients'], queryFn: () => api.patients.list(), retry: false });
  useEffect(() => {
    const self = patients.data?.find((p) => p.relationship === 'SELF');
    if (!self) return;
    setRecipient((v) => v || self.displayName);
    setPhone((v) => v || self.phone || '');
    setGovernorate((v) => v ?? self.governorate ?? null);
    setCity((v) => v || self.city || '');
  }, [patients.data]);

  const preview = useQuery({
    queryKey: ['checkout-preview', code, governorate],
    queryFn: () => api.store.checkoutPreview({ ...(code ? { discountCode: code } : {}), ...(governorate ? { governorate } : {}) }),
    staleTime: 0,
  });
  const p = preview.data;

  const place = useMutation({
    mutationFn: () =>
      api.store.placeOrder({
        idempotencyKey: attemptKey.current,
        discountCode: code || undefined,
        delivery: { recipientName: recipient.trim(), phone: phone.trim(), governorate: governorate!, city: city.trim(), district: district.trim() || null, address: address.trim(), notes: notes.trim() || null },
        expectedTotalPiasters: p!.totalPiasters,
      }),
    onSuccess: async (order) => {
      await qc.invalidateQueries({ queryKey: ['cart'] });
      await qc.invalidateQueries({ queryKey: ['orders'] });
      attemptKey.current = newAttemptKey();
      // The order screen opens Paymob's page and then follows the server's verified payment state.
      router.replace({ pathname: '/patient/orders/[id]', params: { id: order.id, pay: order.can.pay ? '1' : undefined } });
    },
    onError: (e) => {
      setError(t(orderErrorKey(e)));
      // Prices, stock or fees moved: show the customer the new server figures before they try again.
      if (e instanceof ApiError && ['PRICE_CHANGED', 'OUT_OF_STOCK', 'INSUFFICIENT_STOCK', 'CART_HAS_UNAVAILABLE_ITEMS', 'DELIVERY_NOT_AVAILABLE'].includes(e.code)) void preview.refetch();
    },
  });

  const configured = p?.payment.status === 'CONFIGURED';
  const notDelivered = Boolean(configured && governorate && p && p.deliveryFeePiasters === null);
  const formComplete = Boolean(governorate && recipient.trim().length >= 2 && phone.trim().length >= 6 && city.trim() && address.trim().length >= 5);
  const submit = () => {
    if (!formComplete) return setError(t('errors.requiredField'));
    setError(null);
    place.mutate();
  };
  const footerLabel = !configured ? t('store.placeOrderDisabled') : p && governorate && p.deliveryFeePiasters !== null && !p.payment.canPlaceRealOrder ? t('orders.err_FEATURE_DISABLED') : t('orders.placeAndPay');

  return (
    <Screen
      testID="checkout-screen"
      header={<Header back title={configured ? t('store.checkout') : t('store.checkoutPreview')} />}
      footer={
        p ? (
          <View style={{ gap: spacing.xs }}>
            {configured ? <Text variant="caption" color="textTertiary" align="center">{t('orders.payNote')}</Text> : null}
            <Button testID="place-order" label={footerLabel} disabled={!p.payment.canPlaceRealOrder || !formComplete} loading={place.isPending} icon="lock" onPress={submit} />
          </View>
        ) : null
      }
    >
      {preview.isPending ? (
        <LoadingScreen />
      ) : preview.error ? (
        <ErrorState message={t(errorKey(preview.error))} onRetry={() => void preview.refetch()} />
      ) : p ? (
        <>
          {p.payment.simulated ? <Notice tone="warning" icon="alert-triangle" title={t('store.simulatedTitle')} body={t('store.simulatedBody')} testID="simulated-notice" /> : null}
          {p.notices.includes('CONTAINS_SYNTHETIC_DEMO_ITEMS') ? <Notice tone="demo" body={t('store.demoProductNotice')} /> : null}
          <Section title={t('store.cart')}>
            <Card padded={false}>
              {p.lines.map((l, i) => (
                <View key={l.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, padding: spacing.lg, borderTopWidth: i ? 1 : 0, borderTopColor: colors.divider }}>
                  <View style={{ flex: 1 }}>
                    <Text variant="footnote" weight="semibold">{pickL(l, 'productName')}</Text>
                    <Text variant="caption" color="textTertiary">{pickL(l, 'variantLabel')} × {l.quantity}{l.forPatientName ? ` · ${l.forPatientName}` : ''}</Text>
                  </View>
                  <Text variant="footnote" weight="semibold" tabular>{money(l.lineTotalPiasters, locale)}</Text>
                </View>
              ))}
            </Card>
          </Section>

          <Section title={t('orders.deliveryTitle')}>
            <Card>
              <View style={{ gap: spacing.md }}>
                <Select testID="delivery-governorate" label={t('onboarding.governorate')} value={governorate} onChange={setGovernorate} options={GOVERNORATES.map((g) => ({ value: g, label: t(`governorate.${g}`) }))} />
                {notDelivered ? <Notice tone="info" body={t('orders.notDelivered')} testID="not-delivered" /> : null}
                <TextField testID="delivery-recipient" label={t('orders.recipient')} value={recipient} onChangeText={setRecipient} autoComplete="name" textContentType="name" maxLength={80} />
                <TextField testID="delivery-phone" label={t('orders.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" maxLength={20} />
                <TextField testID="delivery-city" label={t('orders.city')} value={city} onChangeText={setCity} maxLength={80} />
                <TextField testID="delivery-district" label={t('orders.district')} value={district} onChangeText={setDistrict} maxLength={80} optional />
                <TextField testID="delivery-address" label={t('orders.address')} value={address} onChangeText={setAddress} multiline maxLength={300} autoComplete="street-address" />
                <TextField testID="delivery-notes" label={t('orders.notes')} value={notes} onChangeText={setNotes} multiline maxLength={300} optional />
              </View>
            </Card>
          </Section>

          <Card>
            <View style={{ gap: spacing.sm }}>
              <TextField testID="discount-code" label={t('store.discountCode')} value={codeInput} onChangeText={(v) => setCodeInput(v.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={24} />
              <Button testID="apply-code" label={t('store.applyCode')} variant="secondary" size="sm" disabled={!codeInput.trim()} onPress={() => setCode(codeInput.trim())} />
              {p.discountCodeRejected ? <Notice tone="info" body={t('store.codeNotApplied')} testID="code-not-applied" /> : null}
            </View>
          </Card>
          <Card>
            <View style={{ gap: spacing.md }}>
              <Row label={t('store.subtotal')} value={money(p.subtotalPiasters, locale)} />
              {p.discount ? <Row label={`${t('store.discount')} · ${pickL(p.discount, 'name')}`} value={`− ${money(p.discount.amountPiasters, locale)}`} testID="checkout-discount" /> : null}
              <Row label={t('store.delivery')} value={p.deliveryFeePiasters === null ? t('store.deliveryTbd') : money(p.deliveryFeePiasters, locale)} muted testID="checkout-delivery" />
              <View style={{ height: 1, backgroundColor: colors.divider }} />
              <Row label={t('store.total')} value={money(p.totalPiasters, locale)} strong testID="checkout-total" />
            </View>
          </Card>
          {error ? <Notice tone="danger" body={error} testID="checkout-error" /> : null}
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="callout">{t('store.paymentStatus')}</Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
                <Text variant="footnote" weight="semibold">Paymob</Text>
                <Badge label={t(`status.${p.payment.status}`)} tone={configured ? 'success' : 'warning'} testID="payment-status" />
              </View>
            </View>
            {configured ? <Text variant="caption" color="textTertiary" style={{ marginTop: spacing.sm }}>{t('orders.paidOnlyAfter')}</Text> : null}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function Row({ label, value, strong, muted, testID }: { label: string; value: string; strong?: boolean; muted?: boolean; testID?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text variant={strong ? 'callout' : 'footnote'} weight={strong ? 'semibold' : 'regular'} color={muted ? 'textTertiary' : 'textSecondary'}>{label}</Text>
      <Text variant={strong ? 'title3' : 'footnote'} weight={strong ? 'bold' : 'medium'} tabular testID={testID}>{value}</Text>
    </View>
  );
}
