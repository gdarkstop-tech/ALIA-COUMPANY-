import { radii, spacing, touchTarget } from '@ghayarly/tokens';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/providers/theme';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './Pressable';
import { Text } from './Text';

type Props = {
  title: string;
  subtitle?: string;
  icon?: IconName;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  testID?: string;
  danger?: boolean;
};

export function ListRow({ title, subtitle, icon, leading, trailing, onPress, chevron = Boolean(onPress), testID, danger }: Props) {
  const { colors } = useTheme();
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touchTarget.comfortable, paddingVertical: spacing.sm }}>
      {leading ??
        (icon ? (
          <View style={{ width: 40, height: 40, borderRadius: radii.md, backgroundColor: danger ? colors.dangerSoft : colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={icon} size={18} color={danger ? 'danger' : 'primary'} />
          </View>
        ) : null)}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="callout" weight="medium" color={danger ? 'danger' : 'text'}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" color="textTertiary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      {chevron ? <Icon name="chevron-right" size={18} color="textTertiary" /> : null}
    </View>
  );
  return onPress ? (
    <PressableScale testID={testID} accessibilityRole="button" accessibilityLabel={title} onPress={onPress} scaleTo={0.99}>
      {body}
    </PressableScale>
  ) : (
    <View testID={testID}>{body}</View>
  );
}

export function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: 1, backgroundColor: colors.divider }} />;
}
