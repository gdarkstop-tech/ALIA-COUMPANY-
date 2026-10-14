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
      accessibilityRole="button"
      aria-selected={Boolean(selected)}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 40,
        paddingHorizontal: spacing.lg,
        borderRadius: radii.pill,
        backgroundColor: selected ? colors.navy : colors.surface,
        borderWidth: 1,
        borderColor: selected ? colors.navy : colors.border,
      }}
    >
      {icon ? <Icon name={icon} size={14} tint={selected ? colors.surface : colors.textSecondary} /> : null}
      <Text variant="footnote" weight="semibold" style={{ color: selected ? colors.surface : colors.textSecondary }}>
        {label}
      </Text>
    </PressableScale>
  );
}
