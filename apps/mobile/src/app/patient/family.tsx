import type { PatientSummary } from '@ghayarly/shared';
import { spacing } from '@ghayarly/tokens';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useActivePatient } from '@/features/patient/hooks';
import { relationshipLabel } from '@/features/patient/ProfileSwitcher';
import { api, errorKey } from '@/lib/api';
import { useI18n } from '@/providers/i18n';
import { useMe } from '@/providers/session';
import { useTheme } from '@/providers/theme';
import { Avatar, Badge, Button, Card, ErrorState, Header, ListRow, LoadingScreen, Notice, Screen, Sheet, Text, useToast } from '@/ui';

function AccessSheet({ patient, onClose }: { patient: PatientSummary | null; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const me = useMe();
  const access = useQuery({ queryKey: ['access', patient?.id], queryFn: () => api.patients.access(patient!.id), enabled: Boolean(patient) });
  const revoke = useMutation({
    mutationFn: (userId: string) => api.patients.revokeAccess(patient!.id, userId),
    onSuccess: async () => {
      toast(t('family.revoked'));
      await qc.invalidateQueries();
      onClose();
    },
  });
  return (
    <Sheet visible={Boolean(patient)} onClose={onClose} title={t('family.manageAccess')}>
      {revoke.error ? <Notice tone="danger" body={t(errorKey(revoke.error))} /> : null}
      {access.data?.filter((a) => a.status === 'ACTIVE').map((a) => (
        <ListRow
          key={a.userId}
          leading={<Avatar name={a.displayName} size={40} />}
          title={a.userId === me.data?.user.id ? `${a.displayName} (${t('family.me')})` : a.displayName}
          subtitle={`${t(`family.access_${a.accessLevel}`)} · ${t(`consent.${a.consentBasis}`)}`}
          trailing={
            a.accessLevel !== 'OWNER' ? (
              <Button label={a.userId === me.data?.user.id ? t('family.leave') : t('family.revoke')} variant="danger" size="sm" fullWidth={false} loading={revoke.isPending} onPress={() => revoke.mutate(a.userId)} />
            ) : (
              <Badge label={t('family.access_OWNER')} tone="primary" />
            )
          }
        />
      ))}
    </Sheet>
  );
}

export default function Family() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const { data, error, isPending, refetch, active, setActive } = useActivePatient();
  const [managing, setManaging] = useState<PatientSummary | null>(null);
  return (
    <Screen testID="family-screen" header={<Header back title={t('family.title')} subtitle={t('family.subtitle')} />} footer={<Button testID="family-add-button" label={t('home.addFamily')} icon="user-plus" onPress={() => router.push('/patient/family-add')} />}>
      {isPending ? (
        <LoadingScreen />
      ) : error ? (
        <ErrorState message={t(errorKey(error))} onRetry={() => void refetch()} />
      ) : (
        <View style={{ gap: spacing.md }}>
          {data.map((p) => (
            <Card key={p.id} testID={`family-member-${p.relationship}`}>
              <View style={{ flexDirection: 'row', gap: spacing.lg, alignItems: 'center' }}>
                <Avatar name={p.displayName} size={52} ring={p.id === active?.id} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text variant="callout" weight="semibold">{p.displayName}</Text>
                  <Text variant="footnote" color="textSecondary">
                    {relationshipLabel(t, p)} · {t('common.yearsOld', { count: p.ageYears })}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
                    <Badge label={t(`family.access_${p.accessLevel}`)} tone={p.accessLevel === 'OWNER' ? 'primary' : p.accessLevel === 'GUARDIAN' ? 'info' : 'accent'} />
                    {p.id === active?.id ? <Badge label={t('family.activeNow')} tone="success" icon="eye" /> : null}
                  </View>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.md }}>
                <Button
                  testID={`switch-to-${p.relationship}`}
                  label={t('family.switchProfile')}
                  icon="repeat"
                  variant="soft"
                  size="sm"
                  fullWidth={false}
                  onPress={() => {
                    setActive(p.id);
                    router.replace('/patient');
                  }}
                />
                <Button label={t('family.manageAccess')} icon="shield" variant="ghost" size="sm" fullWidth={false} onPress={() => setManaging(p)} />
              </View>
            </Card>
          ))}
        </View>
      )}
      <AccessSheet patient={managing} onClose={() => setManaging(null)} />
    </Screen>
  );
}
