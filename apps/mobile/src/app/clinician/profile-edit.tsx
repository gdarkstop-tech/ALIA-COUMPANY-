import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMyProvider, useSetMyProvider } from '@/features/provider/hooks';
import { ProviderProfileForm } from '@/features/provider/ProviderProfileForm';
import { api, errorKey } from '@/lib/api';
import { useI18n } from '@/providers/i18n';
import { Header, LoadingScreen, Notice, Screen, useToast } from '@/ui';

export default function ProfileEdit() {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const mine = useMyProvider();
  const setMine = useSetMyProvider();
  const save = useMutation({
    mutationFn: api.provider.upsert,
    onSuccess: async (d) => {
      await setMine(d);
      toast(t('common.saved'));
      router.back();
    },
  });
  const p = mine.data?.profile;
  return (
    <Screen header={<Header back title={t('provider.profileDetails')} />}>
      {save.error ? <Notice tone="danger" body={t(errorKey(save.error))} /> : null}
      {p?.verificationStatus === 'APPROVED' ? <Notice tone="warning" body={t('provider.editRereview')} /> : null}
      {!p ? <LoadingScreen /> : <ProviderProfileForm providerType={p.providerType} initial={p} busy={save.isPending} submitLabel={t('provider.saveProfile')} onSubmit={(b) => save.mutate(b)} />}
    </Screen>
  );
}
