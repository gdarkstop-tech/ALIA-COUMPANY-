import { listSeparator } from '@ghayarly/i18n';
import type { ProviderCard as Card } from '@ghayarly/shared';
import { radii, spacing } from '@ghayarly/tokens';
import { View } from 'react-native';
import { money } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Avatar, Badge, Card as Surface, Icon, Text, type Tone } from '@/ui';

export function availabilityTone(status: string, accepting: boolean): Tone {
  if (status === 'FULLY_BOOKED') return 'warning';
  if (status === 'AWAY') return 'neutral';
  if (status === 'EXISTING_PATIENTS_ONLY') return 'info';
  return accepting ? 'success' : 'neutral';
}

export function ProviderCardView({ p, onPress }: { p: Card; onPress: () => void }) {
  const { t, pickL, locale } = useI18n();
  const { colors } = useTheme();
  const name = pickL(p, 'displayName');
  return (
    <Surface onPress={onPress} testID={`provider-card-${p.userId}`} accessibilityLabel={name}>
      <View style={{ flexDirection: 'row', gap: spacing.lg }}>
        <Avatar name={name} size={56} />
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' }}>
            <Text variant="callout" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
              {name}
            </Text>
            <Icon name="mci:check-decagram" size={16} color="primary" />
          </View>
          <Text variant="footnote" color="textSecondary" numberOfLines={1}>
            {p.specialty ? t(`specialty.${p.specialty as 'GENERAL_SURGERY'}`) : t('roles.NURSE')} · {t('common.years', { count: p.yearsExperience })}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="map-pin" size={12} color="textTertiary" />
            <Text variant="caption" color="textTertiary" numberOfLines={1}>
              {p.city}{listSeparator(locale)}{t(`governorate.${p.governorate}`)}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
            <Badge label={t(`availability.${p.availabilityStatus as 'AWAY'}`)} tone={availabilityTone(p.availabilityStatus, p.acceptingNewPatients)} />
            {p.isDemo ? <Badge label={t('app.demoBadge')} tone="demo" icon="mci:flask-outline" /> : null}
          </View>
        </View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider }}>
        <Text variant="caption" color="textTertiary">
          {p.completedVisits > 0 ? t('care.completedVisits', { count: p.completedVisits }) : t('care.newOnPlatform')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
          <Text variant="callout" weight="semibold" tabular>
            {money(p.feePiasters, locale)}
          </Text>
          <Text variant="caption" color="textTertiary">
            {p.providerType === 'DOCTOR' ? t('common.perConsultation') : t('common.perVisit')}
          </Text>
        </View>
      </View>
    </Surface>
  );
}

export function MiniProviderCard({ p, onPress }: { p: Card; onPress: () => void }) {
  const { t, pickL } = useI18n();
  const { colors } = useTheme();
  const name = pickL(p, 'displayName');
  return (
    <Surface onPress={onPress} style={{ width: 200, gap: spacing.sm, padding: spacing.lg }} testID={`mini-provider-${p.userId}`}>
      <Avatar name={name} size={44} />
      <Text variant="footnote" weight="semibold" numberOfLines={1}>
        {name}
      </Text>
      <Text variant="caption" color="textSecondary" numberOfLines={1}>
        {p.specialty ? t(`specialty.${p.specialty as 'GENERAL_SURGERY'}`) : t('roles.NURSE')}
      </Text>
      <View style={{ height: 6, flexDirection: 'row', gap: 4, alignItems: 'center' }}>
        <View style={{ width: 6, height: 6, borderRadius: radii.pill, backgroundColor: p.acceptingNewPatients ? colors.success : colors.warning }} />
        <Text variant="micro" color="textTertiary">
          {t(`availability.${p.availabilityStatus as 'AWAY'}`)}
        </Text>
      </View>
    </Surface>
  );
}
