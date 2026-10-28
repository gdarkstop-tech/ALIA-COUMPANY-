/**
 * Dress My Wound (غير لي) design tokens — the single source of visual truth for iOS, Android
 * and the admin console.
 *
 * Visual system: Alia Group × TetraSol (provisional values, see ./brand.ts).
 *   - Deep navy carries structure (headers, primary actions, active navigation).
 *   - Signature orange is reserved for deliberate highlights: hero calls-to-action, selections,
 *     progress and brand accents — never as a clinical warning colour.
 *   - Warm stone surfaces and brass hairlines bring the Alia Group architectural character.
 *   - Clinical status colours (success / warning / danger / info) are a SEPARATE scale so a
 *     medical warning always reads as a warning, never as branding.
 *
 * Components consume semantic tokens only (`colors.surface`, `semantic.brand.accent`), so the
 * look can evolve without rewriting components. Contrast pairs are verified by
 * packages/tokens/test/contrast.test.ts (WCAG 2.2 AA).
 */
import { brandConfig } from './brand';

export { brandConfig } from './brand';
export type { BrandConfig } from './brand';
export { dmwArtwork } from './dmw-artwork';
export { dmwAspect, dmwBox, dmwColors, dmwGradients, dmwParts, dmwSvg } from './dmw';
export type { DmwArtwork, DmwPaintOptions, DmwPart } from './dmw';

export const palette = {
  navy: { 950: '#07152A', 900: '#0A1F3D', 800: '#102A4C', 700: '#18375F', 600: '#234673', 500: '#355B8C', 400: '#5578A6', 300: '#87A0C2', 200: '#B9C8DC', 100: '#DDE5EF', 50: '#F0F4F9' },
  orange: { 700: '#9A3D0C', 600: '#C24E16', 500: brandConfig.hues.orange, 400: '#F5863F', 300: '#F9A66E', 200: '#FCC9A3', 100: '#FDE3D0', 50: '#FEF3EA' },
  stone: { 0: '#FFFFFF', 50: brandConfig.hues.stone, 100: '#F3EEE5', 200: '#E7DFD2', 300: '#D6CAB7', 400: '#BFAF96' },
  brass: { 700: '#6F5530', 600: '#8A6A3B', 500: brandConfig.hues.brass, 400: '#C2A16A', 300: '#D9C29A', 100: '#F2EADB' },
  ink: { 900: '#0A1F3D', 700: '#3A4A60', 500: '#5A6779', 400: '#7D8898', 300: '#A3ACB8' },
  // Clinical status scale — independent of brand hues.
  green: { 50: '#EAF6EF', 600: '#1D6E46', 300: '#7CCB9F' },
  amber: { 50: '#FFF4D6', 600: '#8A5A00', 300: '#F2C14E' },
  red: { 50: '#FEF0EE', 600: '#B42318', 300: '#F28B7D' },
  blue: { 50: '#EEF3FA', 600: '#2B5A9E', 300: '#8FB2E3' },
} as const;

export type ColorTokens = {
  background: string;
  backgroundElevated: string;
  surface: string;
  surfaceMuted: string;
  surfaceSunken: string;
  surfaceInverse: string;
  border: string;
  borderStrong: string;
  divider: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;
  /** Structural primary (navy). */
  primary: string;
  primaryPressed: string;
  textOnPrimary: string;
  primarySoft: string;
  primarySoftText: string;
  navy: string;
  navySoft: string;
  /** Brand accent (TetraSol orange) — highlights, hero CTAs, selections. */
  accent: string;
  accentPressed: string;
  textOnAccent: string;
  accentSoft: string;
  accentText: string;
  /** Alia Group brass — hairlines, ornament, endorsement. */
  brass: string;
  brassSoft: string;
  ornament: string;
  heroBackground: string;
  heroText: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;
  demo: string;
  demoSoft: string;
  focusRing: string;
  overlay: string;
  /**
   * Chart series, in fixed order (never cycled). Validated per mode with the data-viz palette
   * checks (lightness band, chroma floor, colour-vision-deficiency separation, contrast vs surface).
   */
  chart1: string;
  chart2: string;
  shadow: string;
  skeleton: string;
  skeletonHighlight: string;
};

export const lightColors: ColorTokens = {
  background: palette.stone[50],
  backgroundElevated: '#FDFBF8',
  surface: palette.stone[0],
  surfaceMuted: palette.stone[100],
  surfaceSunken: '#EFE9DF',
  surfaceInverse: palette.navy[900],
  border: '#E5DDD0',
  borderStrong: palette.stone[300],
  divider: '#EEE8DE',
  text: palette.ink[900],
  textSecondary: palette.ink[700],
  textTertiary: palette.ink[500],
  textInverse: '#F4F6FA',
  primary: palette.navy[800],
  primaryPressed: palette.navy[900],
  textOnPrimary: '#FFFFFF',
  primarySoft: palette.navy[50],
  primarySoftText: palette.navy[700],
  navy: palette.navy[800],
  navySoft: palette.navy[50],
  accent: palette.orange[500],
  accentPressed: palette.orange[600],
  textOnAccent: palette.navy[900],
  accentSoft: palette.orange[50],
  accentText: palette.orange[700],
  brass: palette.brass[600],
  brassSoft: palette.brass[100],
  ornament: palette.brass[400],
  heroBackground: palette.navy[900],
  heroText: '#F7F3EC',
  success: palette.green[600],
  successSoft: palette.green[50],
  warning: palette.amber[600],
  warningSoft: palette.amber[50],
  danger: palette.red[600],
  dangerSoft: palette.red[50],
  info: palette.blue[600],
  infoSoft: palette.blue[50],
  demo: '#5B3F8F',
  demoSoft: '#F2EEF9',
  focusRing: palette.orange[500],
  overlay: 'rgba(7, 21, 42, 0.5)',
  chart1: palette.blue[600],
  chart2: palette.orange[500],
  shadow: 'rgba(10, 31, 61, 0.08)',
  skeleton: '#EDE6DB',
  skeletonHighlight: '#F6F1EA',
};

export const darkColors: ColorTokens = {
  background: palette.navy[950],
  backgroundElevated: '#0A1B33',
  surface: '#0D2140',
  surfaceMuted: '#132B4F',
  surfaceSunken: '#091830',
  surfaceInverse: '#F0F4F9',
  border: '#1F3A63',
  borderStrong: '#2C4B78',
  divider: '#18305A',
  text: '#EEF2F8',
  textSecondary: '#B7C3D6',
  textTertiary: '#8E9DB4',
  textInverse: palette.navy[900],
  primary: '#C9D7EC',
  primaryPressed: '#DDE5EF',
  textOnPrimary: palette.navy[950],
  primarySoft: '#132B4F',
  primarySoftText: '#C9D7EC',
  navy: '#C9D7EC',
  navySoft: '#132B4F',
  accent: palette.orange[400],
  accentPressed: palette.orange[300],
  textOnAccent: palette.navy[950],
  accentSoft: '#2A1A10',
  accentText: palette.orange[300],
  brass: palette.brass[300],
  brassSoft: '#231C12',
  ornament: palette.brass[500],
  heroBackground: '#0A1B33',
  heroText: '#F7F3EC',
  success: palette.green[300],
  successSoft: '#10291D',
  warning: palette.amber[300],
  warningSoft: '#2B220C',
  danger: palette.red[300],
  dangerSoft: '#33140F',
  info: palette.blue[300],
  infoSoft: '#132B4F',
  demo: '#C2AEE8',
  demoSoft: '#221A33',
  focusRing: palette.orange[400],
  overlay: 'rgba(0, 0, 0, 0.6)',
  chart1: '#4F86D6',
  chart2: '#E8692A',
  shadow: 'rgba(0, 0, 0, 0.35)',
  skeleton: '#15305A',
  skeletonHighlight: '#1B3A68',
};

/**
 * Semantic token view using the corporate naming scheme (brand.* / surface.* / text.* /
 * border.* / status.*). Prefer these names in new components.
 */
export function semanticColors(c: ColorTokens) {
  return {
    brand: { primary: c.primary, secondary: c.brass, accent: c.accent, onPrimary: c.textOnPrimary, onAccent: c.textOnAccent },
    surface: { default: c.surface, elevated: c.backgroundElevated, muted: c.surfaceMuted, canvas: c.background, inverse: c.surfaceInverse, hero: c.heroBackground },
    text: { primary: c.text, secondary: c.textSecondary, tertiary: c.textTertiary, inverse: c.textInverse },
    border: { subtle: c.border, strong: c.borderStrong, divider: c.divider },
    status: { success: c.success, warning: c.warning, danger: c.danger, info: c.info },
  } as const;
}
export type SemanticColors = ReturnType<typeof semanticColors>;

export const spacing = { none: 0, xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, '3xl': 32, '4xl': 40, '5xl': 56, '6xl': 72 } as const;
export type SpacingToken = keyof typeof spacing;

export const radii = { xs: 6, sm: 10, md: 14, lg: 18, xl: 24, xxl: 32, pill: 999 } as const;

/** Arabic glyphs need generous line-height; the scale is tuned for IBM Plex Sans Arabic. */
export const typography = {
  fontFamily: {
    regular: 'IBMPlexSansArabic_400Regular',
    medium: 'IBMPlexSansArabic_500Medium',
    semibold: 'IBMPlexSansArabic_600SemiBold',
    bold: 'IBMPlexSansArabic_700Bold',
    webStack: "'IBM Plex Sans Arabic', 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  size: { display: 32, title1: 26, title2: 21, title3: 18, body: 16, callout: 15, footnote: 13, caption: 12, micro: 11 },
  lineHeight: { display: 44, title1: 38, title2: 31, title3: 27, body: 25, callout: 23, footnote: 20, caption: 18, micro: 16 },
  letterSpacing: { tight: -0.3, normal: 0, wide: 0.4, eyebrow: 1.2 },
  /** Dynamic Type: text scales with the OS setting up to this multiplier (layouts are tested at it). */
  maxFontSizeMultiplier: 1.8,
} as const;
export type TextVariant = keyof typeof typography.size;

export const motion = {
  duration: { instant: 90, fast: 160, normal: 240, slow: 380, gentle: 520 },
  /** cubic-bezier control points (standard / decelerate / emphasized). */
  easing: { standard: [0.2, 0, 0, 1], decelerate: [0, 0, 0, 1], emphasized: [0.3, 0, 0, 1] },
  pressScale: 0.97,
} as const;

export const elevation = {
  card: { shadowOpacity: 1, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  raised: { shadowOpacity: 1, shadowRadius: 28, shadowOffset: { width: 0, height: 12 }, elevation: 6 },
} as const;

/** Minimum interactive target (WCAG 2.5.5 AAA / platform guidance). */
export const touchTarget = { min: 48, comfortable: 56 } as const;

export const layout = { maxContentWidth: 720, maxWideWidth: 1200, screenPadding: 20 } as const;

/**
 * Alia Group architectural language — EXTREMELY subtle by design: a near-invisible texture on the
 * welcome hero only. Never behind clinical content, forms, lists or data. Modern healthcare UX first.
 */
export const ornament = {
  /** Mashrabiya lattice opacity on the welcome hero and (rarely) on light canvases. */
  latticeOpacityHero: 0.05,
  latticeOpacityCanvas: 0.03,
  /** Opacity of the pointed-arch hairline frame on the welcome hero. */
  archStrokeOpacity: 0.35,
  latticeCell: 28,
  /** Pointed (Mamluk) arch: height of the pointed crown relative to the arch width. */
  archCrownRatio: 0.42,
  hairline: 1,
} as const;

export const theme = { light: lightColors, dark: darkColors } as const;
export type ThemeName = keyof typeof theme;

/** CSS custom properties for web surfaces (admin console). */
export function cssVariables(colors: ColorTokens): string {
  return Object.entries(colors)
    .map(([key, value]) => `--color-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}: ${value};`)
    .join('\n');
}
