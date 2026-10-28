import { DOC_SECTIONS, type ClinicalDraftContent } from '@ghayarly/shared';
import { spacing } from '@ghayarly/tokens';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { CLINICIAN_KEY, copilotErrorKey, useDraft } from '@/features/clinician/hooks';
import { NoteView } from '@/features/clinician/NoteView';
import { api, errorKey } from '@/lib/api';
import { confirmDestructive } from '@/lib/confirm';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { Badge, Button, Card, ErrorState, Header, LoadingScreen, Notice, Screen, Text, TextField } from '@/ui';

const LISTS = new Set(['instructions', 'whenToSeekHelp', 'checksForClinician']);
const toForm = (c: ClinicalDraftContent | null) => Object.fromEntries(Object.entries(c ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.join('\n') : v]));
const fromForm = (f: Record<string, string>): ClinicalDraftContent =>
  Object.fromEntries(Object.entries(f).map(([k, v]) => [k, LISTS.has(k) ? v.split('\n').map((x) => x.trim()).filter(Boolean) : v.trim()]));

/** An AI draft is the clinician's to correct; signing makes it final and visible to the person. */
export default function DraftEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useDraft(id);
  const [form, setForm] = useState<Record<string, string>>({});
  const [showNotes, setShowNotes] = useState(false);
  useEffect(() => {
    if (q.data) setForm(toForm(q.data.content));
  }, [q.data]);
  const act = useMutation({
    mutationFn: (action: 'SAVE' | 'SIGN' | 'DISCARD') => api.clinician.updateDraft(id!, action === 'DISCARD' ? { action } : { action, content: fromForm(form) }),
    onSuccess: async (d) => {
      await qc.invalidateQueries({ queryKey: CLINICIAN_KEY });
      if (d.status === 'DISCARDED') router.back();
    },
  });

  if (q.isPending) return <Screen><LoadingScreen /></Screen>;
  if (q.error) return <Screen header={<Header back title="" />}><ErrorState message={t(errorKey(q.error))} onRetry={() => void q.refetch()} /></Screen>;
  const d = q.data;
  const editable = d.status === 'DRAFT';
  const checks = (d.content?.checksForClinician as string[] | undefined) ?? [];

  return (
    <Screen testID="draft-editor" header={<Header back title={t(`copilot.doc_${d.docType}`)} subtitle={d.signedAt ? t('copilot.signed', { date: formatDate(d.signedAt, locale) }) : formatDate(d.createdAt, locale)} />}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        <Badge label={t(`copilot.status_${d.status}`)} tone={d.status === 'SIGNED' ? 'success' : d.status === 'DRAFT' ? 'accent' : 'neutral'} testID="draft-status" />
        {d.edited ? <Badge label={t('copilot.edited')} icon="edit-2" /> : null}
        {d.simulated ? <Badge label={t('copilot.simulated')} tone="demo" testID="draft-simulated" /> : null}
      </View>
      {d.status === 'FAILED' ? <Notice tone="warning" body={d.failure === 'REFUSED' ? t('copilot.status_FAILED') : t('copilot.error_CLINICAL_DRAFT_REJECTED')} /> : null}
      {editable ? <Notice tone="warning" icon="mci:creation" body={t('copilot.draftLabel')} testID="draft-label" /> : null}
      {checks.length ? (
        <Notice tone="info" title={t('copilot.checksTitle')} body={checks.map((c) => `• ${c}`).join('\n')} testID="draft-checks" />
      ) : null}

      {editable ? (
        <Card style={{ gap: spacing.md }}>
          {DOC_SECTIONS[d.docType].map((k) => (
            <TextField
              key={k}
              testID={`draft-section-${k}`}
              label={t(`copilot.section_${k}` as Parameters<typeof t>[0])}
              hint={LISTS.has(k) ? t('copilot.listHint') : undefined}
              value={form[k] ?? ''}
              onChangeText={(v) => setForm((f) => ({ ...f, [k]: v }))}
              multiline
              maxLength={3000}
            />
          ))}
        </Card>
      ) : d.content ? (
        <Card>
          <NoteView note={d} />
        </Card>
      ) : null}

      {d.clinicianInput ? (
        <Card style={{ gap: spacing.sm }}>
          <Button label={t('copilot.yourNotes')} variant="ghost" size="sm" fullWidth={false} icon={showNotes ? 'chevron-up' : 'chevron-down'} onPress={() => setShowNotes(!showNotes)} />
          {showNotes ? <Text variant="footnote" color="textSecondary" testID="draft-original-notes">{d.clinicianInput}</Text> : null}
        </Card>
      ) : null}

      {act.error ? <Notice tone="danger" body={t(copilotErrorKey(act.error))} testID="draft-action-error" /> : null}
      {editable ? (
        <View style={{ gap: spacing.sm }}>
          <Button testID="draft-sign" label={t('copilot.sign')} icon="check-circle" loading={act.isPending && act.variables === 'SIGN'} onPress={() => confirmDestructive(t('copilot.signConfirm'), { cancel: t('common.cancel'), confirm: t('copilot.sign') }, () => act.mutate('SIGN'))} />
          <Button testID="draft-save" label={t('copilot.save')} variant="secondary" loading={act.isPending && act.variables === 'SAVE'} onPress={() => act.mutate('SAVE')} />
          <Button testID="draft-discard" label={t('copilot.discard')} variant="ghost" icon="trash-2" onPress={() => confirmDestructive(t('copilot.discardConfirm'), { cancel: t('common.cancel'), confirm: t('copilot.discard') }, () => act.mutate('DISCARD'))} />
        </View>
      ) : null}
    </Screen>
  );
}
