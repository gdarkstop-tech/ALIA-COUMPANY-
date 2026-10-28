import type { AiProductCard } from '@ghayarly/shared';
import { spacing } from '@ghayarly/tokens';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { useI18n } from '@/providers/i18n';
import { Badge, Button, Card, Text } from '@/ui';

/**
 * Approved company-product information next to an answer that cited it. The server decides what
 * may appear (approved keyword and indication, product on sale, no warning signs); the text here is
 * the clinically approved statement, never the model's words.
 */
export function ProductCard({ p }: { p: AiProductCard }) {
  const { t, pickL } = useI18n();
  const router = useRouter();
  const warnings = pickL(p, 'warnings');
  return (
    <Card style={{ gap: spacing.sm }} testID={`assistant-product-${p.label}`}>
      <Badge tone="accent" icon="mci:tag-outline" label={t('assistant.productInfo')} />
      <Text variant="callout" weight="semibold">[{p.label}] {pickL(p, 'name')}</Text>
      {p.indication ? (
        <View style={{ gap: 2 }}>
          <Text variant="caption" weight="semibold" color="textSecondary">{t('assistant.productApprovedUse')}</Text>
          <Text variant="footnote" testID={`assistant-product-${p.label}-use`}>{pickL(p.indication, 'title')} — {pickL(p.indication, 'body')}</Text>
        </View>
      ) : null}
      {warnings ? (
        <View style={{ gap: 2 }}>
          <Text variant="caption" weight="semibold" color="textSecondary">{t('assistant.productWarnings')}</Text>
          <Text variant="footnote">{warnings}</Text>
        </View>
      ) : null}
      <Text variant="caption" color="textSecondary">{t('assistant.productNote')}</Text>
      <Button testID={`assistant-product-${p.label}-open`} label={t('assistant.viewProduct')} variant="secondary" size="sm" fullWidth={false} icon="shopping-bag" onPress={() => router.push({ pathname: '/patient/product/[slug]', params: { slug: p.slug } })} />
    </Card>
  );
}
