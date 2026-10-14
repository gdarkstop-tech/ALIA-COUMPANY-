import { radii, spacing } from '@ghayarly/tokens';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { verificationTone } from '@/features/provider/hooks';
import { availabilityTone } from '@/features/provider/ProviderCard';
import { api, errorKey } from '@/lib/api';
import { greetingKey, money } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useMe } from '@/providers/session';
import { useTheme } from '@/providers/theme';
import { Badge, Button, Card, EmptyState, ErrorState, Icon, LoadingScreen, Notice, Screen, Section, Text, type IconName, type Tone } from '@/ui';

function Placeholder({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  const { t } = useI18n();
  return (
    <Card>
      <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
        <Icon name={icon} color="textTertiary" />
        <View style={{ flex: 1 }}>
          <Text variant="callout" weight="semibold">{title}</Text>
          <Text variant="caption" color="textSecondary">{body}</Text>
        </View>
        <Badge label={t('app.comingNext')} />
      </View>
    </Card>
  );
}

export default function ClinicianToday() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const me = useMe();
  const dash = useQuery({ queryKey: ['dashboard', 'clinician'], queryFn: () => api.dashboard.clinician() });
  const d = dash.data;
  const isNurse = d?.providerType === 'NURSE';
  const name = me.data?.profile.displayName ?? '';

  return (
    <Screen testID="clinician-dashboard" refreshing={dash.isRefetching} onRefresh={() => void dash.refetch()}>
      <View style={{ paddingTop: spacing.lg, gap: 2 }}>
        <Text variant="footnote" color="textTertiary">{t(isNurse ? 'roles.NURSE' : 'roles.DOCTOR')}</Text>
        <Text variant="title2" testID="clinician-greeting">{t(greetingKey(), { name })}</Text>
      </View>
      {dash.isPending ? (
        <LoadingScreen />
      ) : dash.error ? (
        <ErrorState message={t(errorKey(dash.error))} onRetry={() => void dash.refetch()} />
      ) : d ? (
        <>
          <Animated.View entering={FadeInDown.duration(380)}>
            <Card tone={d.bookable ? 'primary' : 'surface'} onPress={() => router.push('/clinician/verification')} testID="verification-card">
              <View style={{ flexDirection: 'row', gap: spacing.lg, alignItems: 'center' }}>
                <View style={{ width: 48, height: 48, borderRadius: radii.lg, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={d.bookable ? 'mci:check-decagram' : 'mci:shield-search'} size={24} color={d.bookable ? 'primary' : 'info'} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text variant="callout" weight="semibold">{t('provider.verificationTitle')}</Text>
                  <Badge label={t(`provider.status_${d.verificationStatus as 'DRAFT'}`)} tone={verificationTone(d.verificationStatus) as Tone} testID="verification-status-badge" />
                  {!d.bookable ? <Text variant="caption" color="textSecondary">{t('provider.notBookableYet')}</Text> : null}
                </View>
                <Icon name="chevron-right" color="textTertiary" />
              </View>
            </Card>
          </Animated.View>

          {!d.mfaEnrolled ? <Notice tone="warning" icon="lock" body={t('provider.mfaWarning')} /> : null}

          <Animated.View entering={FadeInDown.delay(60).duration(380)}>
            <Card onPress={() => router.push('/clinician/availability')}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ gap: 4 }}>
                  <Text variant="caption" color="textTertiary">{t('availability.status')}</Text>
                  <Badge label={t(`availability.${d.availabilityStatus as 'AWAY'}`)} tone={availabilityTone(d.availabilityStatus, true)} testID="dashboard-availability" />
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Text variant="caption" color="textTertiary">{t('provider.workingDays', { count: d.workingDays })}</Text>
                  {isNurse ? <Text variant="caption" color="textTertiary">{t('provider.servicesCount', { count: d.serviceCount })}</Text> : null}
                </View>
              </View>
            </Card>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(120).duration(380)}>
            <Card tone="navy" onPress={() => router.push('/clinician/earnings')} testID="earnings-card">
              <View style={{ gap: spacing.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text variant="callout" weight="semibold">{t('provider.netEarnings')}</Text>
                  {d.earnings.containsDemoData ? <Badge label={t('app.demoData')} tone="demo" /> : null}
                </View>
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                  {[
                    [t('provider.youEarnedToday'), d.earnings.todayNetPiasters],
                    [t('provider.thisWeek'), d.earnings.weekNetPiasters],
                    [t('provider.availableForPayout'), d.earnings.availableForPayoutPiasters],
                  ].map(([label, v]) => (
                    <View key={label as string} style={{ flex: 1, gap: 2 }}>
                      <Text variant="micro" color="textTertiary">{label as string}</Text>
                      <Text variant="callout" weight="bold" tabular>{money(v as number, locale)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </Card>
          </Animated.View>

          <Section title={isNurse ? t('provider.nextPatient') : t('provider.dashboardTitle')}>
            <Card>
              <EmptyState compact icon="calendar" title={isNurse ? t('provider.visitsEmpty') : t('provider.appointmentsEmpty')} body={t('app.comingNext')} />
            </Card>
          </Section>
          <Placeholder icon="mci:account-multiple-outline" title={t('provider.patientsTitle')} body={t('provider.patientsEmpty')} />
          <Placeholder icon="message-circle" title={t('provider.messagesTitle')} body={t('provider.messagesEmpty')} />
          <Placeholder icon="mci:clipboard-check-outline" title={t('provider.tasksTitle')} body={t('provider.patientsEmpty')} />
          {isNurse ? <Placeholder icon="award" title={t('provider.loyaltyTitle')} body={t('provider.loyaltyEmpty')} /> : null}
          <Placeholder icon="mci:creation-outline" title={t('home.aiTitle')} body={t('status.NOT_CONFIGURED')} />
          {!d.bookable ? <Button label={t('provider.verificationTitle')} variant="soft" icon="shield" onPress={() => router.push('/clinician/verification')} /> : null}
        </>
      ) : null}
    </Screen>
  );
}
