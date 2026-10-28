import { layout, spacing } from '@ghayarly/tokens';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Wordmark } from './brand/BrandMark';
import { DemoBanner } from './DemoBanner';
import { Icon } from './Icon';
import { PressableScale } from './Pressable';
import { Text } from './Text';

type ScreenProps = {
  children: ReactNode;
  scroll?: boolean;
  header?: ReactNode;
  footer?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  edges?: ('top' | 'bottom')[];
  testID?: string;
};

/** Page container: safe areas, warm background, centred max-width column on large screens. */
export function Screen({ children, scroll = true, header, footer, refreshing, onRefresh, contentStyle, edges = ['top'], testID }: ScreenProps) {
  const { colors } = useTheme();
  const content = (
    // Without page scrolling the content takes the remaining height, so an inner list (e.g. a chat)
    // scrolls within it instead of running under the footer.
    <View style={[{ width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center', paddingHorizontal: layout.screenPadding, gap: spacing.xl, paddingBottom: scroll ? spacing['4xl'] : 0 }, scroll ? null : { flex: 1, minHeight: 0 }, contentStyle]}>
      {children}
    </View>
  );
  return (
    <SafeAreaView testID={testID} edges={edges} style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <DemoBanner />
        {header ? <View style={{ width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center', paddingHorizontal: layout.screenPadding }}>{header}</View> : null}
        {scroll ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingTop: spacing.sm }}
            refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined}
          >
            {content}
          </ScrollView>
        ) : (
          <View style={{ flex: 1 }}>{content}</View>
        )}
        {footer ? (
          <View style={{ borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.backgroundElevated }}>
            <View style={{ width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center', padding: layout.screenPadding }}>{footer}</View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** `brand`: shows the official wordmark above the title (entry screens: sign in, sign up). */
type HeaderProps = { title: string; subtitle?: string; back?: boolean; right?: ReactNode; large?: boolean; eyebrow?: string; brand?: boolean };

export function Header({ title, subtitle, back, right, large = true, eyebrow, brand }: HeaderProps) {
  const router = useRouter();
  const { t } = useI18n();
  return (
    <View style={{ paddingTop: spacing.md, paddingBottom: spacing.md, gap: spacing.md }}>
      {back || right ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
          {back ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
              testID="header-back"
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
              style={{ width: 44, height: 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="chevron-left" size={26} />
            </PressableScale>
          ) : (
            <View />
          )}
          {right ?? <View />}
        </View>
      ) : null}
      {brand ? <Wordmark width={184} /> : null}
      <View style={{ gap: spacing.xs }}>
        {eyebrow ? (
          <Text variant="footnote" weight="semibold" color="primary">
            {eyebrow}
          </Text>
        ) : null}
        <Text variant={large ? 'title1' : 'title2'} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="callout" color="textSecondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function Section({ title, action, children, testID }: { title?: string; action?: ReactNode; children: ReactNode; testID?: string }) {
  return (
    <View style={{ gap: spacing.md }} testID={testID}>
      {title || action ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {title ? (
            <Text variant="title3" accessibilityRole="header">
              {title}
            </Text>
          ) : (
            <View />
          )}
          {action}
        </View>
      ) : null}
      {children}
    </View>
  );
}
