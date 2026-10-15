import { layout, ornament, radii, spacing } from '@ghayarly/tokens';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LanguageToggle } from '@/features/auth/LanguageToggle';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { ArchShape, Button, Icon, Lockup, Mashrabiya, Text, type IconName } from '@/ui';

const VALUES: { icon: IconName; title: 'auth.valueHomeTitle' | 'auth.valueFamilyTitle' | 'auth.valuePrivacyTitle'; body: 'auth.valueHomeBody' | 'auth.valueFamilyBody' | 'auth.valuePrivacyBody' }[] = [
  { icon: 'mci:home-heart', title: 'auth.valueHomeTitle', body: 'auth.valueHomeBody' },
  { icon: 'mci:account-group-outline', title: 'auth.valueFamilyTitle', body: 'auth.valueFamilyBody' },
  { icon: 'mci:shield-check-outline', title: 'auth.valuePrivacyTitle', body: 'auth.valuePrivacyBody' },
];

/**
 * Welcome — the one screen where the Alia Group architectural language leads: a navy hero with a
 * restrained mashrabiya lattice and a pointed-arch frame around the product lockup. The single
 * TetraSol-orange action is "Create an account"; everything else stays calm and neutral.
 */
export default function Welcome() {
  const router = useRouter();
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [frame, setFrame] = useState({ width: 0, height: 0 });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }} testID="welcome-screen">
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} bounces={false}>
        <View style={{ backgroundColor: colors.heroBackground, paddingTop: insets.top + spacing.md, paddingBottom: spacing['3xl'], borderBottomLeftRadius: radii.xxl, borderBottomRightRadius: radii.xxl, overflow: 'hidden' }}>
          <Mashrabiya opacity={ornament.latticeOpacityHero} color={colors.ornament} />
          <View style={{ width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center', paddingHorizontal: layout.screenPadding }}>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <LanguageToggle />
            </View>
            <Animated.View entering={FadeInDown.duration(500)} style={{ alignItems: 'center', marginTop: spacing.lg }}>
              <View
                onLayout={(e) => setFrame({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
                style={{ width: '100%', maxWidth: 300, paddingTop: spacing['4xl'], paddingBottom: spacing['3xl'], paddingHorizontal: spacing.lg, alignItems: 'center' }}
              >
                {frame.width > 0 ? (
                  <View style={{ position: 'absolute', top: 0, left: 0 }} pointerEvents="none">
                    <ArchShape width={frame.width} height={frame.height} fill="rgba(247, 243, 236, 0.03)" stroke={colors.ornament} />
                  </View>
                ) : null}
                <Lockup inverse />
              </View>
            </Animated.View>
          </View>
        </View>

        <View style={{ flex: 1, width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center', paddingHorizontal: layout.screenPadding, paddingTop: spacing.xxl, paddingBottom: insets.bottom + spacing.xl, gap: spacing.xxl, justifyContent: 'space-between' }}>
          <View style={{ gap: spacing.xl }}>
            <Text variant="title3" weight="regular" color="textSecondary" align="center">
              {t('auth.welcomeBody')}
            </Text>
            <View style={{ gap: spacing.lg }}>
              {VALUES.map((v, i) => (
                <Animated.View key={v.title} entering={FadeInDown.delay(150 + i * 90).duration(450)} style={{ flexDirection: 'row', gap: spacing.lg, alignItems: 'center' }}>
                  <View style={{ width: 48, height: 48, borderRadius: radii.lg, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={v.icon} size={22} color="primary" />
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
            <Button testID="welcome-get-started" variant="accent" label={t('auth.getStarted')} onPress={() => router.push('/sign-up')} />
            <Button testID="welcome-sign-in" label={t('auth.haveAccount')} variant="secondary" onPress={() => router.push('/sign-in')} />
          </Animated.View>
        </View>
      </ScrollView>
    </View>
  );
}
