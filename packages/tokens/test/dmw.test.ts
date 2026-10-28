import { describe, expect, it } from 'vitest';
import { brandConfig, darkColors, dmwArtwork, dmwAspect, dmwBox, dmwColors, dmwParts, dmwSvg, lightColors } from '../src';

function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('Dress My Wound official artwork', () => {
  it('is official and traceable to the supplied reference', () => {
    expect(brandConfig.assets.productMark).toBe('OFFICIAL');
    expect(brandConfig.assets.productMarkSource).toBe('store/assets/official/dmw/reference');
  });

  it('the emblem carries no lettering; the wordmark adds only the "Dress My Wound" letterforms', () => {
    const emblem = dmwSvg(dmwArtwork, { part: 'emblem' });
    const wordmark = dmwSvg(dmwArtwork, { part: 'wordmark' });
    expect(emblem).not.toContain(dmwArtwork.text.dark);
    expect(emblem).not.toContain(dmwArtwork.text.orange);
    expect(wordmark).toContain(dmwArtwork.text.dark);
    // Artwork is shapes only: no <text>, no Arabic, no subtitle baked in.
    for (const svg of [emblem, wordmark]) {
      expect(svg).not.toMatch(/<text|[؀-ۿ]|console/i);
      expect(svg.match(/<path /g)).toHaveLength(svg === emblem ? 3 : 5);
    }
  });

  it('keeps the supplied proportions (boxes come from the traced bounds, never stretched)', () => {
    const [, , ew, eh] = dmwBox(dmwArtwork, 'emblem');
    const [wx, , ww] = dmwBox(dmwArtwork, 'wordmark');
    expect(ew / eh).toBeCloseTo(dmwAspect(dmwArtwork, 'emblem'), 6);
    // The wordmark starts at the emblem and ends after "Wound".
    expect(wx).toBeLessThanOrEqual(dmwArtwork.emblem.bounds[0]!);
    expect(wx + ww).toBeGreaterThanOrEqual(dmwArtwork.text.bounds[2]!);
    expect(dmwAspect(dmwArtwork, 'wordmark')).toBeGreaterThan(3);
  });

  it('paints "Dress My" dark on light surfaces and soft white on dark ones', () => {
    expect(dmwParts(dmwArtwork, { part: 'wordmark' }).body).toContain(`fill="${dmwColors.ink}"`);
    expect(dmwParts(dmwArtwork, { part: 'wordmark', inverse: true }).body).toContain(`fill="${dmwColors.inkInverse}"`);
    // Lettering stays legible on the app's own canvases (WCAG large-text minimum).
    expect(contrast(dmwColors.ink, lightColors.background)).toBeGreaterThanOrEqual(3);
    expect(contrast(dmwColors.inkInverse, darkColors.background)).toBeGreaterThanOrEqual(3);
    expect(contrast(dmwColors.inkInverse, lightColors.heroBackground)).toBeGreaterThanOrEqual(3);
  });

  it('scopes gradient ids so several marks can share one page', () => {
    const a = dmwSvg(dmwArtwork, { part: 'wordmark', idPrefix: 'a1' });
    const ids = [...a.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id!.startsWith('a1-'))).toBe(true);
    expect([...a.matchAll(/url\(#([^)]+)\)/g)].every((m) => ids.includes(m[1]))).toBe(true);
  });

  it('flat paints (themed / tinted icons) replace every gradient fill', () => {
    const { body } = dmwParts(dmwArtwork, { part: 'wordmark', flat: { all: '#FFFFFF' } });
    // Only the ECG keeps a gradient: its fade-in is alpha, which themed icons honour.
    expect([...body.matchAll(/fill="url\(#([^)]+)\)"/g)].map((m) => m[1])).toEqual(['dmw-ecg']);
    expect(body.match(/fill="#FFFFFF"/g)).toHaveLength(4);
  });
});
