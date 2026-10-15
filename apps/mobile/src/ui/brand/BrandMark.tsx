import { brandConfig } from '@ghayarly/tokens';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { pointedArchOutline } from './geometry';

/**
 * PROVISIONAL product mark for Dress My Wound | غير لي: a pointed arch (Alia Group architecture)
 * sheltering a care cross in TetraSol orange. Replace via brandConfig.assets once an official
 * mark is approved. Rendered as vector so it stays crisp at every size and density.
 */
export function BrandMark({ size = 64, variant = 'tile' }: { size?: number; variant?: 'tile' | 'plain' }) {
  const s = size;
  const archW = s * 0.5;
  const archH = s * 0.6;
  const ax = (s - archW) / 2;
  const ay = s * 0.2;
  const arm = s * 0.085;
  const len = s * 0.15;
  const cx = s / 2;
  const cy = ay + archH * 0.62;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`${brandConfig.product.nameEn} | ${brandConfig.product.nameAr}`} style={{ width: s, height: s }}>
    <Svg width={s} height={s} aria-hidden>
      {variant === 'tile' ? <Rect x={0} y={0} width={s} height={s} rx={s * 0.23} fill={brandConfig.hues.navy} /> : null}
      <Path d={pointedArchOutline(archW, archH, 0.5)} transform={`translate(${ax} ${ay})`} stroke={variant === 'tile' ? '#F7F3EC' : brandConfig.hues.navy} strokeWidth={s * 0.045} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Rect x={cx - arm / 2} y={cy - len} width={arm} height={len * 2} rx={arm / 2} fill={brandConfig.hues.orange} />
      <Rect x={cx - len} y={cy - arm / 2} width={len * 2} height={arm} rx={arm / 2} fill={brandConfig.hues.orange} />
    </Svg>
    </View>
  );
}
