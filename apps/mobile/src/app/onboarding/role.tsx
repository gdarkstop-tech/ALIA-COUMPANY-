import type { SelfSelectableRole } from '@ghayarly/shared';
import { radii, spacing } from '@ghayarly/tokens';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { api, errorKey } from '@/lib/api';
import { useI18n } from '@/providers/i18n';
import { useMe } from '@/providers/session';
import { useTheme } from '@/providers/theme';
import { Badge, Card, Header, Icon, Notice, Screen, Text, type IconName } from '@/ui';

const OPTIONS: { role: SelfSelectableRole; icon: IconName }[] = [
  { role: 'PATIENT', icon: 'mci:account-heart-outline' },
  { role: 'DOCTOR', icon: 'mci:stethoscope' },
  { role: 'NURSE', icon: 'mci:medical-bag' },
];

export default function RoleSelection() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const assign = useMutation({
    mutationFn: (role: SelfSelectableRole) => api.me.assignRole({ role }),
    onSuccess: async (_data, role) => {
      await qc.invalidateQueries();
      router.replace(role === 'PATIENT' ? '/onboarding/patient' : '/onboarding/provider');
    },
  });

  return (
    <Screen testID="role-screen" header={<Header back={Boolean(me.data?.roles.length)} title={t('roles.chooseTitle')} subtitle={t('roles.chooseSubtitle')} />}>
      {assign.error ? <Notice tone="danger" body={t(errorKey(assign.error))} /> : null}
      <View style={{ gap: spacing.md }}>
        {OPTIONS.map((o, i) => {
          const held = me.data?.roles.includes(o.role);
          return (
            <Animated.View key={o.role} entering={FadeInDown.delay(i * 80).duration(400)}>
              <Card testID={`role-${o.role}`} accessibilityLabel={t(`roles.${o.role}`)} onPress={() => (held ? router.replace('/') : assign.mutate(o.role))}>
                <View style={{ flexDirection: 'row', gap: spacing.lg, alignItems: 'center' }}>
                  <View style={{ width: 56, height: 56, borderRadius: radii.lg, backgroundColor: o.role === 'PATIENT' ? colors.primarySoft : o.role === 'DOCTOR' ? colors.navySoft : colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={o.icon} size={26} color={o.role === 'PATIENT' ? 'primary' : o.role === 'DOCTOR' ? 'navy' : 'accentText'} />
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text variant="title3">{t(`roles.${o.role}`)}</Text>
                    <Text variant="footnote" color="textSecondary">
                      {t(`roles.${o.role}_desc`)}
                    </Text>
                    {held ? <Badge label={t('family.activeNow')} tone="success" /> : null}
                  </View>
                  <Icon name="chevron-right" color="textTertiary" />
                </View>
              </Card>
            </Animated.View>
          );
        })}
      </View>
    </Screen>
  );
}
