import { radii, spacing } from '@ghayarly/tokens';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Icon, PressableScale, Text } from '@/ui';

export function LanguageToggle() {
  const { locale, setLocale, t } = useI18n();
  const { colors } = useTheme();
  const next = locale === 'ar' ? 'en' : 'ar';
  return (
    <PressableScale
      testID="language-toggle"
      accessibilityRole="button"
      accessibilityLabel={t('common.language')}
      onPress={() => setLocale(next)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, minHeight: 36, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}
    >
      <Icon name="globe" size={14} color="textSecondary" />
      <Text variant="footnote" weight="semibold" color="textSecondary">
        {next === 'ar' ? t('common.arabic') : t('common.english')}
      </Text>
    </PressableScale>
  );
}
