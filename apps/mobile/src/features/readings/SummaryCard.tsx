import type { HealthFact, HealthSummary, HealthSummaryStatus } from '@ghayarly/shared';
import { radii, spacing } from '@ghayarly/tokens';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { api } from '@/lib/api';
import { confirmDestructive } from '@/lib/confirm';
import { formatDate, formatNumber, ltr } from '@/lib/format';
import type { TranslationKey } from '@ghayarly/i18n';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Badge, Button, Card, Icon, Notice, Text } from '@/ui';
import { readingsErrorKey, useInvalidateReadings } from './hooks';

/** One calculated fact in the person's language (the model received the English form). */
export function useFactText() {
  const { t, locale } = useI18n();
  return (f: HealthFact) => {
    const kind = f.seriesKey.startsWith('VITAL:') ? f.seriesKey.slice(6) : null;
    const series = kind ? t(`readings.kind_${kind}` as TranslationKey) : f.seriesLabel;
    const d = f.display;
    const unit = ltr(f.unit);
    let body: string;
    switch (d.kind) {
      case 'LATEST':
      case 'PREVIOUS':
        body = t(`readings.fact_${d.kind}`, { value: ltr(d.value), unit, date: formatDate(d.date, locale) });
        break;
      case 'CHANGE':
        body = t(`readings.fact_CHANGE_${d.direction}`, { difference: ltr(d.difference), unit });
        break;
      case 'STATS':
        body = t('readings.fact_STATS', { count: d.count, days: d.days, mean: ltr(d.mean), min: ltr(String(d.min)), max: ltr(String(d.max)) });
        break;
      case 'RANGE':
        body = t(`readings.fact_RANGE_${d.status}`, { range: ltr(d.range) });
        break;
    }
    return `${series}: ${body}`;
  };
}

/** The AI summary: clearly labelled, every point shown with the calculated facts it relied on. */
export function SummaryCard({ patientId, days, status, latest }: { patientId: string; days: 30 | 90; status: HealthSummaryStatus; latest: HealthSummary | null }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const invalidate = useInvalidateReadings();
  const factText = useFactText();
  const create = useMutation({ mutationFn: () => api.health.createSummary(patientId, days), onSettled: () => invalidate() });
  const remove = useMutation({ mutationFn: (id: string) => api.health.removeSummary(id), onSuccess: () => invalidate() });
  const reason = status.unavailableReason;
  const facts = new Map((latest?.facts ?? []).map((f) => [f.id, f]));

  return (
    <Card style={{ gap: spacing.md }} testID="health-summary">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Icon name="mci:creation" color="accent" />
        <Text variant="callout" weight="semibold" style={{ flex: 1 }}>{t('readings.summaryTitle')}</Text>
        <Badge label={t('readings.badge_AI')} tone="accent" />
      </View>
      {reason === 'FEATURE_DISABLED' || reason === 'NOT_CONFIGURED' ? (
        <Notice tone="info" body={t('readings.summaryOff')} testID="health-summary-off" />
      ) : reason === 'PAUSED' ? (
        <Notice tone="warning" body={t('readings.summaryPaused')} />
      ) : reason === 'CONSENT_REQUIRED' || reason === 'HEALTH_CONSENT_REQUIRED' ? (
        <Notice tone="info" body={t(reason === 'CONSENT_REQUIRED' ? 'readings.summaryNeedsConsent' : 'readings.summaryNeedsHealth')}>
          <Button label={t('privacy.title')} variant="ghost" size="sm" fullWidth={false} onPress={() => router.push('/settings/privacy')} testID="health-summary-privacy" />
        </Notice>
      ) : (
        <View style={{ gap: spacing.sm }}>
          <Text variant="footnote" color="textSecondary">{t('readings.summaryBody')}</Text>
          {status.allowance ? (
            <Text variant="caption" color="textTertiary" testID="health-summary-allowance">
              {t('readings.summaryRemaining', { remaining: formatNumber(status.allowance.remaining, locale), limit: formatNumber(status.allowance.weeklyLimit, locale) })}
            </Text>
          ) : null}
          {create.error ? <Notice tone="danger" body={t(readingsErrorKey(create.error))} testID="health-summary-error" /> : null}
          {create.isPending ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }} accessibilityLiveRegion="polite">
              <ActivityIndicator color={colors.primary} />
              <Text variant="footnote" color="textSecondary">{t('readings.summaryWriting')}</Text>
            </View>
          ) : (
            <Button testID="health-summary-create" label={t('readings.summaryCreate', { days })} icon="mci:creation" variant="secondary" onPress={() => create.mutate()} disabled={status.allowance?.remaining === 0} />
          )}
        </View>
      )}

      {latest?.status === 'REFUSED' ? <Notice tone="info" body={t('readings.summaryStatus_REFUSED')} /> : null}
      {latest?.status === 'COMPLETED' && latest.content ? (
        <View style={{ gap: spacing.md }} testID="health-summary-content">
          <Notice tone="warning" icon="mci:creation" body={t('readings.summaryLabel')} />
          {latest.simulated ? <Badge label={t('readings.summarySimulated')} tone="demo" testID="health-summary-simulated" /> : null}
          <Text variant="caption" color="textTertiary">{t('readings.summaryWritten', { date: formatDate(latest.createdAt, locale), days: latest.periodDays })}</Text>
          {latest.content.points.map((p, i) => (
            <View key={i} style={{ gap: 6 }} testID={`health-summary-point-${i}`}>
              <Text variant="body">{p.text}</Text>
              <View style={{ borderStartWidth: 2, borderStartColor: colors.divider, paddingStart: spacing.sm, gap: 2, borderRadius: radii.xs }}>
                <Text variant="caption" weight="semibold" color="textTertiary">{t('readings.summaryBasedOn')} · {t('readings.badge_CALCULATED')}</Text>
                {p.facts.map((id) => (facts.get(id) ? <Text key={id} variant="caption" color="textSecondary">{factText(facts.get(id)!)}</Text> : null))}
              </View>
            </View>
          ))}
          {latest.content.questions.length ? (
            <View style={{ gap: 4 }}>
              <Text variant="footnote" weight="semibold">{t('readings.summaryQuestions')}</Text>
              {latest.content.questions.map((q) => (
                <Text key={q} variant="footnote" color="textSecondary">• {q}</Text>
              ))}
            </View>
          ) : null}
          <Button
            label={t('readings.summaryDelete')}
            variant="ghost"
            size="sm"
            fullWidth={false}
            icon="trash-2"
            onPress={() => confirmDestructive(t('readings.summaryDelete'), { cancel: t('common.cancel'), confirm: t('common.remove') }, () => remove.mutate(latest.id))}
            testID="health-summary-delete"
          />
        </View>
      ) : null}
    </Card>
  );
}
