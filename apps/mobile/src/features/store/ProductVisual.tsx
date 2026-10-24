import { radii } from '@ghayarly/tokens';
import { Image, View } from 'react-native';
import { API_URL } from '@/lib/config';
import { useTheme } from '@/providers/theme';
import { Icon, Text } from '@/ui';

export const productImageUri = (imageId: string) => `${API_URL}/v1/store/images/${imageId}`;

/**
 * Product picture: the brand-supplied image when one has been uploaded and the product is on sale,
 * otherwise a neutral tile that must never look like a real packaging shot.
 */
export function ProductVisual({ height = 120, demo, imageId, alt }: { height?: number; demo?: boolean; imageId?: string | null; alt?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ height, borderRadius: radii.lg, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', gap: 6, overflow: 'hidden' }}>
      {imageId ? (
        <Image source={{ uri: productImageUri(imageId) }} accessibilityLabel={alt} accessible={Boolean(alt)} resizeMode="cover" style={{ position: 'absolute', top: 0, start: 0, end: 0, bottom: 0, width: '100%', height: '100%' }} />
      ) : (
        <>
          <View style={{ position: 'absolute', width: height * 1.4, height: height * 1.4, borderRadius: height, borderWidth: 1, borderColor: colors.surface, opacity: 0.6 }} />
          <Icon name="mci:bandage" size={height * 0.28} color="primary" />
          <Text variant="caption" weight="bold" color="primarySoftText" style={{ letterSpacing: 1.5 }}>
            TETRASOL
          </Text>
        </>
      )}
      {demo ? (
        <View style={{ position: 'absolute', top: 8, end: 8, backgroundColor: colors.demoSoft, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
          <Text variant="micro" weight="bold" color="demo">DEMO</Text>
        </View>
      ) : null}
    </View>
  );
}
