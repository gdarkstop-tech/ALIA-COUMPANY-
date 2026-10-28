import { spacing } from '@ghayarly/tokens';
import { useMutation } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { MedicalDisclaimer } from '@/features/compliance/Safety';
import { useActivePatient } from '@/features/patient/hooks';
import { ProfileSwitcher } from '@/features/patient/ProfileSwitcher';
import { useInvalidateWounds, useWoundPermissions, useWoundPresentations, useWounds, woundErrorKey } from '@/features/wounds/hooks';
import { ConsentText } from '@/features/wounds/Permissions';
import { NewWoundSheet } from '@/features/wounds/Sheets';
import { api, errorKey } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Badge, Button, Card, ErrorState, Header, Icon, LoadingScreen, Notice, PressableScale, Screen, Section, Text } from '@/ui';

/** Wounds of the active profile: the scanning permission first, then cases with their next follow-up. */
export default function Wounds() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const invalidate = useInvalidateWounds();
  const { data: patients, active, setActive, isPending } = useActivePatient();
  const perms = useWoundPermissions(active?.id);
  const wounds = useWounds(active?.id);
  const requests = useWoundPresentations(active?.id);
  const [adding, setAdding] = useState(false);
  const allowScan = useMutation({
    mutationFn: () => api.wounds.decide(active!.id, { purpose: 'SCAN', action: 'GRANT', version: perms.data!.consents.find((c) => c.purpose === 'SCAN')!.currentVersion }),
    onSuccess: () => invalidate(),
  });

  if (isPending || !active) return <Screen><LoadingScreen /></Screen>;
  const scan = perms.data?.consents.find((c) => c.purpose === 'SCAN');
  const pending = requests.data?.filter((r) => r.status === 'AWAITING_PATIENT').length ?? 0;

  return (
    <Screen testID="wounds" header={<Header back title={t('wounds.title')} subtitle={t('wounds.subtitle')} />} refreshing={wounds.isRefetching} onRefresh={() => void Promise.all([perms.refetch(), wounds.refetch(), requests.refetch()])}>
      {patients ? <ProfileSwitcher patients={patients} activeId={active.id} onSelect={setActive} /> : null}
      {perms.isPending ? (
        <LoadingScreen />
      ) : perms.error ? (
        <ErrorState message={t(errorKey(perms.error))} onRetry={() => void perms.refetch()} />
      ) : !perms.data.available ? (
        <Notice tone="info" testID="wounds-unavailable" title={t('wounds.unavailable')} body={t('wounds.unavailableBody')} />
      ) : !scan?.active ? (
        <Card style={{ gap: spacing.md }} testID="wound-scan-intro">
          <Text variant="title3">{t('wounds.consentIntroTitle')}</Text>
          <ConsentText purpose="SCAN" expanded />
          {scan?.decision !== 'ALLOWED' ? <Notice tone="info" body={t('wounds.decision_NOT_ALLOWED_SCAN')} /> : null}
          {allowScan.error ? <Notice tone="danger" body={t(woundErrorKey(allowScan.error))} /> : null}
          <Button testID="wound-scan-allow" label={t('wounds.consentIntroAllow')} icon="check" disabled={scan?.decision !== 'ALLOWED'} loading={allowScan.isPending} onPress={() => allowScan.mutate()} />
          <Button testID="wound-scan-more" label={t('wounds.consentIntroMore')} variant="ghost" onPress={() => router.push('/patient/wounds/permissions')} />
          {perms.data.wordingStatus === 'DRAFT_PENDING_LEGAL_REVIEW' ? <Text variant="caption" color="textTertiary">{t('wounds.draftWording', { version: perms.data.wordingVersion })}</Text> : null}
        </Card>
      ) : (
        <Button testID="wound-add" label={t('wounds.addWound')} icon="plus" onPress={() => setAdding(true)} />
      )}

      <Section title={t('wounds.title')}>
        {wounds.error ? <ErrorState message={t(errorKey(wounds.error))} onRetry={() => void wounds.refetch()} /> : null}
        <Card padded={false}>
          {!wounds.data?.length ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg }}>
              <Icon name="mci:bandage" color="textTertiary" />
              <Text variant="footnote" color="textTertiary" style={{ flex: 1 }}>{t('wounds.emptyList')}</Text>
            </View>
          ) : (
            wounds.data.map((w, i) => (
              <PressableScale key={w.id} testID={`wound-${w.label}`} accessibilityRole="button" accessibilityLabel={w.label} onPress={() => router.push(`/patient/wounds/${w.id}` as Href)} style={{ padding: spacing.lg, gap: 4, borderTopWidth: i ? 1 : 0, borderTopColor: colors.divider }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Text variant="callout" weight="semibold" style={{ flex: 1 }}>{w.label}</Text>
                  <Icon name="chevron-right" color="textTertiary" />
                </View>
                <Text variant="caption" color="textSecondary">{`${t(`wounds.site_${w.bodySite}`)} · ${t('wounds.photos', { count: w.photoCount })}`}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                  {w.clinical ? <Badge label={t('wounds.reviewed', { category: t(`wounds.category_${w.clinical.category}`) })} tone="success" /> : <Badge label={t('wounds.notReviewed')} tone="neutral" />}
                  {w.status === 'CLOSED' ? <Badge label={t('wounds.closed')} tone="neutral" /> : null}
                  {w.nextDue ? <Badge testID={`wound-next-${w.label}`} label={t('wounds.nextDue', { day: w.nextDue.day, date: formatDate(w.nextDue.date, locale) })} tone={w.nextDue.status === 'DUE' ? 'accent' : 'info'} /> : null}
                </View>
              </PressableScale>
            ))
          )}
        </Card>
      </Section>

      <PressableScale testID="open-wound-permissions" accessibilityRole="button" accessibilityLabel={t('wounds.permissionsTitle')} onPress={() => router.push('/patient/wounds/permissions')}>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Icon name="mci:shield-account-outline" color="primary" />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="callout" weight="semibold">{t('wounds.permissionsTitle')}</Text>
              <Text variant="footnote" color="textSecondary">{t('wounds.permissionsCardBody')}</Text>
            </View>
            {pending ? <Badge testID="wound-requests-badge" label={String(pending)} tone="accent" /> : null}
            <Icon name="chevron-right" color="textTertiary" />
          </View>
        </Card>
      </PressableScale>
      <MedicalDisclaimer />
      <NewWoundSheet patientId={active.id} visible={adding} onClose={() => setAdding(false)} />
    </Screen>
  );
}
