import { AI_MESSAGE_MAX_CHARS, EMERGENCY_NUMBERS, type AiAllowance, type AiAssistantStatus, type AiPreferences, type AiReportReason } from '@ghayarly/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, errorKey } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/providers/i18n';

/** The server decides availability (feature flag, provider, consent) and the weekly allowance. */
export function useAssistantStatus() {
  return useQuery({ queryKey: ['ai', 'assistant'], queryFn: () => api.ai.assistant(), staleTime: 30_000 });
}

/** Voice availability (flag, provider, both consents) and the weekly voice seconds — from the server. */
export function useVoiceStatus(enabled = true) {
  return useQuery({ queryKey: ['ai', 'voice'], queryFn: () => api.ai.voice(), staleTime: 30_000, enabled });
}

export function useConversations(enabled: boolean) {
  return useQuery({ queryKey: ['ai', 'conversations'], queryFn: () => api.ai.conversations(), enabled });
}

export function useConversation(id: string | undefined) {
  return useQuery({ queryKey: ['ai', 'conversation', id], queryFn: () => api.ai.conversation(id!), enabled: Boolean(id) });
}

export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patientId: string | null) => api.ai.createConversation({ patientId }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ai', 'conversations'] }),
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.ai.deleteConversation(id),
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: ['ai', 'conversation', id] });
      void qc.invalidateQueries({ queryKey: ['ai', 'conversations'] });
    },
  });
}

/** Sends one message. The server stores both sides; the thread is re-read so it always matches the server. */
export function useSendMessage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => api.ai.send(id, content),
    // Awaited so the pending bubble stays until the thread (both messages, server order) is re-read.
    onSuccess: async (reply) => {
      if (reply.allowance) qc.setQueryData<AiAssistantStatus>(['ai', 'assistant'], (prev) => (prev ? { ...prev, allowance: reply.allowance } : prev));
      void qc.invalidateQueries({ queryKey: ['ai', 'conversations'] });
      await qc.invalidateQueries({ queryKey: ['ai', 'conversation', id] });
    },
    // A refused/unavailable send may still have stored the person's message.
    onError: () => {
      void qc.invalidateQueries({ queryKey: ['ai', 'conversation', id] });
      void qc.invalidateQueries({ queryKey: ['ai', 'assistant'] });
    },
  });
}

export const MAX_CHARS = AI_MESSAGE_MAX_CHARS;
export const EMERGENCY_NUMBER = EMERGENCY_NUMBERS.ambulance;

/** Plain-language text for an assistant error (quota, provider outage, paused budget, consent). */
export function useAssistantErrorText() {
  const { t, locale } = useI18n();
  return (e: unknown, allowance?: AiAllowance | null): string => {
    if (e instanceof ApiError) {
      if (e.code === 'AI_QUOTA_EXCEEDED') return allowance ? t('assistant.quotaExceeded', { date: formatDate(allowance.resetsAt, locale) }) : t('assistant.quotaExceededNoDate');
      if (e.code === 'AI_UNAVAILABLE') return t('assistant.unavailable');
      if (e.code === 'AI_BUDGET_NOT_SET' || e.code === 'AI_BUDGET_EXHAUSTED') return t('assistant.budgetPaused');
      if (e.code === 'AI_CONSENT_REQUIRED') return t('assistant.CONSENT_REQUIRED');
      if (e.code === 'FEATURE_DISABLED' || e.code === 'AI_ROUTE_DISABLED') return t('assistant.FEATURE_DISABLED');
      if (e.code === 'NOT_CONFIGURED' || e.code === 'AI_MODEL_NOT_ACTIVE' || e.code === 'AI_ROUTE_NOT_CONFIGURED') return t('assistant.NOT_CONFIGURED');
    }
    return t(errorKey(e));
  };
}

export function useAssistantPreferences() {
  return useQuery({ queryKey: ['ai', 'preferences'], queryFn: () => api.ai.preferences() });
}

export function useSetAssistantPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Pick<AiPreferences, 'replyLanguage' | 'detailLevel'>>) => api.ai.setPreferences(body),
    onSuccess: (next) => qc.setQueryData(['ai', 'preferences'], next),
  });
}

/** Reports one answer; the thread is re-read so the message shows as reported. */
export function useReportAnswer(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { messageId: string; reason: AiReportReason; note?: string; includeQuestion: boolean }) => api.ai.report(v.messageId, { reason: v.reason, note: v.note, includeQuestion: v.includeQuestion }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['ai', 'conversation', conversationId] }),
  });
}
