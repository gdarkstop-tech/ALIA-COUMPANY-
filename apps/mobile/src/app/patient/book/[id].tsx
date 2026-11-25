import type { TranslationKey } from '@ghayarly/i18n';
import { GOVERNORATES, type BookingOption, type Governorate } from '@ghayarly/shared';
import { spacing } from '@ghayarly/tokens';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { bookingErrorKey, cairoDayKey, cairoShortDay, cairoTime } from '@/features/booking/shared';
import { api, errorKey } from '@/lib/api';
import { money } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { usePreferences } from '@/providers/preferences';
import { Button, Card, Checkbox, Chip, EmptyState, ErrorState, Header, LoadingScreen, Notice, Screen, Section, Select, Text, TextField, useToast } from '@/ui';

const optionKey = (o: BookingOption) => `${o.kind}:${o.offeringId ?? o.serviceId}`;

/**
 * Booking request. Only the provider's real free slots are offered (computed by the server from the
 * published hours); the database refuses anything else. A request is not a booking until the
 * provider confirms it; payment happens at the visit.
 */
export default function BookProvider() {
  const { id, option } = useLocalSearchParams<{ id: string; option?: string }>();
  const { t, locale, pickL } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { activePatientId } = usePreferences();

  const provider = useQuery({ queryKey: ['provider', id], queryFn: () => api.providers.get(id) });
  const patients = useQuery({ queryKey: ['patients'], queryFn: () => api.patients.list() });
  const options = useMemo(() => (provider.data?.bookingOptions ?? []).filter((o) => o.bookable), [provider.data]);
  const [selected, setSelected] = useState<string | null>(option ?? null);
  const opt = options.find((o) => optionKey(o) === selected) ?? null;

  useEffect(() => {
    if (!selected && options.length === 1) setSelected(optionKey(options[0]!));
  }, [options, selected]);

  const availability = useQuery({
    queryKey: ['availability', id, selected],
    enabled: Boolean(opt),
    queryFn: () => api.providers.availability(id, { kind: opt!.kind, offeringId: opt!.offeringId ?? undefined, serviceId: opt!.serviceId ?? undefined, days: 14 }),
  });
  const days = useMemo(() => {
    const map = new Map<string, { startsAt: string; endsAt: string }[]>();
    for (const s of availability.data?.slots ?? []) map.set(cairoDayKey(s.startsAt), [...(map.get(cairoDayKey(s.startsAt)) ?? []), s]);
    return [...map.entries()];
  }, [availability.data]);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  useEffect(() => {
    if (days.length && (!day || !days.some(([d]) => d === day))) setDay(days[0]![0]);
  }, [days, day]);

  const [patientId, setPatientId] = useState<string | null>(activePatientId);
  const self = patients.data?.find((p) => p.relationship === 'SELF');
  const [governorate, setGovernorate] = useState<Governorate | null>(null);
  const [city, setCity] = useState('');
  const [district, setDistrict] = useState('');
  const [street, setStreet] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [attested, setAttested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!patientId && patients.data?.length) setPatientId(self?.id ?? patients.data[0]!.id);
    if (self && !phone && self.phone) setPhone(self.phone);
    if (self && !governorate && self.governorate) setGovernorate(self.governorate);
    if (self && !city && self.city) setCity(self.city);
    // Prefill once from the account holder's own profile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patients.data]);

  const home = opt?.kind === 'NURSE_HOME_VISIT' || opt?.kind === 'DOCTOR_HOME_VISIT';
  const submit = useMutation({
    mutationFn: () =>
      api.appointments.create({
        kind: opt!.kind,
        providerUserId: id,
        patientId: patientId!,
        offeringId: opt!.offeringId ?? undefined,
        serviceId: opt!.serviceId ?? undefined,
        startsAt: slot!,
        ...(home ? { visit: { governorate: governorate!, city: city.trim(), district: district.trim() || null, address: street.trim() }, contactPhone: phone.trim() } : {}),
        note: note.trim() || undefined,
        clinicalAuthorizationAttested: opt!.requiresClinicalAuthorization ? attested : undefined,
      }),
    onSuccess: async (a) => {
      await qc.invalidateQueries({ queryKey: ['appointments'] });
      toast(t('booking.requestSent'));
      router.replace({ pathname: '/patient/appointments/[id]', params: { id: a.id } });
    },
    onError: (e) => {
      setError(t(bookingErrorKey(e)));
      setSlot(null);
      void availability.refetch();
    },
  });

  const send = () => {
    if (!opt || !slot || !patientId) return setError(t('errors.requiredField'));
    if (home && (!governorate || !city.trim() || street.trim().length < 5 || !phone.trim())) return setError(t('errors.requiredField'));
    if (opt.requiresClinicalAuthorization && !attested) return setError(t('booking.err_CLINICAL_AUTHORIZATION_REQUIRED'));
    setError(null);
    submit.mutate();
  };

  if (provider.isPending || patients.isPending) return <Screen header={<Header back title="" large={false} />}><LoadingScreen /></Screen>;
  if (provider.error) return <Screen header={<Header back title="" large={false} />}><ErrorState message={t(errorKey(provider.error))} onRetry={() => void provider.refetch()} /></Screen>;
  const name = pickL(provider.data, 'displayName');

  return (
    <Screen
      testID="booking-screen"
      header={<Header back title={t('booking.bookTitle', { name })} large={false} />}
      footer={
        opt ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
            <View>
              <Text variant="caption" color="textTertiary">{t('booking.price')}</Text>
              <Text variant="title3" tabular testID="booking-price">{money(opt.pricePiasters, locale)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Button testID="booking-submit" label={t('booking.sendRequest')} icon="send" onPress={send} loading={submit.isPending} disabled={!slot} />
            </View>
          </View>
        ) : null
      }
    >
      <Notice tone="warning" icon="alert-triangle" body={t('booking.notEmergency')} testID="booking-not-emergency" />
      {error ? <Notice tone="danger" body={error} testID="booking-error" /> : null}

      {!options.length ? (
        <EmptyState icon="calendar" title={t(`booking.block_${provider.data.bookingUnavailableReason ?? 'NOT_OFFERED'}` as TranslationKey)} />
      ) : (
        <>
          <Section title={t('booking.chooseType')}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {options.map((o) => (
                <Chip
                  key={optionKey(o)}
                  testID={`booking-option-${o.kind}`}
                  label={`${o.nameAr || o.nameEn ? pickL(o as { nameAr: string; nameEn: string }, 'name') : t(`booking.kind_${o.kind}`)} · ${money(o.pricePiasters, locale)}`}
                  selected={selected === optionKey(o)}
                  onPress={() => {
                    setSelected(optionKey(o));
                    setSlot(null);
                    setDay(null);
                  }}
                />
              ))}
            </View>
          </Section>

          {opt ? (
            <Section title={t('booking.chooseDay')}>
              {availability.isPending ? (
                <LoadingScreen />
              ) : !days.length ? (
                <EmptyState
                  compact
                  icon="calendar"
                  title={availability.data?.bookable === false ? t(`booking.block_${availability.data.blockedReason ?? 'NOT_OFFERED'}` as TranslationKey) : t('booking.noSlotsAtAll')}
                  testID="booking-no-slots"
                />
              ) : (
                <View style={{ gap: spacing.md }}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                    {days.map(([d, s]) => (
                      <Chip key={d} testID={`booking-day-${d}`} label={cairoShortDay(s[0]!.startsAt, locale)} selected={day === d} onPress={() => { setDay(d); setSlot(null); }} />
                    ))}
                  </View>
                  <Text variant="footnote" color="textSecondary">{t('booking.chooseTime')}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                    {(days.find(([d]) => d === day)?.[1] ?? []).map((s, i) => (
                      <Chip key={s.startsAt} testID={`booking-slot-${i}`} label={cairoTime(s.startsAt, locale)} selected={slot === s.startsAt} onPress={() => setSlot(s.startsAt)} />
                    ))}
                  </View>
                  <Text variant="caption" color="textTertiary">{t('booking.timesInCairo')}</Text>
                </View>
              )}
            </Section>
          ) : null}

          {opt ? (
            <Section title={t('booking.whoFor')}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {(patients.data ?? []).map((p) => (
                  <Chip key={p.id} testID={`booking-patient-${p.relationship}`} label={p.displayName} selected={patientId === p.id} onPress={() => setPatientId(p.id)} />
                ))}
              </View>
            </Section>
          ) : null}

          {opt && home ? (
            <Section title={t('booking.visitAddress')}>
              <Card>
                <View style={{ gap: spacing.md }}>
                  <Select testID="booking-governorate" label={t('onboarding.governorate')} value={governorate} onChange={setGovernorate} options={GOVERNORATES.map((g) => ({ value: g, label: t(`governorate.${g}`) }))} />
                  <TextField testID="booking-city" label={t('booking.city')} value={city} onChangeText={setCity} />
                  <TextField testID="booking-district" label={t('booking.district')} value={district} onChangeText={setDistrict} optional />
                  <TextField testID="booking-street" label={t('booking.street')} value={street} onChangeText={setStreet} multiline />
                  <TextField testID="booking-phone" label={t('booking.contactPhone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" ltr />
                </View>
              </Card>
            </Section>
          ) : null}

          {opt ? (
            <>
              <TextField testID="booking-note" label={t('booking.note')} hint={t('booking.noteHint')} value={note} onChangeText={setNote} multiline optional maxLength={500} />
              {opt.requiresClinicalAuthorization ? <Checkbox testID="booking-attest" checked={attested} onChange={setAttested} label={t('booking.attestation')} /> : null}
              <Notice tone="info" icon="credit-card" body={t('booking.payAtVisit')} />
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}
