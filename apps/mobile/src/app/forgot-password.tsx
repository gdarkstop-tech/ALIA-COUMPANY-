import { useRouter } from 'expo-router';
import { useState } from 'react';
import { authErrorKey, EMAIL_RE } from '@/features/auth/authErrors';
import { authClient } from '@/lib/auth-client';
import { APP_SCHEME } from '@/lib/config';
import { useI18n } from '@/providers/i18n';
import { Button, Header, Notice, Screen, TextField } from '@/ui';

export default function ForgotPassword() {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!EMAIL_RE.test(email.trim())) {
      setError(t('errors.invalidEmail'));
      return;
    }
    setBusy(true);
    setError(null);
    const res = await authClient.requestPasswordReset({ email: email.trim().toLowerCase(), redirectTo: `${APP_SCHEME}://reset-password` });
    setBusy(false);
    if (res.error && res.error.status === 429) setError(t(authErrorKey(res.error)));
    // Same message whether or not the account exists (no account enumeration).
    else setSent(true);
  };

  return (
    <Screen header={<Header back title={t('auth.resetTitle')} subtitle={t('auth.resetSubtitle')} />}>
      {error ? <Notice tone="danger" body={error} /> : null}
      {sent ? <Notice tone="success" body={t('auth.resetSent')} /> : null}
      <TextField label={t('auth.email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" ltr />
      <Button label={t('auth.sendCode')} onPress={() => void submit()} loading={busy} />
      <Button label={t('auth.haveCode')} variant="ghost" onPress={() => router.push('/reset-password')} />
    </Screen>
  );
}
