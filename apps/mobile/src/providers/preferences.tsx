import type { Locale } from '@ghayarly/i18n';
import { getLocales } from 'expo-localization';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { prefs } from '@/lib/storage';

export type ThemeMode = 'system' | 'light' | 'dark';

type Preferences = {
  ready: boolean;
  locale: Locale;
  themeMode: ThemeMode;
  activePatientId: string | null;
  setLocale: (l: Locale) => void;
  setThemeMode: (m: ThemeMode) => void;
  setActivePatientId: (id: string | null) => void;
};

const Ctx = createContext<Preferences | null>(null);

function deviceLocale(): Locale {
  try {
    const tag = getLocales()[0]?.languageCode;
    return tag === 'en' ? 'en' : 'ar';
  } catch {
    return 'ar';
  }
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [locale, setLocaleState] = useState<Locale>('ar');
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [activePatientId, setActivePatientState] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [l, m, p] = await Promise.all([
        prefs.get<Locale | null>('locale', null),
        prefs.get<ThemeMode>('themeMode', 'system'),
        prefs.get<string | null>('activePatientId', null),
      ]);
      setLocaleState(l ?? deviceLocale());
      setThemeModeState(m);
      setActivePatientState(p);
      setReady(true);
    })();
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    void prefs.set('locale', l);
  }, []);
  const setThemeMode = useCallback((m: ThemeMode) => {
    setThemeModeState(m);
    void prefs.set('themeMode', m);
  }, []);
  const setActivePatientId = useCallback((id: string | null) => {
    setActivePatientState(id);
    void prefs.set('activePatientId', id);
  }, []);

  const value = useMemo(
    () => ({ ready, locale, themeMode, activePatientId, setLocale, setThemeMode, setActivePatientId }),
    [ready, locale, themeMode, activePatientId, setLocale, setThemeMode, setActivePatientId],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePreferences(): Preferences {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePreferences must be used within PreferencesProvider');
  return v;
}
