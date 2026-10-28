import { createHash } from 'node:crypto';
import * as jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import type { WoundImageQuality, WoundPhotoWarning } from '@ghayarly/shared';
import { inspectImage } from './images';

/**
 * Wound photo processing (ADR 0015). Deterministic code only — nothing here judges the wound.
 *
 *   * The stored ORIGINAL keeps every pixel exactly as captured (never re-encoded, never edited);
 *     only metadata is removed: EXIF (location, device, owner), XMP, IPTC, comments, PNG text chunks.
 *     A JPEG's orientation is kept as a minimal EXIF block holding nothing else, so it still displays
 *     upright.
 *   * The DERIVATIVE used for viewing, comparison, research and presentations is re-encoded from the
 *     pixels (≤ 1024 px, orientation applied, JPEG, no metadata at all).
 *   * Photo-quality hints (too dark, too bright, blurry, small) help the person retake a photo. They
 *     are heuristics about the photograph, not a medical assessment.
 */
export const WOUND_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
const MAX_PIXELS = 50_000_000;
const DERIVED_MAX_SIDE = 1024;

export type ProcessedWoundImage = {
  contentType: 'image/jpeg' | 'image/png';
  original: Buffer;
  originalSha256: string;
  /** Upright dimensions of the original. */
  width: number;
  height: number;
  derived: Buffer;
  derivedSha256: string;
  derivedWidth: number;
  derivedHeight: number;
  orientation: number;
  /** DateTimeOriginal from the camera, when present and plausible (the device clock may be wrong). */
  cameraTakenAt: string | null;
  metadataRemoved: string[];
  quality: WoundImageQuality;
};

export class WoundImageError extends Error {
  constructor(readonly code: 'IMAGE_TYPE_INVALID' | 'IMAGE_TOO_LARGE' | 'IMAGE_UNREADABLE') {
    super(code);
  }
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export function processWoundImage(buf: Buffer, now = new Date()): ProcessedWoundImage {
  if (buf.length > WOUND_IMAGE_MAX_BYTES) throw new WoundImageError('IMAGE_TOO_LARGE');
  const inspected = inspectImage(buf);
  // WebP / HEIC are not accepted here: the API cannot decode them to build the derivative.
  if (!inspected || (inspected.type !== 'image/jpeg' && inspected.type !== 'image/png')) throw new WoundImageError('IMAGE_TYPE_INVALID');
  if (!inspected.width || !inspected.height || inspected.width * inspected.height > MAX_PIXELS) throw new WoundImageError('IMAGE_TOO_LARGE');

  let original: Buffer;
  let removed: string[];
  let orientation = 1;
  let cameraTakenAt: string | null = null;
  let rgba: { width: number; height: number; data: Uint8Array };
  try {
    if (inspected.type === 'image/jpeg') {
      const stripped = stripJpeg(buf);
      original = stripped.bytes;
      removed = stripped.removed;
      orientation = stripped.orientation;
      cameraTakenAt = plausibleDate(stripped.dateTimeOriginal, now);
      rgba = jpeg.decode(original, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 50, maxMemoryUsageInMB: 800 });
    } else {
      const stripped = stripPng(buf);
      original = stripped.bytes;
      removed = stripped.removed;
      const png = PNG.sync.read(original);
      rgba = { width: png.width, height: png.height, data: png.data };
    }
  } catch (e) {
    if (e instanceof WoundImageError) throw e;
    throw new WoundImageError('IMAGE_UNREADABLE');
  }

  const scale = Math.min(1, DERIVED_MAX_SIDE / Math.max(rgba.width, rgba.height));
  const small = downscale(rgba, Math.max(1, Math.round(rgba.width * scale)), Math.max(1, Math.round(rgba.height * scale)));
  const upright = orient(small, orientation);
  const derived = Buffer.from(jpeg.encode({ data: upright.data, width: upright.width, height: upright.height }, 85).data);
  const swap = orientation >= 5 && orientation <= 8;
  const width = swap ? rgba.height : rgba.width;
  const height = swap ? rgba.width : rgba.height;

  return {
    contentType: inspected.type,
    original,
    originalSha256: sha256(original),
    width,
    height,
    derived,
    derivedSha256: sha256(derived),
    derivedWidth: upright.width,
    derivedHeight: upright.height,
    orientation,
    cameraTakenAt,
    metadataRemoved: removed,
    quality: photoQuality(upright, Math.min(width, height)),
  };
}

/** Re-encodes an already-derived JPEG (research / presentation copies get fresh bytes, no metadata). */
export function reencodeDerived(derived: Buffer): Buffer {
  const img = jpeg.decode(derived, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 2 });
  return Buffer.from(jpeg.encode({ data: img.data, width: img.width, height: img.height }, 85).data);
}

// ---------------------------------------------------------------- JPEG metadata removal
type StrippedJpeg = { bytes: Buffer; removed: string[]; orientation: number; dateTimeOriginal: string | null };

/** Segments kept: JFIF (APP0), ICC colour profile (APP2), Adobe colour transform (APP14) and every non-APP segment. */
function stripJpeg(b: Buffer): StrippedJpeg {
  const keep: Buffer[] = [b.subarray(0, 2)];
  const removed = new Set<string>();
  let orientation = 1;
  let dateTimeOriginal: string | null = null;
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) throw new WoundImageError('IMAGE_UNREADABLE');
    let m = b[i + 1]!;
    while (m === 0xff && i + 2 < b.length) m = b[++i + 1]!; // fill bytes
    if (m === 0xd9) {
      keep.push(b.subarray(i, i + 2));
      break;
    }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      keep.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > b.length) throw new WoundImageError('IMAGE_UNREADABLE');
    const len = b.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > b.length) throw new WoundImageError('IMAGE_UNREADABLE');
    const seg = b.subarray(i, i + 2 + len);
    if (m === 0xda) {
      // Start of scan: the compressed image data runs to the end; copied untouched.
      keep.push(b.subarray(i));
      break;
    }
    const isApp = m >= 0xe0 && m <= 0xef;
    if (m === 0xfe) removed.add('COMMENT');
    else if (isApp && m !== 0xe0 && m !== 0xe2 && m !== 0xee) {
      const payload = seg.subarray(4);
      if (m === 0xe1 && payload.toString('latin1', 0, 6) === 'Exif\0\0') {
        const exif = readExif(payload.subarray(6));
        if (exif.orientation) orientation = exif.orientation;
        dateTimeOriginal = exif.dateTimeOriginal ?? dateTimeOriginal;
        removed.add('EXIF');
      } else if (m === 0xe1) removed.add('XMP');
      else if (m === 0xed) removed.add('IPTC');
      else removed.add(`APP${m - 0xe0}`);
    } else keep.push(seg);
    i += 2 + len;
  }
  // After the JFIF header when there is one (JFIF expects to come first).
  if (orientation !== 1) keep.splice(keep[1]?.[1] === 0xe0 ? 2 : 1, 0, orientationOnlyExif(orientation));
  return { bytes: Buffer.concat(keep), removed: [...removed], orientation, dateTimeOriginal };
}

function readExif(t: Buffer): { orientation: number | null; dateTimeOriginal: string | null } {
  const out = { orientation: null as number | null, dateTimeOriginal: null as string | null };
  if (t.length < 8) return out;
  const le = t.toString('latin1', 0, 2) === 'II';
  if (!le && t.toString('latin1', 0, 2) !== 'MM') return out;
  const u16 = (o: number) => (o + 2 <= t.length ? (le ? t.readUInt16LE(o) : t.readUInt16BE(o)) : 0);
  const u32 = (o: number) => (o + 4 <= t.length ? (le ? t.readUInt32LE(o) : t.readUInt32BE(o)) : 0);
  const entries = (ifd: number) => {
    const n = u16(ifd);
    const list: { tag: number; type: number; count: number; at: number }[] = [];
    for (let k = 0; k < Math.min(n, 200); k++) {
      const at = ifd + 2 + k * 12;
      if (at + 12 > t.length) break;
      list.push({ tag: u16(at), type: u16(at + 2), count: u32(at + 4), at });
    }
    return list;
  };
  let exifIfd = 0;
  for (const e of entries(u32(4))) {
    if (e.tag === 0x0112 && e.type === 3) {
      const v = u16(e.at + 8);
      if (v >= 1 && v <= 8) out.orientation = v;
    }
    if (e.tag === 0x8769) exifIfd = u32(e.at + 8);
  }
  if (exifIfd > 0 && exifIfd < t.length) {
    for (const e of entries(exifIfd)) {
      if (e.tag === 0x9003 && e.type === 2 && e.count >= 19) {
        const off = u32(e.at + 8);
        if (off + 19 <= t.length) out.dateTimeOriginal = t.toString('latin1', off, off + 19);
      }
    }
  }
  return out;
}

/** An APP1 block with a single tag: Orientation. */
function orientationOnlyExif(orientation: number): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(0x0112, 10);
  tiff.writeUInt16BE(3, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(orientation, 18);
  tiff.writeUInt32BE(0, 22);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
}

function plausibleDate(v: string | null, now: Date): string | null {
  const m = v?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!));
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2000 || d.getTime() > now.getTime() + 36 * 3600_000) return null;
  return d.toISOString();
}

// ---------------------------------------------------------------- PNG metadata removal
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT']);
function stripPng(b: Buffer): { bytes: Buffer; removed: string[] } {
  const keep: Buffer[] = [b.subarray(0, 8)];
  const removed = new Set<string>();
  let i = 8;
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i);
    const type = b.toString('latin1', i + 4, i + 8);
    const end = i + 12 + len;
    if (end > b.length) throw new WoundImageError('IMAGE_UNREADABLE');
    const critical = type.charCodeAt(0) >= 65 && type.charCodeAt(0) <= 90;
    if (PNG_KEEP.has(type) || critical) keep.push(b.subarray(i, end));
    else removed.add(['tEXt', 'zTXt', 'iTXt'].includes(type) ? 'PNG_TEXT' : type === 'eXIf' ? 'EXIF' : type);
    i = end;
    if (type === 'IEND') break;
  }
  return { bytes: Buffer.concat(keep), removed: [...removed] };
}

// ---------------------------------------------------------------- pixels
type Rgba = { width: number; height: number; data: Uint8Array };

/** Area-average downscale; transparent areas are composited on white. */
function downscale(src: Rgba, tw: number, th: number): Rgba {
  if (tw === src.width && th === src.height) return flatten(src);
  const acc = new Float64Array(tw * th * 4);
  const xs = new Int32Array(src.width);
  for (let x = 0; x < src.width; x++) xs[x] = Math.min(tw - 1, Math.floor((x * tw) / src.width));
  const d = src.data;
  for (let y = 0; y < src.height; y++) {
    const row = Math.min(th - 1, Math.floor((y * th) / src.height)) * tw;
    for (let x = 0; x < src.width; x++) {
      const s = (y * src.width + x) * 4;
      const t = (row + xs[x]!) * 4;
      const a = d[s + 3]! / 255;
      acc[t] = acc[t]! + d[s]! * a + 255 * (1 - a);
      acc[t + 1] = acc[t + 1]! + d[s + 1]! * a + 255 * (1 - a);
      acc[t + 2] = acc[t + 2]! + d[s + 2]! * a + 255 * (1 - a);
      acc[t + 3] = acc[t + 3]! + 1;
    }
  }
  const out = new Uint8Array(tw * th * 4);
  for (let p = 0; p < tw * th; p++) {
    const n = acc[p * 4 + 3] || 1;
    out[p * 4] = Math.round(acc[p * 4]! / n);
    out[p * 4 + 1] = Math.round(acc[p * 4 + 1]! / n);
    out[p * 4 + 2] = Math.round(acc[p * 4 + 2]! / n);
    out[p * 4 + 3] = 255;
  }
  return { width: tw, height: th, data: out };
}

function flatten(src: Rgba): Rgba {
  const out = new Uint8Array(src.data.length);
  for (let s = 0; s < src.data.length; s += 4) {
    const a = src.data[s + 3]! / 255;
    for (let c = 0; c < 3; c++) out[s + c] = Math.round(src.data[s + c]! * a + 255 * (1 - a));
    out[s + 3] = 255;
  }
  return { width: src.width, height: src.height, data: out };
}

/** Applies an EXIF orientation (1–8) to the pixels. */
function orient(src: Rgba, o: number): Rgba {
  if (o <= 1 || o > 8) return src;
  const { width: w, height: h } = src;
  const swap = o >= 5;
  const ow = swap ? h : w;
  const oh = swap ? w : h;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx: number;
      let ny: number;
      switch (o) {
        case 2: nx = w - 1 - x; ny = y; break;
        case 3: nx = w - 1 - x; ny = h - 1 - y; break;
        case 4: nx = x; ny = h - 1 - y; break;
        case 5: nx = y; ny = x; break;
        case 6: nx = h - 1 - y; ny = x; break;
        case 7: nx = h - 1 - y; ny = w - 1 - x; break;
        default: nx = y; ny = w - 1 - x; break; // 8
      }
      const s = (y * w + x) * 4;
      const t = (ny * ow + nx) * 4;
      out[t] = src.data[s]!;
      out[t + 1] = src.data[s + 1]!;
      out[t + 2] = src.data[s + 2]!;
      out[t + 3] = 255;
    }
  }
  return { width: ow, height: oh, data: out };
}

/** Brightness (mean luma) and sharpness (variance of the Laplacian) on the derivative. */
export function photoQuality(img: Rgba, shortSide: number): WoundImageQuality {
  const { width: w, height: h, data } = img;
  const luma = new Float32Array(w * h);
  let sum = 0;
  for (let p = 0; p < w * h; p++) {
    const v = 0.299 * data[p * 4]! + 0.587 * data[p * 4 + 1]! + 0.114 * data[p * 4 + 2]!;
    luma[p] = v;
    sum += v;
  }
  const brightness = sum / (w * h);
  let n = 0;
  let mean = 0;
  let m2 = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const lap = luma[p - 1]! + luma[p + 1]! + luma[p - w]! + luma[p + w]! - 4 * luma[p]!;
      n++;
      const delta = lap - mean;
      mean += delta / n;
      m2 += delta * (lap - mean);
    }
  }
  const sharpness = n > 1 ? m2 / (n - 1) : 0;
  const warnings: WoundPhotoWarning[] = [];
  if (brightness < 55) warnings.push('TOO_DARK');
  if (brightness > 225) warnings.push('TOO_BRIGHT');
  if (sharpness < 20) warnings.push('BLURRY');
  if (shortSide < 480) warnings.push('LOW_RESOLUTION');
  return { brightness: Math.round(brightness), sharpness: Math.round(sharpness * 10) / 10, warnings };
}
