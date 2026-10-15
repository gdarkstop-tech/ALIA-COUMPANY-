import { LEGAL_DOCUMENTS, LEGAL_DOC_IDS, type LegalDocId } from '@ghayarly/shared';
import { spacing } from '@ghayarly/tokens';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { useI18n } from '@/providers/i18n';
import { EmptyState, Header, Notice, Screen, Text } from '@/ui';

/** In-app copy of a legal document — the same source published on the public support site. */
export default function LegalDocumentScreen() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const { t, locale } = useI18n();
  const id = (LEGAL_DOC_IDS as readonly string[]).includes(doc ?? '') ? (doc as LegalDocId) : null;
  if (!id) {
    return (
      <Screen header={<Header back title={t('legal.documents')} />}>
        <EmptyState title={t('errors.notFound')} />
      </Screen>
    );
  }
  const document = LEGAL_DOCUMENTS[id];
  const d = document[locale];
  return (
    <Screen testID={`legal-${id}`} header={<Header back title={d.title} subtitle={t('legal.version', { version: document.version })} />}>
      {document.status === 'DRAFT_PENDING_LEGAL_REVIEW' ? <Notice tone="warning" body={t('legal.draftNotice')} /> : null}
      <Text variant="callout" color="textSecondary">
        {d.summary}
      </Text>
      {d.sections.map((s) => (
        <View key={s.heading} style={{ gap: spacing.sm }}>
          <Text variant="title3" accessibilityRole="header">
            {s.heading}
          </Text>
          {s.paragraphs.map((p, i) => (
            <Text key={i} variant="body" color="textSecondary">
              {p}
            </Text>
          ))}
        </View>
      ))}
    </Screen>
  );
}
