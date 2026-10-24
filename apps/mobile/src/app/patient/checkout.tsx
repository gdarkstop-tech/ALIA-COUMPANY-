import { spacing } from '@ghayarly/tokens';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { api, errorKey } from '@/lib/api';
import { money } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Badge, Button, Card, ErrorState, Header, LoadingScreen, Notice, Screen, Section, Text, TextField } from '@/ui';

/** Server-calculated checkout preview. Never places an order or charges a card until payments are configured and verified. */
export default function Checkout() {
  const { t, pickL, locale } = useI18n();
  const { colors } = useTheme();
  const [codeInput, setCodeInput] = useState('');
  const [code, setCode] = useState('');
  // Discounts are always computed by the server from current prices; the app only sends the code.
  const preview = useQuery({ queryKey: ['checkout-preview', code], queryFn: () => api.store.checkoutPreview(code ? { discountCode: code } : {}), staleTime: 0 });
  const p = preview.data;
  return (
    <Screen
      testID="checkout-screen"
      header={<Header back title={t('store.checkoutPreview')} />}
      footer={p ? <Button testID="place-order" label={p.payment.canPlaceRealOrder ? t('store.checkout') : t('store.placeOrderDisabled')} disabled={!p.payment.canPlaceRealOrder} icon="lock" /> : null}
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
              <Row label={t('store.delivery')} value={p.deliveryFeePiasters === null ? t('store.deliveryTbd') : money(p.deliveryFeePiasters, locale)} muted />
              <View style={{ height: 1, backgroundColor: colors.divider }} />
              <Row label={t('store.total')} value={money(p.totalPiasters, locale)} strong testID="checkout-total" />
            </View>
          </Card>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="callout">{t('store.paymentStatus')}</Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
                <Text variant="footnote" weight="semibold">Paymob</Text>
                <Badge label={t(`status.${p.payment.status}`)} tone={p.payment.status === 'CONFIGURED' ? 'success' : 'warning'} testID="payment-status" />
              </View>
            </View>
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
