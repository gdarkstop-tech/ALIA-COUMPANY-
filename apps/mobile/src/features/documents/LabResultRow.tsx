import { EMERGENCY_NUMBERS, type LabRangeStatus, type LabResult } from '@ghayarly/shared';
import { radii, spacing } from '@ghayarly/tokens';
import { View } from 'react-native';
import { provenanceTone } from '@/features/patient/provenance';
import { formatDate, ltr } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Badge, Button, Notice, Text, type Tone } from '@/ui';

export const RANGE_TONE: Record<LabRangeStatus, Tone> = { LOW: 'warning', HIGH: 'warning', IN_RANGE: 'success', UNKNOWN: 'neutral' };

/**
 * One result row. The value, unit, range and flag are shown exactly as read (or typed); the range
 * chip compares only with the printed range. Rows still to check offer confirm / correct / reject.
 */
export function LabResultRow({ result, onConfirm, onCorrect, onReject, busy, first }: { result: LabResult; onConfirm?: () => void; onCorrect?: () => void; onReject?: () => void; busy?: boolean; first?: boolean }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const pending = result.reviewStatus === 'PENDING_REVIEW';
  return (
    <View testID={`lab-row-${result.testName}`} style={{ gap: spacing.sm, padding: spacing.lg, borderTopWidth: first ? 0 : 1, borderTopColor: colors.divider }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="callout" weight="semibold">{result.testName}</Text>
          <Text variant="caption" color="textSecondary">
            {result.referenceText ? t('documents.printedRange', { range: ltr(result.referenceText) }) : t('documents.noPrintedRange')}
            {result.printedFlag ? ` · ${t('documents.printedFlag', { flag: ltr(result.printedFlag) })}` : ''}
            {result.observedOn ? ` · ${formatDate(result.observedOn, locale)}` : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text variant="title3" tabular testID={`lab-value-${result.testName}`}>
            {ltr(result.valueText)}
            {result.unit ? <Text variant="footnote" color="textSecondary">{` ${ltr(result.unit)}`}</Text> : null}
          </Text>
          <Badge label={t(`documents.range_${result.rangeStatus}`)} tone={RANGE_TONE[result.rangeStatus]} testID={`lab-range-${result.testName}`} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        <Badge label={t(`documents.review_${result.reviewStatus}`)} tone={pending ? 'accent' : 'neutral'} />
        {result.provenance ? <Badge label={t(`health.provenance_${result.provenance}`)} tone={provenanceTone(result.provenance)} /> : null}
        {result.corrected ? <Badge label={t('documents.corrected')} icon="edit-2" /> : null}
      </View>
      {result.printedCritical ? <Notice tone="danger" body={t('documents.critical', { number: EMERGENCY_NUMBERS.ambulance })} testID={`lab-critical-${result.testName}`} /> : null}
      {pending && onConfirm ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, backgroundColor: colors.surfaceMuted, borderRadius: radii.md, padding: spacing.sm }}>
          <Button testID={`lab-confirm-${result.testName}`} label={t('documents.confirm')} icon="check" size="sm" fullWidth={false} onPress={onConfirm} disabled={busy} />
          <Button testID={`lab-correct-${result.testName}`} label={t('documents.correct')} icon="edit-2" variant="secondary" size="sm" fullWidth={false} onPress={onCorrect} disabled={busy} />
          <Button testID={`lab-reject-${result.testName}`} label={t('documents.reject')} icon="x" variant="ghost" size="sm" fullWidth={false} onPress={onReject} disabled={busy} />
        </View>
      ) : null}
    </View>
  );
}
