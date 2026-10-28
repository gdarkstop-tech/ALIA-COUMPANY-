import type { TranslationKey } from '@ghayarly/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, errorKey } from '@/lib/api';

export const READINGS_KEY = ['readings'] as const;
export type Period = 30 | 90 | 365;

export const useAnalytics = (patientId: string | undefined, days: Period) =>
  useQuery({ queryKey: [...READINGS_KEY, 'analytics', patientId, days], queryFn: () => api.health.analytics(patientId!, days), enabled: Boolean(patientId) });
export const useSummaryStatus = () => useQuery({ queryKey: [...READINGS_KEY, 'ai'], queryFn: () => api.health.summaryStatus() });
export const useSummaries = (patientId: string | undefined) =>
  useQuery({ queryKey: [...READINGS_KEY, 'summaries', patientId], queryFn: () => api.health.summaries(patientId!), enabled: Boolean(patientId) });

/** Readings, trends, summaries and the AI allowance are refreshed together. */
export function useInvalidateReadings() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: READINGS_KEY });
}

export function useRemoveReading(patientId: string) {
  const invalidate = useInvalidateReadings();
  return useMutation({ mutationFn: (id: string) => api.health.removeObservation(patientId, id), onSuccess: () => invalidate() });
}

const READING_ERRORS = ['NOTHING_TO_SUMMARISE', 'HEALTH_SUMMARY_REJECTED', 'HEALTH_SUMMARY_LIMIT', 'HEALTH_SUMMARY_IN_PROGRESS', 'AI_UNAVAILABLE', 'AI_QUOTA_EXCEEDED', 'MEASURED_IN_FUTURE'] as const;

export function readingsErrorKey(e: unknown): TranslationKey {
  if (e instanceof ApiError && (READING_ERRORS as readonly string[]).includes(e.code)) return `readings.error_${e.code as (typeof READING_ERRORS)[number]}`;
  return errorKey(e);
}
