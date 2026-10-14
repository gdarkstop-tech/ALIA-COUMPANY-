import { Stack } from 'expo-router';
import { useTheme } from '@/providers/theme';

export default function ClinicianLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="add-credential" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
