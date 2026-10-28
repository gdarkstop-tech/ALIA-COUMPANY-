import { radii } from '@ghayarly/tokens';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Image, View, type DimensionValue } from 'react-native';
import { api } from '@/lib/api';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Icon, PressableScale, Text } from '@/ui';

/**
 * One wound photo, through a short-lived signed link minted on demand (each one audited). The link
 * is kept in memory only, for less than its lifetime, and never stored on the device.
 */
export function WoundPhoto({ imageId, label, aspect = 4 / 3, width = '100%', testID }: { imageId: string; label: string; aspect?: number; width?: DimensionValue; testID?: string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const link = useQuery({ queryKey: ['wounds', 'link', imageId], queryFn: () => api.wounds.imageLink(imageId), staleTime: 90_000, gcTime: 100_000 });
  const retry = () => {
    setFailed(false);
    void link.refetch();
  };
  return (
    <View testID={testID} style={{ width, aspectRatio: aspect, borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
      {link.data && !failed ? (
        <Image
          source={{ uri: link.data.url }}
          accessibilityLabel={label}
          accessible
          resizeMode="cover"
          onError={() => setFailed(true)}
          style={{ position: 'absolute', top: 0, start: 0, end: 0, bottom: 0, width: '100%', height: '100%' }}
        />
      ) : link.isPending ? (
        <ActivityIndicator accessibilityLabel={t('wounds.photoLoading')} color={colors.primary} />
      ) : (
        <PressableScale accessibilityRole="button" accessibilityLabel={t('wounds.photoExpired')} onPress={retry} style={{ alignItems: 'center', gap: 4, padding: 8 }}>
          <Icon name="refresh-cw" color="textTertiary" />
          <Text variant="caption" color="textTertiary" align="center">{t('wounds.photoExpired')}</Text>
        </PressableScale>
      )}
    </View>
  );
}
