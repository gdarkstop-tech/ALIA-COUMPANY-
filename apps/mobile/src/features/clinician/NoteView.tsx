import { DOC_SECTIONS, type ClinicalDraft } from '@ghayarly/shared';
import { spacing } from '@ghayarly/tokens';
import { View } from 'react-native';
import { useI18n } from '@/providers/i18n';
import { Text } from '@/ui';

/** A note's sections, read-only (signed notes for the person; signed notes for the clinician). */
export function NoteView({ note }: { note: Pick<ClinicalDraft, 'docType' | 'content'> }) {
  const { t } = useI18n();
  const content = note.content ?? {};
  return (
    <View style={{ gap: spacing.sm }}>
      {DOC_SECTIONS[note.docType].map((k) => {
        const v = content[k];
        if (!v || (Array.isArray(v) && !v.length)) return null;
        return (
          <View key={k} style={{ gap: 2 }}>
            <Text variant="footnote" weight="semibold" color="textSecondary">{t(`copilot.section_${k}` as Parameters<typeof t>[0])}</Text>
            {Array.isArray(v) ? v.map((x, i) => <Text key={i} variant="body">• {x}</Text>) : <Text variant="body">{v}</Text>}
          </View>
        );
      })}
    </View>
  );
}
