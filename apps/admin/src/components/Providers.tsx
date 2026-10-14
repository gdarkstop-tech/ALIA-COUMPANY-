'use client';
import { createTranslator, direction, type Locale, type TranslationKey, type TranslationParams } from '@ghayarly/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';

type I18n = { locale: Locale; t: (k: TranslationKey, p?: TranslationParams) => string; setLocale: (l: Locale) => void };
const I18nCtx = createContext<I18n | null>(null);
const ToastCtx = createContext<(m: string) => void>(() => undefined);

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: (n, e) => !(e instanceof ApiError && e.status < 500 && e.status > 0) && n < 2, refetchOnWindowFocus: false } },
      }),
  );
  const [locale, setLocaleState] = useState<Locale>('en');
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('ghayarly-admin-locale');
      if (saved === 'ar' || saved === 'en') setLocaleState(saved);
    } catch {
      /* storage unavailable — keep default */
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction(locale);
  }, [locale]);
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      window.localStorage.setItem('ghayarly-admin-locale', l);
    } catch {
      /* ignore */
    }
  }, []);
  const showToast = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3000);
  }, []);
  const i18n = useMemo(() => ({ locale, t: createTranslator(locale), setLocale }), [locale, setLocale]);
  return (
    <QueryClientProvider client={client}>
      <I18nCtx.Provider value={i18n}>
        <ToastCtx.Provider value={showToast}>
          {children}
          {toast ? (
            <div className="toast" role="status" data-testid="toast">
              {toast}
            </div>
          ) : null}
        </ToastCtx.Provider>
      </I18nCtx.Provider>
    </QueryClientProvider>
  );
}

export function useI18n() {
  const v = useContext(I18nCtx);
  if (!v) throw new Error('useI18n outside Providers');
  return v;
}
export const useToast = () => useContext(ToastCtx);
