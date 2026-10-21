import { Stack } from 'expo-router';
import { ConsentGate } from '@/features/compliance/ConsentGate';
import { useTheme } from '@/providers/theme';

export default function ClinicianLayout() {
  const { colors } = useTheme();
  return (
    <ConsentGate>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="add-credential" options={{ presentation: 'modal' }} />
      </Stack>
    </ConsentGate>
  );
}
