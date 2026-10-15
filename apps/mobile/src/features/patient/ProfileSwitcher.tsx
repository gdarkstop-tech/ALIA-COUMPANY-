import type { PatientSummary } from '@ghayarly/shared';
import { radii, spacing } from '@ghayarly/tokens';
import { useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Avatar, Icon, PressableScale, Text } from '@/ui';

export function relationshipLabel(t: ReturnType<typeof useI18n>['t'], p: PatientSummary) {
  return p.relationship === 'SELF' ? t('family.me') : t(`family.rel_${p.relationship}`);
}

/** Horizontal, thumb-friendly family profile switcher. */
export function ProfileSwitcher({ patients, activeId, onSelect }: { patients: PatientSummary[]; activeId: string | null; onSelect: (id: string) => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: 2 }} accessibilityLabel={t('family.switchProfile')}>
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: spacing.sm }}>
      {patients.map((p) => {
        const active = p.id === activeId;
        return (
          <PressableScale
            key={p.id}
            testID={`profile-chip-${p.relationship}`}
            accessibilityRole="tab"
            aria-selected={active}
            accessibilityLabel={`${p.displayName} — ${relationshipLabel(t, p)}`}
            onPress={() => onSelect(p.id)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              paddingStart: 6,
              paddingEnd: spacing.lg,
              minHeight: 48,
              borderRadius: radii.pill,
              backgroundColor: active ? colors.primary : colors.surface,
              borderWidth: 1,
              borderColor: active ? colors.primary : colors.border,
            }}
          >
            <Avatar name={p.displayName} size={36} />
            <View>
              <Text variant="footnote" weight="semibold" style={{ color: active ? colors.textOnPrimary : colors.text }} numberOfLines={1}>
                {p.relationship === 'SELF' ? t('family.me') : p.displayName}
              </Text>
              {p.relationship !== 'SELF' ? (
                <Text variant="micro" style={{ color: active ? colors.textOnPrimary : colors.textTertiary }}>
                  {relationshipLabel(t, p)}
                </Text>
              ) : null}
            </View>
          </PressableScale>
        );
      })}
      </View>
      {/* The add action is a plain button OUTSIDE the tablist (a tablist may only contain tabs). */}
      <PressableScale
        testID="profile-chip-add"
        accessibilityRole="button"
        accessibilityLabel={t('home.addFamily')}
        onPress={() => router.push('/patient/family-add')}
        style={{ width: 48, height: 48, borderRadius: radii.pill, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="plus" color="textSecondary" />
      </PressableScale>
    </ScrollView>
  );
}
