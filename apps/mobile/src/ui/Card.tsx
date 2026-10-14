import { elevation, radii, spacing } from '@ghayarly/tokens';
import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/providers/theme';
import { PressableScale } from './Pressable';

type Props = {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  tone?: 'surface' | 'muted' | 'primary' | 'navy' | 'accent';
  testID?: string;
  accessibilityLabel?: string;
};

export function Card({ children, onPress, style, padded = true, tone = 'surface', testID, accessibilityLabel }: Props) {
  const { colors, scheme } = useTheme();
  const bg = { surface: colors.surface, muted: colors.surfaceMuted, primary: colors.primarySoft, navy: colors.navySoft, accent: colors.accentSoft }[tone];
  const base: ViewStyle = {
    backgroundColor: bg,
    borderRadius: radii.xl,
    padding: padded ? spacing.xl : 0,
    borderWidth: 1,
    borderColor: tone === 'surface' ? colors.border : 'transparent',
    ...(tone === 'surface' && scheme === 'light' ? { ...elevation.card, shadowColor: colors.shadow } : {}),
  };
  if (onPress) {
    return (
      <PressableScale testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} scaleTo={0.985} style={[base, style]}>
        {children}
      </PressableScale>
    );
  }
  return (
    <View testID={testID} style={[base, style]}>
      {children}
    </View>
  );
}
