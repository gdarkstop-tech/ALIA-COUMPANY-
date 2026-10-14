import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import type { ColorTokens } from '@ghayarly/tokens';
import type { ComponentProps } from 'react';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';

type FeatherName = ComponentProps<typeof Feather>['name'];
type MciName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export type IconName = FeatherName | `mci:${MciName}`;

const MIRRORED: Partial<Record<string, string>> = {
  'chevron-right': 'chevron-left',
  'chevron-left': 'chevron-right',
  'arrow-right': 'arrow-left',
  'arrow-left': 'arrow-right',
};

/** Icon with automatic mirroring of directional glyphs in RTL. `mci:` prefix uses MaterialCommunityIcons. */
export function Icon({ name, size = 20, color = 'text', tint }: { name: IconName; size?: number; color?: keyof ColorTokens; tint?: string }) {
  const { colors } = useTheme();
  const { isRTL } = useI18n();
  const c = tint ?? colors[color];
  if (name.startsWith('mci:')) {
    return <MaterialCommunityIcons name={name.slice(4) as MciName} size={size} color={c} />;
  }
  const resolved = (isRTL ? (MIRRORED[name] ?? name) : name) as FeatherName;
  return <Feather name={resolved} size={size} color={c} />;
}
