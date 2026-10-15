import { radii, spacing } from '@ghayarly/tokens';
import { useTheme } from '@/providers/theme';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './Pressable';
import { Text } from './Text';

export function Chip({ label, selected, onPress, icon, testID }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName; testID?: string }) {
  const { colors } = useTheme();
  return (
    <PressableScale
      testID={testID}
      accessibilityRole={selected === undefined ? 'button' : 'checkbox'}
      {...(selected === undefined ? {} : { 'aria-checked': selected, accessibilityState: { checked: selected } })}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 44,
        paddingHorizontal: spacing.lg,
        borderRadius: radii.pill,
        // Selection = TetraSol orange (soft fill + accent outline), never a clinical colour.
        backgroundColor: selected ? colors.accentSoft : colors.surface,
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? colors.accent : colors.border,
      }}
    >
      {icon ? <Icon name={icon} size={14} tint={selected ? colors.accentText : colors.textSecondary} /> : null}
      <Text variant="footnote" weight="semibold" style={{ color: selected ? colors.accentText : colors.textSecondary }}>
        {label}
      </Text>
    </PressableScale>
  );
}
