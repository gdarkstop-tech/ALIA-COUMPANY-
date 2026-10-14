import { Image } from 'react-native';

export function BrandMark({ size = 64 }: { size?: number }) {
  return <Image source={require('../../../assets/mark.png')} style={{ width: size, height: size, borderRadius: size * 0.23 }} accessibilityIgnoresInvertColors />;
}
