import { createTranslator, direction, isRTL as rtl, pick, type Locale, type TranslationKey, type TranslationParams } from '@ghayarly/i18n';
import * as Updates from 'expo-updates';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { DevSettings, I18nManager, Platform } from 'react-native';
import { usePreferences } from './preferences';

type I18n = {
  locale: Locale;
  isRTL: boolean;
  dir: 'rtl' | 'ltr';
  t: (key: TranslationKey, params?: TranslationParams) => string;
  /** Localized field from a bilingual record, e.g. pickL(provider, 'displayName'). */
  pickL: (obj: Record<string, unknown>, base: string) => string;
  setLocale: (l: Locale) => void;
};

const Ctx = createContext<I18n | null>(null);

async function reloadForDirection() {
  try {
    await Updates.reloadAsync();
  } catch {
    if (__DEV__) DevSettings.reload();
  }
}

/**
 * Arabic (RTL) is the default. On web, direction follows the <html dir> attribute. On native,
 * React Native requires I18nManager.forceRTL + an app reload for layout direction to change.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const { locale, setLocale: persistLocale, ready } = usePreferences();

  useEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof document !== 'undefined') {
        document.documentElement.dir = direction(locale);
        document.documentElement.lang = locale;
      }
      return;
    }
    if (!ready) return;
    const wantRTL = rtl(locale);
    if (I18nManager.isRTL !== wantRTL) {
      I18nManager.allowRTL(wantRTL);
      I18nManager.forceRTL(wantRTL);
      void reloadForDirection();
    }
  }, [locale, ready]);

  const setLocale = useCallback((l: Locale) => persistLocale(l), [persistLocale]);

  const value = useMemo<I18n>(() => {
    const t = createTranslator(locale);
    return { locale, isRTL: rtl(locale), dir: direction(locale), t, pickL: (obj, base) => pick(obj, base, locale), setLocale };
  }, [locale, setLocale]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n must be used within I18nProvider');
  return v;
}
