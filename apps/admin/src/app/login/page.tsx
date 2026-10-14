'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useI18n } from '@/components/Providers';
import { authClient } from '@/lib/auth-client';

function LoginForm() {
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const [step, setStep] = useState<'password' | '2fa'>(params.get('step') === '2fa' ? '2fa' : 'password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (step === 'password') {
      const res = await authClient.signIn.email({ email: email.trim().toLowerCase(), password });
      setBusy(false);
      if (res.error) return setError(res.error.status === 429 ? t('errors.rateLimited') : t('errors.invalidCredentials'));
      if ((res.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) return setStep('2fa');
    } else {
      const res = await authClient.twoFactor.verifyTotp({ code });
      setBusy(false);
      if (res.error) return setError(t('errors.invalidOtp'));
    }
    qc.clear();
    router.replace('/');
  };

  return (
    <div className="login-wrap">
      <form className="card login-card stack" onSubmit={submit} data-testid="admin-login">
        <div className="spread">
          <img src="/mark.png" alt="" width={44} height={44} style={{ borderRadius: 12 }} />
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}>
            {locale === 'ar' ? 'English' : 'العربية'}
          </button>
        </div>
        <div>
          <h1>{t('admin.signInTitle')}</h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>{t('admin.signInBody')}</p>
        </div>
        {error ? <div className="notice danger" role="alert" data-testid="login-error">{error}</div> : null}
        {step === 'password' ? (
          <>
            <div className="field">
              <label htmlFor="email">{t('auth.email')}</label>
              <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required dir="ltr" data-testid="admin-email" />
            </div>
            <div className="field">
              <label htmlFor="password">{t('auth.password')}</label>
              <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required dir="ltr" data-testid="admin-password" />
            </div>
          </>
        ) : (
          <div className="field">
            <label htmlFor="code">{t('auth.twoFactorSubtitle')}</label>
            <input id="code" className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
          </div>
        )}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy} data-testid="admin-submit">
          {busy ? t('common.loading') : step === 'password' ? t('auth.signIn') : t('auth.verify')}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
