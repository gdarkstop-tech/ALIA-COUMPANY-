import { DOC_TYPES_BY_ROLE, type ClinicalDocType, type ClinicianCopilotStatus } from '@ghayarly/shared';
import { spacing } from '@ghayarly/tokens';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { CLINICIAN_KEY, copilotErrorKey, useCopilotStatus, useSharedPatient } from '@/features/clinician/hooks';
import { useConsents, useRecordConsents, consentErrorKey } from '@/features/compliance/hooks';
import { SeriesCard } from '@/features/readings/SeriesCard';
import { api, errorKey } from '@/lib/api';
import { formatDate, formatNumber } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Avatar, Badge, BrandLoader, Button, Card, Chip, ErrorState, Header, LoadingScreen, Notice, PressableScale, Screen, Section, Sheet, Text, TextField, type Tone } from '@/ui';

const STATUS_TONE: Record<string, Tone> = { DRAFT: 'accent', SIGNED: 'success', FAILED: 'neutral', GENERATING: 'info', DISCARDED: 'neutral' };

/** The clinician's terms for the copilot (separate from any patient notice). */
function TermsCard() {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const consents = useConsents();
  const record = useRecordConsents();
  return (
    <Card style={{ gap: spacing.sm }} testID="copilot-terms">
      <Text variant="callout" weight="semibold">{t('copilot.termsTitle')}</Text>
      <Text variant="footnote" color="textSecondary">{t('copilot.termsBody')}</Text>
      {record.error ? <Notice tone="danger" body={t(consentErrorKey(record.error))} /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <Button
          testID="copilot-terms-accept"
          label={t('copilot.termsAccept')}
          size="sm"
          fullWidth={false}
          loading={record.isPending}
          disabled={!consents.data}
          onPress={() => record.mutate({ state: consents.data!, answers: { AI_CLINICAL_DOCUMENTATION: true } }, { onSuccess: () => void qc.invalidateQueries({ queryKey: CLINICIAN_KEY }) })}
        />
        <Button label={t('copilot.termsRead')} variant="ghost" size="sm" fullWidth={false} onPress={() => router.push('/legal/ai-clinician-terms' as Href)} />
      </View>
    </Card>
  );
}

function NewDraftSheet({ patientId, role, status, visible, onClose }: { patientId: string; role: 'DOCTOR' | 'NURSE'; status: ClinicianCopilotStatus; visible: boolean; onClose: () => void }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const types = DOC_TYPES_BY_ROLE[role];
  const [docType, setDocType] = useState<ClinicalDocType>(types[0]!);
  const [notes, setNotes] = useState('');
  const create = useMutation({
    mutationFn: () => api.clinician.createDraft(patientId, { docType, notes: notes.trim() }),
    onSuccess: async (d) => {
      await qc.invalidateQueries({ queryKey: CLINICIAN_KEY });
      onClose();
      setNotes('');
      router.push(`/clinician/draft/${d.id}` as Href);
    },
  });
  return (
    <Sheet visible={visible} onClose={onClose} title={t('copilot.newDraftTitle')} testID="draft-sheet">
      <Text variant="footnote" weight="semibold" color="textSecondary">{t('copilot.docType')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {types.map((d) => (
          <Chip key={d} testID={`draft-type-${d}`} label={t(`copilot.doc_${d}`)} selected={docType === d} onPress={() => setDocType(d)} />
        ))}
      </View>
      <TextField testID="draft-notes" label={t('copilot.notes')} hint={t('copilot.notesHint')} value={notes} onChangeText={setNotes} multiline maxLength={6000} />
      {status.allowance ? <Text variant="caption" color="textTertiary">{t('copilot.remaining', { remaining: formatNumber(status.allowance.remaining, locale), limit: formatNumber(status.allowance.weeklyLimit, locale) })}</Text> : null}
      {create.error ? <Notice tone="danger" body={t(copilotErrorKey(create.error))} testID="draft-error" /> : null}
      {create.isPending ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }} accessibilityLiveRegion="polite">
          <BrandLoader size={28} />
          <Text variant="footnote" color="textSecondary">{t('copilot.generating')}</Text>
        </View>
      ) : (
        <Button testID="draft-generate" label={t('copilot.generate')} icon="mci:creation" onPress={() => create.mutate()} disabled={notes.trim().length < 10 || status.allowance?.remaining === 0} />
      )}
    </Sheet>
  );
}

/** A shared record, read-only: limited profile, record, readings and the clinician's own notes. */
export default function SharedPatient() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const q = useSharedPatient(id);
  const status = useCopilotStatus();
  const [drafting, setDrafting] = useState(false);

  if (q.isPending) return <Screen><LoadingScreen /></Screen>;
  if (q.error) return <Screen header={<Header back title={t('copilot.patientsTitle')} />}><ErrorState message={t(errorKey(q.error))} onRetry={() => void q.refetch()} /></Screen>;
  const { patient: p, entries, analytics, drafts } = q.data;
  const list = (kind: string) => entries.filter((e) => e.kind === kind).map((e) => e.title);
  const reason = status.data?.unavailableReason;

  return (
    <Screen testID="clinician-patient" header={<Header back title={p.displayName} subtitle={t('copilot.sharedUntil', { date: formatDate(p.expiresAt, locale) })} />} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Card style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Avatar name={p.displayName} size={52} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="title3">{p.displayName}</Text>
            <Text variant="footnote" color="textSecondary">{t('copilot.years', { count: p.ageYears })} · {t(`sex.${p.sex}`)}{p.bloodType ? ` · ${p.bloodType}` : ''}</Text>
            <Badge label={p.aiAllowed ? t('copilot.aiAllowed') : t('copilot.aiNotAllowed')} tone={p.aiAllowed ? 'accent' : 'neutral'} />
          </View>
        </View>
        {(['ALLERGY', 'CONDITION', 'MEDICATION'] as const).map((k) => (
          <View key={k} style={{ gap: 2 }} testID={`record-${k}`}>
            <Text variant="footnote" weight="semibold" color="textSecondary">{t(k === 'ALLERGY' ? 'copilot.allergies' : k === 'CONDITION' ? 'copilot.conditions' : 'copilot.medications')}</Text>
            <Text variant="body">{list(k).join(' · ') || t('copilot.noneRecorded')}</Text>
          </View>
        ))}
      </Card>

      <Section title={t('copilot.drafts')} testID="clinician-drafts" action={p.aiAllowed && !reason ? <Button testID="draft-new" label={t('copilot.newDraft')} icon="mci:creation" variant="ghost" size="sm" fullWidth={false} onPress={() => setDrafting(true)} /> : undefined}>
        {reason === 'CLINICIAN_TERMS_REQUIRED' ? <TermsCard /> : null}
        {reason === 'FEATURE_DISABLED' || reason === 'NOT_CONFIGURED' || reason === 'PAUSED' ? <Notice tone="info" body={t('copilot.off')} testID="copilot-off" /> : null}
        {reason === 'NOT_VERIFIED' ? <Notice tone="warning" body={t('copilot.notVerified')} /> : null}
        <Card padded={false}>
          {drafts.length ? (
            drafts.map((d, i) => (
              <PressableScale key={d.id} testID={`draft-${d.docType}-${d.status}`} accessibilityRole="button" accessibilityLabel={t(`copilot.doc_${d.docType}`)} onPress={() => router.push(`/clinician/draft/${d.id}` as Href)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderTopWidth: i ? 1 : 0, borderTopColor: colors.divider }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="callout" weight="semibold">{t(`copilot.doc_${d.docType}`)}</Text>
                  <Text variant="caption" color="textSecondary">{formatDate(d.signedAt ?? d.createdAt, locale)}</Text>
                </View>
                <Badge label={t(`copilot.status_${d.status}`)} tone={STATUS_TONE[d.status]} />
              </PressableScale>
            ))
          ) : (
            <View style={{ padding: spacing.lg }}>
              <Text variant="footnote" color="textTertiary">—</Text>
            </View>
          )}
        </Card>
      </Section>

      <Section title={t('copilot.readings')}>
        {analytics.series.map((s) => (
          <SeriesCard key={s.key} series={s} patientId={p.patientId} readOnly />
        ))}
        {!analytics.series.length ? <Text variant="footnote" color="textTertiary">{t('copilot.noneRecorded')}</Text> : null}
      </Section>

      {status.data?.role && !reason ? <NewDraftSheet patientId={p.patientId} role={status.data.role} status={status.data} visible={drafting} onClose={() => setDrafting(false)} /> : null}
    </Screen>
  );
}
