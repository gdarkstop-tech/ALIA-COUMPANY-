import type { TranslationKey } from '@ghayarly/i18n';
import { PATIENT_ISSUE_CATEGORIES, VISIT_FAILURE_CATEGORIES, type Appointment, type PatientIssueCategory, type VisitFailureCategory } from '@ghayarly/shared';
import { spacing } from '@ghayarly/tokens';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { api, errorKey } from '@/lib/api';
import { useI18n } from '@/providers/i18n';
import { Badge, Button, Chip, ErrorState, Header, LoadingScreen, Notice, Screen, Section, Sheet, Text, TextField, useToast } from '@/ui';
import { AppointmentFacts, AppointmentHistory, bookingErrorKey, cairoDay, cairoDayKey, cairoShortDay, cairoTime, STATUS_TONE } from './shared';

type SheetKind = null | 'cancel' | 'decline' | 'reschedule' | 'fail' | 'report';

/** One booking, for the patient side or the provider. Buttons follow `a.can`, which mirrors the database rules. */
export function AppointmentScreen({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['appointment', id], queryFn: () => api.appointments.get(id) });
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [failCategory, setFailCategory] = useState<VisitFailureCategory | null>(null);
  const [issue, setIssue] = useState<PatientIssueCategory | null>(null);
  const [newSlot, setNewSlot] = useState<string | null>(null);

  const done = async (a: Appointment | null, message: TranslationKey) => {
    if (a) qc.setQueryData(['appointment', id], a);
    await qc.invalidateQueries({ queryKey: ['appointments'] });
    await qc.invalidateQueries({ queryKey: ['appointment', id] });
    setSheet(null);
    setReason('');
    setError(null);
    toast(t(message));
  };
  const run = useMutation({
    mutationFn: async (action: () => Promise<[Appointment | null, TranslationKey]>) => action(),
    onSuccess: ([a, message]) => done(a, message),
    onError: (e) => setError(t(bookingErrorKey(e))),
  });

  const a = q.data;
  const slots = useQuery({
    queryKey: ['reschedule-slots', id],
    enabled: sheet === 'reschedule' && Boolean(a),
    queryFn: () => api.providers.availability(a!.provider.userId, { kind: a!.kind, offeringId: a!.offeringId ?? undefined, serviceId: a!.service?.id, days: 14 }),
  });

  if (q.isPending) return <Screen header={<Header back title="" large={false} />}><LoadingScreen /></Screen>;
  if (q.error || !a) return <Screen header={<Header back title="" large={false} />}><ErrorState message={t(errorKey(q.error))} onRetry={() => void q.refetch()} /></Screen>;
  const counterpart = a.viewerRole === 'PROVIDER' ? a.patient.displayName : locale === 'ar' ? a.provider.displayNameAr : a.provider.displayNameEn;

  return (
    <Screen testID="appointment-screen" header={<Header back title={counterpart} subtitle={t(`booking.kind_${a.kind}`)} large={false} />}>
      <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
        <Badge testID="appointment-status" label={t(`booking.status_${a.status}`)} tone={STATUS_TONE[a.status]} />
        {a.status === 'REQUESTED' ? <Badge label={t('booking.respondBy', { time: `${cairoShortDay(a.respondBy, locale)} ${cairoTime(a.respondBy, locale)}` })} tone="warning" icon="clock" /> : null}
      </View>
      {a.statusReason ? <Notice tone="info" title={t('booking.reason')} body={a.statusReason} /> : null}
      {a.kind !== 'DOCTOR_CLINIC' ? <Notice tone="warning" icon="alert-triangle" body={t('booking.notEmergency')} /> : null}
      <AppointmentFacts a={a} />
      {a.note && a.viewerRole === 'PROVIDER' ? (
        <Section title={t('booking.note')}>
          <Text variant="callout">{a.note}</Text>
        </Section>
      ) : null}

      <View style={{ gap: spacing.sm }}>
        {a.can.respond ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button testID="appointment-accept" label={t('booking.accept')} icon="check" loading={run.isPending} onPress={() => run.mutate(async () => [await api.appointments.respond(id, true), 'booking.accepted'])} />
            </View>
            <View style={{ flex: 1 }}>
              <Button testID="appointment-decline" label={t('booking.decline')} variant="secondary" onPress={() => setSheet('decline')} />
            </View>
          </View>
        ) : null}
        {a.can.start ? <Button testID="appointment-start" label={t('booking.start')} icon="play" onPress={() => run.mutate(async () => [await api.appointments.progress(id, 'START'), 'booking.saved'])} /> : null}
        {a.can.complete ? <Button testID="appointment-complete" label={t('booking.complete')} icon="check-circle" onPress={() => run.mutate(async () => [await api.appointments.progress(id, 'COMPLETE'), 'booking.saved'])} /> : null}
        {a.can.noShow ? <Button testID="appointment-no-show" label={t('booking.noShow')} variant="secondary" onPress={() => run.mutate(async () => [await api.appointments.progress(id, 'NO_SHOW'), 'booking.saved'])} /> : null}
        {a.can.fail ? <Button testID="appointment-fail" label={t('booking.fail')} variant="secondary" onPress={() => setSheet('fail')} /> : null}
        {a.can.reschedule ? <Button testID="appointment-reschedule" label={t('booking.reschedule')} variant="secondary" icon="calendar" onPress={() => { setNewSlot(null); setSheet('reschedule'); }} /> : null}
        {a.can.reportIssue ? <Button testID="appointment-report" label={t('booking.reportIssue')} variant="ghost" icon="flag" onPress={() => setSheet('report')} /> : null}
        {a.can.cancel && a.viewerRole !== 'ADMIN' ? <Button testID="appointment-cancel" label={t('booking.cancel')} variant="ghost" icon="x" onPress={() => setSheet('cancel')} /> : null}
      </View>

      <Section title={t('booking.history')}>
        <AppointmentHistory a={a} />
      </Section>

      <Sheet
        visible={sheet !== null}
        onClose={() => { setSheet(null); setError(null); }}
        testID="appointment-sheet"
        title={sheet === 'cancel' ? t('booking.cancelTitle') : sheet === 'decline' ? t('booking.decline') : sheet === 'reschedule' ? t('booking.reschedule') : sheet === 'fail' ? t('booking.failCategory') : t('booking.reportIssue')}
      >
        {error ? <Notice tone="danger" body={error} /> : null}
        {sheet === 'fail' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {VISIT_FAILURE_CATEGORIES.map((c) => <Chip key={c} label={t(`booking.fail_${c}`)} selected={failCategory === c} onPress={() => setFailCategory(c)} />)}
          </View>
        ) : null}
        {sheet === 'report' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {PATIENT_ISSUE_CATEGORIES.map((c) => <Chip key={c} label={t(`booking.issue_${c}`)} selected={issue === c} onPress={() => setIssue(c)} />)}
          </View>
        ) : null}
        {sheet === 'reschedule' ? (
          slots.isPending ? (
            <LoadingScreen />
          ) : (
            <View style={{ gap: spacing.sm }}>
              {Object.entries((slots.data?.slots ?? []).reduce<Record<string, string[]>>((acc, s) => ((acc[cairoDayKey(s.startsAt)] ??= []).push(s.startsAt), acc), {}))
                .slice(0, 7)
                .map(([d, times]) => (
                  <View key={d} style={{ gap: spacing.xs }}>
                    <Text variant="footnote" weight="semibold">{cairoDay(times[0]!, locale)}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                      {times.map((s) => <Chip key={s} label={cairoTime(s, locale)} selected={newSlot === s} onPress={() => setNewSlot(s)} />)}
                    </View>
                  </View>
                ))}
              {!slots.data?.slots.length ? <Text variant="footnote" color="textSecondary">{t('booking.noSlotsAtAll')}</Text> : null}
              <Text variant="caption" color="textTertiary">{t('booking.timesInCairo')}</Text>
            </View>
          )
        ) : null}
        {sheet !== 'report' ? <TextField testID="appointment-reason" label={t('booking.reason')} value={reason} onChangeText={setReason} multiline optional={sheet === 'cancel' && a.viewerRole === 'PATIENT'} /> : null}
        <Button
          testID="appointment-sheet-confirm"
          label={t('booking.confirm')}
          loading={run.isPending}
          onPress={() => {
            const needsReason = sheet === 'decline' || (sheet === 'cancel' && a.viewerRole !== 'PATIENT');
            if (needsReason && reason.trim().length < 3) return setError(t('booking.reasonRequired'));
            if (sheet === 'cancel') run.mutate(async () => [await api.appointments.cancel(id, reason.trim() || undefined), 'booking.cancelled']);
            if (sheet === 'decline') run.mutate(async () => [await api.appointments.respond(id, false, reason.trim()), 'booking.declined']);
            if (sheet === 'reschedule' && newSlot) run.mutate(async () => [await api.appointments.reschedule(id, newSlot, reason.trim() || undefined), 'booking.rescheduled']);
            if (sheet === 'fail' && failCategory) run.mutate(async () => [await api.appointments.progress(id, 'FAIL', { failureCategory: failCategory, reason: reason.trim() || undefined }), 'booking.saved']);
            if (sheet === 'report' && issue) run.mutate(async () => [(await api.appointments.report(id, issue), null), 'booking.reported']);
          }}
        />
      </Sheet>
    </Screen>
  );
}
