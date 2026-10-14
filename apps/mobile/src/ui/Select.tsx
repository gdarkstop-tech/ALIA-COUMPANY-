import { radii, spacing, touchTarget } from '@ghayarly/tokens';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Icon } from './Icon';
import { PressableScale } from './Pressable';
import { Sheet } from './Sheet';
import { Text } from './Text';

type Option<T extends string> = { value: T; label: string; description?: string };

export function Select<T extends string>({ label, value, options, onChange, placeholder, optional, error, testID }: { label: string; value: T | null | undefined; options: Option<T>[]; onChange: (v: T) => void; placeholder?: string; optional?: boolean; error?: string | null; testID?: string }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
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
      <PressableScale
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: current?.label ?? '' }}
        onPress={() => setOpen(true)}
        scaleTo={0.99}
        style={{
          minHeight: touchTarget.min + 4,
          borderRadius: radii.md,
          borderWidth: 1,
          borderColor: error ? colors.danger : colors.border,
          backgroundColor: colors.surface,
          paddingHorizontal: spacing.lg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text color={current ? 'text' : 'textTertiary'}>{current?.label ?? placeholder ?? '—'}</Text>
        <Icon name="chevron-down" size={18} color="textTertiary" />
      </PressableScale>
      {error ? (
        <Text variant="caption" color="danger">
          {error}
        </Text>
      ) : null}
      <Sheet visible={open} onClose={() => setOpen(false)} title={label}>
        <View style={{ gap: spacing.xs }}>
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <PressableScale
                key={o.value}
                testID={testID ? `${testID}-option-${o.value}` : undefined}
                accessibilityRole="radio"
                aria-checked={selected}
                onPress={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                scaleTo={0.99}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  minHeight: touchTarget.min,
                  paddingHorizontal: spacing.lg,
                  borderRadius: radii.md,
                  backgroundColor: selected ? colors.primarySoft : 'transparent',
                }}
              >
                <View style={{ flex: 1, paddingVertical: spacing.sm }}>
                  <Text weight={selected ? 'semibold' : 'regular'} color={selected ? 'primarySoftText' : 'text'}>
                    {o.label}
                  </Text>
                  {o.description ? (
                    <Text variant="caption" color="textTertiary">
                      {o.description}
                    </Text>
                  ) : null}
                </View>
                {selected ? <Icon name="check" size={18} color="primary" /> : null}
              </PressableScale>
            );
          })}
        </View>
      </Sheet>
    </View>
  );
}
