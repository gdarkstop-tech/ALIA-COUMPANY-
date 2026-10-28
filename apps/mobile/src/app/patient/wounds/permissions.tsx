import type { WoundPresentationView } from '@ghayarly/shared';
import { spacing } from '@ghayarly/tokens';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { useActivePatient } from '@/features/patient/hooks';
import { ProfileSwitcher } from '@/features/patient/ProfileSwitcher';
import { useInvalidateWounds, useWoundPermissions, useWoundPresentations, woundErrorKey } from '@/features/wounds/hooks';
import { PermissionCard } from '@/features/wounds/Permissions';
import { WoundPhoto } from '@/features/wounds/WoundPhoto';
import { api, errorKey } from '@/lib/api';
import { confirmDestructive } from '@/lib/confirm';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Badge, Button, Card, ErrorState, Header, LoadingScreen, Notice, Screen, Section, Text, useToast, type Tone } from '@/ui';

const STATUS_TONE: Record<WoundPresentationView['status'], Tone> = {
  NOMINATED: 'neutral', AWAITING_PATIENT: 'accent', PATIENT_APPROVED: 'info', PATIENT_DECLINED: 'neutral', APPROVED: 'success', REJECTED: 'neutral', WITHDRAWN: 'neutral',
};

/** A presentation request: the exact photos, text, audience, use and end date — approve, decline or withdraw. */
function Request({ r, canDecide }: { r: WoundPresentationView; canDecide: boolean }) {
  const { t, locale } = useI18n();
  const invalidate = useInvalidateWounds();
  const decide = useMutation({ mutationFn: (decision: 'APPROVE' | 'DECLINE') => api.wounds.decidePresentation(r.id, { decision, requestHash: r.requestHash! }), onSuccess: () => invalidate() });
  const withdraw = useMutation({ mutationFn: () => api.wounds.withdrawPresentation(r.id), onSuccess: () => invalidate() });
  const open = ['AWAITING_PATIENT', 'PATIENT_APPROVED', 'APPROVED'].includes(r.status);
  return (
    <Card style={{ gap: spacing.sm }} testID={`wound-request-${r.status}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text variant="callout" weight="semibold" style={{ flex: 1 }}>{r.title}</Text>
        <Badge label={t(`wounds.presentation_${r.status}`)} tone={STATUS_TONE[r.status]} />
      </View>
      {r.status === 'AWAITING_PATIENT' ? <Notice tone="info" body={t('wounds.requestIntro')} /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {r.images.map((i) => (
          <View key={i.imageId} style={{ width: '48%', gap: 4 }}>
            <WoundPhoto imageId={i.imageId} label={t('wounds.photoDay', { day: i.day })} />
            <Text variant="caption" weight="semibold">{t('wounds.photoDay', { day: i.day })}</Text>
            <Text variant="caption" color="textSecondary">{locale === 'en' ? i.captionEn : i.captionAr}</Text>
          </View>
        ))}
      </View>
      <Text variant="footnote">{locale === 'en' ? r.summaryEn : r.summaryAr}</Text>
      {r.audience && r.organization ? <Text variant="caption" color="textSecondary">{t('wounds.requestAudience', { audience: t(`wounds.audience_${r.audience}`), organization: t(`wounds.org_${r.organization}`) })}</Text> : null}
      {r.scopeNote ? <Text variant="caption" color="textSecondary">{t('wounds.requestScope', { scope: r.scopeNote })}</Text> : null}
      {r.validUntil ? <Text variant="caption" color="textSecondary">{t('wounds.requestValid', { date: formatDate(r.validUntil, locale) })}</Text> : null}
      {r.outcome ? <Text variant="caption" color="textSecondary">{t('wounds.requestOutcome', { outcome: t(`wounds.outcome_${r.outcome}`) })}</Text> : null}
      {decide.error || withdraw.error ? <Notice tone="danger" body={t(woundErrorKey(decide.error ?? withdraw.error))} /> : null}
      {canDecide && r.status === 'AWAITING_PATIENT' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Button testID="wound-request-approve" label={t('wounds.approveRequest')} size="sm" fullWidth={false} icon="check" loading={decide.isPending && decide.variables === 'APPROVE'} onPress={() => decide.mutate('APPROVE')} />
          <Button testID="wound-request-decline" label={t('wounds.declineRequest')} variant="secondary" size="sm" fullWidth={false} icon="x" loading={decide.isPending && decide.variables === 'DECLINE'} onPress={() => decide.mutate('DECLINE')} />
        </View>
      ) : null}
      {canDecide && open && r.status !== 'AWAITING_PATIENT' ? (
        <Button testID="wound-request-withdraw" label={t('wounds.withdrawRequest')} variant="ghost" size="sm" fullWidth={false} icon="x-circle" loading={withdraw.isPending} onPress={() => confirmDestructive(t('wounds.withdrawRequestConfirm'), { cancel: t('common.cancel'), confirm: t('wounds.withdraw') }, () => withdraw.mutate())} />
      ) : null}
    </Card>
  );
}

/** Privacy Center → Wound data permissions (A / B / C), presentation requests, history and deletion. */
export default function WoundPermissions() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const invalidate = useInvalidateWounds();
  const { data: patients, active, setActive, isPending } = useActivePatient();
  const perms = useWoundPermissions(active?.id);
  const requests = useWoundPresentations(active?.id);
  const removeAll = useMutation({
    mutationFn: () => api.wounds.removeAll(active!.id),
    onSuccess: async () => {
      await invalidate();
      toast(t('wounds.deleteAllDone'));
    },
  });
  if (isPending || !active) return <Screen><LoadingScreen /></Screen>;
  const canDecideC = perms.data?.consents.find((c) => c.purpose === 'PRESENTATION')?.decision === 'ALLOWED';

  return (
    <Screen testID="wound-permissions" header={<Header back title={t('wounds.permissionsTitle')} subtitle={t('wounds.permissionsSubtitle')} />} refreshing={perms.isRefetching} onRefresh={() => void Promise.all([perms.refetch(), requests.refetch()])}>
      {patients ? <ProfileSwitcher patients={patients} activeId={active.id} onSelect={setActive} /> : null}
      {perms.isPending ? (
        <LoadingScreen />
      ) : perms.error ? (
        <ErrorState message={t(errorKey(perms.error))} onRetry={() => void perms.refetch()} />
      ) : (
        <>
          {!perms.data.available ? <Notice tone="info" title={t('wounds.unavailable')} body={t('wounds.unavailableBody')} /> : null}
          {perms.data.consents.map((c) => <PermissionCard key={c.purpose} patientId={active.id} perms={perms.data} state={c} />)}

          <Section title={t('wounds.requestsTitle')} testID="wound-requests">
            {requests.data?.length ? requests.data.map((r) => <Request key={r.id} r={r} canDecide={canDecideC} />) : <Notice tone="info" body={t('wounds.requestsEmpty')} />}
            <Text variant="caption" color="textTertiary">{t('wounds.limitsNote')}</Text>
          </Section>

          <Section title={t('wounds.howUsedTitle')}>
            <Card style={{ gap: spacing.sm }}>
              {(['howUsed1', 'howUsed2', 'howUsed3', 'howUsed4'] as const).map((k) => <Text key={k} variant="footnote" color="textSecondary">{`• ${t(`wounds.${k}`)}`}</Text>)}
            </Card>
          </Section>

          <Section title={t('wounds.historyTitle')} testID="wound-history">
            <Card padded={false}>
              {perms.data.history.length === 0 ? (
                <View style={{ padding: spacing.lg }}>
                  <Text variant="footnote" color="textTertiary">—</Text>
                </View>
              ) : (
                perms.data.history.map((e, i) => (
                  <View key={e.id} style={{ padding: spacing.md, gap: 2, borderTopWidth: i ? 1 : 0, borderTopColor: colors.divider }}>
                    <Text variant="footnote" weight="semibold">{`${{ SCAN: 'A', RESEARCH: 'B', PRESENTATION: 'C' }[e.purpose]} · ${t(`wounds.history_${e.action}`)}`}</Text>
                    <Text variant="caption" color="textSecondary">
                      {[t(`wounds.basis_${e.basis as 'SELF'}`), e.reason === 'SCAN_WITHDRAWN' ? t('wounds.reason_SCAN_WITHDRAWN') : null, formatDate(e.at, locale), e.version].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                ))
              )}
            </Card>
          </Section>

          {/* Shown to everyone who manages the profile; the server allows it only to its administrators. */}
          {perms.data.history.length ? (
            <Button
              testID="wound-delete-all"
              label={t('wounds.deleteAll')}
              variant="ghost"
              icon="trash-2"
              loading={removeAll.isPending}
              onPress={() => confirmDestructive(t('wounds.deleteAllConfirm'), { cancel: t('common.cancel'), confirm: t('common.remove') }, () => removeAll.mutate())}
            />
          ) : null}
          {removeAll.error ? <Notice tone="danger" body={t(woundErrorKey(removeAll.error))} /> : null}

          <Card style={{ gap: spacing.sm }}>
            <Text variant="callout" weight="semibold">{t('wounds.supportTitle')}</Text>
            <Text variant="footnote" color="textSecondary">{t('wounds.supportBody')}</Text>
            <Button label={t('legal.privacy')} variant="ghost" size="sm" fullWidth={false} icon="external-link" onPress={() => router.push('/legal/privacy')} />
          </Card>
        </>
      )}
    </Screen>
  );
}
