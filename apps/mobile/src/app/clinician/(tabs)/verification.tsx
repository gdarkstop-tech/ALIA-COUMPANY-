import { listSeparator } from '@ghayarly/i18n';
import { radii, spacing } from '@ghayarly/tokens';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { useMyProvider, useSetMyProvider, verificationTone } from '@/features/provider/hooks';
import { api, errorKey } from '@/lib/api';
import { formatDate, money } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Badge, Button, Card, Divider, ErrorState, Header, Icon, LoadingScreen, Notice, PressableScale, Screen, Section, Text, useToast, type Tone } from '@/ui';

export default function Verification() {
  const { t, pickL, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const mine = useMyProvider();
  const setMine = useSetMyProvider();
  const submit = useMutation({ mutationFn: () => api.provider.submit(), onSuccess: async (d) => { await setMine(d); toast(t('provider.submitted')); } });
  const remove = useMutation({ mutationFn: (id: string) => api.provider.removeCredential(id), onSuccess: setMine });

  if (mine.isPending) return <Screen><LoadingScreen /></Screen>;
  if (mine.error) return <Screen><ErrorState message={t(errorKey(mine.error))} onRetry={() => void mine.refetch()} /></Screen>;
  const m = mine.data;
  if (!m.profile) return <Screen><Button label={t('provider.startOnboarding')} onPress={() => router.replace('/onboarding/provider')} /></Screen>;
  const p = m.profile;
  const status = p.verificationStatus;
  const tone = verificationTone(status) as Tone;

  return (
    <Screen testID="verification-screen" header={<Header title={t('provider.verificationTitle')} />} refreshing={mine.isRefetching} onRefresh={() => void mine.refetch()}>
      <Card tone={status === 'APPROVED' ? 'primary' : 'surface'}>
        <View style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Icon name={status === 'APPROVED' ? 'mci:check-decagram' : status === 'REJECTED' ? 'x-circle' : 'mci:shield-search'} size={28} color={tone === 'success' ? 'success' : tone === 'danger' ? 'danger' : 'info'} />
            <Text variant="title3" style={{ flex: 1 }} testID="verification-status">{t(`provider.status_${status}`)}</Text>
          </View>
          <Text variant="footnote" color="textSecondary">{t(`provider.statusBody_${status}`)}</Text>
          {p.verificationNote ? <Notice tone="warning" title={t('provider.reviewerNote')} body={p.verificationNote} /> : null}
          {p.isDemo ? <Badge label={t('app.demoData')} tone="demo" /> : null}
        </View>
      </Card>

      <Section title={t('provider.checklist')}>
        <Card padded={false}>
          {m.checklist.map((c, i) => (
            <View key={c.key} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderTopWidth: i ? 1 : 0, borderTopColor: colors.divider }} testID={`check-${c.key}`}>
              <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: c.done ? colors.success : colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
                {c.done ? <Icon name="check" size={15} tint="#fff" /> : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.borderStrong }} />}
              </View>
              <Text variant="callout" color={c.done ? 'text' : 'textSecondary'}>{t(`provider.check_${c.key}` as 'provider.check_profile')}</Text>
            </View>
          ))}
        </Card>
      </Section>

      <Section title={t('provider.credentials')} action={<Button testID="add-credential" label={t('provider.addCredential')} icon="plus" variant="ghost" size="sm" fullWidth={false} onPress={() => router.push('/clinician/add-credential')} />}>
        <Card padded={false}>
          {m.credentials.length === 0 ? (
            <View style={{ padding: spacing.lg }}><Text variant="footnote" color="textTertiary">{t('provider.notBookableYet')}</Text></View>
          ) : (
            m.credentials.map((c, i) => (
              <View key={c.id} style={{ padding: spacing.lg, gap: spacing.xs, borderTopWidth: i ? 1 : 0, borderTopColor: colors.divider }} testID={`credential-${c.kind}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <View style={{ width: 36, height: 36, borderRadius: radii.md, backgroundColor: c.status === 'APPROVED' ? colors.successSoft : colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={c.status === 'APPROVED' ? 'check' : 'file-text'} size={17} color={c.status === 'APPROVED' ? 'success' : 'textSecondary'} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="callout" weight="semibold">{t(`provider.cred_${c.kind}`)}</Text>
                    <Text variant="caption" color="textTertiary">{c.issuer} · {c.identifier}</Text>
                  </View>
                  <Badge label={t(`provider.credStatus_${c.status}`)} tone={c.status === 'APPROVED' ? 'success' : c.status === 'REJECTED' ? 'danger' : 'info'} />
                  {c.status !== 'APPROVED' ? (
                    <PressableScale accessibilityRole="button" accessibilityLabel={t('common.remove')} onPress={() => remove.mutate(c.id)} style={{ padding: 6 }}>
                      <Icon name="trash-2" size={16} color="textTertiary" />
                    </PressableScale>
                  ) : null}
                </View>
                {c.reviewNote ? <Text variant="caption" color="danger">{t('provider.reviewerNote')}: {c.reviewNote}</Text> : null}
              </View>
            ))
          )}
        </Card>
        <Notice tone="info" icon="upload-cloud" body={t('provider.documentNotUploaded')} />
      </Section>

      {submit.error ? <Notice tone="danger" body={t(errorKey(submit.error))} /> : null}
      {m.canSubmit ? <Button testID="submit-verification" label={t('provider.submit')} icon="send" loading={submit.isPending} onPress={() => submit.mutate()} /> : null}

      <Section title={t('provider.profileDetails')} action={<Button label={t('common.edit')} icon="edit-2" variant="ghost" size="sm" fullWidth={false} onPress={() => router.push('/clinician/profile-edit')} />}>
        <Card>
          <View style={{ gap: spacing.sm }}>
            <Text variant="callout" weight="semibold">{pickL(p, 'displayName')}</Text>
            <Text variant="footnote" color="textSecondary">
              {p.specialty ? t(`specialty.${p.specialty}`) : t('roles.NURSE')} · {t('common.years', { count: p.yearsExperience })}
            </Text>
            <Divider />
            <Text variant="footnote" color="textSecondary">{p.city}{listSeparator(locale)}{t(`governorate.${p.governorate}`)}</Text>
            <Text variant="footnote" color="textSecondary">{t('provider.fee')}: {money(p.feePiasters ?? null, locale)}</Text>
            {p.submittedAt ? <Text variant="caption" color="textTertiary">{t('provider.submittedOn', { date: formatDate(p.submittedAt, locale) })}</Text> : null}
          </View>
        </Card>
      </Section>
    </Screen>
  );
}
