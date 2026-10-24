import { createHash } from 'node:crypto';

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';
export type InspectedImage = { type: ImageType; width: number | null; height: number | null; sha256: string };

/**
 * Identifies an uploaded image from its bytes (never from the declared type or file name) and
 * reads its dimensions from the header. Anything that is not a well-formed JPEG / PNG / WebP is
 * rejected; SVG and other active formats are never accepted.
 */
export function inspectImage(buf: Buffer): InspectedImage | null {
  const type = sniff(buf);
  if (!type) return null;
  const dims = type === 'image/png' ? pngSize(buf) : type === 'image/jpeg' ? jpegSize(buf) : webpSize(buf);
  if (!dims) return null; // a recognised signature without a readable header is not a usable image
  return { type, width: dims.w, height: dims.h, sha256: createHash('sha256').update(buf).digest('hex') };
}

function sniff(b: Buffer): ImageType | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function pngSize(b: Buffer) {
  if (b.length < 24 || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function jpegSize(b: Buffer) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const len = b.readUInt16BE(i + 2);
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

function webpSize(b: Buffer) {
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8 ' && b.length >= 30) return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L' && b.length >= 25) {
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    if (b.length < 30) return null;
    return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  }
  return null;
}
