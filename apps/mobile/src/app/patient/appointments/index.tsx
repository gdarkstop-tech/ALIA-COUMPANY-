import { spacing } from '@ghayarly/tokens';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AppointmentCard } from '@/features/booking/shared';
import { api, errorKey } from '@/lib/api';
import { useI18n } from '@/providers/i18n';
import { EmptyState, ErrorState, Header, LoadingScreen, Screen, Segmented } from '@/ui';

/** The person's bookings, for themself and the family members they manage. */
export default function MyAppointments() {
  const { t } = useI18n();
  const router = useRouter();
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const q = useQuery({ queryKey: ['appointments', scope], queryFn: () => api.appointments.list({ scope }) });
  return (
    <Screen testID="appointments-screen" header={<Header back title={t('booking.myAppointments')} />}>
      <Segmented value={scope} onChange={setScope} options={[{ value: 'upcoming', label: t('booking.upcoming') }, { value: 'past', label: t('booking.past') }]} testID="appointments-scope" />
      {q.isPending ? (
        <LoadingScreen />
      ) : q.error ? (
        <ErrorState message={t(errorKey(q.error))} onRetry={() => void q.refetch()} />
      ) : !q.data.length ? (
        <EmptyState icon="calendar" title={t('booking.none')} body={t('booking.noneBody')} actionLabel={t('care.title')} onAction={() => router.push('/patient/care')} testID="appointments-empty" />
      ) : (
        <View style={{ gap: spacing.sm }}>
          {q.data.map((a, i) => (
            <AppointmentCard key={a.id} a={a} testID={`appointment-row-${i}`} onPress={() => router.push({ pathname: '/patient/appointments/[id]', params: { id: a.id } })} />
          ))}
        </View>
      )}
    </Screen>
  );
}
