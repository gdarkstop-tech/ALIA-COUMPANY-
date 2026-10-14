/**
 * Ghayarly design tokens — the single source of visual truth for mobile and admin.
 *
 * Palette intent: warm-white canvas, calm teal for primary action and care, deep navy for
 * trust and structure, a very restrained warm sand accent for warmth. Components consume
 * semantic tokens (`color.surface`, `color.textSecondary`) — never raw palette values — so
 * the look can evolve without rewriting components.
 */

export const palette = {
  teal: { 50: '#EEF8F7', 100: '#D5EFEC', 200: '#AADDD8', 300: '#72C4BC', 400: '#3DA89F', 500: '#1E8C84', 600: '#16746E', 700: '#145D59', 800: '#134B48', 900: '#123E3C' },
  navy: { 50: '#EFF3F8', 100: '#D8E1EC', 200: '#B3C3D7', 300: '#8AA1BD', 400: '#5F7C9E', 500: '#3E5C80', 600: '#2B4767', 700: '#1D3654', 800: '#142A44', 900: '#0C1E33', 950: '#071423' },
  sand: { 50: '#FCF7F1', 100: '#F6EADB', 200: '#ECD4B6', 300: '#DFB88C', 400: '#CF9A66', 500: '#B97F4B' },
  warmWhite: { 0: '#FFFFFF', 25: '#FDFCFA', 50: '#FAF8F4', 100: '#F3F0EA', 200: '#E9E4DB' },
  ink: { 900: '#0C1E33', 700: '#33465C', 500: '#5E6E80', 400: '#7D8A99', 300: '#A3ADB8' },
  green: { 50: '#ECF7F1', 500: '#2F8A5F', 600: '#257050', 300: '#6CC49A' },
  amber: { 50: '#FDF5E6', 500: '#B7791F', 600: '#975F12', 300: '#E7B866' },
  red: { 50: '#FDF0EE', 500: '#C0392B', 600: '#A02D22', 300: '#EE8A7E' },
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
  textOnPrimary: string;
  primary: string;
  primaryPressed: string;
  primarySoft: string;
  primarySoftText: string;
  navy: string;
  navySoft: string;
  accent: string;
  accentSoft: string;
  accentText: string;
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
  shadow: string;
  skeleton: string;
  skeletonHighlight: string;
};

export const lightColors: ColorTokens = {
  background: palette.warmWhite[50],
  backgroundElevated: palette.warmWhite[25],
  surface: palette.warmWhite[0],
  surfaceMuted: palette.warmWhite[100],
  surfaceSunken: '#F0ECE4',
  surfaceInverse: palette.navy[900],
  border: '#E6E1D8',
  borderStrong: '#D3CCC0',
  divider: '#EEEAE3',
  text: palette.ink[900],
  textSecondary: palette.ink[700],
  textTertiary: palette.ink[500],
  textInverse: '#F4F7FA',
  textOnPrimary: '#FFFFFF',
  primary: palette.teal[600],
  primaryPressed: palette.teal[700],
  primarySoft: palette.teal[50],
  primarySoftText: palette.teal[800],
  navy: palette.navy[800],
  navySoft: palette.navy[50],
  accent: palette.sand[400],
  accentSoft: palette.sand[50],
  accentText: '#7A532E',
  success: palette.green[600],
  successSoft: palette.green[50],
  warning: palette.amber[600],
  warningSoft: palette.amber[50],
  danger: palette.red[600],
  dangerSoft: palette.red[50],
  info: palette.navy[500],
  infoSoft: palette.navy[50],
  demo: '#6B4FA0',
  demoSoft: '#F3EFFA',
  focusRing: palette.teal[400],
  overlay: 'rgba(7, 20, 35, 0.45)',
  shadow: 'rgba(12, 30, 51, 0.08)',
  skeleton: '#EFEBE4',
  skeletonHighlight: '#F7F4EF',
};

export const darkColors: ColorTokens = {
  background: '#08131F',
  backgroundElevated: '#0B1928',
  surface: '#0F1F30',
  surfaceMuted: '#132638',
  surfaceSunken: '#0A1724',
  surfaceInverse: '#EEF2F6',
  border: '#1C3247',
  borderStrong: '#284259',
  divider: '#172A3D',
  text: '#ECF1F6',
  textSecondary: '#B4C1CF',
  textTertiary: '#8395A8',
  textInverse: palette.navy[900],
  textOnPrimary: '#04201E',
  primary: palette.teal[300],
  primaryPressed: palette.teal[200],
  primarySoft: '#10302F',
  primarySoftText: palette.teal[200],
  navy: palette.navy[200],
  navySoft: '#14273B',
  accent: palette.sand[300],
  accentSoft: '#2A2118',
  accentText: palette.sand[200],
  success: palette.green[300],
  successSoft: '#11291E',
  warning: palette.amber[300],
  warningSoft: '#2C2210',
  danger: palette.red[300],
  dangerSoft: '#311816',
  info: palette.navy[300],
  infoSoft: '#14273B',
  demo: '#B9A3E3',
  demoSoft: '#221A33',
  focusRing: palette.teal[300],
  overlay: 'rgba(0, 0, 0, 0.6)',
  shadow: 'rgba(0, 0, 0, 0.35)',
  skeleton: '#15283A',
  skeletonHighlight: '#1B3247',
};

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
  letterSpacing: { tight: -0.3, normal: 0, wide: 0.4 },
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

export const theme = { light: lightColors, dark: darkColors } as const;
export type ThemeName = keyof typeof theme;

/** CSS custom properties for web surfaces (admin console). */
export function cssVariables(colors: ColorTokens): string {
  return Object.entries(colors)
    .map(([key, value]) => `--color-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}: ${value};`)
    .join('\n');
}
