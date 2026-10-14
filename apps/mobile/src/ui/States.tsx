import { radii, spacing } from '@ghayarly/tokens';
import { useEffect } from 'react';
import { View, type DimensionValue } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export function EmptyState({ icon = 'inbox', title, body, actionLabel, onAction, compact, testID }: { icon?: IconName; title: string; body?: string; actionLabel?: string; onAction?: () => void; compact?: boolean; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={{ alignItems: 'center', gap: spacing.md, paddingVertical: compact ? spacing.lg : spacing['3xl'], paddingHorizontal: spacing.lg }}>
      <View style={{ width: compact ? 52 : 72, height: compact ? 52 : 72, borderRadius: radii.pill, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={compact ? 22 : 30} color="primary" />
      </View>
      <Text variant={compact ? 'callout' : 'title3'} weight="semibold" align="center">
        {title}
      </Text>
      {body ? (
        <Text variant="footnote" color="textSecondary" align="center" style={{ maxWidth: 320 }}>
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} variant="soft" size="md" fullWidth={false} /> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <View accessibilityRole="alert" style={{ alignItems: 'center', gap: spacing.md, paddingVertical: spacing['3xl'] }}>
      <View style={{ width: 64, height: 64, borderRadius: radii.pill, backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="cloud-off" size={26} color="danger" />
      </View>
      <Text variant="callout" align="center" color="textSecondary" style={{ maxWidth: 320 }}>
        {message}
      </Text>
      {onRetry ? <Button label={t('common.retry')} onPress={onRetry} variant="secondary" size="md" fullWidth={false} icon="refresh-cw" /> : null}
    </View>
  );
}

export function Skeleton({ height = 16, width = '100%', radius = radii.sm }: { height?: number; width?: DimensionValue; radius?: number }) {
  const { colors } = useTheme();
  const o = useSharedValue(0.55);
  useEffect(() => {
    o.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
  }, [o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ height, width, borderRadius: radius, backgroundColor: colors.skeleton }, style]} />;
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  const { colors } = useTheme();
  return (
    <View accessibilityLabel="Loading" style={{ backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.xl, gap: spacing.md, borderWidth: 1, borderColor: colors.border }}>
      <Skeleton height={20} width="45%" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={12} width={i === lines - 1 ? '60%' : '100%'} />
      ))}
    </View>
  );
}

export function LoadingScreen() {
  return (
    <View style={{ gap: spacing.lg, paddingTop: spacing.xl }}>
      <Skeleton height={32} width="60%" radius={radii.md} />
      <CardSkeleton />
      <CardSkeleton lines={2} />
    </View>
  );
}
