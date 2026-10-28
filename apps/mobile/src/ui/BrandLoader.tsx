import { spacing } from '@ghayarly/tokens';
import { useEffect } from 'react';
import { Image, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useI18n } from '@/providers/i18n';
import { Text } from './Text';

const SWIRL = require('../../assets/brand/loader-swirl.png');

/**
 * The orange swirl loader (supplied TetraSol artwork). Turns slowly; with Reduce Motion on it stays
 * still and breathes instead. Announced as a progress indicator with a label.
 */
export function BrandLoader({ size = 56, label, showLabel = false, testID }: { size?: number; label?: string; showLabel?: boolean; testID?: string }) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const turn = useSharedValue(0);
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduced) {
      pulse.value = withRepeat(withTiming(0.55, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
    } else {
      turn.value = withRepeat(withTiming(360, { duration: 1400, easing: Easing.linear }), -1, false);
    }
    return () => {
      cancelAnimation(turn);
      cancelAnimation(pulse);
    };
  }, [reduced, turn, pulse]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }], opacity: pulse.value }));
  const text = label ?? t('common.loading');
  return (
    <View testID={testID ?? 'brand-loader'} accessible accessibilityRole="progressbar" accessibilityLabel={text} style={{ alignItems: 'center', gap: spacing.sm }}>
      <Animated.View style={[{ width: size, height: size }, style]}>
        <Image source={SWIRL} resizeMode="contain" style={{ width: size, height: size }} />
      </Animated.View>
      {showLabel ? <Text variant="footnote" color="textSecondary">{text}</Text> : null}
    </View>
  );
}
