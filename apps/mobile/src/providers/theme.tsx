import { darkColors, lightColors, type ColorTokens } from '@ghayarly/tokens';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { usePreferences } from './preferences';

type Theme = { colors: ColorTokens; scheme: 'light' | 'dark' };
const Ctx = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const { themeMode } = usePreferences();
  const scheme: 'light' | 'dark' = themeMode === 'system' ? (system === 'dark' ? 'dark' : 'light') : themeMode;
  const value = useMemo(() => ({ scheme, colors: scheme === 'dark' ? darkColors : lightColors }), [scheme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): Theme {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme must be used within ThemeProvider');
  return v;
}
