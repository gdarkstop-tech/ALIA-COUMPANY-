import { useLocalSearchParams } from 'expo-router';
import { AppointmentScreen } from '@/features/booking/AppointmentScreen';

export default function PatientAppointment() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <AppointmentScreen id={id} />;
}
