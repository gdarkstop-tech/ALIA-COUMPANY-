import { radii, spacing } from '@ghayarly/tokens';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { api, errorKey } from '@/lib/api';
import { money } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Badge, Button, Card, EmptyState, ErrorState, Header, LoadingScreen, Notice, Screen, Text, useToast } from '@/ui';

export default function NurseServices() {
  const { t, pickL, locale } = useI18n();
  const { colors } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const services = useQuery({ queryKey: ['provider-services'], queryFn: () => api.provider.services() });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (services.data) setSelected(new Set(services.data.filter((s) => s.selected).map((s) => s.id)));
  }, [services.data]);
  const save = useMutation({
    mutationFn: () => api.provider.setServices({ services: [...selected].map((id) => ({ serviceId: id, pricePiasters: services.data?.find((s) => s.id === id)?.pricePiasters ?? null })) }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['provider-services'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast(t('provider.servicesSaved'));
    },
  });

  return (
    <Screen testID="services-screen" header={<Header title={t('provider.servicesTitle')} subtitle={t('provider.servicesSubtitle')} />} footer={services.data?.length ? <Button testID="save-services" label={t('common.save')} loading={save.isPending} onPress={() => save.mutate()} /> : null}>
      {save.error ? <Notice tone="danger" body={t(errorKey(save.error))} /> : null}
      {services.isPending ? (
        <LoadingScreen />
      ) : services.error ? (
        <ErrorState message={t(errorKey(services.error))} onRetry={() => void services.refetch()} />
      ) : services.data.length === 0 ? (
        <EmptyState icon="mci:medical-bag" title={t('provider.servicesTitle')} body={t('app.comingNext')} />
      ) : (
        <>
          {services.data.some((s) => s.isDemo) ? <Notice tone="demo" body={t('provider.demoPrices')} /> : null}
          {services.data.map((s) => {
            const on = selected.has(s.id);
            return (
              <Card key={s.id} testID={`service-${s.code}`} style={on ? { borderColor: colors.primary, borderWidth: 1.5 } : undefined}>
                <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
                  <View style={{ flex: 1, gap: spacing.xs }}>
                    <Text variant="callout" weight="semibold">{pickL(s, 'name')}</Text>
                    <Text variant="caption" color="textSecondary">{pickL(s, 'scope')}</Text>
                    <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: 2 }}>
                      <Badge label={t('common.minutes', { count: s.durationMinutes })} />
                      <Badge label={money(s.pricePiasters ?? s.basePricePiasters, locale)} tone="primary" />
                      {s.requiresClinicalAuthorization ? <Badge label={t('provider.requiresAuthorization')} tone="warning" icon="alert-circle" /> : null}
                    </View>
                  </View>
                  <View style={{ paddingTop: 2, borderRadius: radii.pill }}>
                    <Switch
                      testID={`service-toggle-${s.code}`}
                      accessibilityLabel={pickL(s, 'name')}
                      value={on}
                      onValueChange={(v) => setSelected((prev) => { const n = new Set(prev); if (v) n.add(s.id); else n.delete(s.id); return n; })}
                      trackColor={{ true: colors.accent, false: colors.border }}
                    />
                  </View>
                </View>
              </Card>
            );
          })}
        </>
      )}
    </Screen>
  );
}
