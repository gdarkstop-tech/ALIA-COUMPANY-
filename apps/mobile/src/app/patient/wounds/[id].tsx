import { useLocalSearchParams } from 'expo-router';
import { useWound, woundErrorKey } from '@/features/wounds/hooks';
import { WoundCaseView } from '@/features/wounds/WoundCaseView';
import { useI18n } from '@/providers/i18n';
import { ErrorState, Header, LoadingScreen, Screen } from '@/ui';

/** One wound: timeline of photos (Day N), comparison, measurements, notes and treatments. */
export default function WoundDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const w = useWound(id);
  return (
    <Screen testID="wound-detail" header={<Header back title={w.data?.label ?? t('wounds.title')} />} refreshing={w.isRefetching} onRefresh={() => void w.refetch()}>
      {w.isPending ? <LoadingScreen /> : w.error ? <ErrorState message={t(woundErrorKey(w.error))} onRetry={() => void w.refetch()} /> : <WoundCaseView wound={w.data} />}
    </Screen>
  );
}
