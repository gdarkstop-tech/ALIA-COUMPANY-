import { typography, type ColorTokens, type TextVariant } from '@ghayarly/tokens';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { useTheme } from '@/providers/theme';

export type Weight = 'regular' | 'medium' | 'semibold' | 'bold';

export type TextProps = RNTextProps & {
  variant?: TextVariant;
  weight?: Weight;
  color?: keyof ColorTokens;
  align?: 'auto' | 'center';
  tabular?: boolean;
};

const DEFAULT_WEIGHT: Partial<Record<TextVariant, Weight>> = { display: 'bold', title1: 'bold', title2: 'semibold', title3: 'semibold' };

export function Text({ variant = 'body', weight, color = 'text', align = 'auto', tabular, style, ...rest }: TextProps) {
  const { colors } = useTheme();
  const w = weight ?? DEFAULT_WEIGHT[variant] ?? 'regular';
  const base: TextStyle = {
    fontFamily: typography.fontFamily[w],
    fontSize: typography.size[variant],
    lineHeight: typography.lineHeight[variant],
    color: colors[color],
    textAlign: align,
    ...(variant === 'display' || variant === 'title1' ? { letterSpacing: typography.letterSpacing.tight } : {}),
    ...(tabular ? { fontVariant: ['tabular-nums'] } : {}),
  };
  return <RNText {...rest} style={[base, style]} />;
}
