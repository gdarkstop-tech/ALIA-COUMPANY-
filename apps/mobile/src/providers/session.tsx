import type { MeResponse, Role } from '@ghayarly/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { useCallback } from 'react';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';

export function useMe(enabled = true) {
  return useQuery({ queryKey: ['me'], queryFn: () => api.me.get(), enabled, staleTime: 30_000 });
}

/** The experience to show: the profile's active role if held, otherwise the first primary role. */
export function activeExperience(me: MeResponse | undefined): Role | null {
  if (!me) return null;
  if (me.profile.activeRole && me.roles.includes(me.profile.activeRole)) return me.profile.activeRole;
  return me.roles.find((r) => r === 'PATIENT' || r === 'DOCTOR' || r === 'NURSE') ?? me.roles[0] ?? null;
}

export function useSignOut() {
  const qc = useQueryClient();
  return useCallback(async () => {
    try {
      await authClient.signOut();
    } finally {
      qc.clear();
    }
  }, [qc]);
}

/**
 * Resets navigation history on auth boundaries so Back can never return to a screen that
 * belongs to the previous session state.
 */
export function useResetTo() {
  const router = useRouter();
  return useCallback(
    (href: Href) => {
      if (router.canDismiss()) router.dismissAll();
      router.replace(href);
    },
    [router],
  );
}
