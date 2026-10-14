import { radii, spacing } from '@ghayarly/tokens';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { authClient } from '@/lib/auth-client';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useMe } from '@/providers/session';
import { useTheme } from '@/providers/theme';
import { Badge, Button, Card, Divider, Header, ListRow, LoadingScreen, Notice, Screen, Section, Text, TextField, useToast } from '@/ui';

export default function Security() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const me = useMe();
  const session = authClient.useSession();
  const sessions = useQuery({
    queryKey: ['auth-sessions'],
    queryFn: async () => {
      const res = await authClient.listSessions();
      if (res.error) throw new Error(res.error.message);
      return res.data ?? [];
    },
  });
  const revoke = useMutation({
    mutationFn: async (token: string) => {
      const res = await authClient.revokeSession({ token });
      if (res.error) throw new Error(res.error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['auth-sessions'] }),
  });

  const [password, setPassword] = useState('');
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const enable = useMutation({
    mutationFn: async () => {
      const res = await authClient.twoFactor.enable({ password });
      if (res.error) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: (data) => {
      setTotpUri(data && 'totpURI' in data ? data.totpURI : null);
      setError(null);
    },
    onError: () => setError(t('errors.invalidCredentials')),
  });
  const verify = useMutation({
    mutationFn: async () => {
      const res = await authClient.twoFactor.verifyTotp({ code });
      if (res.error) throw new Error(res.error.message);
    },
    onSuccess: async () => {
      toast(t('me.twoFactorEnabled'));
      setTotpUri(null);
      await qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: () => setError(t('errors.invalidOtp')),
  });
  const secret = totpUri ? new URL(totpUri).searchParams.get('secret') : null;

  return (
    <Screen header={<Header back title={t('me.security')} />}>
      <Section title={t('me.twoFactor')}>
        <Card>
          <View style={{ gap: spacing.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="callout" weight="semibold">{t('me.twoFactor')}</Text>
              <Badge label={me.data?.user.twoFactorEnabled ? t('me.twoFactorOn') : t('me.twoFactorOff')} tone={me.data?.user.twoFactorEnabled ? 'success' : 'warning'} />
            </View>
            {error ? <Notice tone="danger" body={error} /> : null}
            {!me.data?.user.twoFactorEnabled && !totpUri ? (
              <>
                <TextField label={t('me.confirmPassword')} value={password} onChangeText={setPassword} secureTextEntry ltr />
                <Button label={t('me.twoFactorEnable')} icon="shield" loading={enable.isPending} disabled={!password} onPress={() => enable.mutate()} />
              </>
            ) : null}
            {totpUri ? (
              <>
                <Text variant="footnote" color="textSecondary">{t('me.twoFactorSecret')}</Text>
                <View style={{ backgroundColor: colors.surfaceSunken, borderRadius: radii.md, padding: spacing.lg }}>
                  <Text variant="callout" weight="semibold" selectable style={{ letterSpacing: 2, textAlign: 'center' }}>{secret}</Text>
                </View>
                <TextField label={t('auth.otpCode')} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" ltr />
                <Button label={t('auth.verify')} loading={verify.isPending} disabled={code.length !== 6} onPress={() => verify.mutate()} />
              </>
            ) : null}
          </View>
        </Card>
      </Section>
      <Section title={t('me.sessions')}>
        {sessions.isPending ? (
          <LoadingScreen />
        ) : (
          <Card padded={false}>
            <View style={{ paddingHorizontal: spacing.lg }}>
              {(sessions.data ?? []).map((s, i) => {
                const isCurrent = s.id === session.data?.session.id;
                return (
                  <View key={s.id}>
                    {i ? <Divider /> : null}
                    <ListRow
                      icon={/mobile|android|iphone|expo/i.test(s.userAgent ?? '') ? 'smartphone' : 'monitor'}
                      title={isCurrent ? t('me.currentDevice') : (s.userAgent ?? '—').slice(0, 40)}
                      subtitle={formatDate(String(s.createdAt), locale)}
                      trailing={!isCurrent ? <Button label={t('me.revokeSession')} variant="ghost" size="sm" fullWidth={false} onPress={() => revoke.mutate(s.token)} /> : <Badge label={t('family.activeNow')} tone="success" />}
                    />
                  </View>
                );
              })}
            </View>
          </Card>
        )}
      </Section>
    </Screen>
  );
}
