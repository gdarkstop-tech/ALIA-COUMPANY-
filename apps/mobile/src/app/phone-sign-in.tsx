import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { authErrorKey, EG_PHONE_RE, normalizeEgyptPhone } from '@/features/auth/authErrors';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { useI18n } from '@/providers/i18n';
import { useResetTo } from '@/providers/session';
import { Button, Header, Notice, Screen, TextField } from '@/ui';

export default function PhoneSignIn() {
  const resetTo = useResetTo();
  const qc = useQueryClient();
  const { t } = useI18n();
  const status = useQuery({ queryKey: ['system-status'], queryFn: () => api.system.status() });
  const [phone, setPhone] = useState('+20');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalized = normalizeEgyptPhone(phone);

  const send = async () => {
    if (!EG_PHONE_RE.test(normalized)) {
      setError(t('errors.invalidPhone'));
      return;
    }
    setBusy(true);
    setError(null);
    const res = await authClient.phoneNumber.sendOtp({ phoneNumber: normalized });
    setBusy(false);
    if (res.error) setError(t(authErrorKey(res.error)));
    else setSent(true);
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    const res = await authClient.phoneNumber.verify({ phoneNumber: normalized, code: code.trim() });
    setBusy(false);
    if (res.error) {
      setError(t(authErrorKey(res.error)));
      return;
    }
    qc.clear();
    resetTo('/');
  };

  return (
    <Screen header={<Header back title={sent ? t('auth.otpTitle') : t('auth.usePhone')} subtitle={sent ? t('auth.otpSubtitle', { phone: normalized }) : t('auth.phoneHint')} />}>
      {error ? <Notice tone="danger" body={error} /> : null}
      {status.data?.integrations.sms === 'DEV_ADAPTER' ? <Notice tone="demo" body={t('auth.devOtpHint')} /> : null}
      {status.data?.integrations.sms === 'NOT_CONFIGURED' ? <Notice tone="warning" body={`${t('status.sms')}: ${t('status.NOT_CONFIGURED')}`} /> : null}
      {!sent ? (
        <>
          <TextField testID="phone-input" label={t('auth.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" ltr />
          <Button testID="phone-send" label={t('auth.sendCode')} onPress={() => void send()} loading={busy} />
        </>
      ) : (
        <>
          <TextField
            testID="otp-input"
            label={t('auth.otpCode')}
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            ltr
            style={{ letterSpacing: 6, fontSize: 22 }}
          />
          <Button testID="otp-verify" label={t('auth.verify')} onPress={() => void verify()} loading={busy} disabled={code.length !== 6} />
          <Button label={t('auth.changeNumber')} variant="ghost" onPress={() => setSent(false)} />
        </>
      )}
    </Screen>
  );
}
