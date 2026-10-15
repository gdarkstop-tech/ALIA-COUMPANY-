import { availabilityOptionsFor, type AvailabilityStatus } from '@ghayarly/shared';
import { radii, spacing } from '@ghayarly/tokens';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { useMyProvider, useSetMyProvider } from '@/features/provider/hooks';
import { api, errorKey } from '@/lib/api';
import { isValidIsoDate, maskDate, minutesToTime } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Button, Card, ErrorState, Header, Icon, LoadingScreen, Notice, PressableScale, Screen, Section, Text, TextField, useToast } from '@/ui';

const ORDER = [6, 0, 1, 2, 3, 4, 5];
type Slot = { weekday: number; startMinute: number; endMinute: number };

function Stepper({ value, onChange, min, max, step = 1, format, testID }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; format?: (v: number) => string; testID?: string }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const target = { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' } as const;
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface }}>
      <PressableScale accessibilityRole="button" accessibilityLabel={t('common.decrease')} accessibilityValue={{ text: format ? format(value) : String(value) }} onPress={() => onChange(Math.max(min, value - step))} style={target}>
        <Icon name="minus" size={16} />
      </PressableScale>
      <Text weight="semibold" tabular style={{ minWidth: 56, textAlign: 'center' }}>{format ? format(value) : value}</Text>
      <PressableScale accessibilityRole="button" accessibilityLabel={t('common.increase')} accessibilityValue={{ text: format ? format(value) : String(value) }} onPress={() => onChange(Math.min(max, value + step))} style={target}>
        <Icon name="plus" size={16} />
      </PressableScale>
    </View>
  );
}

const stepperRow = { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md } as const;
const stepperLabel = { flexGrow: 1, flexShrink: 1, flexBasis: 120 } as const;

export default function Availability() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const toast = useToast();
  const mine = useMyProvider();
  const setMine = useSetMyProvider();
  const p = mine.data?.profile;
  const [maxDaily, setMaxDaily] = useState(8);
  const [radius, setRadius] = useState(10);
  const [awayUntil, setAwayUntil] = useState('');
  const [slots, setSlots] = useState<Slot[]>([]);
  useEffect(() => {
    if (!p) return;
    setMaxDaily(p.maxDailyAppointments);
    setRadius(p.serviceRadiusKm);
    setAwayUntil(p.awayUntil ?? '');
  }, [p]);
  useEffect(() => {
    if (mine.data) setSlots(mine.data.workingHours);
  }, [mine.data]);

  const update = useMutation({
    mutationFn: api.provider.updateAvailability,
    onSuccess: async (d) => {
      await setMine(d);
      toast(t('availability.updated'));
    },
  });
  const saveHours = useMutation({
    mutationFn: () => api.provider.setWorkingHours({ slots }),
    onSuccess: async (d) => {
      await setMine(d);
      toast(t('availability.updated'));
    },
  });

  if (mine.isPending) return <Screen><LoadingScreen /></Screen>;
  if (mine.error || !p) return <Screen><ErrorState message={t(errorKey(mine.error))} onRetry={() => void mine.refetch()} /></Screen>;
  const options = availabilityOptionsFor(p.providerType);
  const isDoctor = p.providerType === 'DOCTOR';
  const stopped = p.availabilityStatus === 'EXISTING_PATIENTS_ONLY';

  const toggleDay = (d: number) =>
    setSlots((s) => (s.some((x) => x.weekday === d) ? s.filter((x) => x.weekday !== d) : [...s, { weekday: d, startMinute: isDoctor ? 17 * 60 : 9 * 60, endMinute: isDoctor ? 21 * 60 : 17 * 60 }]));
  const shift = (d: number, field: 'startMinute' | 'endMinute', delta: number) =>
    setSlots((s) =>
      s.map((x) => {
        if (x.weekday !== d) return x;
        const v = Math.min(1440, Math.max(0, x[field] + delta));
        const next = { ...x, [field]: v };
        return next.endMinute > next.startMinute ? next : x;
      }),
    );

  return (
    <Screen testID="availability-screen" header={<Header title={t('availability.title')} subtitle={t('availability.subtitle')} />}>
      {update.error ? <Notice tone="danger" body={t(errorKey(update.error))} /> : null}

      {isDoctor ? (
        <Button
          testID={stopped ? 'resume-new-patients' : 'stop-new-patients'}
          label={stopped ? t('availability.resumeNew') : t('availability.stopNew')}
          icon={stopped ? 'user-check' : 'user-x'}
          variant={stopped ? 'soft' : 'secondary'}
          loading={update.isPending}
          onPress={() => update.mutate({ availabilityStatus: stopped ? 'ACCEPTING_NEW_PATIENTS' : 'EXISTING_PATIENTS_ONLY' })}
        />
      ) : null}

      <Section title={t('availability.status')}>
        <View style={{ gap: spacing.sm }}>
          {options.map((o: AvailabilityStatus) => {
            const selected = p.availabilityStatus === o;
            return (
              <PressableScale
                key={o}
                testID={`status-${o}`}
                accessibilityRole="radio"
                aria-checked={selected}
                onPress={() => {
                  if (o === 'AWAY' && !isValidIsoDate(awayUntil)) {
                    update.mutate({ availabilityStatus: o });
                    return;
                  }
                  update.mutate({ availabilityStatus: o, ...(o === 'AWAY' ? { awayUntil } : {}) });
                }}
                scaleTo={0.99}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radii.lg, borderWidth: selected ? 2 : 1, borderColor: selected ? colors.accent : colors.border, backgroundColor: selected ? colors.accentSoft : colors.surface }}
              >
                <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: selected ? colors.accent : colors.borderStrong, alignItems: 'center', justifyContent: 'center' }}>
                  {selected ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent }} /> : null}
                </View>
                <Text variant="callout" weight={selected ? 'semibold' : 'regular'}>{t(`availability.${o}`)}</Text>
              </PressableScale>
            );
          })}
        </View>
        {p.availabilityStatus === 'AWAY' ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <TextField label={t('availability.awayUntil')} placeholder="YYYY-MM-DD" value={awayUntil} onChangeText={(v) => setAwayUntil(maskDate(v))} keyboardType="number-pad" ltr />
            </View>
            <Button label={t('common.save')} size="md" fullWidth={false} disabled={!isValidIsoDate(awayUntil)} onPress={() => update.mutate({ availabilityStatus: 'AWAY', awayUntil })} />
          </View>
        ) : null}
      </Section>

      <Card>
        <View style={{ gap: spacing.lg }}>
          {/* The stepper moves under its label on narrow phones / large text instead of spilling out. */}
          <View style={stepperRow}>
            <Text variant="callout" style={stepperLabel}>{t('availability.maxDaily')}</Text>
            <Stepper testID="max-daily" value={maxDaily} onChange={setMaxDaily} min={0} max={80} />
          </View>
          {!isDoctor ? (
            <View style={stepperRow}>
              <Text variant="callout" style={stepperLabel}>{t('availability.serviceRadius')}</Text>
              <Stepper value={radius} onChange={setRadius} min={1} max={100} format={(v) => t('availability.km', { count: v })} />
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Text variant="callout">{t('availability.temporarilyUnavailable')}</Text>
              <Text variant="caption" color="textTertiary">{t('availability.temporarilyUnavailableHint')}</Text>
            </View>
            <Switch testID="pause-switch" accessibilityLabel={t('availability.temporarilyUnavailable')} value={p.temporarilyUnavailable} onValueChange={(v) => update.mutate({ temporarilyUnavailable: v })} trackColor={{ true: colors.accent, false: colors.border }} />
          </View>
          <Button testID="save-capacity" label={t('common.save')} variant="soft" size="md" loading={update.isPending} onPress={() => update.mutate({ maxDailyAppointments: maxDaily, ...(isDoctor ? {} : { serviceRadiusKm: radius }) })} />
        </View>
      </Card>

      <Section title={t('availability.workingHours')}>
        <Card padded={false}>
          {ORDER.map((d, i) => {
            const slot = slots.find((s) => s.weekday === d);
            return (
              <View key={d} style={{ padding: spacing.lg, gap: spacing.sm, borderTopWidth: i ? 1 : 0, borderTopColor: colors.divider }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text variant="callout" weight="medium">{t(`availability.weekday${d}` as 'availability.weekday0')}</Text>
                  <Switch testID={`day-${d}`} accessibilityLabel={t(`availability.weekday${d}` as 'availability.weekday0')} value={Boolean(slot)} onValueChange={() => toggleDay(d)} trackColor={{ true: colors.accent, false: colors.border }} />
                </View>
                {slot ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
                    <Stepper value={slot.startMinute} onChange={(v) => shift(d, 'startMinute', v - slot.startMinute)} min={0} max={1410} step={30} format={(v) => minutesToTime(v, locale)} />
                    <Icon name="arrow-right" size={14} color="textTertiary" />
                    <Stepper value={slot.endMinute} onChange={(v) => shift(d, 'endMinute', v - slot.endMinute)} min={30} max={1440} step={30} format={(v) => minutesToTime(v % 1440, locale)} />
                  </View>
                ) : (
                  <Text variant="caption" color="textTertiary">{t('availability.dayOff')}</Text>
                )}
              </View>
            );
          })}
        </Card>
        {saveHours.error ? <Notice tone="danger" body={t(errorKey(saveHours.error))} /> : null}
        <Button testID="save-hours" label={t('common.save')} loading={saveHours.isPending} onPress={() => saveHours.mutate()} />
      </Section>
    </Screen>
  );
}
