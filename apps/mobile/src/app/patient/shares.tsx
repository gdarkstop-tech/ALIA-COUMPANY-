import { spacing } from '@ghayarly/tokens';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { NoteView } from '@/features/clinician/NoteView';
import { MedicalDisclaimer } from '@/features/compliance/Safety';
import { useActivePatient } from '@/features/patient/hooks';
import { ProfileSwitcher } from '@/features/patient/ProfileSwitcher';
import { api, errorKey } from '@/lib/api';
import { confirmDestructive } from '@/lib/confirm';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Badge, Button, Card, Checkbox, ErrorState, Header, LoadingScreen, Notice, Screen, Section, Text, type Tone } from '@/ui';
import { woundErrorKey } from '@/features/wounds/hooks';

const STATUS_TONE: Record<string, Tone> = { ACTIVE: 'success', REVOKED: 'neutral', EXPIRED: 'neutral' };

/** Who can read this profile's record, and the notes clinicians signed. */
export default function Shares() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: patients, active, setActive, isPending } = useActivePatient();
  const shares = useQuery({ queryKey: ['shares', active?.id], queryFn: () => api.shares.list(active!.id), enabled: Boolean(active) });
  const notes = useQuery({ queryKey: ['shares', 'notes', active?.id], queryFn: () => api.shares.notes(active!.id), enabled: Boolean(active) });
  const revoke = useMutation({ mutationFn: (id: string) => api.shares.revoke(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['shares'] }) });
  const wounds = useMutation({ mutationFn: (v: { id: string; allowed: boolean }) => api.shares.setWounds(v.id, v.allowed), onSuccess: () => qc.invalidateQueries({ queryKey: ['shares'] }) });

  if (isPending || !active) return <Screen><LoadingScreen /></Screen>;
  return (
    <Screen testID="shares" header={<Header back title={t('shares.title')} subtitle={t('shares.subtitle')} />} refreshing={shares.isRefetching} onRefresh={() => void Promise.all([shares.refetch(), notes.refetch()])}>
      {patients ? <ProfileSwitcher patients={patients} activeId={active.id} onSelect={setActive} /> : null}
      <Section title={t('shares.activeTitle')} action={<Button label={t('shares.findClinician')} variant="ghost" size="sm" fullWidth={false} icon="search" onPress={() => router.push('/patient/care')} />}>
        {shares.error ? <ErrorState message={t(errorKey(shares.error))} onRetry={() => void shares.refetch()} /> : null}
        <Card padded={false}>
          {shares.data?.length ? (
            shares.data.map((s, i) => (
              <View key={s.id} testID={`share-${s.providerName}`} style={{ padding: spacing.lg, gap: spacing.xs, borderTopWidth: i ? 1 : 0, borderTopColor: colors.divider }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Text variant="callout" weight="semibold" style={{ flex: 1 }}>{s.providerName ?? '—'}</Text>
                  <Badge label={t(`shares.status_${s.status}`)} tone={STATUS_TONE[s.status]} />
                </View>
                <Text variant="caption" color="textSecondary">{t('shares.shared', { date: formatDate(s.expiresAt, locale) })}</Text>
                {s.aiAllowed ? <Badge label={t('shares.aiOn')} tone="accent" icon="mci:creation" /> : null}
                {s.status === 'ACTIVE' ? (
                  <Checkbox
                    testID={`share-wounds-${s.providerName}`}
                    checked={s.woundsAllowed}
                    onChange={(allowed) => wounds.mutate({ id: s.id, allowed })}
                    label={t('shares.woundsToggle')}
                  >
                    <Text variant="caption" color="textSecondary">{t('shares.woundsToggleBody')}</Text>
                  </Checkbox>
                ) : null}
                {s.status === 'ACTIVE' ? (
                  <Button testID={`share-revoke-${s.providerName}`} label={t('shares.revoke')} variant="ghost" size="sm" fullWidth={false} icon="x-circle" onPress={() => confirmDestructive(t('shares.revokeConfirm'), { cancel: t('common.cancel'), confirm: t('shares.revoke') }, () => revoke.mutate(s.id))} />
                ) : null}
              </View>
            ))
          ) : (
            <View style={{ padding: spacing.lg }}>
              <Text variant="footnote" color="textTertiary">{t('shares.none')}</Text>
            </View>
          )}
        </Card>
      </Section>

      {wounds.error ? <Notice tone="danger" body={t(woundErrorKey(wounds.error))} /> : null}
      <Section title={t('shares.notesTitle')} testID="clinical-notes">
        {notes.data?.length ? (
          notes.data.map((n) => (
            <Card key={n.id} style={{ gap: spacing.sm }} testID={`clinical-note-${n.id}`}>
              <Text variant="callout" weight="semibold">{t(`copilot.doc_${n.docType}`)}</Text>
              <Text variant="caption" color="textSecondary">{t('shares.signedBy', { name: n.authorName ?? '—', date: formatDate(n.signedAt, locale) })}</Text>
              <Badge label={t('shares.aiAssisted')} tone="accent" icon="mci:creation" />
              {n.simulated ? <Badge label={t('copilot.simulated')} tone="demo" /> : null}
              <NoteView note={n} />
            </Card>
          ))
        ) : (
          <Notice tone="info" body={t('shares.notesEmpty')} />
        )}
      </Section>
      <MedicalDisclaimer />
    </Screen>
  );
}
