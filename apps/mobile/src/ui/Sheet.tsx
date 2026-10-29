import { layout, radii, spacing } from '@ghayarly/tokens';
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Icon } from './Icon';
import { Text } from './Text';

/** Bottom sheet built on the platform Modal (accessible, works on iOS/Android/web). */
export function Sheet({ visible, onClose, title, children, testID }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode; testID?: string }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityLabel={t('common.close')} onPress={onClose} style={{ flex: 1, backgroundColor: colors.overlay }} />
      <View
        testID={testID}
        accessibilityViewIsModal
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          maxHeight: '85%',
          backgroundColor: colors.backgroundElevated,
          borderTopLeftRadius: radii.xxl,
          borderTopRightRadius: radii.xxl,
          paddingBottom: Math.max(insets.bottom, spacing.lg),
        }}
      >
        {/* flexShrink lets the content scroll inside the 85 % cap instead of overflowing past the screen. */}
        <View style={{ width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center', flexShrink: 1 }}>
          <View style={{ alignItems: 'center', paddingTop: spacing.sm }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong }} />
          </View>
          {title ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingTop: spacing.md }}>
              <Text variant="title3">{title}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} hitSlop={12} testID="sheet-close">
                <Icon name="x" size={22} color="textSecondary" />
              </Pressable>
            </View>
          ) : null}
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
