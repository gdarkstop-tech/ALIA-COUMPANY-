import { Stack } from 'expo-router';
import { useTheme } from '@/providers/theme';

export default function PatientLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="family-add" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
