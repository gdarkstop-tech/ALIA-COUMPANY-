import { palette } from '@ghayarly/tokens';
import { View } from 'react-native';
import { initials } from '@/lib/format';
import { useTheme } from '@/providers/theme';
import { Text } from './Text';

// Initial avatars: calm brand-adjacent pairs (all ≥ 4.5:1 text contrast). Never orange — that is
// reserved for selections and the hero action.
const TINTS = [
  [palette.navy[100], palette.navy[700]],
  [palette.brass[100], palette.brass[700]],
  [palette.blue[50], palette.blue[600]],
  [palette.green[50], palette.green[600]],
  [palette.stone[100], palette.ink[700]],
] as const;
const DARK_TINTS = [
  ['#14273B', palette.navy[200]],
  ['#231C12', palette.brass[300]],
  ['#10291D', palette.green[300]],
] as const;

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Avatar({ name, size = 44, ring }: { name: string; size?: number; ring?: boolean }) {
  const { scheme, colors } = useTheme();
  const set = scheme === 'dark' ? DARK_TINTS : TINTS;
  const [bg, fg] = set[hash(name) % set.length]!;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: ring ? 2 : 0,
        borderColor: ring ? colors.primary : 'transparent',
      }}
    >
      <Text weight="semibold" style={{ color: fg, fontSize: size * 0.36, lineHeight: size * 0.5 }}>
        {initials(name).toUpperCase()}
      </Text>
    </View>
  );
}
