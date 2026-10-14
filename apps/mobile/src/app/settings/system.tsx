import { spacing } from '@ghayarly/tokens';
import { View } from 'react-native';
import { useI18n } from '@/providers/i18n';
import { Badge, Card, Divider, Header, LoadingScreen, Notice, Screen, Text, useSystemStatus } from '@/ui';

const KEYS = ['payments', 'sms', 'email', 'storage', 'ai', 'push', 'maps'] as const;

/** Honest view of which integrations are live in this environment. */
export default function SystemStatusScreen() {
  const { t } = useI18n();
  const status = useSystemStatus();
  return (
    <Screen header={<Header back title={t('me.systemStatus')} />}>
      {status.isPending ? (
        <LoadingScreen />
      ) : status.data ? (
        <>
          {status.data.demoMode ? <Notice tone="demo" body={t('app.demoModeBanner')} /> : null}
          <Card padded={false}>
            <View style={{ paddingHorizontal: spacing.lg }}>
              {KEYS.map((k, i) => {
                const s = status.data.integrations[k];
                return (
                  <View key={k}>
                    {i ? <Divider /> : null}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.lg }}>
                      <Text variant="callout">{t(`status.${k}`)}</Text>
                      <Badge label={t(`status.${s}`)} tone={s === 'CONFIGURED' ? 'success' : s === 'DEV_ADAPTER' ? 'demo' : 'warning'} testID={`status-${k}`} />
                    </View>
                  </View>
                );
              })}
            </View>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
