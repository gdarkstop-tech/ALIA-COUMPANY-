import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useConsents } from '@/features/compliance/hooks';
import { api, ApiError, errorKey } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { useI18n } from '@/providers/i18n';
import { activeExperience, useMe, useSignOut } from '@/providers/session';
import { useTheme } from '@/providers/theme';
import { ErrorState } from '@/ui';

function Splash() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

/** Session gate: routes to auth, role selection, onboarding or the right experience. */
export default function Index() {
  const { t } = useI18n();
  const session = authClient.useSession();
  const signedIn = Boolean(session.data);
  const me = useMe(signedIn);
  const consents = useConsents(signedIn && Boolean(me.data));
  const signOut = useSignOut();
  const role = activeExperience(me.data);
  const patients = useQuery({ queryKey: ['patients'], queryFn: () => api.patients.list(), enabled: role === 'PATIENT' });
  const provider = useQuery({ queryKey: ['provider-me'], queryFn: () => api.provider.me(), enabled: role === 'DOCTOR' || role === 'NURSE' });

  const expired = me.error instanceof ApiError && me.error.status === 401;
  useEffect(() => {
    if (expired) void signOut();
  }, [expired, signOut]);

  if (session.isPending) return <Splash />;
  if (!signedIn || expired) return <Redirect href="/welcome" />;
  if (me.isPending) return <Splash />;
  if (me.error) return <ErrorState message={t(errorKey(me.error))} onRetry={() => void me.refetch()} />;
  // Current terms + privacy must be accepted before anything else (new accounts and document updates).
  if (consents.isPending) return <Splash />;
  if (consents.error) return <ErrorState message={t(errorKey(consents.error))} onRetry={() => void consents.refetch()} />;
  if (consents.data.missingRequired.length) return <Redirect href="/consent" />;
  if (!role) return <Redirect href="/onboarding/role" />;
  if (role === 'PATIENT') {
    if (patients.isPending) return <Splash />;
    if (patients.error) return <ErrorState message={t(errorKey(patients.error))} onRetry={() => void patients.refetch()} />;
    return <Redirect href={patients.data.length ? '/patient' : '/onboarding/patient'} />;
  }
  if (role === 'DOCTOR' || role === 'NURSE') {
    if (provider.isPending) return <Splash />;
    if (provider.error) return <ErrorState message={t(errorKey(provider.error))} onRetry={() => void provider.refetch()} />;
    return <Redirect href={provider.data.exists ? '/clinician' : '/onboarding/provider'} />;
  }
  return <Redirect href="/staff" />;
}
