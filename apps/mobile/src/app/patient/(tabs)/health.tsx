import { HEALTH_ENTRY_KINDS, type HealthEntry, type HealthEntryKind, type Provenance } from '@ghayarly/shared';
import { radii, spacing } from '@ghayarly/tokens';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { AddEntrySheet } from '@/features/patient/AddEntrySheet';
import { EmergencyContactSheet } from '@/features/patient/EmergencyContactSheet';
import { useActivePatient } from '@/features/patient/hooks';
import { useConsents } from '@/features/compliance/hooks';
import { EmergencyNotice, MedicalDisclaimer } from '@/features/compliance/Safety';
import { ProfileSwitcher, relationshipLabel } from '@/features/patient/ProfileSwitcher';
import { api, errorKey } from '@/lib/api';
import { ltr } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Avatar, Badge, Button, Card, ErrorState, Header, Icon, LoadingScreen, Notice, PressableScale, Screen, Section, Text, type IconName, type Tone } from '@/ui';

const SECTION: Record<HealthEntryKind, { title: 'health.allergies' | 'health.conditions' | 'health.medications' | 'health.surgeries'; empty: 'health.emptyAllergies' | 'health.emptyConditions' | 'health.emptyMedications' | 'health.emptySurgeries'; icon: IconName }> = {
  ALLERGY: { title: 'health.allergies', empty: 'health.emptyAllergies', icon: 'mci:allergy' },
  CONDITION: { title: 'health.conditions', empty: 'health.emptyConditions', icon: 'mci:heart-pulse' },
  MEDICATION: { title: 'health.medications', empty: 'health.emptyMedications', icon: 'mci:pill' },
  SURGERY: { title: 'health.surgeries', empty: 'health.emptySurgeries', icon: 'mci:bandage' },
};

export function provenanceTone(p: Provenance | null): Tone {
  return p === 'PROFESSIONALLY_VERIFIED' ? 'success' : p === 'IMPORTED_DOCUMENT' ? 'info' : 'neutral';
}

function confirm(message: string, labels: { cancel: string; confirm: string }, onYes: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(message)) onYes();
    return;
  }
  Alert.alert(message, undefined, [{ text: labels.cancel, style: 'cancel' }, { text: labels.confirm, style: 'destructive', onPress: onYes }]);
}

export default function MyHealth() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: patients, active, setActive, isPending } = useActivePatient();
  const entries = useQuery({ queryKey: ['health-entries', active?.id], queryFn: () => api.patients.healthEntries(active!.id), enabled: Boolean(active) });
  const [adding, setAdding] = useState<HealthEntryKind | null>(null);
  const [editingContact, setEditingContact] = useState(false);
  const consents = useConsents();
  const remove = useMutation({
    mutationFn: (e: HealthEntry) => api.patients.removeHealthEntry(e.patientId, e.id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['health-entries'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  if (isPending || !active) return <Screen><LoadingScreen /></Screen>;

  return (
    <Screen testID="my-health" header={<Header title={t('health.title')} subtitle={t('health.subtitle')} right={<Button label={t('nav.family')} variant="ghost" size="sm" fullWidth={false} icon="users" onPress={() => router.push('/patient/family')} />} />} refreshing={entries.isRefetching} onRefresh={() => void entries.refetch()}>
      {patients ? <ProfileSwitcher patients={patients} activeId={active.id} onSelect={setActive} /> : null}

      <Card>
        <View style={{ flexDirection: 'row', gap: spacing.lg, alignItems: 'center' }}>
          <Avatar name={active.displayName} size={60} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="title3" testID="health-patient-name">{active.displayName}</Text>
            <Text variant="footnote" color="textSecondary">
              {relationshipLabel(t, active)} · {t('common.yearsOld', { count: active.ageYears })} · {t(`sex.${active.sex}`)}
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
              <Badge label={t(`family.access_${active.accessLevel}`)} tone="primary" />
              {active.isDemo ? <Badge label={t('app.demoBadge')} tone="demo" /> : null}
            </View>
          </View>
        </View>
        <View style={{ flexDirection: 'row', marginTop: spacing.lg, gap: spacing.md }}>
          <View style={{ flex: 1, backgroundColor: colors.surfaceMuted, borderRadius: radii.md, padding: spacing.md, gap: 4 }}>
            <Text variant="caption" color="textTertiary">
              {t('health.bloodType')}
            </Text>
            <Text variant="title3">{active.bloodType === 'UNKNOWN' ? t('onboarding.bloodTypeUnknown') : ltr(active.bloodType)}</Text>
            {active.bloodTypeProvenance ? <Badge label={t(`health.provenance_${active.bloodTypeProvenance}`)} tone={provenanceTone(active.bloodTypeProvenance)} /> : null}
          </View>
          <PressableScale onPress={() => setEditingContact(true)} accessibilityRole="button" accessibilityLabel={t('health.emergencyContact')} style={{ flex: 1.4, backgroundColor: colors.surfaceMuted, borderRadius: radii.md, padding: spacing.md, gap: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="caption" color="textTertiary">
                {t('health.emergencyContact')}
              </Text>
              <Icon name="edit-2" size={14} color="textTertiary" />
            </View>
            {active.emergencyContactName ? (
              <>
                <Text variant="callout" weight="semibold">{active.emergencyContactName}</Text>
                <Text variant="caption" color="textSecondary">{active.emergencyContactPhone ? ltr(active.emergencyContactPhone) : ''}</Text>
              </>
            ) : (
              <Text variant="footnote" color="textSecondary">{t('health.noEmergencyContact')}</Text>
            )}
          </PressableScale>
        </View>
      </Card>

      <EmergencyNotice />
      {consents.data && !consents.data.healthDataConsented ? (
        <Notice tone="warning" title={t('privacy.healthData')} body={t('privacy.healthDataOff')} testID="health-paused">
          <Button label={t('privacy.title')} variant="ghost" size="sm" fullWidth={false} onPress={() => router.push('/settings/privacy')} />
        </Notice>
      ) : null}

      {entries.isPending ? (
        <LoadingScreen />
      ) : entries.error ? (
        <ErrorState message={t(errorKey(entries.error))} onRetry={() => void entries.refetch()} />
      ) : (
        HEALTH_ENTRY_KINDS.map((kind) => {
          const list = entries.data.filter((e) => e.kind === kind);
          const s = SECTION[kind];
          return (
            <Section key={kind} title={t(s.title)} testID={`health-section-${kind}`} action={<Button testID={`add-entry-${kind}`} label={t('health.addEntry')} icon="plus" variant="ghost" size="sm" fullWidth={false} onPress={() => setAdding(kind)} />}>
              <Card padded={false}>
                {list.length === 0 ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg }}>
                    <Icon name={s.icon} color="textTertiary" />
                    <Text variant="footnote" color="textTertiary">{t(s.empty)}</Text>
                  </View>
                ) : (
                  list.map((e, idx) => (
                    <View key={e.id} testID={`entry-${e.title}`} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderTopWidth: idx ? 1 : 0, borderTopColor: colors.divider }}>
                      <View style={{ width: 36, height: 36, borderRadius: radii.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name={s.icon} size={18} color="primary" />
                      </View>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text variant="callout" weight="semibold">{e.title}</Text>
                        {e.note ? <Text variant="caption" color="textSecondary">{e.note}</Text> : null}
                        <Badge label={t(`health.provenance_${e.provenance}`)} tone={provenanceTone(e.provenance)} icon={e.provenance === 'PROFESSIONALLY_VERIFIED' ? 'check' : undefined} />
                      </View>
                      {e.provenance !== 'PROFESSIONALLY_VERIFIED' ? (
                        <PressableScale accessibilityRole="button" accessibilityLabel={t('common.remove')} onPress={() => confirm(t('health.removeConfirm'), { cancel: t('common.cancel'), confirm: t('common.remove') }, () => remove.mutate(e))} style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name="trash-2" size={16} color="textTertiary" />
                        </PressableScale>
                      ) : null}
                    </View>
                  ))
                )}
              </Card>
            </Section>
          );
        })
      )}

      <Section title={t('health.timelineTitle')}>
        <Card>
          <View style={{ gap: spacing.md }}>
            {(['health.vitalsTitle', 'health.reportsTitle', 'health.timelineTitle'] as const).map((k, i) => (
              <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Icon name={(['mci:chart-line-variant', 'mci:file-document-outline', 'mci:timeline-clock-outline'] as const)[i]!} color="textTertiary" />
                <Text variant="footnote" color="textSecondary" style={{ flex: 1 }}>{t(k)}</Text>
                <Badge label={t('app.comingNext')} />
              </View>
            ))}
          </View>
        </Card>
      </Section>

      <MedicalDisclaimer />

      <AddEntrySheet patientId={active.id} kind={adding} onClose={() => setAdding(null)} />
      <EmergencyContactSheet patient={active} visible={editingContact} onClose={() => setEditingContact(false)} />
    </Screen>
  );
}
