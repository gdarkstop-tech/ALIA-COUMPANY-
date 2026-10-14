import type { ProviderType } from '@ghayarly/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ProviderProfileForm } from '@/features/provider/ProviderProfileForm';
import { api, errorKey } from '@/lib/api';
import { useI18n } from '@/providers/i18n';
import { activeExperience, useMe } from '@/providers/session';
import { Header, LoadingScreen, Notice, Screen } from '@/ui';

export default function ProviderOnboarding() {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const role = activeExperience(me.data);
  const providerType: ProviderType = role === 'NURSE' ? 'NURSE' : 'DOCTOR';
  const save = useMutation({
    mutationFn: api.provider.upsert,
    onSuccess: async () => {
      await api.me.completeOnboarding();
      await qc.invalidateQueries();
      router.replace('/clinician/verification');
    },
  });
  return (
    <Screen testID="provider-onboarding" header={<Header title={t('onboarding.providerTitle')} subtitle={t('onboarding.providerBody')} />}>
      {save.error ? <Notice tone="danger" body={t(errorKey(save.error))} /> : null}
      {me.isPending ? <LoadingScreen /> : <ProviderProfileForm providerType={providerType} initial={{ displayNameEn: me.data?.user.name }} busy={save.isPending} submitLabel={t('common.continue')} onSubmit={(b) => save.mutate(b)} />}
    </Screen>
  );
}
