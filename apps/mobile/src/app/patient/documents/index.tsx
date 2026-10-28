import type { MedicalDocument } from '@ghayarly/shared';
import { radii, spacing } from '@ghayarly/tokens';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useConsents } from '@/features/compliance/hooks';
import { MedicalDisclaimer } from '@/features/compliance/Safety';
import { fileSize } from '@/features/documents/format';
import { useDocuments, useLabResults } from '@/features/documents/hooks';
import { LabResultRow } from '@/features/documents/LabResultRow';
import { LabResultSheet, type LabResultSheetMode } from '@/features/documents/LabResultSheet';
import { UploadSheet } from '@/features/documents/UploadSheet';
import { useActivePatient } from '@/features/patient/hooks';
import { ProfileSwitcher } from '@/features/patient/ProfileSwitcher';
import { errorKey } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Badge, Button, Card, ErrorState, Header, Icon, LoadingScreen, Notice, PressableScale, Screen, Section, Text } from '@/ui';

function DocumentRow({ doc, first, onPress }: { doc: MedicalDocument; first: boolean; onPress: () => void }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const pdf = doc.contentType === 'application/pdf';
  return (
    <PressableScale testID={`document-${doc.title}`} accessibilityRole="button" accessibilityLabel={doc.title} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderTopWidth: first ? 0 : 1, borderTopColor: colors.divider }}>
      <View style={{ width: 40, height: 40, borderRadius: radii.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={pdf ? 'mci:file-pdf-box' : 'mci:image-outline'} color="primary" />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text variant="callout" weight="semibold">{doc.title}</Text>
        <Text variant="caption" color="textSecondary">
          {t(`documents.kind_${doc.kind}`)} · {formatDate(doc.documentDate ?? doc.createdAt, locale)} · {fileSize(doc.byteSize)}
        </Text>
        {doc.pendingReview > 0 ? <Badge label={t('documents.pendingCount', { count: doc.pendingReview })} tone="accent" testID={`document-pending-${doc.title}`} /> : null}
      </View>
      <Icon name="chevron-right" color="textTertiary" />
    </PressableScale>
  );
}

/** Lab reports and other documents of the active profile, and its confirmed results. */
export default function Documents() {
  const { t } = useI18n();
  const router = useRouter();
  const { data: patients, active, setActive, isPending } = useActivePatient();
  const docs = useDocuments(active?.id);
  const results = useLabResults(active?.id);
  const consents = useConsents();
  const [uploading, setUploading] = useState(false);
  const [sheet, setSheet] = useState<LabResultSheetMode | null>(null);

  if (isPending || !active) return <Screen><LoadingScreen /></Screen>;
  const healthOff = consents.data ? !consents.data.healthDataConsented : false;

  return (
    <Screen testID="documents" header={<Header back title={t('documents.title')} subtitle={t('documents.subtitle')} />} refreshing={docs.isRefetching} onRefresh={() => void Promise.all([docs.refetch(), results.refetch()])}>
      {patients ? <ProfileSwitcher patients={patients} activeId={active.id} onSelect={setActive} /> : null}
      {healthOff ? (
        <Notice tone="warning" title={t('privacy.healthData')} body={t('privacy.healthDataOff')}>
          <Button label={t('privacy.title')} variant="ghost" size="sm" fullWidth={false} onPress={() => router.push('/settings/privacy')} />
        </Notice>
      ) : (
        <Button testID="document-upload-open" label={t('documents.upload')} icon="upload" onPress={() => setUploading(true)} />
      )}

      <Section title={t('documents.listTitle')}>
        {docs.isPending ? (
          <LoadingScreen />
        ) : docs.error ? (
          <ErrorState message={t(errorKey(docs.error))} onRetry={() => void docs.refetch()} />
        ) : (
          <Card padded={false}>
            {docs.data.length === 0 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg }}>
                <Icon name="mci:file-document-outline" color="textTertiary" />
                <Text variant="footnote" color="textTertiary" style={{ flex: 1 }}>{t('documents.empty')}</Text>
              </View>
            ) : (
              docs.data.map((d, i) => <DocumentRow key={d.id} doc={d} first={i === 0} onPress={() => router.push(`/patient/documents/${d.id}` as Href)} />)
            )}
          </Card>
        )}
      </Section>

      <Section title={t('documents.resultsTitle')} testID="lab-results" action={healthOff ? undefined : <Button testID="lab-add" label={t('documents.manualAdd')} icon="plus" variant="ghost" size="sm" fullWidth={false} onPress={() => setSheet({ kind: 'manual', patientId: active.id })} />}>
        <Card padded={false}>
          {results.data?.length ? (
            results.data.map((r, i) => <LabResultRow key={r.id} result={r} first={i === 0} />)
          ) : (
            <View style={{ padding: spacing.lg }}>
              <Text variant="footnote" color="textTertiary">{t('documents.resultsEmpty')}</Text>
            </View>
          )}
        </Card>
        <Text variant="caption" color="textTertiary">{t('documents.rangeExplainer')}</Text>
      </Section>

      <MedicalDisclaimer />
      <UploadSheet patientId={active.id} visible={uploading} onClose={() => setUploading(false)} />
      <LabResultSheet mode={sheet} onClose={() => setSheet(null)} />
    </Screen>
  );
}
