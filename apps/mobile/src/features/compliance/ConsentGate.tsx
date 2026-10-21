import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';
import { LoadingScreen } from '@/ui';
import { useConsents } from './hooks';

/**
 * Keeps every patient / clinician screen behind the current Terms and Privacy Policy, including
 * screens opened directly by a deep link (which skip the root index route). Account deletion and
 * the privacy centre stay reachable without accepting: declining the terms means deleting the
 * account. If the consent state cannot be loaded, the screens render (the server still enforces
 * health-data consent itself).
 */
export function ConsentGate({ children }: { children: ReactNode }) {
  const consents = useConsents();
  if (consents.isPending) return <LoadingScreen />;
  if (consents.data?.missingRequired.length) return <Redirect href="/consent" />;
  return <>{children}</>;
}
