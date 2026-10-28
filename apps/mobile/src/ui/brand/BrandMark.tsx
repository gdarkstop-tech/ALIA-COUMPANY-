import { brandConfig, dmwArtwork, dmwAspect, dmwColors, dmwSvg } from '@ghayarly/tokens';
import { useId, useMemo } from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useTheme } from '@/providers/theme';

/**
 * Official Dress My Wound marks, rendered from the vector artwork traced from the supplied
 * reference (packages/tokens/src/dmw.ts) — crisp at every size and density, identical to the app
 * icon and the admin console. The artwork never contains Arabic text: غير لي is set as live text
 * next to it (Lockup), so localisation stays intact.
 */
const LABEL = `${brandConfig.product.nameEn} | ${brandConfig.product.nameAr}`;

/** Gradient ids must be unique per document on the web, where every inline SVG shares one DOM. */
function usePrefix(tag: string) {
  return `${tag}${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
}

/** The emblem (cross, heart, ECG, leaf) — no text. `tile` sits it on the icon's soft cream glass. */
export function BrandMark({ size = 64, variant = 'plain' }: { size?: number; variant?: 'tile' | 'plain' }) {
  const prefix = usePrefix('m');
  const xml = useMemo(() => dmwSvg(dmwArtwork, { part: 'emblem', idPrefix: prefix }), [prefix]);
  const inner = variant === 'tile' ? size * 0.72 : size;
  const height = inner / dmwAspect(dmwArtwork, 'emblem');
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={LABEL}
      style={[{ width: size, height: variant === 'tile' ? size : height, alignItems: 'center', justifyContent: 'center', direction: 'ltr' }, variant === 'tile' ? { borderRadius: size * 0.23, backgroundColor: dmwColors.cream, borderWidth: 1, borderColor: 'rgba(249, 115, 22, 0.18)' } : null]}
    >
      <SvgXml xml={xml} width={inner} height={height} />
    </View>
  );
}

/**
 * The tagline-free wordmark (emblem + "Dress My Wound"), as supplied — never stretched or cropped.
 * `inverse` = on a dark surface ("Dress My" in soft white); by default it follows the colour scheme.
 */
export function Wordmark({ width = 240, inverse }: { width?: number; inverse?: boolean }) {
  const { scheme } = useTheme();
  const onDark = inverse ?? scheme === 'dark';
  const prefix = usePrefix('w');
  const xml = useMemo(() => dmwSvg(dmwArtwork, { part: 'wordmark', inverse: onDark, idPrefix: prefix }), [onDark, prefix]);
  const height = width / dmwAspect(dmwArtwork, 'wordmark');
  return (
    // The artwork reads left to right in both languages.
    <View accessible accessibilityRole="image" accessibilityLabel={LABEL} style={{ width, height, direction: 'ltr' }} testID="dmw-wordmark">
      <SvgXml xml={xml} width={width} height={height} />
    </View>
  );
}
