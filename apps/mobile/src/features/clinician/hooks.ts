import type { TranslationKey } from '@ghayarly/i18n';
import { useQuery } from '@tanstack/react-query';
import { ApiError, api, errorKey } from '@/lib/api';

export const CLINICIAN_KEY = ['clinician'] as const;
export const useCopilotStatus = () => useQuery({ queryKey: [...CLINICIAN_KEY, 'ai'], queryFn: () => api.clinician.copilotStatus() });
export const useSharedPatients = () => useQuery({ queryKey: [...CLINICIAN_KEY, 'patients'], queryFn: () => api.clinician.patients() });
export const useSharedPatient = (id: string | undefined) => useQuery({ queryKey: [...CLINICIAN_KEY, 'patient', id], queryFn: () => api.clinician.patient(id!), enabled: Boolean(id) });
export const useDraft = (id: string | undefined) => useQuery({ queryKey: [...CLINICIAN_KEY, 'draft', id], queryFn: () => api.clinician.draft(id!), enabled: Boolean(id) });

const COPILOT_ERRORS = ['CLINICAL_DRAFT_REJECTED', 'CLINICAL_DRAFT_LIMIT', 'CARE_SHARE_AI_NOT_ALLOWED', 'CARE_SHARE_ENDED', 'CLINICAL_DRAFT_NOT_EDITABLE', 'DOCUMENT_TYPE_NOT_IN_SCOPE', 'AI_UNAVAILABLE', 'AI_QUOTA_EXCEEDED'] as const;
export function copilotErrorKey(e: unknown): TranslationKey {
  if (e instanceof ApiError && (COPILOT_ERRORS as readonly string[]).includes(e.code)) return `copilot.error_${e.code as (typeof COPILOT_ERRORS)[number]}`;
  return errorKey(e);
}
