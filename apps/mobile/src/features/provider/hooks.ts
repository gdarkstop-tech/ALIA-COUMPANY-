import type { MyProviderProfile } from '@ghayarly/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useMyProvider() {
  return useQuery({ queryKey: ['provider-me'], queryFn: () => api.provider.me() });
}

export function useSetMyProvider() {
  const qc = useQueryClient();
  return async (data: MyProviderProfile) => {
    qc.setQueryData(['provider-me'], data);
    await qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export function verificationTone(status: string) {
  return status === 'APPROVED' ? 'success' : status === 'REJECTED' || status === 'SUSPENDED' ? 'danger' : status === 'CHANGES_REQUESTED' ? 'warning' : status === 'DRAFT' ? 'neutral' : 'info';
}
