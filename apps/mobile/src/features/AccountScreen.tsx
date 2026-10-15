import type { Role } from '@ghayarly/shared';
import { spacing } from '@ghayarly/tokens';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { api, errorKey } from '@/lib/api';
import { APP_VERSION } from '@/lib/config';
import { useI18n } from '@/providers/i18n';
import { usePreferences, type ThemeMode } from '@/providers/preferences';
import { activeExperience, useMe, useSignOut, useResetTo } from '@/providers/session';
import { useTheme } from '@/providers/theme';
import { Avatar, Badge, Button, Card, Divider, Header, ListRow, Notice, Screen, Section, Segmented, Sheet, Text, TextField, useToast } from '@/ui';

/** Shared account & settings screen for patient and clinician experiences. */
export function AccountScreen({ experience }: { experience: 'patient' | 'clinician' }) {
  const { t, locale, setLocale } = useI18n();
  const { themeMode, setThemeMode } = usePreferences();
  const { colors } = useTheme();
  const router = useRouter();
  const resetTo = useResetTo();
  const toast = useToast();
  const qc = useQueryClient();
  const me = useMe();
  const signOut = useSignOut();
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantName, setAssistantName] = useState('');
  const current = activeExperience(me.data);

  const switchRole = useMutation({
    mutationFn: (role: Role) => api.me.update({ activeRole: role }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      resetTo('/');
    },
  });
  const saveAssistant = useMutation({
    mutationFn: () => api.me.update({ assistantName: assistantName.trim() }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast(t('common.saved'));
      setAssistantOpen(false);
    },
  });

  const name = me.data?.profile.displayName ?? '';
  const otherRoles = (me.data?.roles ?? []).filter((r) => r !== current && (r === 'PATIENT' || r === 'DOCTOR' || r === 'NURSE'));

  return (
    <Screen testID="account-screen" header={<Header title={t('me.title')} />}>
      <Card>
        <View style={{ flexDirection: 'row', gap: spacing.lg, alignItems: 'center' }}>
          <Avatar name={name || '?'} size={60} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="title3">{name}</Text>
            <Text variant="footnote" color="textSecondary">{me.data?.user.email.endsWith('.invalid') ? me.data?.user.phoneNumber : me.data?.user.email}</Text>
            <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
              {current ? <Badge label={t(`roles.${current}`)} tone="primary" /> : null}
              <Badge label={me.data?.user.emailVerified ? t('me.emailVerified') : t('me.emailNotVerified')} tone={me.data?.user.emailVerified ? 'success' : 'warning'} />
            </View>
          </View>
        </View>
      </Card>

      {me.data?.mfa.required && !me.data.mfa.enrolled ? <Notice tone="warning" title={t('me.twoFactor')} body={t('provider.mfaWarning')} /> : null}

      <Section title={t('common.language')}>
        <Segmented testID="locale-switch" value={locale} onChange={setLocale} options={[{ value: 'ar', label: t('common.arabic') }, { value: 'en', label: t('common.english') }]} />
      </Section>
      <Section title={t('common.theme')}>
        <Segmented<ThemeMode>
          testID="theme-switch"
          value={themeMode}
          onChange={setThemeMode}
          options={[{ value: 'system', label: t('common.themeSystem') }, { value: 'light', label: t('common.themeLight') }, { value: 'dark', label: t('common.themeDark') }]}
        />
      </Section>

      <Card padded={false}>
        <View style={{ paddingHorizontal: spacing.lg }}>
          {experience === 'patient' ? (
            <>
              <ListRow icon="users" title={t('family.title')} subtitle={t('family.subtitle')} onPress={() => router.push('/patient/family')} />
              <Divider />
              <ListRow
                icon="mci:creation-outline"
                title={t('me.assistantName')}
                subtitle={me.data?.profile.assistantName ?? t('me.assistantNameHint')}
                onPress={() => {
                  setAssistantName(me.data?.profile.assistantName ?? '');
                  setAssistantOpen(true);
                }}
              />
              <Divider />
            </>
          ) : null}
          {experience === 'patient' ? (
            <>
              <ListRow icon="mci:crown-outline" title={t('billing.title')} subtitle={t('billing.subtitle')} onPress={() => router.push('/settings/subscription')} testID="open-subscription" />
              <Divider />
            </>
          ) : null}
          <ListRow icon="mci:shield-lock-outline" title={t('privacy.title')} subtitle={t('privacy.subtitle')} onPress={() => router.push('/settings/privacy')} testID="open-privacy" />
          <Divider />
          <ListRow icon="lock" title={t('me.security')} subtitle={`${t('me.sessions')} · ${t('me.twoFactor')}`} onPress={() => router.push('/settings/security')} testID="open-security" />
          <Divider />
          <ListRow icon="activity" title={t('me.systemStatus')} onPress={() => router.push('/settings/system')} />
        </View>
      </Card>

      <Notice tone="info" icon="mci:shield-lock-outline" title={t('me.privacy')} body={t('me.privacyBody')} />

      <Section title={t('roles.switchRole')}>
        <Card padded={false}>
          <View style={{ paddingHorizontal: spacing.lg }}>
            {otherRoles.map((r) => (
              <View key={r}>
                <ListRow icon="repeat" title={t(`roles.${r}`)} onPress={() => switchRole.mutate(r)} testID={`switch-role-${r}`} />
                <Divider />
              </View>
            ))}
            <ListRow icon="plus" title={t('roles.addRole')} onPress={() => router.push('/onboarding/role')} />
          </View>
        </Card>
        {switchRole.error ? <Notice tone="danger" body={t(errorKey(switchRole.error))} /> : null}
      </Section>

      <Button
        testID="sign-out"
        label={t('common.signOut')}
        variant="danger"
        icon="log-out"
        onPress={async () => {
          await signOut();
          resetTo('/welcome');
        }}
      />
      <Text variant="caption" color="textTertiary" align="center" style={{ color: colors.textTertiary }}>
        {t('app.name')} · {t('me.version', { version: APP_VERSION })}
      </Text>

      <Sheet visible={assistantOpen} onClose={() => setAssistantOpen(false)} title={t('me.assistantName')}>
        <TextField label={t('me.assistantName')} hint={t('me.assistantNameHint')} value={assistantName} onChangeText={setAssistantName} maxLength={40} />
        <Button label={t('common.save')} loading={saveAssistant.isPending} disabled={!assistantName.trim()} onPress={() => saveAssistant.mutate()} />
      </Sheet>
    </Screen>
  );
}
