import { radii } from '@ghayarly/tokens';
import { View } from 'react-native';
import { useTheme } from '@/providers/theme';
import { Icon, Text } from '@/ui';

/**
 * Neutral product tile used until brand-approved photography is supplied. Deliberately
 * abstract: it must never look like a real packaging shot.
 */
export function ProductVisual({ height = 120, demo }: { height?: number; demo?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ height, borderRadius: radii.lg, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', gap: 6, overflow: 'hidden' }}>
      <View style={{ position: 'absolute', width: height * 1.4, height: height * 1.4, borderRadius: height, borderWidth: 1, borderColor: colors.surface, opacity: 0.6 }} />
      <Icon name="mci:bandage" size={height * 0.28} color="primary" />
      <Text variant="caption" weight="bold" color="primarySoftText" style={{ letterSpacing: 1.5 }}>
        TETRASOL
      </Text>
      {demo ? (
        <View style={{ position: 'absolute', top: 8, end: 8, backgroundColor: colors.demoSoft, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
          <Text variant="micro" weight="bold" color="demo">DEMO</Text>
        </View>
      ) : null}
    </View>
  );
}
