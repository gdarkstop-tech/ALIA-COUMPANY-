import { useLocalSearchParams } from 'expo-router';
import { AppointmentScreen } from '@/features/booking/AppointmentScreen';

export default function ClinicianAppointment() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <AppointmentScreen id={id} />;
}
