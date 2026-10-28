import { spacing } from '@ghayarly/tokens';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';
import { consentErrorKey, useConsents, useRecordConsents } from '@/features/compliance/hooks';
import { errorKey } from '@/lib/api';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Button, Card, Divider, ErrorState, Header, ListRow, LoadingScreen, Notice, Screen, Section, Sheet, Text } from '@/ui';

/** Privacy center: consent switches, what we keep, legal documents and account deletion. */
export default function PrivacyCenter() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const consents = useConsents();
  const record = useRecordConsents();
  const [confirmPause, setConfirmPause] = useState(false);

  if (consents.isPending) return <LoadingScreen />;
  if (consents.error) return <ErrorState message={t(errorKey(consents.error))} onRetry={() => void consents.refetch()} />;
  const state = consents.data;
  const marketing = state.consents.find((c) => c.type === 'MARKETING_COMMUNICATIONS')?.granted ?? false;
  const aiConsent = state.consents.find((c) => c.type === 'AI_ASSISTANT_PROCESSING');
  const voiceConsent = state.consents.find((c) => c.type === 'AI_VOICE_PROCESSING');
  const documentConsent = state.consents.find((c) => c.type === 'AI_DOCUMENT_PROCESSING');
  const setHealth = (granted: boolean) => record.mutate({ state, answers: { HEALTH_DATA_PROCESSING: granted } });

  return (
    <Screen testID="privacy-center" header={<Header back title={t('privacy.title')} subtitle={t('privacy.subtitle')} />}>
      <Card style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="callout" weight="semibold">{t('privacy.healthData')}</Text>
            <Text variant="footnote" color="textSecondary">{t('privacy.healthDataBody')}</Text>
          </View>
          <Switch
            testID="health-consent-switch"
            accessibilityLabel={t('privacy.healthData')}
            value={state.healthDataConsented}
            disabled={record.isPending}
            onValueChange={(v) => (v ? setHealth(true) : setConfirmPause(true))}
            trackColor={{ true: colors.accent, false: colors.border }}
          />
        </View>
        {!state.healthDataConsented ? <Notice tone="warning" body={t('privacy.healthDataOff')} testID="health-paused-notice" /> : null}
        <Button label={`${t('legal.read')} · ${t('legal.healthConsent')}`} variant="ghost" size="sm" fullWidth={false} onPress={() => router.push('/legal/health-consent' as Href)} />
        <Divider />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="callout" weight="semibold">{t('privacy.marketing')}</Text>
            <Text variant="footnote" color="textSecondary">{t('privacy.marketingBody')}</Text>
          </View>
          <Switch
            testID="marketing-switch"
            accessibilityLabel={t('privacy.marketing')}
            value={marketing}
            disabled={record.isPending}
            onValueChange={(v) => record.mutate({ state, answers: { MARKETING_COMMUNICATIONS: v } })}
            trackColor={{ true: colors.accent, false: colors.border }}
          />
        </View>
        {aiConsent ? (
          <>
            <Divider />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="callout" weight="semibold">{t('privacy.aiAssistant')}</Text>
                <Text variant="footnote" color="textSecondary">{t('privacy.aiAssistantBody')}</Text>
              </View>
              <Switch
                testID="ai-consent-switch"
                accessibilityLabel={t('privacy.aiAssistant')}
                value={aiConsent.granted}
                disabled={record.isPending}
                onValueChange={(v) => record.mutate({ state, answers: { AI_ASSISTANT_PROCESSING: v } })}
                trackColor={{ true: colors.accent, false: colors.border }}
              />
            </View>
            <Button label={`${t('legal.read')} · ${t('legal.aiConsent')}`} variant="ghost" size="sm" fullWidth={false} onPress={() => router.push('/legal/ai-assistant-consent' as Href)} testID="open-ai-consent" />
          </>
        ) : null}
        {voiceConsent ? (
          <>
            <Divider />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="callout" weight="semibold">{t('privacy.aiVoice')}</Text>
                <Text variant="footnote" color="textSecondary">{t('privacy.aiVoiceBody')}</Text>
              </View>
              <Switch
                testID="ai-voice-consent-switch"
                accessibilityLabel={t('privacy.aiVoice')}
                value={voiceConsent.granted}
                disabled={record.isPending}
                onValueChange={(v) => record.mutate({ state, answers: { AI_VOICE_PROCESSING: v } })}
                trackColor={{ true: colors.accent, false: colors.border }}
              />
            </View>
            <Button label={`${t('legal.read')} · ${t('legal.aiVoiceConsent')}`} variant="ghost" size="sm" fullWidth={false} onPress={() => router.push('/legal/ai-voice-consent' as Href)} testID="open-ai-voice-consent" />
          </>
        ) : null}
        {documentConsent ? (
          <>
            <Divider />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="callout" weight="semibold">{t('privacy.aiDocuments')}</Text>
                <Text variant="footnote" color="textSecondary">{t('privacy.aiDocumentsBody')}</Text>
              </View>
              <Switch
                testID="ai-document-consent-switch"
                accessibilityLabel={t('privacy.aiDocuments')}
                value={documentConsent.granted}
                disabled={record.isPending}
                onValueChange={(v) => record.mutate({ state, answers: { AI_DOCUMENT_PROCESSING: v } })}
                trackColor={{ true: colors.accent, false: colors.border }}
              />
            </View>
            <Button label={`${t('legal.read')} · ${t('legal.aiDocumentConsent')}`} variant="ghost" size="sm" fullWidth={false} onPress={() => router.push('/legal/ai-document-consent' as Href)} testID="open-ai-document-consent" />
          </>
        ) : null}
      </Card>
      {record.error ? <Notice tone="danger" body={t(consentErrorKey(record.error))} /> : null}

      <Notice tone="info" icon="mci:shield-lock-outline" title={t('privacy.dataSummaryTitle')} body={t('privacy.dataSummaryBody')} />
      <Text variant="caption" color="textTertiary">{t('privacy.noTracking')}</Text>

      <Card padded={false}>
        <View style={{ paddingHorizontal: spacing.lg }}>
          <ListRow icon="mci:shield-account-outline" title={t('wounds.permissionsTitle')} subtitle={t('wounds.permissionsCardBody')} onPress={() => router.push('/patient/wounds/permissions' as Href)} testID="open-wound-permissions-privacy" />
        </View>
      </Card>

      <Section title={t('legal.documents')}>
        <Card padded={false}>
          <View style={{ paddingHorizontal: spacing.lg }}>
            <ListRow icon="file-text" title={t('legal.privacy')} onPress={() => router.push('/legal/privacy' as Href)} testID="open-privacy-policy" />
            <Divider />
            <ListRow icon="file-text" title={t('legal.terms')} onPress={() => router.push('/legal/terms' as Href)} />
            <Divider />
            <ListRow icon="mci:medical-bag" title={t('legal.medicalDisclaimer')} onPress={() => router.push('/legal/medical-disclaimer' as Href)} />
          </View>
        </Card>
      </Section>

      <Card padded={false}>
        <View style={{ paddingHorizontal: spacing.lg }}>
          <ListRow icon="trash-2" danger title={t('privacy.deleteAccount')} subtitle={t('privacy.deleteAccountBody')} onPress={() => router.push('/settings/delete-account' as Href)} testID="open-delete-account" />
        </View>
      </Card>

      <Sheet visible={confirmPause} onClose={() => setConfirmPause(false)} title={t('privacy.withdrawTitle')} testID="pause-health-sheet">
        <Text variant="callout" color="textSecondary">{t('privacy.withdrawBody')}</Text>
        <Button
          testID="confirm-pause-health"
          label={t('privacy.withdraw')}
          variant="danger"
          onPress={() => {
            setConfirmPause(false);
            setHealth(false);
          }}
        />
        <Button label={t('common.cancel')} variant="secondary" onPress={() => setConfirmPause(false)} />
      </Sheet>
    </Screen>
  );
}
