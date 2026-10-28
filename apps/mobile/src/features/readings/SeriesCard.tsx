import type { HealthSeries } from '@ghayarly/shared';
import { radii, spacing } from '@ghayarly/tokens';
import { useState } from 'react';
import { View } from 'react-native';
import { provenanceTone } from '@/features/patient/provenance';
import { confirmDestructive } from '@/lib/confirm';
import { formatDate, ltr } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Badge, Button, Card, Icon, PressableScale, Text } from '@/ui';
import { useRemoveReading } from './hooks';
import { pointValue, TrendChart } from './TrendChart';

const signed = (x: number) => (x > 0 ? `+${x}` : `${x}`);

/** One measure: the latest MEASURED value, the chart, the CALCULATED figures, and a table view. */
export function SeriesCard({ series, patientId }: { series: HealthSeries; patientId: string }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const [table, setTable] = useState(false);
  const remove = useRemoveReading(patientId);
  const st = series.stats!;
  const title = series.kind ? t(`readings.kind_${series.kind}`) : series.label;
  const id = series.key.replace(/[^A-Za-z0-9_]/g, '_');
  const verified = st.latest.provenance === 'PROFESSIONALLY_VERIFIED';
  const change =
    st.change === null ? null : st.change === 0 && (st.change2 ?? 0) === 0 ? t('readings.change_UNCHANGED') : t(st.change >= 0 ? 'readings.change_HIGHER' : 'readings.change_LOWER', { difference: ltr(`${st.change2 !== null ? `${signed(st.change)}/${signed(st.change2)}` : Math.abs(st.change)} ${series.unit}`) });
  return (
    <Card style={{ gap: spacing.md }} testID={`series-${id}`}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="callout" weight="semibold">{title}</Text>
          {series.source === 'LAB' ? <Badge label={t('readings.labResult')} tone="info" /> : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text variant="title3" testID={`series-${id}-latest`}>
            {ltr(pointValue(st.latest))}
            <Text variant="footnote" color="textSecondary">{` ${ltr(series.unit)}`}</Text>
          </Text>
          <Text variant="caption" color="textSecondary">{formatDate(st.latest.at, locale)}</Text>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            <Badge label={t(verified ? 'readings.badge_VERIFIED' : 'readings.badge_MEASURED')} tone={verified ? 'success' : 'neutral'} icon={verified ? 'check' : undefined} />
          </View>
        </View>
      </View>

      {st.count >= 2 ? <TrendChart series={series} testID={`chart-${id}`} /> : <Text variant="footnote" color="textTertiary">{t('readings.oneReading')}</Text>}

      {st.count >= 2 ? (
        <View style={{ gap: 4, backgroundColor: colors.surfaceMuted, borderRadius: radii.md, padding: spacing.md }} testID={`series-${id}-calculated`}>
          <Badge label={t('readings.badge_CALCULATED')} tone="primary" />
          <Text variant="footnote" color="textSecondary">
            {t('readings.stats', { count: st.count, mean: ltr(st.mean2 !== null ? `${st.mean}/${st.mean2}` : `${st.mean}`), min: ltr(String(st.min)), max: ltr(String(st.max)) })}
          </Text>
          {change ? <Text variant="footnote" color="textSecondary" testID={`series-${id}-change`}>{change}</Text> : null}
        </View>
      ) : null}
      {series.printedRange && (series.printedRange.low !== null || series.printedRange.high !== null) ? <Text variant="caption" color="textTertiary">{t('readings.printedBand')} · {ltr(series.printedRange.text ?? '')}</Text> : null}

      <Button label={table ? t('readings.hideTable') : t('readings.showTable')} variant="ghost" size="sm" fullWidth={false} icon="list" onPress={() => setTable(!table)} testID={`series-${id}-table-toggle`} />
      {table ? (
        <View testID={`series-${id}-table`}>
          {[...series.points].reverse().map((p, i) => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: i ? 1 : 0, borderTopColor: colors.divider }}>
              <Text variant="footnote" color="textSecondary" style={{ flex: 1 }}>{formatDate(p.at, locale)}</Text>
              <Text variant="footnote" weight="semibold" tabular>{ltr(`${pointValue(p)} ${series.unit}`)}</Text>
              {p.provenance ? <Badge label={t(`health.provenance_${p.provenance}`)} tone={provenanceTone(p.provenance)} /> : null}
              {series.source === 'VITAL' && p.provenance !== 'PROFESSIONALLY_VERIFIED' ? (
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={t('readings.remove')}
                  onPress={() => confirmDestructive(t('readings.removeConfirm'), { cancel: t('common.cancel'), confirm: t('readings.remove') }, () => remove.mutate(p.id))}
                  style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Icon name="x" size={16} color="textTertiary" />
                </PressableScale>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}
