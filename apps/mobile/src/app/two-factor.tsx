import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { authErrorKey } from '@/features/auth/authErrors';
import { authClient } from '@/lib/auth-client';
import { useI18n } from '@/providers/i18n';
import { useResetTo } from '@/providers/session';
import { Button, Header, Notice, Screen, TextField } from '@/ui';

export default function TwoFactor() {
  const router = useRouter();
  const resetTo = useResetTo();
  const qc = useQueryClient();
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await authClient.twoFactor.verifyTotp({ code });
    setBusy(false);
    if (res.error) {
      setError(t(authErrorKey(res.error)));
      return;
    }
    qc.clear();
    resetTo('/');
  };

  return (
    <Screen header={<Header back title={t('auth.twoFactorTitle')} subtitle={t('auth.twoFactorSubtitle')} />}>
      {error ? <Notice tone="danger" body={error} /> : null}
      <TextField label={t('auth.otpCode')} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" ltr />
      <Button label={t('auth.verify')} onPress={() => void submit()} loading={busy} disabled={code.length !== 6} />
    </Screen>
  );
}
