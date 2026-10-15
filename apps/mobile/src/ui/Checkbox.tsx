import { radii, spacing } from '@ghayarly/tokens';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/providers/theme';
import { Icon } from './Icon';
import { PressableScale } from './Pressable';
import { Text } from './Text';

/**
 * Accessible checkbox row: the box + label row is the touch target (≥ 48 dp) and reports its
 * checked state. Extra actions (e.g. "Read the document") render BELOW the row as siblings — never
 * nested inside the pressable, so a tap always does exactly one thing and screen readers see two
 * separate controls.
 */
export function Checkbox({ checked, onChange, label, children, testID }: { checked: boolean; onChange: (v: boolean) => void; label: string; children?: ReactNode; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <PressableScale
        testID={testID}
        accessibilityRole="checkbox"
        accessibilityLabel={label}
        aria-checked={checked}
        accessibilityState={{ checked }}
        onPress={() => onChange(!checked)}
        scaleTo={0.99}
        style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', minHeight: 48, paddingVertical: spacing.xs }}
      >
        <View style={{ width: 24, height: 24, borderRadius: radii.xs + 1, borderWidth: 2, borderColor: checked ? colors.accent : colors.borderStrong, backgroundColor: checked ? colors.accent : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
          {checked ? <Icon name="check" size={14} tint={colors.textOnAccent} /> : null}
        </View>
        <Text variant="callout" style={{ flex: 1 }}>
          {label}
        </Text>
      </PressableScale>
      {children ? <View style={{ paddingStart: 24 + spacing.md, alignItems: 'flex-start' }}>{children}</View> : null}
    </View>
  );
}
