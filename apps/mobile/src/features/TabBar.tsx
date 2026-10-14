import { typography } from '@ghayarly/tokens';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/providers/theme';
import { Icon, type IconName } from '@/ui';

/** Shared, calm tab bar styling for the patient and clinician experiences. */
export function useTabScreenOptions(): ComponentProps<typeof Tabs>['screenOptions'] {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return {
    headerShown: false,
    tabBarActiveTintColor: colors.primary,
    tabBarInactiveTintColor: colors.textTertiary,
    tabBarStyle: {
      backgroundColor: colors.backgroundElevated,
      borderTopColor: colors.divider,
      height: 74 + insets.bottom,
      paddingTop: 6,
      paddingBottom: Math.max(insets.bottom, 8),
    },
    tabBarLabelStyle: { fontFamily: typography.fontFamily.medium, fontSize: 11, lineHeight: 16 },
    sceneStyle: { backgroundColor: colors.background },
  };
}

export function tabIcon(name: IconName) {
  return ({ color, size }: { color: ColorValue; size: number }) => <Icon name={name} size={size - 2} tint={String(color)} />;
}
