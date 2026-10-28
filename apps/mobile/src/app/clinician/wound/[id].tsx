import { useLocalSearchParams } from 'expo-router';
import { useWound, woundErrorKey } from '@/features/wounds/hooks';
import { WoundCaseView } from '@/features/wounds/WoundCaseView';
import { useI18n } from '@/providers/i18n';
import { ErrorState, Header, LoadingScreen, Screen } from '@/ui';

/** A shared patient's wound, for a clinician whose share includes wound photos. */
export default function ClinicianWound() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const w = useWound(id);
  return (
    <Screen testID="clinician-wound" header={<Header back title={w.data?.label ?? t('wounds.title')} subtitle={t('wounds.clinicianTitle')} />} refreshing={w.isRefetching} onRefresh={() => void w.refetch()}>
      {w.isPending ? <LoadingScreen /> : w.error ? <ErrorState message={t(woundErrorKey(w.error))} onRetry={() => void w.refetch()} /> : <WoundCaseView wound={w.data} />}
    </Screen>
  );
}
