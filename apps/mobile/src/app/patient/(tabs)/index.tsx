import { radii, spacing } from '@ghayarly/tokens';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useAssistantStatus, useVoiceStatus } from '@/features/assistant/hooks';
import { voiceSupported } from '@/features/assistant/voice/audio';
import { useActivePatient } from '@/features/patient/hooks';
import { ProfileSwitcher, relationshipLabel } from '@/features/patient/ProfileSwitcher';
import { MiniProviderCard } from '@/features/provider/ProviderCard';
import { api, errorKey } from '@/lib/api';
import { greetingKey, money } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useMe } from '@/providers/session';
import { useTheme } from '@/providers/theme';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Icon, ListRow, LoadingScreen, PressableScale, Screen, Section, TetraSolLogo, Text } from '@/ui';

function Fade({ i, children }: { i: number; children: React.ReactNode }) {
  return <Animated.View entering={FadeInDown.delay(60 * i).duration(380)}>{children}</Animated.View>;
}

export default function PatientHome() {
  const { t, pickL, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const me = useMe();
  const { data: patients, active, setActive } = useActivePatient();
  const dash = useQuery({ queryKey: ['dashboard', 'patient', active?.id], queryFn: () => api.dashboard.patient(active?.id), enabled: Boolean(active) });
  const assistant = useAssistantStatus();
  const voice = useVoiceStatus(voiceSupported());
  // undefined while loading; null = available. Opening is allowed whenever the server could serve it after consent.
  const assistantReason = assistant.data ? assistant.data.unavailableReason : undefined;
  const voiceReason = voice.data ? voice.data.unavailableReason : undefined;
  // Text chat or (in builds that ship it) voice: either is reason enough to open the assistant.
  const assistantOpenable = assistantReason === null || assistantReason === 'CONSENT_REQUIRED' || voiceReason === null || voiceReason === 'VOICE_CONSENT_REQUIRED';

  const firstName = (me.data?.profile.displayName ?? '').split(' ')[0] ?? '';
  const d = dash.data;

  return (
    <Screen testID="patient-home" refreshing={dash.isRefetching} onRefresh={() => void dash.refetch()}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.lg }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="footnote" color="textTertiary">
            {new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}
          </Text>
          <Text variant="title2" testID="home-greeting">
            {t(greetingKey(), { name: firstName })}
          </Text>
        </View>
        <PressableScale accessibilityRole="button" accessibilityLabel={t('nav.me')} onPress={() => router.push('/patient/me')}>
          <Avatar name={me.data?.profile.displayName ?? '?'} size={44} />
        </PressableScale>
      </View>

      {patients && patients.length ? <ProfileSwitcher patients={patients} activeId={active?.id ?? null} onSelect={setActive} /> : null}

      {dash.isPending ? (
        <LoadingScreen />
      ) : dash.error ? (
        <ErrorState message={t(errorKey(dash.error))} onRetry={() => void dash.refetch()} />
      ) : d ? (
        <>
          {d.activePatient.relationship !== 'SELF' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }} testID="viewing-profile">
              <Icon name="eye" size={14} color="primary" />
              <Text variant="footnote" weight="semibold" color="primary">
                {t('home.viewingProfile', { name: d.activePatient.displayName })} · {relationshipLabel(t, d.activePatient)}
              </Text>
            </View>
          ) : null}

          <Fade i={0}>
            <Card tone="navy">
              <View style={{ gap: spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text variant="title3">{t('home.todayTitle')}</Text>
                  <Icon name="sun" color="navy" />
                </View>
                <Text variant="callout" color="textSecondary">
                  {t('home.todayEmpty')}
                </Text>
                {/* Wraps on narrow phones and at large Dynamic Type sizes instead of clipping. */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  <Button label={t('home.findDoctor')} icon="mci:stethoscope" size="md" fullWidth={false} onPress={() => router.push('/patient/care')} />
                  <Button label={t('home.requestNurse')} icon="mci:medical-bag" size="md" variant="secondary" fullWidth={false} onPress={() => router.push({ pathname: '/patient/care', params: { type: 'NURSE' } })} />
                </View>
              </View>
            </Card>
          </Fade>

          <Fade i={1}>
            <Card onPress={() => router.push('/patient/health')} testID="home-snapshot">
              <View style={{ gap: spacing.lg }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text variant="title3">{t('home.snapshotTitle')}</Text>
                  <Icon name="chevron-right" color="textTertiary" />
                </View>
                <View style={{ gap: spacing.xs }}>
                  <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.surfaceSunken, overflow: 'hidden' }}>
                    <View style={{ width: `${d.healthSnapshot.profileCompleteness}%`, height: 8, borderRadius: 4, backgroundColor: colors.primary }} />
                  </View>
                  <Text variant="caption" color="textSecondary">
                    {t('home.profileComplete', { percent: d.healthSnapshot.profileCompleteness })}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  {(
                    [
                      ['health.allergies', d.healthSnapshot.allergies, 'mci:allergy'],
                      ['health.conditions', d.healthSnapshot.conditions, 'mci:heart-pulse'],
                      ['health.medications', d.healthSnapshot.medications, 'mci:pill'],
                      ['health.surgeries', d.healthSnapshot.surgeries, 'mci:bandage'],
                    ] as const
                  ).map(([key, n, icon]) => (
                    <View key={key} style={{ flex: 1, backgroundColor: colors.surfaceMuted, borderRadius: radii.md, padding: spacing.md, gap: 4, alignItems: 'center' }}>
                      <Icon name={icon} size={18} color="primary" />
                      <Text variant="title3" tabular>
                        {new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG').format(n)}
                      </Text>
                      <Text variant="micro" color="textTertiary" align="center" numberOfLines={2}>
                        {t(key)}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            </Card>
          </Fade>

          <Fade i={2}>
            <Section title={t('home.familyTitle')} action={<Button label={t('home.addFamily')} variant="ghost" size="sm" fullWidth={false} icon="user-plus" onPress={() => router.push('/patient/family-add')} />}>
              {d.family.length ? (
                <Card padded={false}>
                  <View style={{ paddingHorizontal: spacing.lg }}>
                    {d.family.map((f, idx) => (
                      <View key={f.patient.id} style={{ borderTopWidth: idx ? 1 : 0, borderTopColor: colors.divider }}>
                        <ListRow
                          testID={`family-row-${f.patient.relationship}`}
                          leading={<Avatar name={f.patient.displayName} size={40} />}
                          title={f.patient.relationship === 'SELF' ? t('family.me') : f.patient.displayName}
                          subtitle={`${relationshipLabel(t, f.patient)} — ${f.highlights.map((h) => t(h.key as 'home.highlightReady', h.params)).join(' · ')}`}
                          onPress={() => setActive(f.patient.id)}
                        />
                      </View>
                    ))}
                  </View>
                </Card>
              ) : (
                <Card>
                  <EmptyState compact icon="users" title={t('home.familyTitle')} body={t('home.familyEmpty')} actionLabel={t('home.addFamily')} onAction={() => router.push('/patient/family-add')} />
                </Card>
              )}
            </Section>
          </Fade>

          <Fade i={3}>
            <Section title={t('home.careTeamTitle')}>
              <Card>
                <EmptyState compact icon="mci:account-group-outline" title={t('home.careTeamTitle')} body={t('home.careTeamEmpty')} />
              </Card>
            </Section>
          </Fade>

          <Fade i={4}>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <Card style={{ flex: 1 }}>
                <View style={{ gap: spacing.sm }}>
                  <Icon name="mci:pill" color="primary" />
                  <Text variant="callout" weight="semibold">
                    {t('home.medicationsTitle')}
                  </Text>
                  <Text variant="caption" color="textSecondary">
                    {t('home.medicationsActive', { count: d.medicationReminders.activeMedications })}
                  </Text>
                  <Badge label={t('app.comingNext')} tone="neutral" />
                </View>
              </Card>
              <Card style={{ flex: 1 }} tone="accent" onPress={assistantOpenable ? () => router.push('/patient/assistant') : undefined} testID="home-assistant">
                <View style={{ gap: spacing.sm }}>
                  <Icon name="mci:creation-outline" color="accentText" />
                  <Text variant="callout" weight="semibold">
                    {d.aiAssistant.assistantName ?? t('home.aiTitle')}
                  </Text>
                  <Text variant="caption" color="textSecondary" numberOfLines={4}>
                    {assistantReason === null ? t('home.aiAvailable') : assistantReason === 'CONSENT_REQUIRED' ? t('home.aiConsentNeeded') : t('home.aiNotConfigured')}
                  </Text>
                  {assistantOpenable ? <Badge label={t('home.aiOpen')} tone="accent" icon="chevron-right" /> : <Badge label={t('app.notConfigured')} tone="accent" />}
                </View>
              </Card>
            </View>
          </Fade>

          <Fade i={5}>
            <Card tone="primary" onPress={() => router.push('/patient/store')} testID="home-tetrasol">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
                <TetraSolLogo height={22} plate testID="home-tetrasol-logo" />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="title3">{t('home.tetrasolTitle')}</Text>
                  <Text variant="footnote" color="textSecondary">
                    {t('home.tetrasolBody')}
                  </Text>
                  {d.tetrasol.featured[0] ? (
                    <Text variant="caption" color="primarySoftText">
                      {pickL(d.tetrasol.featured[0], 'name')} · {money(d.tetrasol.featured[0].fromPricePiasters, locale)}
                    </Text>
                  ) : null}
                </View>
                <Icon name="chevron-right" color="primary" />
              </View>
            </Card>
          </Fade>

          {d.suggestedProviders.length ? (
            <Fade i={6}>
              <Section title={t('home.suggestedTitle')} action={<Button label={t('common.seeAll')} variant="ghost" size="sm" fullWidth={false} onPress={() => router.push('/patient/care')} />}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, paddingVertical: 4 }}>
                  {d.suggestedProviders.map((p) => (
                    <MiniProviderCard key={p.userId} p={p} onPress={() => router.push({ pathname: '/patient/provider/[id]', params: { id: p.userId } })} />
                  ))}
                </ScrollView>
              </Section>
            </Fade>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
