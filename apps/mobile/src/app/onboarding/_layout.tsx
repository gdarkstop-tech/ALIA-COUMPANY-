import { Stack } from 'expo-router';
import { ConsentGate } from '@/features/compliance/ConsentGate';
import { useTheme } from '@/providers/theme';

/** Onboarding is reachable by deep link too: it stays behind the current Terms and Privacy Policy. */
export default function OnboardingLayout() {
  const { colors } = useTheme();
  return (
    <ConsentGate>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </ConsentGate>
  );
}
