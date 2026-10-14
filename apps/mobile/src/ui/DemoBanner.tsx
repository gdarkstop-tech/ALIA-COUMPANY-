import { spacing } from '@ghayarly/tokens';
import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Icon } from './Icon';
import { Text } from './Text';

export function useSystemStatus() {
  return useQuery({ queryKey: ['system-status'], queryFn: () => api.system.status(), staleTime: 60_000 });
}

/** Persistent strip shown whenever the API runs in demo mode (synthetic data). */
export function DemoBanner() {
  const { data } = useSystemStatus();
  const { colors } = useTheme();
  const { t } = useI18n();
  if (!data?.demoMode) return null;
  return (
    <View testID="demo-banner" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, backgroundColor: colors.demoSoft, paddingVertical: 5, paddingHorizontal: spacing.lg }}>
      <Icon name="mci:flask-outline" size={13} color="demo" />
      <Text variant="micro" weight="medium" color="demo" numberOfLines={1}>
        {t('app.demoModeBanner')}
      </Text>
    </View>
  );
}
