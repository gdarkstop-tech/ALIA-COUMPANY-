import { AI_DETAIL_LEVELS, AI_REPLY_LANGUAGES } from '@ghayarly/shared';
import { spacing } from '@ghayarly/tokens';
import { View } from 'react-native';
import { useAssistantPreferences, useSetAssistantPreferences } from '@/features/assistant/hooks';
import { errorKey } from '@/lib/api';
import { useI18n } from '@/providers/i18n';
import { Card, ErrorState, Header, LoadingScreen, Notice, Screen, Segmented, Text } from '@/ui';

/** How the assistant answers this person. Server-validated; never changes the safety rules. */
export default function AssistantSettings() {
  const { t } = useI18n();
  const prefs = useAssistantPreferences();
  const save = useSetAssistantPreferences();
  if (prefs.isPending) return <LoadingScreen />;
  if (prefs.error) return <ErrorState message={t(errorKey(prefs.error))} onRetry={() => void prefs.refetch()} />;
  const p = prefs.data;
  return (
    <Screen testID="assistant-settings" header={<Header back title={t('assistant.settings')} subtitle={t('assistant.settingsBody')} />}>
      <Card style={{ gap: spacing.lg }}>
        <View style={{ gap: spacing.sm }}>
          <Text variant="callout" weight="semibold">{t('assistant.replyLanguage')}</Text>
          <Segmented
            testID="assistant-reply-language"
            value={p.replyLanguage}
            onChange={(v) => save.mutate({ replyLanguage: v })}
            options={AI_REPLY_LANGUAGES.map((v) => ({ value: v, label: t(`assistant.lang_${v}`) }))}
          />
        </View>
        <View style={{ gap: spacing.sm }}>
          <Text variant="callout" weight="semibold">{t('assistant.detailLevel')}</Text>
          <Segmented
            testID="assistant-detail-level"
            value={p.detailLevel}
            onChange={(v) => save.mutate({ detailLevel: v })}
            options={AI_DETAIL_LEVELS.map((v) => ({ value: v, label: t(`assistant.detail_${v}`) }))}
          />
        </View>
        <Text variant="caption" color="textTertiary">{t('assistant.nameHint')}</Text>
      </Card>
      {save.error ? <Notice tone="danger" body={t(errorKey(save.error))} /> : null}
    </Screen>
  );
}
