import type { DocumentAiStatus, LabResult, MedicalDocumentDetail } from '@ghayarly/shared';
import { spacing } from '@ghayarly/tokens';
import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { consentErrorKey, useConsents, useRecordConsents } from '@/features/compliance/hooks';
import { MedicalDisclaimer } from '@/features/compliance/Safety';
import { fileSize } from '@/features/documents/format';
import { documentErrorKey, useDocument, useDocumentAi, useInvalidateDocuments, useReviewResult } from '@/features/documents/hooks';
import { LabResultRow } from '@/features/documents/LabResultRow';
import { LabResultSheet, type LabResultSheetMode } from '@/features/documents/LabResultSheet';
import { api, errorKey } from '@/lib/api';
import { confirmDestructive } from '@/lib/confirm';
import { formatDate, formatNumber } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Badge, Button, Card, ErrorState, Header, Icon, LoadingScreen, Notice, Screen, Section, Text } from '@/ui';

/** Opens a single-use link to the original (the link is never stored). */
async function openOriginal(id: string) {
  const { url } = await api.documents.viewLink(id);
  if (Platform.OS === 'web') window.open(url, '_blank', 'noopener');
  else await WebBrowser.openBrowserAsync(url);
}

/** Reading with AI: what is possible right now, the inline document consent, and the read action. */
function AiCard({ doc, status }: { doc: MedicalDocumentDetail; status: DocumentAiStatus }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const consents = useConsents();
  const record = useRecordConsents();
  const invalidate = useInvalidateDocuments();
  const read = useMutation({ mutationFn: () => api.documents.extract(doc.id), onSettled: () => invalidate() });
  const reason = status.unavailableReason;
  const running = read.isPending || doc.latestExtraction?.status === 'PENDING';

  let body: ReactNode;
  if (doc.kind !== 'LAB_REPORT') body = <Notice tone="info" body={t('documents.notLabReport')} />;
  else if (reason === 'FEATURE_DISABLED' || reason === 'NOT_CONFIGURED') body = <Notice tone="info" body={t('documents.aiOff')} testID="document-ai-off" />;
  else if (reason === 'PAUSED') body = <Notice tone="warning" body={t('documents.aiPaused')} />;
  else if (reason === 'CONSENT_REQUIRED')
    body = (
      <Notice tone="info" body={t('documents.aiNeedsAssistantConsent')}>
        <Button label={t('privacy.title')} variant="ghost" size="sm" fullWidth={false} onPress={() => router.push('/settings/privacy')} />
      </Notice>
    );
  else if (reason === 'DOCUMENT_CONSENT_REQUIRED')
    body = (
      <View style={{ gap: spacing.sm }} testID="document-ai-consent">
        <Text variant="callout" weight="semibold">{t('documents.aiConsentTitle')}</Text>
        <Text variant="footnote" color="textSecondary">{t('documents.aiConsentBody')}</Text>
        {record.error ? <Notice tone="danger" body={t(consentErrorKey(record.error))} /> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Button
            testID="document-ai-consent-allow"
            label={t('documents.aiConsentAllow')}
            size="sm"
            fullWidth={false}
            loading={record.isPending}
            disabled={!consents.data}
            onPress={() => record.mutate({ state: consents.data!, answers: { AI_DOCUMENT_PROCESSING: true } }, { onSuccess: () => void invalidate() })}
          />
          <Button label={t('documents.aiConsentRead')} variant="ghost" size="sm" fullWidth={false} onPress={() => router.push('/legal/ai-document-consent' as Href)} />
        </View>
      </View>
    );
  else
    body = (
      <View style={{ gap: spacing.sm }}>
        <Text variant="footnote" color="textSecondary">{t('documents.aiBody')}</Text>
        {status.allowance ? (
          <Text variant="caption" color="textTertiary" testID="document-ai-allowance">
            {t('documents.aiRemaining', { remaining: formatNumber(status.allowance.remaining, locale), limit: formatNumber(status.allowance.weeklyLimit, locale) })}
          </Text>
        ) : null}
        {read.error ? <Notice tone="danger" body={t(documentErrorKey(read.error))} testID="document-ai-error" /> : null}
        {doc.latestExtraction?.status === 'COMPLETED' ? (
          <Notice tone="success" body={t('documents.status_COMPLETED')} testID="document-ai-done" />
        ) : running ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }} accessibilityLiveRegion="polite">
            <ActivityIndicator color={colors.primary} />
            <Text variant="footnote" color="textSecondary">{t('documents.aiReading')}</Text>
          </View>
        ) : (
          <Button testID="document-ai-read" label={t('documents.aiRead')} icon="mci:text-recognition" onPress={() => read.mutate()} disabled={status.allowance?.remaining === 0} />
        )}
      </View>
    );

  return (
    <Card style={{ gap: spacing.md }} testID="document-ai">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Icon name="mci:creation" color="accent" />
        <Text variant="callout" weight="semibold" style={{ flex: 1 }}>{t('documents.aiTitle')}</Text>
      </View>
      {body}
    </Card>
  );
}

export default function DocumentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const router = useRouter();
  const doc = useDocument(id);
  const ai = useDocumentAi();
  const review = useReviewResult();
  const invalidate = useInvalidateDocuments();
  const [sheet, setSheet] = useState<LabResultSheetMode | null>(null);
  const open = useMutation({ mutationFn: () => openOriginal(id!) });
  const remove = useMutation({
    mutationFn: () => api.documents.remove(id!),
    onSuccess: async () => {
      await invalidate();
      router.back();
    },
  });

  if (doc.isPending) return <Screen><LoadingScreen /></Screen>;
  if (doc.error) return <Screen header={<Header back title={t('documents.title')} />}><ErrorState message={t(errorKey(doc.error))} onRetry={() => void doc.refetch()} /></Screen>;
  const d = doc.data;
  const x = d.latestExtraction;
  const decide = (r: LabResult, decision: 'CONFIRM' | 'REJECT') => review.mutate({ result: r, body: { decision } });

  return (
    <Screen testID="document-detail" header={<Header back title={d.title} subtitle={t(`documents.kind_${d.kind}`)} />} refreshing={doc.isRefetching} onRefresh={() => void doc.refetch()}>
      <Card style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Icon name={d.contentType === 'application/pdf' ? 'mci:file-pdf-box' : 'mci:image-outline'} size={28} color="primary" />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="callout" weight="semibold">{d.title}</Text>
            <Text variant="caption" color="textSecondary">
              {t('documents.fileInfo', { type: d.contentType === 'application/pdf' ? 'PDF' : d.contentType.split('/')[1]!.toUpperCase(), size: fileSize(d.byteSize) })} · {formatDate(d.documentDate ?? d.createdAt, locale)}
            </Text>
          </View>
        </View>
        {open.error ? <Notice tone="danger" body={t(errorKey(open.error))} /> : null}
        <Button testID="document-open" label={t('documents.openOriginal')} icon="external-link" variant="secondary" size="sm" fullWidth={false} loading={open.isPending} onPress={() => open.mutate()} />
      </Card>

      {ai.data ? <AiCard doc={d} status={ai.data} /> : null}

      {x && x.status !== 'COMPLETED' && x.status !== 'PENDING' ? <Notice tone={x.status === 'FAILED' ? 'warning' : 'info'} body={t(`documents.status_${x.status}`)} testID="document-extraction-status" /> : null}

      {d.results.length ? (
        <Section title={t('documents.reviewTitle')} testID="document-review">
          <Notice tone="warning" icon="mci:creation" body={t('documents.reviewBody')} />
          {x?.simulated ? <Badge label={t('documents.simulated')} tone="demo" testID="document-simulated" /> : null}
          {x?.completedAt ? <Text variant="caption" color="textTertiary">{t('documents.readOn', { date: formatDate(x.completedAt, locale) })}{x.labName ? ` · ${x.labName}` : ''}</Text> : null}
          {review.error ? <Notice tone="danger" body={t(documentErrorKey(review.error))} /> : null}
          <Card padded={false}>
            {d.results.map((r, i) => (
              <LabResultRow
                key={r.id}
                result={r}
                first={i === 0}
                busy={review.isPending}
                onConfirm={() => decide(r, 'CONFIRM')}
                onCorrect={() => setSheet({ kind: 'correct', result: r })}
                onReject={() => decide(r, 'REJECT')}
              />
            ))}
          </Card>
          <Text variant="caption" color="textTertiary">{t('documents.rangeExplainer')}</Text>
        </Section>
      ) : x?.status === 'COMPLETED' ? (
        <Notice tone="info" body={t('documents.noRows')} />
      ) : null}

      <Button testID="document-manual-add" label={t('documents.manualAdd')} icon="plus" variant="ghost" onPress={() => setSheet({ kind: 'manual', patientId: d.patientId, documentId: d.id })} />
      {remove.error ? <Notice tone="danger" body={t(errorKey(remove.error))} /> : null}
      <Button
        testID="document-delete"
        label={t('documents.deleteDoc')}
        icon="trash-2"
        variant="danger"
        loading={remove.isPending}
        onPress={() => confirmDestructive(t('documents.deleteConfirm'), { cancel: t('common.cancel'), confirm: t('common.remove') }, () => remove.mutate())}
      />
      <MedicalDisclaimer />
      <LabResultSheet mode={sheet} onClose={() => setSheet(null)} />
    </Screen>
  );
}
