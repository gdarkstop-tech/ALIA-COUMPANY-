import { radii, spacing, touchTarget } from '@ghayarly/tokens';
import { ActivityIndicator, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/providers/theme';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './Pressable';
import { Text } from './Text';

/**
 * primary  — navy, the default structural action.
 * accent   — TetraSol orange: reserve for the ONE hero call-to-action on a screen.
 */
type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger' | 'soft';

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: 'md' | 'lg' | 'sm';
  icon?: IconName;
  iconEnd?: IconName;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityHint?: string;
};

export function Button({ label, onPress, variant = 'primary', size = 'lg', icon, iconEnd, loading, disabled, fullWidth = true, style, testID, accessibilityHint }: ButtonProps) {
  const { colors } = useTheme();
  const palette: Record<Variant, { bg: string; fg: keyof typeof colors; border?: string }> = {
    primary: { bg: colors.primary, fg: 'textOnPrimary' },
    accent: { bg: colors.accent, fg: 'textOnAccent' },
    secondary: { bg: colors.surface, fg: 'text', border: colors.borderStrong },
    ghost: { bg: 'transparent', fg: 'primary' },
    danger: { bg: colors.dangerSoft, fg: 'danger' },
    soft: { bg: colors.primarySoft, fg: 'primarySoftText' },
  };
  const p = palette[variant];
  // Every size meets the 44 pt minimum (Apple HIG); md/lg follow the 48/56 dp tokens.
  const height = size === 'lg' ? touchTarget.comfortable : size === 'md' ? touchTarget.min : 44;
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      aria-disabled={Boolean(disabled || loading)} aria-busy={Boolean(loading)}
      disabled={disabled || loading}
      onPress={onPress}
      haptic={variant === 'primary' || variant === 'accent'}
      style={[
        {
          minHeight: height,
          paddingHorizontal: size === 'sm' ? spacing.md : spacing.xl,
          borderRadius: radii.lg,
          backgroundColor: p.bg,
          borderWidth: p.border ? 1 : 0,
          borderColor: p.border,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: spacing.sm,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors[p.fg]} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} color={p.fg} /> : null}
          <Text variant={size === 'sm' ? 'footnote' : 'callout'} weight="semibold" color={p.fg}>
            {label}
          </Text>
          {iconEnd ? <Icon name={iconEnd} size={18} color={p.fg} /> : null}
        </View>
      )}
    </PressableScale>
  );
}
