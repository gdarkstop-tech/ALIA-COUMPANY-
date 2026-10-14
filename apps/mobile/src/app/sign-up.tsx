import { spacing } from '@ghayarly/tokens';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { authErrorKey, EMAIL_RE } from '@/features/auth/authErrors';
import { LanguageToggle } from '@/features/auth/LanguageToggle';
import { authClient } from '@/lib/auth-client';
import { useI18n } from '@/providers/i18n';
import { useResetTo } from '@/providers/session';
import { Button, Header, Notice, Screen, Text, TextField } from '@/ui';

export default function SignUp() {
  const router = useRouter();
  const resetTo = useResetTo();
  const qc = useQueryClient();
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errs, setErrs] = useState<{ name?: string; email?: string; password?: string }>({});

  const submit = async () => {
    const next: typeof errs = {};
    if (name.trim().length < 2) next.name = t('errors.requiredField');
    if (!EMAIL_RE.test(email.trim())) next.email = t('errors.invalidEmail');
    if (password.length < 10 || !/\d/.test(password) || !/[A-Za-z؀-ۿ]/.test(password)) next.password = t('errors.weakPassword');
    setErrs(next);
    if (Object.keys(next).length) return;
    setSubmitting(true);
    setError(null);
    const res = await authClient.signUp.email({ name: name.trim(), email: email.trim().toLowerCase(), password });
    setSubmitting(false);
    if (res.error) {
      setError(t(authErrorKey(res.error)));
      return;
    }
    qc.clear();
    resetTo('/onboarding/role');
  };

  return (
    <Screen testID="sign-up-screen" header={<Header back title={t('auth.signUpTitle')} subtitle={t('auth.signUpSubtitle')} right={<LanguageToggle />} />}>
      {error ? <Notice tone="danger" body={error} /> : null}
      <View style={{ gap: spacing.lg }}>
        <TextField testID="sign-up-name" label={t('auth.fullName')} value={name} onChangeText={setName} autoComplete="name" textContentType="name" error={errs.name} />
        <TextField testID="sign-up-email" label={t('auth.email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" ltr error={errs.email} />
        <TextField
          testID="sign-up-password"
          label={t('auth.password')}
          hint={t('auth.passwordHint')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          ltr
          error={errs.password}
        />
      </View>
      <Text variant="caption" color="textTertiary">
        {t('auth.termsNotice')}
      </Text>
      <Button testID="sign-up-submit" label={t('auth.signUp')} onPress={() => void submit()} loading={submitting} />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.xs }}>
        <Link href="/sign-in">
          <Text variant="footnote" weight="semibold" color="primary">
            {t('auth.haveAccount')}
          </Text>
        </Link>
      </View>
    </Screen>
  );
}
