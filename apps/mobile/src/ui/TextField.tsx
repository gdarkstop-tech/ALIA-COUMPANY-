import { radii, spacing, touchTarget, typography } from '@ghayarly/tokens';
import { forwardRef, useState } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Icon } from './Icon';
import { Text } from './Text';

type Props = TextInputProps & {
  label: string;
  hint?: string;
  error?: string | null;
  optional?: boolean;
  /** Force LTR for values like email, phone, dates or IDs even in Arabic UI. */
  ltr?: boolean;
};

export const TextField = forwardRef<TextInput, Props>(function TextField({ label, hint, error, optional, secureTextEntry, ltr, style, multiline, onFocus, onBlur, ...rest }, ref) {
  const { colors } = useTheme();
  const { t, isRTL } = useI18n();
  const [focused, setFocused] = useState(false);
  const [reveal, setReveal] = useState(false);
  const borderColor = error ? colors.danger : focused ? colors.primary : colors.border;
  return (
    <View style={{ gap: spacing.xs + 2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="footnote" weight="semibold" color="textSecondary">
          {label}
        </Text>
        {optional ? (
          <Text variant="caption" color="textTertiary">
            {t('common.optional')}
          </Text>
        ) : null}
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          minHeight: multiline ? 96 : touchTarget.min + 4,
          borderRadius: radii.md,
          borderWidth: focused ? 1.5 : 1,
          borderColor,
          backgroundColor: colors.surface,
          paddingHorizontal: spacing.lg,
        }}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={colors.textTertiary}
          {...rest}
          secureTextEntry={secureTextEntry && !reveal}
          multiline={multiline}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            {
              flex: 1,
              fontFamily: typography.fontFamily.regular,
              fontSize: typography.size.body,
              color: colors.text,
              paddingVertical: spacing.md,
              textAlign: ltr ? 'left' : isRTL ? 'right' : 'left',
              writingDirection: ltr ? 'ltr' : isRTL ? 'rtl' : 'ltr',
              outlineStyle: 'none',
            } as never,
            style,
          ]}
        />
        {secureTextEntry ? (
          <Pressable accessibilityRole="button" accessibilityLabel={reveal ? 'Hide password' : 'Show password'} hitSlop={12} onPress={() => setReveal((v) => !v)}>
            <Icon name={reveal ? 'eye-off' : 'eye'} size={18} color="textTertiary" />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color="textTertiary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});
