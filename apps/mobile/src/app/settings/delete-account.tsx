import { ACCOUNT_DELETION_CONFIRMATION, PHONE_ONLY_EMAIL_DOMAIN, STORE_MANAGED_STATUSES } from '@ghayarly/shared';
import { spacing } from '@ghayarly/tokens';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { useEntitlements } from '@/features/billing/useStoreBilling';
import { api, ApiError, errorKey } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { useI18n } from '@/providers/i18n';
import { useMe, useResetTo } from '@/providers/session';
import { Button, Card, Header, Notice, Screen, Text, TextField, useToast } from '@/ui';

/**
 * In-app account deletion (App Store 5.1.1(v), Google Play account-deletion policy).
 * The server re-authenticates (password, or a sign-in within 15 minutes for phone-only accounts),
 * deletes immediately and returns a summary; the app then clears every local trace of the session.
 */
export default function DeleteAccount() {
  const { t } = useI18n();
  const me = useMe();
  const qc = useQueryClient();
  const resetTo = useResetTo();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Apple guidance: deleting the account does not cancel an App Store / Play subscription — say so.
  const entitlements = useEntitlements();
  const phoneOnly = Boolean(me.data?.user.email.endsWith(`@${PHONE_ONLY_EMAIL_DOMAIN}`));
  const confirmed = confirm.trim().toUpperCase() === ACCOUNT_DELETION_CONFIRMATION;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.me.deleteAccount({ confirmation: confirm, ...(phoneOnly ? {} : { password }) });
      // Server already revoked every session; clear the local cookie store and caches too.
      await authClient.signOut().catch(() => undefined);
      qc.clear();
      toast(t('deletion.done'));
      resetTo('/welcome');
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      setError(
        code === 'INVALID_PASSWORD'
          ? t('errors.invalidPassword')
          : code === 'PASSWORD_REQUIRED'
            ? t('errors.passwordRequired')
            : code === 'RECENT_SIGN_IN_REQUIRED'
              ? t('errors.recentSignInRequired')
              : t(errorKey(e)),
      );
    } finally {
      setBusy(false);
    }
  };

  const storeSub = entitlements.data?.entitlements.find((e) => e.source !== 'ADMIN_GRANT' && STORE_MANAGED_STATUSES.includes(e.status));

  return (
    <Screen testID="delete-account" header={<Header back title={t('deletion.title')} />}>
      <Notice tone="danger" body={t('deletion.intro')} />
      {storeSub ? (
        <Notice tone="warning" testID="delete-active-subscription" body={t('billing.activeStoreSubscription', { store: t(storeSub.source === 'APPLE' ? 'billing.appStore' : 'billing.googlePlay') })} />
      ) : null}
      <Card style={{ gap: spacing.sm }}>
        <Text variant="callout" weight="semibold">{t('deletion.deletedTitle')}</Text>
        {t('deletion.deletedItems').split(' · ').map((item) => (
          <Text key={item} variant="footnote" color="textSecondary">• {item}</Text>
        ))}
      </Card>
      <Card style={{ gap: spacing.sm }}>
        <Text variant="callout" weight="semibold">{t('deletion.keptTitle')}</Text>
        {t('deletion.keptItems').split(' · ').map((item) => (
          <Text key={item} variant="footnote" color="textSecondary">• {item}</Text>
        ))}
      </Card>
      <View style={{ gap: spacing.md }}>
        {phoneOnly ? (
          <Text variant="footnote" color="textSecondary">{t('deletion.recentSignInNote')}</Text>
        ) : (
          <TextField testID="delete-password" label={t('deletion.passwordLabel')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" />
        )}
        <TextField
          testID="delete-confirm"
          label={t('deletion.typeToConfirm', { word: t('deletion.confirmWord') })}
          value={confirm}
          onChangeText={setConfirm}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        {error ? <Notice tone="danger" body={error} testID="delete-error" /> : null}
        <Button
          testID="delete-submit"
          variant="danger"
          icon="trash-2"
          label={t('deletion.submit')}
          disabled={!confirmed || (!phoneOnly && !password)}
          loading={busy}
          onPress={() => void submit()}
        />
      </View>
    </Screen>
  );
}
