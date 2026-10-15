import { describe, expect, it } from 'vitest';
import { brandConfig, darkColors, lightColors, semanticColors, type ColorTokens } from '../src';

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** [foreground, background, minimum ratio, why] — WCAG 2.2: 4.5 body text, 3.0 large text / UI. */
const PAIRS: [keyof ColorTokens, keyof ColorTokens, number, string][] = [
  ['text', 'background', 4.5, 'body text on canvas'],
  ['text', 'surface', 4.5, 'body text on cards'],
  ['textSecondary', 'surface', 4.5, 'secondary text'],
  ['textSecondary', 'background', 4.5, 'secondary text on canvas'],
  ['textTertiary', 'surface', 4.5, 'captions on cards'],
  ['textTertiary', 'background', 4.5, 'captions on canvas'],
  ['textOnPrimary', 'primary', 4.5, 'navy button label'],
  ['textOnAccent', 'accent', 4.5, 'orange CTA label'],
  ['primarySoftText', 'primarySoft', 4.5, 'soft navy button'],
  ['accentText', 'accentSoft', 4.5, 'orange chip/selection text'],
  ['success', 'successSoft', 4.5, 'success badge'],
  ['warning', 'warningSoft', 4.5, 'clinical warning badge'],
  ['danger', 'dangerSoft', 4.5, 'danger badge'],
  ['info', 'infoSoft', 4.5, 'info badge'],
  ['demo', 'demoSoft', 4.5, 'synthetic-data badge'],
  ['heroText', 'heroBackground', 4.5, 'text on navy hero'],
  ['textInverse', 'surfaceInverse', 4.5, 'toast text'],
  ['primary', 'surface', 3, 'navy icons / active tab'],
  ['accent', 'heroBackground', 3, 'orange accent on hero'],
  ['brass', 'background', 3, 'brass ornament on canvas'],
];

describe.each([
  ['light', lightColors],
  ['dark', darkColors],
] as const)('%s theme contrast (WCAG 2.2 AA)', (_name, colors) => {
  it.each(PAIRS)('%s on %s ≥ %s (%s)', (fg, bg, min) => {
    expect(contrast(colors[fg], colors[bg])).toBeGreaterThanOrEqual(min);
  });
});

describe('brand system rules', () => {
  it('keeps the brand accent distinct from clinical warning and danger colours', () => {
    for (const c of [lightColors, darkColors]) {
      expect(c.accent.toLowerCase()).not.toBe(c.warning.toLowerCase());
      expect(c.accent.toLowerCase()).not.toBe(c.danger.toLowerCase());
      // Perceptibly different: luminance contrast between accent and warning ≥ 1.4
      expect(contrast(c.accent, c.warning)).toBeGreaterThanOrEqual(1.4);
    }
  });
  it('exposes the corporate semantic categories', () => {
    const s = semanticColors(lightColors);
    expect(Object.keys(s).sort()).toEqual(['border', 'brand', 'status', 'surface', 'text']);
    expect(s.brand.accent).toBe(lightColors.accent);
    expect(s.status.warning).toBe(lightColors.warning);
  });
  it('is explicitly marked provisional until official assets are supplied', () => {
    expect(brandConfig.product).toEqual({ nameEn: 'Dress My Wound', nameAr: 'غير لي' });
    if (brandConfig.status === 'PROVISIONAL') {
      expect(brandConfig.corporate.officialAssetsReceived || brandConfig.commerce.officialAssetsReceived).toBe(false);
    }
  });
});
