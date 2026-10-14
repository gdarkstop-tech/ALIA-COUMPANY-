import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { authErrorKey } from '@/features/auth/authErrors';
import { authClient } from '@/lib/auth-client';
import { useI18n } from '@/providers/i18n';
import { Button, Header, Notice, Screen, TextField, useToast } from '@/ui';

export default function ResetPassword() {
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ token?: string }>();
  const { t } = useI18n();
  const [token, setToken] = useState(params.token ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (password.length < 10) {
      setError(t('errors.weakPassword'));
      return;
    }
    setBusy(true);
    setError(null);
    const res = await authClient.resetPassword({ token: token.trim(), newPassword: password });
    setBusy(false);
    if (res.error) {
      setError(t(authErrorKey(res.error)));
      return;
    }
    toast(t('auth.passwordUpdated'));
    router.replace('/sign-in');
  };

  return (
    <Screen header={<Header back title={t('auth.setNewPassword')} />}>
      {error ? <Notice tone="danger" body={error} /> : null}
      <TextField label={t('auth.resetToken')} value={token} onChangeText={setToken} autoCapitalize="none" ltr />
      <TextField label={t('auth.newPassword')} hint={t('auth.passwordHint')} value={password} onChangeText={setPassword} secureTextEntry ltr />
      <Button label={t('auth.setNewPassword')} onPress={() => void submit()} loading={busy} disabled={!token} />
    </Screen>
  );
}
