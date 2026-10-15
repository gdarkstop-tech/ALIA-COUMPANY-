import { spacing } from '@ghayarly/tokens';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useConsents, useRecordConsents } from '@/features/compliance/hooks';
import { errorKey } from '@/lib/api';
import { useI18n } from '@/providers/i18n';
import { useResetTo, useSignOut } from '@/providers/session';
import { Button, Card, Checkbox, ErrorState, Header, Lockup, LoadingScreen, Notice, Screen, Text } from '@/ui';

/**
 * Consent gate: shown after sign-in whenever the account has not accepted the CURRENT terms and
 * privacy policy (new accounts, phone-OTP sign-ups, and everyone after a document update).
 * Marketing is optional and unticked by default. Health-data consent is asked separately, in
 * context, before any health information is entered.
 */
export default function ConsentGate() {
  const { t } = useI18n();
  const router = useRouter();
  const resetTo = useResetTo();
  const signOut = useSignOut();
  const consents = useConsents();
  const record = useRecordConsents();
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [marketing, setMarketing] = useState(false);

  if (consents.isPending) return <LoadingScreen />;
  if (consents.error) return <ErrorState message={t(errorKey(consents.error))} onRetry={() => void consents.refetch()} />;

  const previouslyAnswered = consents.data.consents.some((c) => c.required && c.answeredVersion && !c.granted);
  const open = (doc: 'terms' | 'privacy') => router.push(`/legal/${doc}` as Href);

  return (
    <Screen
      testID="consent-gate"
      header={<Header title={t('legal.gateTitle')} subtitle={t('legal.gateBody')} />}
      footer={
        <View style={{ gap: spacing.sm }}>
          {record.error ? <Notice tone="danger" body={t(errorKey(record.error))} /> : null}
          <Button
            testID="consent-accept"
            variant="accent"
            label={t('legal.accept')}
            disabled={!terms || !privacy}
            loading={record.isPending}
            onPress={() =>
              record.mutate(
                { state: consents.data, answers: { TERMS_OF_SERVICE: true, PRIVACY_POLICY: true, MARKETING_COMMUNICATIONS: marketing } },
                { onSuccess: () => resetTo('/') },
              )
            }
          />
          <Button
            label={t('common.signOut')}
            variant="ghost"
            onPress={async () => {
              await signOut();
              resetTo('/welcome');
            }}
          />
        </View>
      }
    >
      <View style={{ alignItems: 'center', paddingVertical: spacing.md }}>
        <Lockup compact />
      </View>
      {previouslyAnswered ? <Notice tone="info" body={t('legal.updatedNotice')} /> : null}
      <Card style={{ gap: spacing.md }}>
        <Checkbox testID="consent-terms" checked={terms} onChange={setTerms} label={t('legal.acceptTerms')}>
          <Button label={`${t('legal.read')} · ${t('legal.terms')}`} variant="ghost" size="sm" fullWidth={false} onPress={() => open('terms')} testID="read-terms" />
        </Checkbox>
        <Checkbox testID="consent-privacy" checked={privacy} onChange={setPrivacy} label={t('legal.acceptPrivacy')}>
          <Button label={`${t('legal.read')} · ${t('legal.privacy')}`} variant="ghost" size="sm" fullWidth={false} onPress={() => open('privacy')} testID="read-privacy" />
        </Checkbox>
        <Checkbox testID="consent-marketing" checked={marketing} onChange={setMarketing} label={t('legal.marketingOptional')} />
      </Card>
      <Text variant="caption" color="textTertiary" align="center">
        {t('privacy.noTracking')}
      </Text>
    </Screen>
  );
}
