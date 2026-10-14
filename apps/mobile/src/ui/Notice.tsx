import { radii, spacing } from '@ghayarly/tokens';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/providers/theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/** Inline callout for disclosures (simulation, demo data, safety notes). */
export function Notice({ tone = 'info', icon, title, body, children, testID }: { tone?: 'info' | 'warning' | 'demo' | 'success' | 'danger'; icon?: IconName; title?: string; body?: string; children?: ReactNode; testID?: string }) {
  const { colors } = useTheme();
  const map = {
    info: [colors.infoSoft, 'info', 'info'],
    warning: [colors.warningSoft, 'warning', 'alert-triangle'],
    demo: [colors.demoSoft, 'demo', 'mci:flask-outline'],
    success: [colors.successSoft, 'success', 'check-circle'],
    danger: [colors.dangerSoft, 'danger', 'alert-octagon'],
  } as const;
  const [bg, fg, defIcon] = map[tone];
  return (
    <View testID={testID} accessibilityRole="summary" style={{ flexDirection: 'row', gap: spacing.md, backgroundColor: bg, borderRadius: radii.lg, padding: spacing.lg }}>
      <Icon name={icon ?? (defIcon as IconName)} size={18} color={fg} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? (
          <Text variant="footnote" weight="semibold" color={fg}>
            {title}
          </Text>
        ) : null}
        {body ? (
          <Text variant="footnote" color="textSecondary">
            {body}
          </Text>
        ) : null}
        {children}
      </View>
    </View>
  );
}
