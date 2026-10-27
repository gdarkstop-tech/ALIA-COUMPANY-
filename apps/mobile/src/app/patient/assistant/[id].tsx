import { AI_REPORT_REASONS, type AiChatMessage, type AiReportReason } from '@ghayarly/shared';
import { radii, spacing, typography } from '@ghayarly/tokens';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, TextInput, View } from 'react-native';
import { EMERGENCY_NUMBER, MAX_CHARS, useAssistantErrorText, useAssistantStatus, useConversation, useDeleteConversation, useReportAnswer, useSendMessage } from '@/features/assistant/hooks';
import { usePatients } from '@/features/patient/hooks';
import { errorKey } from '@/lib/api';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Badge, Button, Checkbox, Chip, ErrorState, Header, Icon, LoadingScreen, Notice, PressableScale, Screen, Sheet, Text, TextField } from '@/ui';

function Bubble({ m, onReport }: { m: AiChatMessage; onReport?: () => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const mine = m.role === 'user';
  const emergency = m.kind === 'EMERGENCY_GUIDANCE';
  const background = mine ? colors.primary : emergency ? colors.dangerSoft : colors.surface;
  return (
    <View testID={`assistant-message-${m.role}-${m.kind}`} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '88%', gap: spacing.xs }}>
      {m.kind !== 'MESSAGE' ? (
        <Badge
          tone={emergency ? 'danger' : m.kind === 'SIMULATED' ? 'demo' : 'neutral'}
          icon={emergency ? 'mci:ambulance' : undefined}
          label={t(emergency ? 'assistant.emergencyLabel' : m.kind === 'SIMULATED' ? 'assistant.simulatedLabel' : 'assistant.refusalLabel')}
        />
      ) : null}
      <View style={{ backgroundColor: background, borderRadius: radii.lg, padding: spacing.md, borderWidth: mine ? 0 : 1, borderColor: emergency ? colors.danger : colors.border }}>
        <Text variant="callout" selectable style={mine ? { color: colors.surface } : undefined}>
          {m.content}
        </Text>
      </View>
      {emergency ? (
        <Button testID="assistant-call-emergency" variant="danger" size="md" fullWidth={false} icon="phone" label={t('safety.callEmergency', { number: EMERGENCY_NUMBER })} onPress={() => void Linking.openURL(`tel:${EMERGENCY_NUMBER}`).catch(() => undefined)} />
      ) : null}
      {!mine && onReport ? (
        m.reported ? (
          <Text variant="caption" color="textTertiary" testID={`assistant-reported-${m.id}`}>{t('assistant.reported')}</Text>
        ) : (
          <PressableScale accessibilityRole="button" accessibilityLabel={t('assistant.reportAnswer')} onPress={onReport} testID="assistant-report" style={{ minHeight: 32, justifyContent: 'center', alignSelf: 'flex-start' }}>
            <Text variant="caption" color="textSecondary" style={{ textDecorationLine: 'underline' }}>{t('assistant.reportAnswer')}</Text>
          </PressableScale>
        )
      ) : null}
    </View>
  );
}

/** One conversation. The server runs the emergency check, quota and safety rules on every message. */
export default function AssistantChat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, isRTL } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const conversation = useConversation(id);
  const status = useAssistantStatus();
  const patients = usePatients();
  const send = useSendMessage(id ?? '');
  const remove = useDeleteConversation();
  const errorText = useAssistantErrorText();
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const report = useReportAnswer(id ?? '');
  const [reporting, setReporting] = useState<string | null>(null);
  const [reason, setReason] = useState<AiReportReason | null>(null);
  const [includeQuestion, setIncludeQuestion] = useState(false);
  const [reportNote, setReportNote] = useState('');
  const openReport = (messageId: string) => {
    report.reset();
    setReason(null);
    setIncludeQuestion(false);
    setReportNote('');
    setReporting(messageId);
  };
  const scroll = useRef<ScrollView>(null);
  const messages = conversation.data?.messages ?? [];

  useEffect(() => {
    const timer = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(timer);
  }, [messages.length, pending]);

  if (conversation.isPending) return <LoadingScreen />;
  if (conversation.error) return <ErrorState message={t(errorKey(conversation.error))} onRetry={() => void conversation.refetch()} />;
  const c = conversation.data;
  const shared = c.patientId ? patients.data?.find((p) => p.id === c.patientId) : null;
  const tooLong = [...draft].length > MAX_CHARS;
  const canSend = draft.trim().length > 0 && !tooLong && !send.isPending && status.data?.unavailableReason === null;

  const submit = () => {
    const content = draft.trim();
    if (!canSend) return;
    setPending(content);
    setDraft('');
    send.mutate(content, {
      onSettled: () => setPending(null),
      onError: () => setDraft((d) => d || content),
    });
  };

  return (
    <Screen
      testID="assistant-chat"
      scroll={false}
      edges={['top', 'bottom']}
      header={
        <Header
          back
          large={false}
          title={c.title}
          subtitle={shared ? t('assistant.sharingProfile', { name: shared.relationship === 'SELF' ? t('family.me') : shared.displayName }) : t('assistant.subtitle')}
          right={
            <PressableScale testID="assistant-delete" accessibilityRole="button" accessibilityLabel={t('assistant.deleteChat')} onPress={() => setConfirmDelete(true)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="trash-2" color="danger" />
            </PressableScale>
          }
        />
      }
      footer={
        <View style={{ gap: spacing.sm }}>
          {send.error ? <Notice tone="danger" body={errorText(send.error, status.data?.allowance)} testID="assistant-send-error" /> : null}
          {status.data?.unavailableReason ? <Notice tone="warning" body={t(`assistant.${status.data.unavailableReason}`)} /> : null}
          {tooLong ? <Text variant="caption" color="danger">{t('assistant.tooLong', { max: MAX_CHARS })}</Text> : null}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
            <TextInput
              testID="assistant-input"
              value={draft}
              onChangeText={setDraft}
              placeholder={t('assistant.placeholder')}
              placeholderTextColor={colors.textTertiary}
              multiline
              maxLength={MAX_CHARS + 200}
              accessibilityLabel={t('assistant.placeholder')}
              style={{
                flex: 1,
                minHeight: 44,
                maxHeight: 140,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radii.lg,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                color: colors.text,
                backgroundColor: colors.surface,
                fontFamily: typography.fontFamily.regular,
                fontSize: typography.size.callout,
                textAlign: isRTL ? 'right' : 'left',
                writingDirection: isRTL ? 'rtl' : 'ltr',
              }}
            />
            <Button testID="assistant-send" label={t('assistant.send')} size="md" fullWidth={false} disabled={!canSend} loading={send.isPending} onPress={submit} />
          </View>
          <Text variant="micro" color="textTertiary" align="center">
            {t('assistant.disclaimer', { number: EMERGENCY_NUMBER })}
          </Text>
        </View>
      }
    >
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.md, paddingVertical: spacing.md }}>
        {messages.map((m) => (
          <Bubble key={m.id} m={m} onReport={m.role === 'assistant' ? () => openReport(m.id) : undefined} />
        ))}
        {pending ? (
          <>
            <Bubble m={{ id: 'pending', role: 'user', kind: 'MESSAGE', content: pending, createdAt: new Date().toISOString(), reported: false }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }} testID="assistant-thinking">
              <ActivityIndicator color={colors.primary} />
              <Text variant="footnote" color="textSecondary">{t('assistant.sending')}</Text>
            </View>
          </>
        ) : null}
      </ScrollView>

      <Sheet visible={reporting !== null} onClose={() => setReporting(null)} title={t('assistant.reportTitle')} testID="assistant-report-sheet">
        {report.isSuccess ? (
          <>
            <Notice tone="success" body={t('assistant.reportDone')} testID="assistant-report-done" />
            <Button label={t('common.done')} onPress={() => setReporting(null)} />
          </>
        ) : (
          <>
            <Text variant="callout" color="textSecondary">{t('assistant.reportBody')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {AI_REPORT_REASONS.map((r) => (
                <Chip key={r} label={t(`assistant.reason_${r}`)} selected={reason === r} onPress={() => setReason(r)} testID={`assistant-report-reason-${r}`} />
              ))}
            </View>
            <Checkbox checked={includeQuestion} onChange={setIncludeQuestion} label={t('assistant.reportIncludeQuestion')} testID="assistant-report-include-question" />
            <TextField label={t('assistant.reportNote')} optional value={reportNote} onChangeText={setReportNote} maxLength={1000} multiline testID="assistant-report-note" />
            <Text variant="caption" color="textTertiary">{t('assistant.reportKept')}</Text>
            {report.error ? <Notice tone="danger" body={errorText(report.error)} /> : null}
            <Button
              testID="assistant-report-send"
              label={t('assistant.reportSend')}
              disabled={!reason}
              loading={report.isPending}
              onPress={() => reason && reporting && report.mutate({ messageId: reporting, reason, note: reportNote.trim() || undefined, includeQuestion })}
            />
          </>
        )}
      </Sheet>

      <Sheet visible={confirmDelete} onClose={() => setConfirmDelete(false)} title={t('assistant.deleteTitle')} testID="assistant-delete-sheet">
        <Text variant="callout" color="textSecondary">{t('assistant.deleteBody')}</Text>
        <Button
          testID="assistant-confirm-delete"
          label={t('assistant.deleteChat')}
          variant="danger"
          loading={remove.isPending}
          onPress={() => remove.mutate(c.id, { onSuccess: () => { setConfirmDelete(false); router.back(); } })}
        />
        <Button label={t('common.cancel')} variant="secondary" onPress={() => setConfirmDelete(false)} />
      </Sheet>
    </Screen>
  );
}
