import { GLUCOSE_CONTEXTS, OBSERVATION_KINDS, OBSERVATION_SPEC, type GlucoseContext, type ObservationKind } from '@ghayarly/shared';
import { spacing } from '@ghayarly/tokens';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { isValidIsoDate, maskDate, normalizeNumberInput } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { Button, Chip, Notice, Sheet, Text, TextField, useToast } from '@/ui';
import { readingsErrorKey, useInvalidateReadings } from './hooks';

const pad2 = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const localTime = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const maskTime = (v: string) => {
  const digits = v.replace(/\D/g, '').slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`;
};

/** Records one reading: the unit is fixed per kind; bounds only catch typing errors. */
export function ReadingSheet({ patientId, visible, onClose }: { patientId: string; visible: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const invalidate = useInvalidateReadings();
  const [kind, setKind] = useState<ObservationKind>('BLOOD_PRESSURE');
  const [value, setValue] = useState('');
  const [value2, setValue2] = useState('');
  const [context, setContext] = useState<GlucoseContext | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!visible) return;
    const now = new Date();
    setValue('');
    setValue2('');
    setContext(null);
    setDate(localDate(now));
    setTime(localTime(now));
    setNote('');
  }, [visible]);
  const spec = OBSERVATION_SPEC[kind];
  const v = Number(normalizeNumberInput(value));
  const v2 = Number(normalizeNumberInput(value2));
  const bp = kind === 'BLOOD_PRESSURE';
  const inRange = value !== '' && v >= spec.min && v <= spec.max && (!bp || (value2 !== '' && v2 >= spec.min2! && v2 <= spec.max2! && v2 < v));
  const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  const save = useMutation({
    // The date and time are the device's local time, sent with its offset (ISO-8601).
    mutationFn: () =>
      api.health.addObservation(patientId, {
        kind,
        value: v,
        value2: bp ? v2 : null,
        context: kind === 'BLOOD_GLUCOSE' ? context : null,
        measuredAt: new Date(`${date}T${time}:00`).toISOString(),
        note: note.trim() || null,
      }),
    onSuccess: async () => {
      await invalidate();
      toast(t('common.saved'));
      onClose();
    },
  });
  return (
    <Sheet visible={visible} onClose={onClose} title={t('readings.addTitle')} testID="reading-sheet">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {OBSERVATION_KINDS.map((k) => (
          <Chip key={k} testID={`reading-kind-${k}`} label={t(`readings.kind_${k}`)} selected={kind === k} onPress={() => setKind(k)} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <TextField testID="reading-value" label={bp ? t('readings.systolic') : `${t('readings.value')} (${spec.unit})`} value={value} onChangeText={setValue} keyboardType="decimal-pad" ltr />
        </View>
        {bp ? (
          <View style={{ flex: 1 }}>
            <TextField testID="reading-value2" label={t('readings.diastolic')} value={value2} onChangeText={setValue2} keyboardType="decimal-pad" ltr />
          </View>
        ) : null}
      </View>
      <Text variant="caption" color="textTertiary">{t('readings.plausible', { min: spec.min, max: spec.max, unit: spec.unit })}</Text>
      {kind === 'BLOOD_GLUCOSE' ? (
        <View style={{ gap: spacing.xs }}>
          <Text variant="footnote" weight="semibold" color="textSecondary">{t('readings.context')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {GLUCOSE_CONTEXTS.map((c) => (
              <Chip key={c} testID={`reading-context-${c}`} label={t(`readings.context_${c}`)} selected={context === c} onPress={() => setContext(context === c ? null : c)} />
            ))}
          </View>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1.4 }}>
          <TextField testID="reading-date" label={t('readings.date')} placeholder="YYYY-MM-DD" value={date} onChangeText={(x) => setDate(maskDate(x))} keyboardType="number-pad" ltr />
        </View>
        <View style={{ flex: 1 }}>
          <TextField testID="reading-time" label={t('readings.time')} placeholder="HH:MM" value={time} onChangeText={(x) => setTime(maskTime(x))} keyboardType="number-pad" ltr />
        </View>
      </View>
      <TextField testID="reading-note" label={t('readings.note')} optional value={note} onChangeText={setNote} maxLength={200} hint={t('readings.noteHint')} />
      {save.error ? <Notice tone="danger" body={t(readingsErrorKey(save.error))} /> : null}
      <Button testID="reading-save" label={t('common.save')} onPress={() => save.mutate()} loading={save.isPending} disabled={!inRange || !isValidIsoDate(date) || !timeOk} />
    </Sheet>
  );
}
