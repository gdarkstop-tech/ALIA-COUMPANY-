import { radii, spacing } from '@ghayarly/tokens';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { EMERGENCY_NUMBER, useAssistantErrorText, useVoiceStatus } from '@/features/assistant/hooks';
import { voiceSupported } from '@/features/assistant/voice/audio';
import { useVoiceSession, type VoicePhase } from '@/features/assistant/voice/useVoiceSession';
import { useConsents, useRecordConsents, consentErrorKey } from '@/features/compliance/hooks';
import { errorKey } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Badge, Button, Card, ErrorState, Header, Icon, LoadingScreen, Notice, PressableScale, Screen, Text } from '@/ui';

/** The calm "presence" of the assistant: breathes while listening, follows the voice level. */
function Orb({ phase, level, onPress, label }: { phase: VoicePhase; level: number; onPress?: () => void; label: string }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const breath = useSharedValue(1);
  const live = phase === 'listening' || phase === 'hearing' || phase === 'thinking' || phase === 'speaking';
  useEffect(() => {
    breath.value = live && !reduced ? withRepeat(withSequence(withTiming(1.06, { duration: 1400 }), withTiming(1, { duration: 1400 })), -1) : withTiming(1);
  }, [live, reduced, breath]);
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: breath.value + (reduced ? 0 : Math.min(level * 3, 0.25)) }] }));
  const tint = phase === 'speaking' ? colors.accent : phase === 'hearing' ? colors.primary : colors.navy;
  return (
    <PressableScale onPress={onPress} disabled={!onPress} accessibilityRole="button" accessibilityLabel={label} testID="voice-orb" style={{ alignSelf: 'center', width: 200, height: 200, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: 200, height: 200, borderRadius: 100, backgroundColor: tint, opacity: 0.14 }, ring]} />
      <View style={{ width: 132, height: 132, borderRadius: 66, backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={phase === 'speaking' ? 'volume-2' : 'mic'} size={44} color="surface" />
      </View>
    </PressableScale>
  );
}

const VOICE_ERRORS = { AI_UNAVAILABLE: 'voice.error_AI_UNAVAILABLE', AI_RATE_LIMITED: 'voice.error_AI_RATE_LIMITED', NETWORK_ERROR: 'voice.error_NETWORK_ERROR' } as const;

/**
 * Live voice conversation. The server decides availability, checks every sentence for emergencies
 * before the model may answer, meters the weekly seconds and stops the stream; this screen only
 * captures, plays and shows the transcript.
 */
export default function VoiceScreen() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const { conversationId } = useLocalSearchParams<{ conversationId?: string }>();
  const supported = voiceSupported();
  const status = useVoiceStatus(supported);
  const consents = useConsents(status.data?.unavailableReason === 'VOICE_CONSENT_REQUIRED');
  const record = useRecordConsents();
  const errorText = useAssistantErrorText();
  const v = useVoiceSession();
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: true });
  }, [v.lines.length]);

  const header = <Header back title={t('voice.title')} subtitle={t('voice.subtitle')} />;
  if (!supported) {
    return (
      <Screen testID="voice-screen" header={header}>
        <Notice tone="info" body={t('voice.unsupported')} testID="voice-unsupported" />
      </Screen>
    );
  }
  if (status.isPending) return <LoadingScreen />;
  if (status.error) return <ErrorState message={t(errorKey(status.error))} onRetry={() => void status.refetch()} />;

  const { unavailableReason, allowance } = status.data;
  const live = v.phase !== 'idle' && v.phase !== 'ended';
  const callEmergency = () => void Linking.openURL(`tel:${EMERGENCY_NUMBER}`).catch(() => undefined);
  const errorMessage = (e: unknown): string =>
    e === 'MIC_DENIED' ? t('voice.micDenied')
    : e === 'VOICE_UNSUPPORTED' ? t('voice.unsupported')
    : typeof e === 'string' ? t(VOICE_ERRORS[e as keyof typeof VOICE_ERRORS] ?? 'errors.generic')
    : errorText(e, allowance);

  return (
    <Screen testID="voice-screen" header={header} scroll={false}>
      <View style={{ flex: 1, gap: spacing.lg }}>
        {unavailableReason === 'VOICE_CONSENT_REQUIRED' && consents.data ? (
          <Card style={{ gap: spacing.md }} testID="voice-consent">
            <Text variant="title3" weight="semibold">{t('voice.consentTitle')}</Text>
            <Text variant="callout" color="textSecondary">{t('voice.consentBody')}</Text>
            <Button testID="voice-consent-allow" label={t('voice.consentAllow')} icon="mic" loading={record.isPending} onPress={() => record.mutate({ state: consents.data!, answers: { AI_VOICE_PROCESSING: true } })} />
            <Button label={t('voice.readNotice')} variant="ghost" size="sm" fullWidth={false} onPress={() => router.push('/legal/ai-voice-consent' as Href)} testID="voice-read-notice" />
            {record.error ? <Notice tone="danger" body={t(consentErrorKey(record.error))} /> : null}
          </Card>
        ) : unavailableReason ? (
          <Notice tone={unavailableReason === 'CONSENT_REQUIRED' ? 'info' : 'warning'} title={t('assistant.unavailableTitle')} body={t(unavailableReason === 'VOICE_CONSENT_REQUIRED' ? 'voice.VOICE_CONSENT_REQUIRED' : `assistant.${unavailableReason}`)} testID={`voice-unavailable-${unavailableReason}`}>
            {unavailableReason === 'CONSENT_REQUIRED' ? <Button label={t('assistant.openPrivacy')} size="sm" fullWidth={false} onPress={() => router.push('/settings/privacy' as Href)} /> : null}
          </Notice>
        ) : (
          <>
            {v.simulated ? <Badge tone="demo" label={t('voice.simulated')} /> : null}
            <Orb
              phase={v.phase}
              level={v.level}
              label={live ? t('voice.end') : t('voice.start')}
              onPress={v.phase === 'idle' || v.phase === 'ended' ? () => void v.start({ conversationId: v.conversationId ?? conversationId }) : undefined}
            />
            <View style={{ alignItems: 'center', gap: spacing.xs }}>
              <Text variant="title3" weight="semibold" testID="voice-phase" accessibilityLiveRegion="polite">{t(`voice.phase_${v.phase}`)}</Text>
              {v.remaining !== null ? (
                <Text variant="footnote" color="textSecondary" testID="voice-remaining">{t('voice.remaining', { time: t('voice.minutesSeconds', { minutes: formatNumber(Math.floor(v.remaining / 60), locale), seconds: formatNumber(v.remaining % 60, locale) }) })}</Text>
              ) : allowance ? (
                <Text variant="footnote" color="textSecondary" testID="voice-allowance">
                  {t('voice.allowance', { remaining: formatNumber(Math.floor(allowance.remaining / 60), locale), limit: formatNumber(Math.floor(allowance.weeklyLimit / 60), locale) })}
                </Text>
              ) : null}
            </View>

            {v.emergency ? (
              <Card style={{ gap: spacing.md, backgroundColor: colors.dangerSoft, borderColor: colors.danger, borderWidth: 1 }} testID="voice-emergency">
                <Text variant="callout" selectable>{v.emergency}</Text>
                <Button testID="voice-call-emergency" variant="danger" icon="phone" label={t('safety.callEmergency', { number: EMERGENCY_NUMBER })} onPress={callEmergency} />
              </Card>
            ) : null}
            {v.notUnderstood ? <Notice tone="info" body={t('voice.notUnderstood')} testID="voice-not-understood" /> : null}
            {v.endReason && !v.emergency ? <Notice tone={v.endReason === 'USER_ENDED' ? 'info' : 'warning'} body={t(`voice.ended_${v.endReason}`)} testID={`voice-ended-${v.endReason}`} /> : null}
            {v.error ? <Notice tone="danger" body={errorMessage(v.error)} testID="voice-error" /> : null}

            <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }} testID="voice-transcript">
              {v.lines.map((l) => (
                <View key={l.key} testID={`voice-line-${l.role}`} style={{ alignSelf: l.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%', backgroundColor: l.role === 'user' ? colors.primary : colors.surface, borderRadius: radii.lg, padding: spacing.md, borderWidth: l.role === 'user' ? 0 : 1, borderColor: colors.border, opacity: l.final ? 1 : 0.8 }}>
                  <Text variant="callout" style={l.role === 'user' ? { color: colors.surface } : undefined}>{l.text}</Text>
                </View>
              ))}
            </ScrollView>

            <View style={{ gap: spacing.sm }}>
              {live ? (
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  {v.phase === 'speaking' ? <View style={{ flex: 1 }}><Button testID="voice-stop-answer" variant="secondary" icon="square" label={t('voice.stopAnswer')} onPress={v.interrupt} /></View> : null}
                  <View style={{ flex: 1 }}><Button testID="voice-end" variant="danger" icon="phone-off" label={t('voice.end')} onPress={v.end} /></View>
                </View>
              ) : (
                <Button testID="voice-start" icon="mic" label={v.phase === 'ended' ? t('voice.again') : t('voice.start')} onPress={() => void v.start({ conversationId: v.conversationId ?? conversationId })} />
              )}
              {v.phase === 'ended' && v.conversationId ? (
                <Button testID="voice-open-transcript" variant="ghost" size="sm" label={t('voice.continueInText')} onPress={() => router.replace({ pathname: '/patient/assistant/[id]', params: { id: v.conversationId! } })} />
              ) : null}
              <Text variant="caption" color="textTertiary" style={{ textAlign: 'center' }}>{t('voice.privacyNote')}</Text>
              <Text variant="caption" color="textTertiary" style={{ textAlign: 'center' }}>{t('voice.emergencyNote', { number: EMERGENCY_NUMBER })}</Text>
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}
