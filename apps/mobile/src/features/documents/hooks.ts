import type { LabResult } from '@ghayarly/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, errorKey } from '@/lib/api';
import type { TranslationKey } from '@ghayarly/i18n';

export const DOCS_KEY = ['documents'] as const;

export const useDocumentAi = (enabled = true) => useQuery({ queryKey: [...DOCS_KEY, 'ai'], queryFn: () => api.documents.aiStatus(), enabled });
export const useDocuments = (patientId: string | undefined) => useQuery({ queryKey: [...DOCS_KEY, 'list', patientId], queryFn: () => api.documents.list(patientId!), enabled: Boolean(patientId) });
export const useDocument = (id: string | undefined) => useQuery({ queryKey: [...DOCS_KEY, 'detail', id], queryFn: () => api.documents.get(id!), enabled: Boolean(id) });
export const useLabResults = (patientId: string | undefined) => useQuery({ queryKey: [...DOCS_KEY, 'results', patientId], queryFn: () => api.labResults.list(patientId!), enabled: Boolean(patientId) });

/** Everything under documents (lists, details, results, AI allowance) is refreshed together. */
export function useInvalidateDocuments() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: DOCS_KEY });
}

export function useReviewResult() {
  const invalidate = useInvalidateDocuments();
  return useMutation({
    mutationFn: (v: { result: LabResult; body: Parameters<typeof api.labResults.review>[1] }) => api.labResults.review(v.result.id, v.body),
    onSuccess: () => invalidate(),
  });
}

const DOCUMENT_ERRORS = [
  'DOCUMENT_TYPE_INVALID',
  'DOCUMENT_TOO_LARGE',
  'DOCUMENT_READ_FAILED',
  'AI_UNAVAILABLE',
  'DOCUMENT_EXTRACTION_IN_PROGRESS',
  'AI_QUOTA_EXCEEDED',
  'LAB_RESULT_ALREADY_REVIEWED',
  'DOCUMENT_ALREADY_READ',
  'DOCUMENT_READ_LIMIT',
] as const;

/** A specific message for document errors the person can act on; the generic one otherwise. */
export function documentErrorKey(e: unknown): TranslationKey {
  if (e instanceof ApiError && (DOCUMENT_ERRORS as readonly string[]).includes(e.code)) return `documents.error_${e.code as (typeof DOCUMENT_ERRORS)[number]}`;
  return errorKey(e);
}
