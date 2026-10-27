import { spacing } from '@ghayarly/tokens';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';
import { EMERGENCY_NUMBER, useAssistantErrorText, useAssistantPreferences, useAssistantStatus, useConversations, useCreateConversation } from '@/features/assistant/hooks';
import { EmergencyNotice } from '@/features/compliance/Safety';
import { useActivePatient } from '@/features/patient/hooks';
import { errorKey } from '@/lib/api';
import { formatDate, formatNumber } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Button, Card, Divider, EmptyState, ErrorState, Header, Icon, ListRow, LoadingScreen, Notice, PressableScale, Screen, Section, Text } from '@/ui';

/** Patient health assistant: availability and weekly allowance come from the server, never the app. */
export default function AssistantHome() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const status = useAssistantStatus();
  const available = status.data?.unavailableReason === null;
  const conversations = useConversations(Boolean(status.data && status.data.unavailableReason !== 'FEATURE_DISABLED'));
  const create = useCreateConversation();
  const prefs = useAssistantPreferences();
  const errorText = useAssistantErrorText();
  const { active } = useActivePatient();
  const [share, setShare] = useState(false);

  if (status.isPending) return <LoadingScreen />;
  if (status.error) return <ErrorState message={t(errorKey(status.error))} onRetry={() => void status.refetch()} />;
  const { unavailableReason, allowance } = status.data;
  const profileName = active ? (active.relationship === 'SELF' ? t('family.me') : active.displayName) : '';

  return (
    <Screen
      testID="assistant-home"
      header={
        <Header
          back
          title={prefs.data?.assistantName ?? t('assistant.title')}
          subtitle={t('assistant.subtitle')}
          right={
            <PressableScale testID="assistant-open-settings" accessibilityRole="button" accessibilityLabel={t('assistant.settings')} onPress={() => router.push('/patient/assistant/settings' as Href)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="sliders" />
            </PressableScale>
          }
        />
      } refreshing={status.isRefetching} onRefresh={() => void Promise.all([status.refetch(), conversations.refetch()])}>
      <EmergencyNotice compact />

      {unavailableReason ? (
        <Notice tone={unavailableReason === 'CONSENT_REQUIRED' ? 'info' : 'warning'} title={t('assistant.unavailableTitle')} body={t(`assistant.${unavailableReason}`)} testID={`assistant-unavailable-${unavailableReason}`}>
          {unavailableReason === 'CONSENT_REQUIRED' ? (
            <Button label={t('assistant.openPrivacy')} size="sm" fullWidth={false} onPress={() => router.push('/settings/privacy' as Href)} testID="assistant-open-privacy" />
          ) : null}
        </Notice>
      ) : null}

      {allowance ? (
        <Card testID="assistant-allowance">
          <View style={{ gap: spacing.xs }}>
            <Text variant="callout" weight="semibold">
              {t('assistant.allowance', { remaining: formatNumber(allowance.remaining, locale), limit: formatNumber(allowance.weeklyLimit, locale) })}
            </Text>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceSunken, overflow: 'hidden' }}>
              <View style={{ width: `${allowance.weeklyLimit ? Math.min(100, (allowance.used / allowance.weeklyLimit) * 100) : 100}%`, height: 6, backgroundColor: colors.primary }} />
            </View>
            <Text variant="caption" color="textTertiary">
              {t('assistant.resets', { date: formatDate(allowance.resetsAt, locale) })}
            </Text>
          </View>
        </Card>
      ) : null}

      {available ? (
        <Card style={{ gap: spacing.md }}>
          {active ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="callout" weight="semibold">{t('assistant.shareProfile', { name: profileName })}</Text>
                <Text variant="footnote" color="textSecondary">{t('assistant.shareProfileBody')}</Text>
              </View>
              <Switch testID="assistant-share-profile" accessibilityLabel={t('assistant.shareProfile', { name: profileName })} value={share} onValueChange={setShare} trackColor={{ true: colors.accent, false: colors.border }} />
            </View>
          ) : null}
          <Button
            testID="assistant-new-chat"
            label={t('assistant.newChat')}
            icon="message-circle"
            loading={create.isPending}
            onPress={() =>
              create.mutate(share && active ? active.id : null, {
                onSuccess: (c) => router.push({ pathname: '/patient/assistant/[id]', params: { id: c.id } }),
              })
            }
          />
          {create.error ? <Notice tone="danger" body={errorText(create.error, allowance)} /> : null}
        </Card>
      ) : null}

      {unavailableReason !== 'FEATURE_DISABLED' ? (
        <Section title={t('assistant.conversations')}>
          {conversations.data?.length ? (
            <Card padded={false}>
              <View style={{ paddingHorizontal: spacing.lg }}>
                {conversations.data.map((c, i) => (
                  <View key={c.id}>
                    {i ? <Divider /> : null}
                    <ListRow testID={`assistant-conversation-${i}`} icon="message-circle" title={c.title} subtitle={formatDate(c.updatedAt, locale)} onPress={() => router.push({ pathname: '/patient/assistant/[id]', params: { id: c.id } })} />
                  </View>
                ))}
              </View>
            </Card>
          ) : (
            <Card>
              <EmptyState compact icon="message-circle" title={t('assistant.conversations')} body={t('assistant.empty')} />
            </Card>
          )}
        </Section>
      ) : null}

      <Text variant="caption" color="textTertiary" align="center" testID="assistant-disclaimer">
        {t('assistant.disclaimer', { number: EMERGENCY_NUMBER })}
      </Text>
    </Screen>
  );
}
