import { useRouter } from 'expo-router';
import { useI18n } from '@/providers/i18n';
import { useSignOut, useResetTo } from '@/providers/session';
import { Button, EmptyState, Header, Screen } from '@/ui';

/** Internal staff use the separate, MFA-protected admin console — not the patient/clinician app. */
export default function Staff() {
  const { t } = useI18n();
  const router = useRouter();
  const resetTo = useResetTo();
  const signOut = useSignOut();
  return (
    <Screen header={<Header title={t('staff.title')} />}>
      <EmptyState icon="mci:shield-account-outline" title={t('staff.title')} body={t('staff.body')} />
      <Button label={t('roles.addRole')} variant="secondary" onPress={() => router.push('/onboarding/role')} />
      <Button
        label={t('common.signOut')}
        variant="ghost"
        onPress={async () => {
          await signOut();
          resetTo('/welcome');
        }}
      />
    </Screen>
  );
}
