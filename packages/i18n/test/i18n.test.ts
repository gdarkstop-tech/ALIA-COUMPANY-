import { describe, expect, it } from 'vitest';
import { ar } from '../src/ar';
import { en } from '../src/en';
import { direction, translate } from '../src';

function keys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : keys(v as Record<string, unknown>, `${prefix}${k}.`)));
}

describe('i18n', () => {
  it('Arabic and English dictionaries have identical keys', () => {
    expect(keys(ar).sort()).toEqual(keys(en).sort());
  });
  it('keeps placeholders consistent between languages', () => {
    const enKeys = keys(en);
    for (const k of enKeys) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
      expect(ph(translate('ar', k)), k).toBe(ph(translate('en', k)));
    }
  });
  it('interpolates with locale digits', () => {
    expect(translate('en', 'home.profileComplete', { percent: 80 })).toBe('Profile 80% complete');
    expect(translate('ar', 'home.profileComplete', { percent: 80 })).toBe('الملف مكتمل بنسبة ٨٠٪');
  });
  it('reports direction', () => {
    expect(direction('ar')).toBe('rtl');
    expect(direction('en')).toBe('ltr');
  });
});
