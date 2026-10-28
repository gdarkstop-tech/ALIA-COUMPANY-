import { brandConfig, spacing, typography } from '@ghayarly/tokens';
import { View } from 'react-native';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Text } from '../Text';
import { Wordmark } from './BrandMark';
import { BrassRule } from './Ornaments';

/**
 * Brand hierarchy lockup: the official Dress My Wound wordmark (tagline-free), the Arabic name
 * غير لي set as live text (never inside the artwork — larger when the app is in Arabic), then the
 * Alia Group endorsement. TetraSol never appears here — it is reserved for the store section.
 */
export function Lockup({ inverse, compact, showMark = true }: { inverse?: boolean; compact?: boolean; showMark?: boolean }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const main = inverse ? colors.heroText : colors.text;
  return (
    <View style={{ alignItems: 'center', gap: compact ? spacing.sm : spacing.md }} accessibilityRole="header" accessibilityLabel={`${t('app.name')} — ${t('app.nameSecondary')}. ${t('app.endorsement')}`}>
      {showMark ? (
        <Wordmark width={compact ? 224 : 268} inverse={inverse} />
      ) : (
        <Text variant={compact ? 'title1' : 'display'} align="center" style={{ color: main }}>
          {brandConfig.product.nameEn}
        </Text>
      )}
      <Text variant={locale === 'ar' ? (compact ? 'title2' : 'title1') : 'callout'} weight={locale === 'ar' ? 'semibold' : 'medium'} align="center" style={{ color: locale === 'ar' ? main : inverse ? colors.heroText : colors.textSecondary, opacity: locale === 'ar' ? 1 : 0.85 }}>
        {brandConfig.product.nameAr}
      </Text>
      <BrassRule width={compact ? 96 : 132} color={inverse ? colors.ornament : colors.brass} />
      <Text variant="micro" weight="semibold" align="center" style={{ color: inverse ? colors.ornament : colors.brass, letterSpacing: typography.letterSpacing.eyebrow, textTransform: 'uppercase' }}>
        {t('app.endorsement')}
      </Text>
    </View>
  );
}
