import { spacing } from '@ghayarly/tokens';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { api, errorKey } from '@/lib/api';
import { useI18n } from '@/providers/i18n';
import { useMe, useResetTo, useSignOut } from '@/providers/session';
import { Button, Card, ErrorState, Header, LoadingScreen, Notice, Screen, Text, TextField, useToast } from '@/ui';

/**
 * Shown to a suspended or blocked account: why (in the words staff wrote for the person), until
 * when, and how to ask for a review. Account deletion and the legal documents stay reachable; the
 * person's health records are kept and not deleted by a restriction.
 */
export default function AccountRestricted() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const resetTo = useResetTo();
  const signOut = useSignOut();
  const toast = useToast();
  const qc = useQueryClient();
  const me = useMe();
  const status = useQuery({ queryKey: ['account-status'], queryFn: () => api.me.accountStatus() });
  const [message, setMessage] = useState('');
  const appeal = useMutation({
    mutationFn: () => api.me.appeal({ message: message.trim(), ...(status.data?.events[0] ? { eventId: status.data.events[0].id } : {}) }),
    onSuccess: async () => {
      setMessage('');
      toast(t('accounts.appealSent'));
      await qc.invalidateQueries({ queryKey: ['account-status'] });
    },
  });

  if (me.data && me.data.account.status === 'ACTIVE') return <Redirect href="/" />;
  if (status.isPending) return <LoadingScreen />;
  if (status.error) return <ErrorState message={t(errorKey(status.error))} onRetry={() => void status.refetch()} />;
  const { account, appeals, canAppeal } = status.data;
  const latest = appeals[0];
  const until = account.suspendedUntil
    ? t('accounts.until', { date: new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(account.suspendedUntil)) })
    : account.status === 'SUSPENDED'
      ? t('accounts.untilReview')
      : null;

  return (
    <Screen
      testID="account-restricted"
      header={<Header title={t(account.status === 'BLOCKED' ? 'accounts.restrictedTitle_BLOCKED' : 'accounts.restrictedTitle_SUSPENDED')} />}
      footer={
        <View style={{ gap: spacing.sm }}>
          <Button testID="restricted-delete" label={t('accounts.deleteInstead')} variant="ghost" onPress={() => router.push('/settings/delete-account' as Href)} />
          <Button
            testID="restricted-sign-out"
            label={t('common.signOut')}
            variant="secondary"
            onPress={async () => {
              await signOut();
              resetTo('/welcome');
            }}
          />
        </View>
      }
    >
      <Notice tone="danger" icon="alert-triangle" body={account.publicMessage ?? t('accounts.restrictedBody')} testID="restricted-message" />
      <Card style={{ gap: spacing.sm }}>
        {account.reason ? <Text variant="callout" weight="semibold">{t(`accounts.reason_${account.reason}`)}</Text> : null}
        {until ? <Text variant="footnote" color="textSecondary">{until}</Text> : null}
        <Text variant="footnote" color="textSecondary">{t('accounts.restrictedBody')}</Text>
      </Card>

      {latest && latest.status === 'OPEN' ? <Notice tone="info" body={t('accounts.appealPending')} testID="appeal-pending" /> : null}
      {latest && (latest.status === 'GRANTED' || latest.status === 'DENIED') ? (
        <Notice tone={latest.status === 'GRANTED' ? 'success' : 'warning'} title={t(`accounts.appealOutcome_${latest.status}`)} body={latest.decisionNote ?? ''} />
      ) : null}

      {canAppeal ? (
        <Card style={{ gap: spacing.md }} testID="appeal-form">
          <Text variant="title3">{t('accounts.appealTitle')}</Text>
          <Text variant="footnote" color="textSecondary">{t('accounts.appealBody')}</Text>
          <TextField testID="appeal-message" label={t('accounts.appealMessage')} value={message} onChangeText={setMessage} multiline maxLength={2000} />
          {appeal.error ? <Notice tone="danger" body={t(errorKey(appeal.error))} /> : null}
          <Button testID="appeal-submit" label={t('accounts.submitAppeal')} disabled={message.trim().length < 10} loading={appeal.isPending} onPress={() => appeal.mutate()} />
        </Card>
      ) : null}

      <Notice tone="info" icon="phone" body={t('accounts.emergencyReminder')} />
      <View style={{ flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' }}>
        <Button label={t('legal.terms')} variant="ghost" size="sm" fullWidth={false} onPress={() => router.push('/legal/terms' as Href)} />
        <Button label={t('legal.privacy')} variant="ghost" size="sm" fullWidth={false} onPress={() => router.push('/legal/privacy' as Href)} />
      </View>
    </Screen>
  );
}
