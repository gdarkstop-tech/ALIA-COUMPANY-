'use client';
import { AppointmentsTable } from '@/components/ops-appointments';
import { OpsPage } from '@/components/ops';

export default function OpsAppointments() {
  return (
    <OpsPage href="/ops/appointments">
      <AppointmentsTable testId="ops-appointments" />
    </OpsPage>
  );
}
