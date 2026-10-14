import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { usePreferences } from '@/providers/preferences';

export function usePatients() {
  return useQuery({ queryKey: ['patients'], queryFn: () => api.patients.list() });
}

/** The profile currently being viewed (fast family switching). Falls back to the user's own profile. */
export function useActivePatient() {
  const { activePatientId, setActivePatientId } = usePreferences();
  const q = usePatients();
  const active = q.data?.find((p) => p.id === activePatientId) ?? q.data?.find((p) => p.relationship === 'SELF') ?? q.data?.[0] ?? null;
  return { ...q, active, setActive: setActivePatientId };
}
