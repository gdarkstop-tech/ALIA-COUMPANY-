import { radii, spacing } from '@ghayarly/tokens';
import { View } from 'react-native';
import { useTheme } from '@/providers/theme';
import { PressableScale } from './Pressable';
import { Text } from './Text';

export function Segmented<T extends string>({ options, value, onChange, testID }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: colors.surfaceSunken, borderRadius: radii.lg, padding: 4, gap: 4 }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <PressableScale
            key={o.value}
            testID={testID ? `${testID}-${o.value}` : undefined}
            accessibilityRole="tab"
            aria-selected={active}
            onPress={() => onChange(o.value)}
            scaleTo={0.98}
            style={{
              flex: 1,
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radii.md,
              backgroundColor: active ? colors.surface : 'transparent',
              paddingHorizontal: spacing.sm,
              ...(active ? { shadowColor: colors.shadow, shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } } : {}),
            }}
          >
            <Text variant="footnote" weight="semibold" color={active ? 'text' : 'textTertiary'}>
              {o.label}
            </Text>
            {active ? <View style={{ position: 'absolute', bottom: 5, width: 18, height: 3, borderRadius: 2, backgroundColor: colors.accent }} /> : null}
          </PressableScale>
        );
      })}
    </View>
  );
}
