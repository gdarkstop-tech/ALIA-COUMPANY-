import type { TranslationKey } from '@ghayarly/i18n';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, errorKey } from '@/lib/api';

export const WOUNDS_KEY = ['wounds'] as const;

export const useWoundStatus = () => useQuery({ queryKey: [...WOUNDS_KEY, 'status'], queryFn: () => api.wounds.status() });
export const useWoundPermissions = (patientId: string | undefined) =>
  useQuery({ queryKey: [...WOUNDS_KEY, 'permissions', patientId], queryFn: () => api.wounds.permissions(patientId!), enabled: Boolean(patientId) });
export const useWounds = (patientId: string | undefined) => useQuery({ queryKey: [...WOUNDS_KEY, 'list', patientId], queryFn: () => api.wounds.list(patientId!), enabled: Boolean(patientId) });
export const useWound = (id: string | undefined) => useQuery({ queryKey: [...WOUNDS_KEY, 'detail', id], queryFn: () => api.wounds.get(id!), enabled: Boolean(id) });
export const useWoundPresentations = (patientId: string | undefined) =>
  useQuery({ queryKey: [...WOUNDS_KEY, 'presentations', patientId], queryFn: () => api.wounds.presentations(patientId!), enabled: Boolean(patientId) });

/** Everything about wounds (lists, details, permissions, requests) is refreshed together. */
export function useInvalidateWounds() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: WOUNDS_KEY });
}

const WOUND_ERRORS = [
  'WOUND_SCAN_CONSENT_REQUIRED',
  'FEATURE_DISABLED',
  'IMAGE_TYPE_INVALID',
  'IMAGE_TOO_LARGE',
  'IMAGE_UNREADABLE',
  'STORAGE_UNAVAILABLE',
  'NOT_CONFIGURED',
  'WOUND_CASE_CLOSED',
  'WOUND_CONSENT_NOT_ALLOWED',
  'WOUND_SECONDARY_USE_MINOR',
  'PRESENTATION_CHANGED',
  'WOUND_UPLOAD_DAILY_LIMIT',
  'WOUND_CLASSIFICATION_REQUIRED',
] as const;

/** A specific message for wound errors the person can act on; the generic one otherwise. */
export function woundErrorKey(e: unknown): TranslationKey {
  if (e instanceof ApiError && (WOUND_ERRORS as readonly string[]).includes(e.code)) return `wounds.error_${e.code as (typeof WOUND_ERRORS)[number]}`;
  return errorKey(e);
}
