import { spacing } from '@ghayarly/tokens';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AppointmentCard } from '@/features/booking/shared';
import { api, errorKey } from '@/lib/api';
import { useI18n } from '@/providers/i18n';
import { Button, EmptyState, ErrorState, Header, LoadingScreen, Screen, Segmented } from '@/ui';

/** The provider's bookings: requests to answer, confirmed visits, history. Nobody is assigned automatically. */
export default function ClinicianAppointments() {
  const { t } = useI18n();
  const router = useRouter();
  const [scope, setScope] = useState<'requests' | 'upcoming' | 'past'>('requests');
  const q = useQuery({ queryKey: ['appointments', 'provider', scope], queryFn: () => api.appointments.mine(scope) });
  return (
    <Screen testID="clinician-appointments" header={<Header back title={t('booking.myAppointments')} />}>
      <Segmented
        value={scope}
        onChange={setScope}
        testID="clinician-appointments-scope"
        options={[{ value: 'requests', label: t('booking.requests') }, { value: 'upcoming', label: t('booking.upcoming') }, { value: 'past', label: t('booking.past') }]}
      />
      {q.isPending ? (
        <LoadingScreen />
      ) : q.error ? (
        <ErrorState message={t(errorKey(q.error))} onRetry={() => void q.refetch()} />
      ) : !q.data.length ? (
        <EmptyState icon="calendar" title={t('booking.none')} testID="clinician-appointments-empty" />
      ) : (
        <View style={{ gap: spacing.sm }}>
          {q.data.map((a, i) => (
            <AppointmentCard key={a.id} a={a} testID={`clinician-appointment-${i}`} onPress={() => router.push({ pathname: '/clinician/appointment/[id]', params: { id: a.id } })} />
          ))}
        </View>
      )}
      <Button label={t('booking.settingsTitle')} variant="secondary" icon="settings" onPress={() => router.push('/clinician/booking-settings')} testID="booking-settings-link" />
    </Screen>
  );
}
