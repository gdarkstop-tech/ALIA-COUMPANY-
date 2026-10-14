import { radii, spacing } from '@ghayarly/tokens';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/providers/theme';
import { Icon } from './Icon';
import { Text } from './Text';

type ToastKind = 'success' | 'error' | 'info';
type ToastState = { id: number; message: string; kind: ToastKind } | null;
const Ctx = createContext<(message: string, kind?: ToastKind) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const show = useCallback((message: string, kind: ToastKind = 'success') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ id: Date.now(), message, kind });
    timer.current = setTimeout(() => setToast(null), 3200);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      {toast ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + spacing.sm, left: 0, right: 0, alignItems: 'center', paddingHorizontal: spacing.lg }}>
          <Animated.View
            key={toast.id}
            entering={FadeInUp.duration(220)}
            exiting={FadeOutUp.duration(180)}
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            testID="toast"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              maxWidth: 480,
              backgroundColor: colors.surfaceInverse,
              borderRadius: radii.lg,
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.md,
              shadowColor: '#000',
              shadowOpacity: 0.18,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 8 },
            }}
          >
            <Icon name={toast.kind === 'error' ? 'alert-circle' : toast.kind === 'info' ? 'info' : 'check-circle'} size={18} tint={toast.kind === 'error' ? colors.danger : colors.primary} />
            <Text variant="footnote" weight="medium" style={{ color: colors.textInverse }}>
              {toast.message}
            </Text>
          </Animated.View>
        </View>
      ) : null}
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
