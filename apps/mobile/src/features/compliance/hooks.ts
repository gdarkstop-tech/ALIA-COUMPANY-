import { FEATURES_OFF, type ConsentType, type ConsentsResponse, type FeatureFlags } from '@ghayarly/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { ApiError, api, errorKey } from '@/lib/api';
import { useI18n } from '@/providers/i18n';

const SOURCE = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';

export function useConsents(enabled = true) {
  return useQuery({ queryKey: ['consents'], queryFn: () => api.me.consents(), enabled, staleTime: 60_000 });
}

/** Records consent answers at the server's CURRENT document versions (stale versions are rejected server-side). */
export function useRecordConsents() {
  const qc = useQueryClient();
  const { locale } = useI18n();
  return useMutation({
    mutationFn: async ({ state, answers }: { state: ConsentsResponse; answers: Partial<Record<ConsentType, boolean>> }) => {
      const consents = state.consents
        .filter((c) => answers[c.type] !== undefined)
        .map((c) => ({ type: c.type, version: c.currentVersion, granted: Boolean(answers[c.type]) }));
      return api.me.recordConsents({ consents, source: SOURCE, locale });
    },
    onSuccess: (next) => {
      qc.setQueryData(['consents'], next);
    },
    // A document was updated while this screen was open: reload the current versions so the next
    // tap answers the new documents instead of re-sending the stale ones.
    onError: (e) => {
      if (isStaleConsent(e)) void qc.invalidateQueries({ queryKey: ['consents'] });
    },
  });
}

const isStaleConsent = (e: unknown) => e instanceof ApiError && e.code === 'STALE_CONSENT_VERSION';

/** Message for a failed consent update ("documents were updated" instead of a generic error). */
export function consentErrorKey(e: unknown) {
  return isStaleConsent(e) ? ('legal.updatedNotice' as const) : errorKey(e);
}

/** Server-side feature flags. Until the server answers, everything regulated stays OFF. */
export function useFeatures(): FeatureFlags {
  const q = useQuery({ queryKey: ['features'], queryFn: () => api.system.features(), staleTime: 5 * 60_000 });
  return q.data ?? FEATURES_OFF;
}
