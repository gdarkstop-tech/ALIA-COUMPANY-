import { lightColors, radii } from '@ghayarly/tokens';
import { Image, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/providers/theme';

const FULL = require('../../../assets/brand/tetrasol-logo.png');
const WORDMARK = require('../../../assets/brand/tetrasol-wordmark.png');
const RATIO = { full: 628 / 219, wordmark: 627 / 179 } as const;

/**
 * The official TetraSol logo, as supplied (scripts/brand/prepare-supplied-assets.py only removes
 * its white backdrop; it is never redrawn or recoloured). Use it wherever TetraSol is named: the
 * store, product visuals and product information — never in the Dress My Wound lockup or app icon.
 *
 * `full` carries the "Delaware-based incorporation, USA" line and is for large placements only;
 * `wordmark` is for everything smaller. On dark surfaces the logo sits on a light plate so the
 * navy stays legible.
 */
export function TetraSolLogo({ height = 24, variant = 'wordmark', plate, testID, style }: { height?: number; variant?: 'full' | 'wordmark'; plate?: boolean; testID?: string; style?: StyleProp<ViewStyle> }) {
  const { scheme } = useTheme();
  const onPlate = plate ?? scheme === 'dark';
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel="TetraSol"
      style={[{ alignSelf: 'flex-start' }, onPlate ? { backgroundColor: lightColors.surface, borderRadius: radii.md, paddingHorizontal: Math.round(height * 0.35), paddingVertical: Math.round(height * 0.22) } : null, style]}
    >
      <Image source={variant === 'full' ? FULL : WORDMARK} resizeMode="contain" style={{ height, width: Math.round(height * RATIO[variant]) }} />
    </View>
  );
}
