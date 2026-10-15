import { ornament } from '@ghayarly/tokens';
import { useId } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, Path, Pattern, Rect } from 'react-native-svg';
import { useTheme } from '@/providers/theme';
import { latticeTilePath, pointedArchOutline, pointedArchPath } from './geometry';

/**
 * Barely-visible mashrabiya texture. Decorative only (hidden from screen readers). Welcome hero
 * only — never behind clinical content, forms or data.
 */
export function Mashrabiya({ opacity, color, cell = ornament.latticeCell, style }: { opacity?: number; color?: string; cell?: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const id = `lattice-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id={id} patternUnits="userSpaceOnUse" width={cell} height={cell}>
            <Path d={latticeTilePath(cell)} stroke={color ?? colors.ornament} strokeWidth={0.8} fill="none" />
          </Pattern>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} opacity={opacity ?? ornament.latticeOpacityCanvas} />
      </Svg>
    </View>
  );
}

/** Pointed Mamluk-style arch silhouette (filled), e.g. the welcome hero frame. */
export function ArchShape({ width, height, fill, stroke, strokeOpacity = ornament.archStrokeOpacity }: { width: number; height: number; fill: string; stroke?: string; strokeOpacity?: number }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
      <Svg width={width} height={height} aria-hidden>
        <Path d={pointedArchPath(width, height, ornament.archCrownRatio)} fill={fill} />
        {stroke ? <Path d={pointedArchOutline(width - 12, height - 6, ornament.archCrownRatio)} transform="translate(6 6)" stroke={stroke} strokeOpacity={strokeOpacity} strokeWidth={1} fill="none" /> : null}
      </Svg>
    </View>
  );
}

/** Brass hairline with a small centred lozenge — the Alia Group divider. */
export function BrassRule({ width = 120, color }: { width?: number; color?: string }) {
  const { colors } = useTheme();
  const c = color ?? colors.brass;
  const m = width / 2;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
      <Svg width={width} height={10} aria-hidden>
        <Path d={`M0 5 L${m - 9} 5 M${m + 9} 5 L${width} 5`} stroke={c} strokeWidth={1} />
        <Path d={`M${m} 1 L${m + 4} 5 L${m} 9 L${m - 4} 5 Z`} fill={c} />
      </Svg>
    </View>
  );
}
