import { radii, spacing } from '@ghayarly/tokens';
import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { api, errorKey } from '@/lib/api';
import { formatDate, money } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Badge, Card, EmptyState, ErrorState, Header, Icon, LoadingScreen, Notice, Screen, Section, Text } from '@/ui';

/** Provider-facing earnings focus on NET amounts (spec §12). */
export default function Earnings() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const q = useQuery({ queryKey: ['earnings'], queryFn: () => api.provider.earnings() });
  const e = q.data;
  return (
    <Screen testID="earnings-screen" header={<Header title={t('provider.netEarnings')} />} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      {q.isPending ? (
        <LoadingScreen />
      ) : q.error ? (
        <ErrorState message={t(errorKey(q.error))} onRetry={() => void q.refetch()} />
      ) : e ? (
        <>
          {e.containsDemoData ? <Notice tone="demo" title={t('app.demoData')} body={t('provider.demoEarnings')} testID="earnings-demo-notice" /> : null}
          <Animated.View entering={FadeInDown.duration(400)}>
            <View style={{ backgroundColor: colors.surfaceInverse, borderRadius: radii.xl, padding: spacing.xxl, gap: spacing.sm }}>
              <Text variant="footnote" style={{ color: colors.textInverse, opacity: 0.75 }}>{t('provider.youEarnedToday')}</Text>
              <Text variant="display" tabular style={{ color: colors.textInverse }} testID="earned-today">{money(e.todayNetPiasters, locale)}</Text>
              <Text variant="footnote" style={{ color: colors.textInverse, opacity: 0.75 }}>{t('provider.completedVisitsToday', { count: e.todayCompletedVisits })}</Text>
            </View>
          </Animated.View>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            {[
              [t('provider.thisWeek'), e.weekNetPiasters, 'trending-up', 'week'],
              [t('provider.availableForPayout'), e.availableForPayoutPiasters, 'mci:bank-outline', 'available'],
              [t('provider.pending'), e.pendingPiasters, 'clock', 'pending'],
            ].map(([label, v, icon, id]) => (
              <Card key={id as string} style={{ flex: 1, padding: spacing.lg, gap: spacing.xs }} testID={`earnings-${id}`}>
                <Icon name={icon as 'clock'} size={18} color="primary" />
                <Text variant="micro" color="textTertiary">{label as string}</Text>
                <Text variant="callout" weight="bold" tabular>{money(v as number, locale)}</Text>
              </Card>
            ))}
          </View>
          {!e.payoutsEnabled ? <Notice tone="warning" icon="mci:bank-off-outline" body={t('provider.payoutsNotConfigured')} /> : null}
          <Text variant="caption" color="textTertiary">{t('provider.earningsDisclosure')}</Text>
          <Section title={t('provider.ledgerTitle')}>
            {e.entries.length === 0 ? (
              <Card><EmptyState compact icon="mci:wallet-outline" title={t('provider.netEarnings')} body={t('provider.earningsEmpty')} /></Card>
            ) : (
              <Card padded={false}>
                {e.entries.map((l, i) => (
                  <View key={l.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderTopWidth: i ? 1 : 0, borderTopColor: colors.divider }}>
                    <View style={{ width: 36, height: 36, borderRadius: radii.md, backgroundColor: l.amountPiasters >= 0 ? colors.successSoft : colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name={l.entryType === 'PAYOUT' ? 'mci:bank-transfer-out' : 'mci:medical-bag'} size={18} color={l.amountPiasters >= 0 ? 'success' : 'textSecondary'} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="footnote" weight="semibold">{t(`provider.entry_${l.entryType}`)}</Text>
                      <Text variant="caption" color="textTertiary">{formatDate(l.occurredAt, locale)} · {t(`provider.ledger_${l.status}`)}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                      <Text variant="footnote" weight="bold" tabular color={l.amountPiasters >= 0 ? 'success' : 'textSecondary'}>
                        {l.amountPiasters >= 0 ? '+' : ''}{money(l.amountPiasters, locale)}
                      </Text>
                      {l.isDemo ? <Badge label={t('app.demoBadge')} tone="demo" /> : null}
                    </View>
                  </View>
                ))}
              </Card>
            )}
          </Section>
        </>
      ) : null}
    </Screen>
  );
}
