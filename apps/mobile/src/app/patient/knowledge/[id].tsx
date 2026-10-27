import { spacing } from '@ghayarly/tokens';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { View } from 'react-native';
import { api, errorKey } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { Button, Card, ErrorState, Header, LoadingScreen, Screen, Text } from '@/ui';

/** A clinically approved knowledge version the assistant cited, with its source. */
export default function KnowledgeArticle() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const v = useQuery({ queryKey: ['knowledge', id], queryFn: () => api.knowledge.version(id!), enabled: Boolean(id) });
  if (v.isPending) return <LoadingScreen />;
  if (v.error) return <ErrorState message={t(errorKey(v.error))} onRetry={() => void v.refetch()} />;
  const a = v.data;
  return (
    <Screen testID="knowledge-article" header={<Header back title={a.title} subtitle={a.summary || undefined} />}>
      <View style={{ gap: spacing.md }}>
        {a.body.split(/\n\s*\n/).map((p, i) => (
          <Text key={i} variant="body" color="textSecondary" style={{ writingDirection: a.locale === 'ar' ? 'rtl' : 'ltr' }}>
            {p.trim()}
          </Text>
        ))}
      </View>
      <Card style={{ gap: spacing.sm }}>
        <Text variant="footnote" weight="semibold">
          {t('assistant.sourceFrom', { publisher: a.sourcePublisher, title: a.sourceTitle, date: a.sourceDate ? ` (${formatDate(a.sourceDate, locale)})` : '' })}
        </Text>
        <Text variant="caption" color="textTertiary">{t('assistant.sourceReviewed', { date: formatDate(a.approvedAt, locale), version: a.version })}</Text>
        {a.sourceUrl ? <Button label={t('assistant.openSource')} variant="secondary" size="sm" fullWidth={false} icon="external-link" onPress={() => void WebBrowser.openBrowserAsync(a.sourceUrl!)} /> : null}
      </Card>
    </Screen>
  );
}
