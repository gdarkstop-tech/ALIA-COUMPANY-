import {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
  useFonts,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ReducedMotionConfig, ReduceMotion } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiError } from '@/lib/api';
import { installGlobalErrorHandler, reportError } from '@/lib/errorReporting';
import { I18nProvider } from '@/providers/i18n';
import { PreferencesProvider, usePreferences } from '@/providers/preferences';
import { ThemeProvider, useTheme } from '@/providers/theme';
import { ToastProvider } from '@/ui';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
installGlobalErrorHandler();

/** Route-level error boundary (Expo Router): reports anonymously and offers a calm retry. */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  useEffect(() => {
    reportError(error, { fatal: false });
  }, [error]);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16, backgroundColor: '#FAF7F2' }} accessibilityRole="alert">
      <Text style={{ fontSize: 18, fontWeight: '600', color: '#0A1F3D', textAlign: 'center' }}>Something went wrong · حدث خطأ ما</Text>
      <Pressable accessibilityRole="button" onPress={() => void retry()} style={{ minHeight: 48, paddingHorizontal: 24, borderRadius: 18, backgroundColor: '#102A4C', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>Try again · حاول مرة أخرى</Text>
      </Pressable>
    </View>
  );
}

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
  const [queryClient] = useState(() => {
    // An account suspended or blocked mid-session: refresh /me so the gates show the restriction
    // screen (the API refuses everything else anyway).
    const onError = (error: unknown) => {
      if (error instanceof ApiError && (error.code === 'ACCOUNT_SUSPENDED' || error.code === 'ACCOUNT_BLOCKED')) void client.invalidateQueries({ queryKey: ['me'] });
    };
    const client: QueryClient = new QueryClient({
      queryCache: new QueryCache({ onError }),
      mutationCache: new MutationCache({ onError }),
      defaultOptions: {
        queries: {
          retry: (count, error) => !(error instanceof ApiError && error.status > 0 && error.status < 500) && count < 2,
          staleTime: 15_000,
        },
      },
    });
    return client;
  });
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Respect the OS "Reduce motion" setting for every Reanimated animation. */}
      <ReducedMotionConfig mode={ReduceMotion.System} />
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
