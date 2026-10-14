import { spacing } from '@ghayarly/tokens';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { authErrorKey, EMAIL_RE } from '@/features/auth/authErrors';
import { DemoAccounts } from '@/features/auth/DemoAccounts';
import { LanguageToggle } from '@/features/auth/LanguageToggle';
import { authClient } from '@/lib/auth-client';
import { useI18n } from '@/providers/i18n';
import { useResetTo } from '@/providers/session';
import { Button, Header, Notice, Screen, Text, TextField } from '@/ui';

export default function SignIn() {
  const router = useRouter();
  const resetTo = useResetTo();
  const qc = useQueryClient();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  const submit = async (e = email, p = password) => {
    const errs: typeof fieldErrors = {};
    if (!EMAIL_RE.test(e.trim())) errs.email = t('errors.invalidEmail');
    if (!p) errs.password = t('errors.requiredField');
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    setSubmitting(true);
    setError(null);
    const res = await authClient.signIn.email({ email: e.trim().toLowerCase(), password: p });
    setSubmitting(false);
    if (res.error) {
      setError(t(authErrorKey(res.error)));
      return;
    }
    if ((res.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
      router.push('/two-factor');
      return;
    }
    qc.clear();
    resetTo('/');
  };

  return (
    <Screen testID="sign-in-screen" header={<Header back title={t('auth.signInTitle')} subtitle={t('auth.signInSubtitle')} right={<LanguageToggle />} />}>
      {error ? <Notice tone="danger" body={error} testID="sign-in-error" /> : null}
      <View style={{ gap: spacing.lg }}>
        <TextField
          testID="sign-in-email"
          label={t('auth.email')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          ltr
          error={fieldErrors.email}
        />
        <TextField
          testID="sign-in-password"
          label={t('auth.password')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          ltr
          error={fieldErrors.password}
          onSubmitEditing={() => void submit()}
        />
        <Link href="/forgot-password" style={{ alignSelf: 'flex-start' }}>
          <Text variant="footnote" weight="semibold" color="primary">
            {t('auth.forgotPassword')}
          </Text>
        </Link>
      </View>
      <Button testID="sign-in-submit" label={t('auth.signIn')} onPress={() => void submit()} loading={submitting} />
      <Button label={t('auth.usePhone')} variant="secondary" icon="smartphone" onPress={() => router.push('/phone-sign-in')} />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.xs }}>
        <Text variant="footnote" color="textSecondary">
          {t('auth.noAccount')}
        </Text>
        <Link href="/sign-up">
          <Text variant="footnote" weight="semibold" color="primary">
            {t('auth.getStarted')}
          </Text>
        </Link>
      </View>
      <DemoAccounts
        onPick={(e, p) => {
          setEmail(e);
          setPassword(p);
          void submit(e, p);
        }}
      />
    </Screen>
  );
}
