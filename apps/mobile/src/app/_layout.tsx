import {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
  useFonts,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState, type ReactNode } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiError } from '@/lib/api';
import { I18nProvider } from '@/providers/i18n';
import { PreferencesProvider, usePreferences } from '@/providers/preferences';
import { ThemeProvider, useTheme } from '@/providers/theme';
import { ToastProvider } from '@/ui';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

function Ready({ children, fontsLoaded }: { children: ReactNode; fontsLoaded: boolean }) {
  const { ready } = usePreferences();
  const isReady = ready && fontsLoaded;
  useEffect(() => {
    if (isReady) void SplashScreen.hideAsync().catch(() => undefined);
  }, [isReady]);
  return isReady ? <>{children}</> : null;
}

function Shell() {
  const { colors, scheme } = useTheme();
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background).catch(() => undefined);
  }, [colors.background]);
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background }, animation: 'fade_from_bottom' }}>
        <Stack.Screen name="patient" options={{ animation: 'fade' }} />
        <Stack.Screen name="clinician" options={{ animation: 'fade' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ IBMPlexSansArabic_400Regular, IBMPlexSansArabic_500Medium, IBMPlexSansArabic_600SemiBold, IBMPlexSansArabic_700Bold });
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: (count, error) => !(error instanceof ApiError && error.status > 0 && error.status < 500) && count < 2,
            staleTime: 15_000,
          },
        },
      }),
  );
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <PreferencesProvider>
            <Ready fontsLoaded={fontsLoaded || Boolean(fontError)}>
              <I18nProvider>
                <ThemeProvider>
                  <ToastProvider>
                    <Shell />
                  </ToastProvider>
                </ThemeProvider>
              </I18nProvider>
            </Ready>
          </PreferencesProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
