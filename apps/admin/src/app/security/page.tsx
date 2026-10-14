'use client';
import { useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { useI18n, useToast } from '@/components/Providers';
import { Shell, useMe } from '@/components/Shell';
import { authClient } from '@/lib/auth-client';

export default function Security() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const me = useMe();
  const [password, setPassword] = useState('');
  const [uri, setUri] = useState<string | null>(null);
  const [backup, setBackup] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const enabled = me.data?.user.twoFactorEnabled;

  const enable = async () => {
    setError(null);
    const res = await authClient.twoFactor.enable({ password });
    if (res.error || !res.data || !('totpURI' in res.data)) return setError(t('errors.invalidCredentials'));
    setUri(res.data.totpURI);
    setBackup(res.data.backupCodes);
  };
  const verify = async () => {
    const res = await authClient.twoFactor.verifyTotp({ code });
    if (res.error) return setError(t('errors.invalidOtp'));
    toast(t('me.twoFactorEnabled'));
    setUri(null);
    await qc.invalidateQueries({ queryKey: ['me'] });
  };

  return (
    <Shell title={t('admin.security')}>
      <div className="card stack" style={{ maxWidth: 560 }}>
        <div className="spread">
          <h2>{t('me.twoFactor')}</h2>
          <span className={`badge tone-${enabled ? 'success' : 'warning'}`}>{enabled ? t('me.twoFactorOn') : t('me.twoFactorOff')}</span>
        </div>
        {error ? <div className="notice danger">{error}</div> : null}
        {!enabled && !uri ? (
          <>
            <div className="field">
              <label htmlFor="pw">{t('me.confirmPassword')}</label>
              <input id="pw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" />
            </div>
            <button className="btn btn-primary" disabled={!password} onClick={() => void enable()}>{t('me.twoFactorEnable')}</button>
          </>
        ) : null}
        {uri ? (
          <>
            <p className="muted">{t('admin.scanQr')}</p>
            <div style={{ background: '#fff', padding: 16, borderRadius: 16, alignSelf: 'center' }}>
              <QRCodeSVG value={uri} size={180} />
            </div>
            <details>
              <summary className="subtle">Backup codes</summary>
              <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>{backup.join('  ')}</pre>
            </details>
            <div className="field">
              <label htmlFor="otp">{t('auth.otpCode')}</label>
              <input id="otp" className="input mono" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            </div>
            <button className="btn btn-primary" disabled={code.length !== 6} onClick={() => void verify()}>{t('auth.verify')}</button>
          </>
        ) : null}
      </div>
    </Shell>
  );
}
