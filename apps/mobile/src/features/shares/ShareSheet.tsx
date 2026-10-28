import { spacing } from '@ghayarly/tokens';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { usePatients } from '@/features/patient/hooks';
import { ApiError, api, errorKey } from '@/lib/api';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Button, Chip, Notice, Sheet, Text, useToast } from '@/ui';

/** Shares one profile's record with this clinician, for a limited time; AI drafting is a separate choice. */
export function ShareSheet({ providerUserId, providerName, visible, onClose }: { providerUserId: string; providerName: string; visible: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const patients = usePatients();
  const [patientId, setPatientId] = useState<string | null>(null);
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [ai, setAi] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setPatientId(patients.data?.find((p) => p.relationship === 'SELF')?.id ?? patients.data?.[0]?.id ?? null);
    setDays(30);
    setAi(false);
  }, [visible, patients.data]);
  const grant = useMutation({
    mutationFn: () => api.shares.grant({ patientId: patientId!, providerUserId, days, aiAllowed: ai }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['shares'] });
      toast(t('common.saved'));
      onClose();
    },
  });
  const error = grant.error instanceof ApiError && grant.error.code === 'CLINICIAN_NOT_AVAILABLE' ? t('shares.error_CLINICIAN_NOT_AVAILABLE') : grant.error ? t(errorKey(grant.error)) : null;
  return (
    <Sheet visible={visible} onClose={onClose} title={t('shares.shareTitle', { name: providerName })} testID="share-sheet">
      <Notice tone="info" icon="mci:shield-lock-outline" body={t('shares.shareBody')} />
      <Text variant="footnote" weight="semibold" color="textSecondary">{t('shares.profile')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {(patients.data ?? []).map((p) => (
          <Chip key={p.id} testID={`share-profile-${p.relationship}`} label={p.displayName} selected={patientId === p.id} onPress={() => setPatientId(p.id)} />
        ))}
      </View>
      <Text variant="footnote" weight="semibold" color="textSecondary">{t('shares.duration')}</Text>
      <View style={{ flexDirection: 'row', gap: spacing.xs }}>
        {([7, 30, 90] as const).map((d) => (
          <Chip key={d} testID={`share-days-${d}`} label={t(`shares.days_${d}`)} selected={days === d} onPress={() => setDays(d)} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="callout" weight="semibold">{t('shares.allowAi')}</Text>
          <Text variant="footnote" color="textSecondary">{t('shares.allowAiBody')}</Text>
        </View>
        <Switch testID="share-ai-switch" accessibilityLabel={t('shares.allowAi')} value={ai} onValueChange={setAi} trackColor={{ true: colors.accent, false: colors.border }} />
      </View>
      {error ? <Notice tone="danger" body={error} /> : null}
      <Button testID="share-confirm" label={t('shares.confirm')} icon="share-2" onPress={() => grant.mutate()} loading={grant.isPending} disabled={!patientId} />
    </Sheet>
  );
}
