import { layout, radii, spacing } from '@ghayarly/tokens';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BrandMark } from '@/features/auth/BrandMark';
import { LanguageToggle } from '@/features/auth/LanguageToggle';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Button, Icon, Text, type IconName } from '@/ui';

const VALUES: { icon: IconName; title: 'auth.valueHomeTitle' | 'auth.valueFamilyTitle' | 'auth.valuePrivacyTitle'; body: 'auth.valueHomeBody' | 'auth.valueFamilyBody' | 'auth.valuePrivacyBody' }[] = [
  { icon: 'mci:home-heart', title: 'auth.valueHomeTitle', body: 'auth.valueHomeBody' },
  { icon: 'mci:account-group-outline', title: 'auth.valueFamilyTitle', body: 'auth.valueFamilyBody' },
  { icon: 'mci:shield-check-outline', title: 'auth.valuePrivacyTitle', body: 'auth.valuePrivacyBody' },
];

export default function Welcome() {
  const router = useRouter();
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} testID="welcome-screen">
      <View style={{ flex: 1, width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center', paddingHorizontal: layout.screenPadding, justifyContent: 'space-between', paddingBottom: spacing.xl }}>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingTop: spacing.md }}>
          <LanguageToggle />
        </View>

        <View style={{ gap: spacing['3xl'] }}>
          <Animated.View entering={FadeInDown.duration(500)} style={{ gap: spacing.lg }}>
            <BrandMark size={72} />
            <View style={{ gap: spacing.xs }}>
              <Text variant="display">{t('app.name')}</Text>
              <Text variant="footnote" weight="semibold" color="primary">
                {t('app.fullName')}
              </Text>
            </View>
            <Text variant="title3" weight="regular" color="textSecondary">
              {t('auth.welcomeBody')}
            </Text>
          </Animated.View>

          <View style={{ gap: spacing.lg }}>
            {VALUES.map((v, i) => (
              <Animated.View key={v.title} entering={FadeInDown.delay(150 + i * 90).duration(450)} style={{ flexDirection: 'row', gap: spacing.lg, alignItems: 'center' }}>
                <View style={{ width: 48, height: 48, borderRadius: radii.lg, backgroundColor: i === 1 ? colors.accentSoft : colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={v.icon} size={22} color={i === 1 ? 'accentText' : 'primary'} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="callout" weight="semibold">
                    {t(v.title)}
                  </Text>
                  <Text variant="footnote" color="textSecondary">
                    {t(v.body)}
                  </Text>
                </View>
              </Animated.View>
            ))}
          </View>
        </View>

        <Animated.View entering={FadeInDown.delay(450).duration(450)} style={{ gap: spacing.md }}>
          <Text variant="caption" color="textTertiary" align="center">
            {t('app.tagline')}
          </Text>
          <Button testID="welcome-get-started" label={t('auth.getStarted')} onPress={() => router.push('/sign-up')} />
          <Button testID="welcome-sign-in" label={t('auth.haveAccount')} variant="secondary" onPress={() => router.push('/sign-in')} />
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}
