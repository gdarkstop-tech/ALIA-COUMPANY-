import { PRODUCT_KNOWLEDGE_KINDS } from '@ghayarly/shared';
import { radii, spacing } from '@ghayarly/tokens';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { usePatients } from '@/features/patient/hooks';
import { relationshipLabel } from '@/features/patient/ProfileSwitcher';
import { stockTone } from '@/features/store/hooks';
import { ProductVisual } from '@/features/store/ProductVisual';
import { api, errorKey } from '@/lib/api';
import { formatDate, money } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Badge, Button, Card, ErrorState, Header, Icon, LoadingScreen, Notice, PressableScale, Screen, Section, Select, Text, useToast } from '@/ui';

export default function ProductDetail() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { t, pickL, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const product = useQuery({ queryKey: ['product', slug], queryFn: () => api.store.product(slug) });
  const patients = usePatients();
  const [variantId, setVariantId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [forPatient, setForPatient] = useState<string>('ME');

  useEffect(() => {
    if (product.data && !variantId) setVariantId(product.data.variants.find((v) => v.stockStatus !== 'OUT_OF_STOCK')?.id ?? product.data.variants[0]?.id ?? null);
  }, [product.data, variantId]);

  const add = useMutation({
    mutationFn: () => api.store.addToCart({ variantId: variantId!, quantity: qty, forPatientId: forPatient === 'ME' ? null : forPatient }),
    onSuccess: async (cart) => {
      qc.setQueryData(['cart'], cart);
      toast(t('store.added'));
    },
  });

  if (product.isPending) return <Screen header={<Header back title="" large={false} />}><LoadingScreen /></Screen>;
  if (product.error) return <Screen header={<Header back title="" large={false} />}><ErrorState message={t(errorKey(product.error))} onRetry={() => void product.refetch()} /></Screen>;
  const p = product.data;
  const variant = p.variants.find((v) => v.id === variantId);
  const outOfStock = variant?.stockStatus === 'OUT_OF_STOCK';

  return (
    <Screen
      testID="product-detail"
      header={<Header back title="" large={false} right={<Button label={t('store.cart')} variant="ghost" size="sm" fullWidth={false} icon="shopping-cart" onPress={() => router.push('/patient/cart')} />} />}
      footer={
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Button testID="add-to-cart" label={t('store.addToCart')} variant="secondary" icon="shopping-cart" disabled={!variant || outOfStock} loading={add.isPending} onPress={() => add.mutate()} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              testID="buy-now"
              label={t('store.buyNow')}
              disabled={!variant || outOfStock}
              onPress={async () => {
                await add.mutateAsync();
                router.push('/patient/checkout');
              }}
            />
          </View>
        </View>
      }
    >
      <ProductVisual height={200} demo={p.isDemo} imageId={p.images[0]?.id} alt={p.images[0] ? pickL(p.images[0], 'alt') || t('store.productImage') : undefined} />
      <View style={{ gap: spacing.sm }}>
        <Text variant="title2" testID="product-name">{pickL(p, 'name')}</Text>
        <Text variant="callout" color="textSecondary">{pickL(p, 'summary')}</Text>
        <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
          {variant ? <Badge label={t(`store.stock_${variant.stockStatus}`)} tone={stockTone(variant.stockStatus)} /> : null}
          {p.isDemo ? <Badge label={t('app.demoData')} tone="demo" icon="mci:flask-outline" /> : null}
        </View>
      </View>
      {p.isDemo ? <Notice tone="demo" title={t('app.demoData')} body={t('store.demoProductNotice')} testID="product-demo-notice" /> : null}
      {add.error ? <Notice tone="danger" body={t(errorKey(add.error))} /> : null}

      <Section title={t('store.variants')}>
        <View style={{ gap: spacing.sm }}>
          {p.variants.map((v) => {
            const selected = v.id === variantId;
            return (
              <PressableScale key={v.id} testID={`variant-${v.sku}`} accessibilityRole="radio" aria-checked={selected} onPress={() => setVariantId(v.id)} scaleTo={0.99}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radii.lg, borderWidth: selected ? 2 : 1, borderColor: selected ? colors.accent : colors.border, backgroundColor: selected ? colors.accentSoft : colors.surface }}>
                <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: selected ? colors.accent : colors.borderStrong, alignItems: 'center', justifyContent: 'center' }}>
                  {selected ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent }} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="callout" weight="medium">{pickL(v, 'label')}</Text>
                  <Text variant="caption" color="textTertiary">{t(`store.stock_${v.stockStatus}`)}</Text>
                </View>
                <Text variant="callout" weight="semibold" tabular>{money(v.pricePiasters, locale)}</Text>
              </PressableScale>
            );
          })}
        </View>
      </Section>

      <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-end' }}>
        <View style={{ gap: spacing.xs }}>
          <Text variant="footnote" weight="semibold" color="textSecondary">{t('store.quantity')}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, paddingHorizontal: spacing.sm, minHeight: 52 }}>
            <PressableScale accessibilityRole="button" accessibilityLabel="-" onPress={() => setQty((q) => Math.max(1, q - 1))} style={{ padding: spacing.sm }}><Icon name="minus" /></PressableScale>
            <Text variant="callout" weight="semibold" tabular testID="qty-value">{qty}</Text>
            <PressableScale accessibilityRole="button" accessibilityLabel="+" onPress={() => setQty((q) => Math.min(20, q + 1))} style={{ padding: spacing.sm }}><Icon name="plus" /></PressableScale>
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <Select
            label={t('store.forWhom')}
            value={forPatient}
            onChange={setForPatient}
            options={[{ value: 'ME', label: t('family.me') }, ...(patients.data ?? []).filter((x) => x.relationship !== 'SELF').map((x) => ({ value: x.id, label: `${x.displayName} · ${relationshipLabel(t, x)}` }))]}
          />
        </View>
      </View>

      <Section title={t('store.approvedInfo')}>
        <Card><Text variant="callout" color="textSecondary">{pickL(p, 'description')}</Text></Card>
      </Section>
      {pickL(p, 'approvedUses') ? (
        <Section title={t('store.approvedUses')}>
          <Card testID="product-approved-uses"><Text variant="callout" color="textSecondary">{pickL(p, 'approvedUses')}</Text></Card>
        </Section>
      ) : null}
      <Section title={t('store.usage')}>
        <Card><Text variant="callout" color="textSecondary">{pickL(p, 'usage')}</Text></Card>
      </Section>
      {pickL(p, 'warnings') ? <Notice tone="warning" icon="alert-triangle" title={t('store.warnings')} body={pickL(p, 'warnings')} testID="product-warnings" /> : null}
      {PRODUCT_KNOWLEDGE_KINDS.map((kind) => {
        const items = p.knowledge.filter((k) => k.kind === kind);
        return items.length ? (
          <Section key={kind} title={t(`store.knowledge_${kind}`)} testID={`product-knowledge-${kind}`}>
            <Card padded={false}>
              {items.map((k, i) => (
                <View key={k.versionId} style={{ padding: spacing.lg, gap: spacing.xs, borderTopWidth: i ? 1 : 0, borderTopColor: colors.divider }}>
                  <Text variant="callout" weight="semibold">{pickL(k, 'title')}</Text>
                  <Text variant="callout" color="textSecondary">{pickL(k, 'body')}</Text>
                  <Text variant="caption" color="textTertiary">{t('store.knowledgeApproved', { version: k.version, date: formatDate(k.approvedAt, locale) })}</Text>
                </View>
              ))}
            </Card>
          </Section>
        ) : null;
      })}
      <Section title={t('store.regulatory')}>
        <Card>
          <Text variant="footnote" color="textSecondary">{p.approvalReference ?? t('store.noApprovalRef')}</Text>
          {p.regulatoryNote ? <Text variant="footnote" color="textSecondary">{p.regulatoryNote}</Text> : null}
        </Card>
      </Section>
      <Notice tone="info" icon="mci:stethoscope" body={t('store.clinicianNote')} />
    </Screen>
  );
}
