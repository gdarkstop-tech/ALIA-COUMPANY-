import { radii, spacing } from '@ghayarly/tokens';
import { View } from 'react-native';
import { useTheme } from '@/providers/theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'demo' | 'accent';

export function Badge({ label, tone = 'neutral', icon, testID }: { label: string; tone?: Tone; icon?: IconName; testID?: string }) {
  const { colors } = useTheme();
  const map = {
    neutral: [colors.surfaceMuted, 'textSecondary'],
    primary: [colors.primarySoft, 'primarySoftText'],
    success: [colors.successSoft, 'success'],
    warning: [colors.warningSoft, 'warning'],
    danger: [colors.dangerSoft, 'danger'],
    info: [colors.infoSoft, 'info'],
    demo: [colors.demoSoft, 'demo'],
    accent: [colors.accentSoft, 'accentText'],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: bg, borderRadius: radii.pill, paddingHorizontal: spacing.sm + 2, paddingVertical: 3, alignSelf: 'flex-start' }}>
      {icon ? <Icon name={icon} size={12} color={fg} /> : null}
      <Text variant="caption" weight="semibold" color={fg}>
        {label}
      </Text>
    </View>
  );
}

export function StatusDot({ tone }: { tone: Tone }) {
  const { colors } = useTheme();
  const c = { neutral: colors.textTertiary, primary: colors.primary, success: colors.success, warning: colors.warning, danger: colors.danger, info: colors.info, demo: colors.demo, accent: colors.accent }[tone];
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c }} />;
}
