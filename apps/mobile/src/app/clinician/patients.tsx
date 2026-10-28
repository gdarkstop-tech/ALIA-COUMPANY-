import { spacing } from '@ghayarly/tokens';
import { useRouter, type Href } from 'expo-router';
import { View } from 'react-native';
import { useSharedPatients } from '@/features/clinician/hooks';
import { errorKey } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Avatar, Badge, Card, ErrorState, Header, Icon, LoadingScreen, PressableScale, Screen, Text } from '@/ui';

/** Records patients shared with this clinician (read-only, for as long as they choose). */
export default function SharedPatients() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const q = useSharedPatients();
  return (
    <Screen testID="clinician-patients" header={<Header back title={t('copilot.patientsTitle')} subtitle={t('copilot.patientsSubtitle')} />} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      {q.isPending ? (
        <LoadingScreen />
      ) : q.error ? (
        <ErrorState message={t(errorKey(q.error))} onRetry={() => void q.refetch()} />
      ) : !q.data.length ? (
        <Card>
          <Text variant="footnote" color="textTertiary">{t('copilot.patientsEmpty')}</Text>
        </Card>
      ) : (
        <Card padded={false}>
          {q.data.map((p, i) => (
            <PressableScale key={p.patientId} testID={`clinician-patient-${p.displayName}`} accessibilityRole="button" accessibilityLabel={p.displayName} onPress={() => router.push(`/clinician/patient/${p.patientId}` as Href)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderTopWidth: i ? 1 : 0, borderTopColor: colors.divider }}>
              <Avatar name={p.displayName} size={44} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text variant="callout" weight="semibold">{p.displayName}</Text>
                <Text variant="caption" color="textSecondary">{t('copilot.years', { count: p.ageYears })} · {t(`sex.${p.sex}`)} · {t('copilot.sharedUntil', { date: formatDate(p.expiresAt, locale) })}</Text>
                {p.aiAllowed ? <Badge label={t('copilot.aiAllowed')} tone="accent" icon="mci:creation" /> : null}
              </View>
              <Icon name="chevron-right" color="textTertiary" />
            </PressableScale>
          ))}
        </Card>
      )}
    </Screen>
  );
}
