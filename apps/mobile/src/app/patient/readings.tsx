import { spacing } from '@ghayarly/tokens';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useConsents } from '@/features/compliance/hooks';
import { EmergencyNotice, MedicalDisclaimer } from '@/features/compliance/Safety';
import { useActivePatient } from '@/features/patient/hooks';
import { ProfileSwitcher } from '@/features/patient/ProfileSwitcher';
import { useAnalytics, useSummaries, useSummaryStatus, type Period } from '@/features/readings/hooks';
import { ReadingSheet } from '@/features/readings/ReadingSheet';
import { SeriesCard } from '@/features/readings/SeriesCard';
import { SummaryCard } from '@/features/readings/SummaryCard';
import { errorKey } from '@/lib/api';
import { useI18n } from '@/providers/i18n';
import { Badge, Button, Card, ErrorState, Header, Icon, LoadingScreen, Notice, Screen, Section, Segmented, Text, type Tone } from '@/ui';

const LEGEND: { key: 'MEASURED' | 'CALCULATED' | 'AI' | 'VERIFIED'; tone: Tone }[] = [
  { key: 'MEASURED', tone: 'neutral' },
  { key: 'CALCULATED', tone: 'primary' },
  { key: 'AI', tone: 'accent' },
  { key: 'VERIFIED', tone: 'success' },
];

/** Readings and confirmed lab results of the active profile: measured, calculated and AI kept apart. */
export default function Readings() {
  const { t } = useI18n();
  const router = useRouter();
  const { data: patients, active, setActive, isPending } = useActivePatient();
  const [days, setDays] = useState<Period>(90);
  const [adding, setAdding] = useState(false);
  const analytics = useAnalytics(active?.id, days);
  const status = useSummaryStatus();
  const summaries = useSummaries(active?.id);
  const consents = useConsents();

  if (isPending || !active) return <Screen><LoadingScreen /></Screen>;
  const healthOff = consents.data ? !consents.data.healthDataConsented : false;

  return (
    <Screen testID="readings" header={<Header back title={t('readings.title')} subtitle={t('readings.subtitle')} />} refreshing={analytics.isRefetching} onRefresh={() => void analytics.refetch()}>
      {patients ? <ProfileSwitcher patients={patients} activeId={active.id} onSelect={setActive} /> : null}
      {healthOff ? (
        <Notice tone="warning" title={t('privacy.healthData')} body={t('privacy.healthDataOff')}>
          <Button label={t('privacy.title')} variant="ghost" size="sm" fullWidth={false} onPress={() => router.push('/settings/privacy')} />
        </Notice>
      ) : (
        <Button testID="reading-add" label={t('readings.add')} icon="plus" onPress={() => setAdding(true)} />
      )}
      <EmergencyNotice />

      <Card style={{ gap: spacing.sm }} testID="readings-legend">
        <Text variant="footnote" weight="semibold">{t('readings.legendTitle')}</Text>
        {LEGEND.map((l) => (
          <View key={l.key} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
            <Badge label={t(`readings.badge_${l.key}`)} tone={l.tone} />
            <Text variant="caption" color="textSecondary" style={{ flex: 1 }}>{t(`readings.legend_${l.key}`)}</Text>
          </View>
        ))}
      </Card>

      <Segmented testID="readings-period" options={([30, 90, 365] as const).map((d) => ({ value: String(d), label: t(`readings.period_${d}`) }))} value={String(days)} onChange={(v) => setDays(Number(v) as Period)} />

      {analytics.isPending ? (
        <LoadingScreen />
      ) : analytics.error ? (
        <ErrorState message={t(errorKey(analytics.error))} onRetry={() => void analytics.refetch()} />
      ) : analytics.data.series.length === 0 ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Icon name="mci:chart-line-variant" color="textTertiary" />
            <Text variant="footnote" color="textTertiary" style={{ flex: 1 }}>{t('readings.empty')}</Text>
          </View>
        </Card>
      ) : (
        <Section>
          {analytics.data.series.map((s) => (
            <SeriesCard key={s.key} series={s} patientId={active.id} />
          ))}
        </Section>
      )}

      {status.data ? <SummaryCard patientId={active.id} days={days === 30 ? 30 : 90} status={status.data} latest={summaries.data?.[0] ?? null} /> : null}

      <MedicalDisclaimer />
      <ReadingSheet patientId={active.id} visible={adding} onClose={() => setAdding(false)} />
    </Screen>
  );
}
