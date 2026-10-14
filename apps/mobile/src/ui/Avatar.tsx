import { palette } from '@ghayarly/tokens';
import { View } from 'react-native';
import { initials } from '@/lib/format';
import { useTheme } from '@/providers/theme';
import { Text } from './Text';

const TINTS = [
  [palette.teal[100], palette.teal[800]],
  [palette.navy[100], palette.navy[700]],
  [palette.sand[100], '#7A532E'],
  ['#E7EEF5', palette.navy[600]],
  ['#E3F1EE', palette.teal[700]],
] as const;
const DARK_TINTS = [
  ['#10302F', palette.teal[200]],
  ['#14273B', palette.navy[200]],
  ['#2A2118', palette.sand[200]],
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
