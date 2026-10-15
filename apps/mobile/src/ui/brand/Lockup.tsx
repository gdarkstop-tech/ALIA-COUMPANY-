import { spacing, typography } from '@ghayarly/tokens';
import { View } from 'react-native';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Text } from '../Text';
import { BrandMark } from './BrandMark';
import { BrassRule } from './Ornaments';

/**
 * Brand hierarchy lockup: product name first (in the UI language), the other-language name
 * second, then the Alia Group endorsement. TetraSol never appears here — it is reserved for the
 * store section.
 */
export function Lockup({ inverse, compact, showMark = true }: { inverse?: boolean; compact?: boolean; showMark?: boolean }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const main = inverse ? colors.heroText : colors.text;
  return (
    <View style={{ alignItems: 'center', gap: compact ? spacing.sm : spacing.md }} accessibilityRole="header" accessibilityLabel={`${t('app.name')} — ${t('app.nameSecondary')}. ${t('app.endorsement')}`}>
      {showMark ? <BrandMark size={compact ? 56 : 76} /> : null}
      <View style={{ alignItems: 'center', gap: 2 }}>
        <Text variant={compact ? 'title1' : 'display'} align="center" style={{ color: main }}>
          {t('app.name')}
        </Text>
        <Text variant="callout" weight="medium" align="center" style={{ color: inverse ? colors.heroText : colors.textSecondary, opacity: 0.85 }}>
          {t('app.nameSecondary')}
        </Text>
      </View>
      <BrassRule width={compact ? 96 : 132} color={inverse ? colors.ornament : colors.brass} />
      <Text variant="micro" weight="semibold" align="center" style={{ color: inverse ? colors.ornament : colors.brass, letterSpacing: typography.letterSpacing.eyebrow, textTransform: 'uppercase' }}>
        {t('app.endorsement')}
      </Text>
    </View>
  );
}
