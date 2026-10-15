import { typography } from '@ghayarly/tokens';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { View, type ColorValue } from 'react-native';
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

/** Tab icon with the TetraSol orange active indicator (navy tint carries the structure). */
function TabIcon({ name, color, size, focused }: { name: IconName; color: ColorValue; size: number; focused: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ position: 'absolute', top: -8, width: 16, height: 3, borderRadius: 2, backgroundColor: focused ? colors.accent : 'transparent' }} />
      <Icon name={name} size={size - 2} tint={String(color)} />
    </View>
  );
}

export function tabIcon(name: IconName) {
  return ({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) => <TabIcon name={name} color={color} size={size} focused={focused} />;
}
