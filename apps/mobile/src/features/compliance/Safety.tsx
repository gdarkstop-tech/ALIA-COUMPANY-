import { EMERGENCY_NUMBERS } from '@ghayarly/shared';
import { radii, spacing } from '@ghayarly/tokens';
import { Linking, View } from 'react-native';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Icon, PressableScale, Text } from '@/ui';

/**
 * Emergency signposting shown wherever health information is entered or viewed. Uses the clinical
 * danger scale (never brand orange) and a real tel: link to Egypt's ambulance number.
 */
export function EmergencyNotice({ compact }: { compact?: boolean }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const number = EMERGENCY_NUMBERS.ambulance;
  return (
    <View testID="emergency-notice" accessibilityRole="summary" style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.dangerSoft, borderRadius: radii.lg, padding: compact ? spacing.md : spacing.lg }}>
      <Icon name="mci:ambulance" size={20} color="danger" />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="footnote" weight="semibold" color="danger">
          {t('safety.emergencyTitle')}
        </Text>
        {!compact ? (
          <Text variant="caption" color="textSecondary">
            {t('safety.emergencyBody', { number })}
          </Text>
        ) : null}
      </View>
      <PressableScale
        testID="call-emergency"
        accessibilityRole="button"
        accessibilityLabel={t('safety.callEmergency', { number })}
        onPress={() => void Linking.openURL(`tel:${number}`).catch(() => undefined)}
        style={{ minHeight: 44, minWidth: 44, paddingHorizontal: spacing.md, borderRadius: radii.pill, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}
      >
        <Icon name="phone" size={14} tint={colors.surface} />
        <Text variant="footnote" weight="bold" style={{ color: colors.surface }}>
          {number}
        </Text>
      </PressableScale>
    </View>
  );
}

/** Plain-language medical disclaimer (no diagnosis / treatment). */
export function MedicalDisclaimer() {
  const { t } = useI18n();
  return (
    <Text testID="medical-disclaimer" variant="caption" color="textTertiary" align="center">
      {t('safety.disclaimer')}
    </Text>
  );
}
