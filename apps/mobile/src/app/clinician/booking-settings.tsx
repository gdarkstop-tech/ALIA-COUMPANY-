import { DOCTOR_OFFERING_KINDS, GOVERNORATES, type DoctorOfferingKind, type Governorate } from '@ghayarly/shared';
import { spacing } from '@ghayarly/tokens';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { cairoDay, cairoTime } from '@/features/booking/shared';
import { api, errorKey } from '@/lib/api';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Button, Card, Chip, ErrorState, Header, ListRow, LoadingScreen, Notice, Screen, Section, Select, Text, TextField, useToast } from '@/ui';

type Draft = { kind: DoctorOfferingKind; on: boolean; duration: number; price: string; addrAr: string; addrEn: string };
const DURATIONS = [15, 20, 30, 45, 60, 90] as const;

/** Cairo wall time "YYYY-MM-DD HH:MM" → ISO instant (Egypt is UTC+2, or UTC+3 in summer time). */
function cairoInputToIso(v: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as number[];
  for (const offset of [2, 3]) {
    const guess = new Date(Date.UTC(y!, mo! - 1, d!, h! - offset, mi!));
    const back = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(guess).replace(',', '');
    if (back === `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`) return guess.toISOString();
  }
  return null;
}

export default function BookingSettings() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['provider', 'me'], queryFn: () => api.provider.me() });
  const isDoctor = me.data?.profile?.providerType === 'DOCTOR';
  const offerings = useQuery({ queryKey: ['offerings'], enabled: isDoctor, queryFn: () => api.appointments.offerings() });
  const coverage = useQuery({ queryKey: ['coverage'], queryFn: () => api.appointments.coverage() });
  const timeOff = useQuery({ queryKey: ['time-off'], queryFn: () => api.appointments.timeOff() });
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [areas, setAreas] = useState<{ governorate: Governorate; city: string }[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!offerings.data) return;
    setDrafts(
      DOCTOR_OFFERING_KINDS.filter((k) => k !== 'DOCTOR_ONLINE').map((kind) => {
        const o = offerings.data.find((x) => x.kind === kind);
        return { kind, on: Boolean(o?.active), duration: o?.durationMinutes ?? 30, price: o ? String(o.pricePiasters / 100) : '', addrAr: o?.clinicAddressAr ?? '', addrEn: o?.clinicAddressEn ?? '' };
      }),
    );
  }, [offerings.data]);
  useEffect(() => {
    if (coverage.data) setAreas(coverage.data.map((a) => ({ governorate: a.governorate as Governorate, city: a.city ?? '' })));
  }, [coverage.data]);

  const onError = (e: unknown) => setError(t(errorKey(e)));
  const saveOfferings = useMutation({
    mutationFn: () =>
      api.appointments.setOfferings({
        offerings: drafts
          .filter((d) => d.on || offerings.data?.some((o) => o.kind === d.kind))
          .map((d) => ({ kind: d.kind, durationMinutes: d.duration as 30, pricePiasters: Math.round(Number(d.price || '0') * 100), clinicAddressAr: d.addrAr.trim() || null, clinicAddressEn: d.addrEn.trim() || null, active: d.on })),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['offerings'] });
      toast(t('booking.saved'));
      setError(null);
    },
    onError,
  });
  const saveCoverage = useMutation({
    mutationFn: () => api.appointments.setCoverage({ areas: areas.map((a) => ({ governorate: a.governorate, city: a.city.trim() || null })) }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['coverage'] });
      toast(t('booking.saved'));
      setError(null);
    },
    onError,
  });
  const addOff = useMutation({
    mutationFn: () => api.appointments.addTimeOff({ startsAt: cairoInputToIso(from)!, endsAt: cairoInputToIso(to)! }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['time-off'] });
      setFrom('');
      setTo('');
      toast(t('booking.saved'));
      setError(null);
    },
    onError,
  });
  const removeOff = useMutation({ mutationFn: (id: string) => api.appointments.removeTimeOff(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['time-off'] }) });

  if (me.isPending) return <Screen header={<Header back title={t('booking.settingsTitle')} large={false} />}><LoadingScreen /></Screen>;
  if (me.error) return <Screen header={<Header back title={t('booking.settingsTitle')} large={false} />}><ErrorState message={t(errorKey(me.error))} /></Screen>;

  return (
    <Screen testID="booking-settings" header={<Header back title={t('booking.settingsTitle')} />}>
      {error ? <Notice tone="danger" body={error} /> : null}

      {isDoctor ? (
        <Section title={t('booking.offeringsTitle')}>
          <Text variant="footnote" color="textSecondary">{t('booking.offeringsHint')}</Text>
          {drafts.map((d, i) => (
            <Card key={d.kind}>
              <View style={{ gap: spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text variant="callout" weight="semibold">{t(`booking.kind_${d.kind}`)}</Text>
                  <Switch
                    testID={`offering-${d.kind}`}
                    accessibilityLabel={t(`booking.kind_${d.kind}`)}
                    value={d.on}
                    onValueChange={(on) => setDrafts((x) => x.map((y, j) => (j === i ? { ...y, on } : y)))}
                    trackColor={{ true: colors.accent, false: colors.border }}
                  />
                </View>
                {d.on ? (
                  <>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                      {DURATIONS.map((m) => (
                        <Chip key={m} label={t('common.minutes', { count: m })} selected={d.duration === m} onPress={() => setDrafts((x) => x.map((y, j) => (j === i ? { ...y, duration: m } : y)))} />
                      ))}
                    </View>
                    <TextField
                      testID={`offering-price-${d.kind}`}
                      label={t('booking.priceEgp')}
                      value={d.price}
                      onChangeText={(price) => setDrafts((x) => x.map((y, j) => (j === i ? { ...y, price: price.replace(/[^0-9.]/g, '') } : y)))}
                      keyboardType="decimal-pad"
                      ltr
                    />
                    {d.kind === 'DOCTOR_CLINIC' ? (
                      <>
                        <TextField label={t('booking.clinicAddressAr')} value={d.addrAr} onChangeText={(addrAr) => setDrafts((x) => x.map((y, j) => (j === i ? { ...y, addrAr } : y)))} />
                        <TextField label={t('booking.clinicAddressEn')} value={d.addrEn} onChangeText={(addrEn) => setDrafts((x) => x.map((y, j) => (j === i ? { ...y, addrEn } : y)))} ltr />
                      </>
                    ) : null}
                  </>
                ) : null}
              </View>
            </Card>
          ))}
          <Notice tone="info" body={t('booking.block_VIDEO_NOT_CONFIGURED')} />
          <Button testID="offerings-save" label={t('common.save')} loading={saveOfferings.isPending} onPress={() => saveOfferings.mutate()} />
        </Section>
      ) : (
        <Notice tone="info" body={t('booking.approvedPrice')} />
      )}

      <Section title={t('booking.coverageTitle')}>
        <Text variant="footnote" color="textSecondary">{t('booking.coverageHint')}</Text>
        {areas.map((a, i) => (
          <Card key={i}>
            <View style={{ gap: spacing.sm }}>
              <Select
                label={t('onboarding.governorate')}
                value={a.governorate}
                onChange={(g) => setAreas((x) => x.map((y, j) => (j === i ? { ...y, governorate: g } : y)))}
                options={GOVERNORATES.map((g) => ({ value: g, label: t(`governorate.${g}`) }))}
              />
              <TextField label={t('booking.city')} value={a.city} onChangeText={(city) => setAreas((x) => x.map((y, j) => (j === i ? { ...y, city } : y)))} optional />
              <Button label={t('common.remove')} variant="ghost" size="sm" onPress={() => setAreas((x) => x.filter((_, j) => j !== i))} />
            </View>
          </Card>
        ))}
        <Button
          label={t('booking.addArea')}
          variant="secondary"
          icon="plus"
          onPress={() => setAreas((x) => [...x, { governorate: (me.data?.profile?.governorate as Governorate | undefined) ?? 'CAIRO', city: '' }])}
        />
        <Button testID="coverage-save" label={t('common.save')} loading={saveCoverage.isPending} onPress={() => saveCoverage.mutate()} />
      </Section>

      <Section title={t('booking.timeOffTitle')}>
        <Text variant="footnote" color="textSecondary">{t('booking.timeOffHint')}</Text>
        {(timeOff.data ?? []).map((o) => (
          <ListRow
            key={o.id}
            icon="moon"
            title={`${cairoDay(o.startsAt, locale)} ${cairoTime(o.startsAt, locale)}`}
            subtitle={`→ ${cairoDay(o.endsAt, locale)} ${cairoTime(o.endsAt, locale)}`}
            trailing={<Button label={t('common.remove')} variant="ghost" size="sm" fullWidth={false} onPress={() => removeOff.mutate(o.id)} />}
          />
        ))}
        <TextField testID="time-off-from" label={t('booking.from')} value={from} onChangeText={setFrom} ltr placeholder="2026-12-24 09:00" />
        <TextField testID="time-off-to" label={t('booking.to')} value={to} onChangeText={setTo} ltr placeholder="2026-12-26 21:00" />
        <Text variant="caption" color="textTertiary">{t('booking.timesInCairo')}</Text>
        <Button
          testID="time-off-add"
          label={t('booking.addTimeOff')}
          variant="secondary"
          loading={addOff.isPending}
          onPress={() => (cairoInputToIso(from) && cairoInputToIso(to) ? addOff.mutate() : setError(t('errors.invalidDate')))}
        />
      </Section>
    </Screen>
  );
}
