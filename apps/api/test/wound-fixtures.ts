import * as jpeg from 'jpeg-js';

/** A synthetic photo: a textured pattern (never a real wound or a real person). */
export function testJpeg(w: number, h: number, colour?: (x: number, y: number) => [number, number, number]): Buffer {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b] = colour ? colour(x, y) : [((x * 13) ^ (y * 7)) & 255, (x * 3 + y * 5) & 255, ((x >> 3) + (y >> 3)) % 2 ? 200 : 60];
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return Buffer.from(jpeg.encode({ data, width: w, height: h }, 90).data);
}

/** Inserts extra segments right after SOI. */
export function withSegments(jpg: Buffer, segments: Buffer[]): Buffer {
  return Buffer.concat([jpg.subarray(0, 2), ...segments, jpg.subarray(2)]);
}

/** A minimal EXIF APP1: orientation, DateTimeOriginal (in the Exif IFD) and a fake GPS text tag. */
export function exifBlock(o: { orientation?: number; dateTimeOriginal?: string; gps?: string }): Buffer {
  const entries0: { tag: number; type: number; count: number; value: Buffer | number }[] = [];
  if (o.orientation) entries0.push({ tag: 0x0112, type: 3, count: 1, value: o.orientation });
  if (o.gps) entries0.push({ tag: 0x010e, type: 2, count: o.gps.length + 1, value: Buffer.from(`${o.gps}\0`, 'latin1') }); // ImageDescription
  const hasExif = !!o.dateTimeOriginal;
  const n0 = entries0.length + (hasExif ? 1 : 0);
  const ifd0 = 8;
  const ifd0Size = 2 + n0 * 12 + 4;
  const exifIfd = ifd0 + ifd0Size;
  const exifSize = hasExif ? 2 + 12 + 4 : 0;
  let dataAt = exifIfd + exifSize;
  const tiff = Buffer.alloc(2000);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(ifd0, 4);
  tiff.writeUInt16LE(n0, ifd0);
  let at = ifd0 + 2;
  const writeEntry = (e: { tag: number; type: number; count: number; value: Buffer | number }) => {
    tiff.writeUInt16LE(e.tag, at);
    tiff.writeUInt16LE(e.type, at + 2);
    tiff.writeUInt32LE(e.count, at + 4);
    if (typeof e.value === 'number') tiff.writeUInt16LE(e.value, at + 8);
    else if (e.value.length <= 4) e.value.copy(tiff, at + 8);
    else {
      tiff.writeUInt32LE(dataAt, at + 8);
      e.value.copy(tiff, dataAt);
      dataAt += e.value.length;
    }
    at += 12;
  };
  for (const e of entries0) writeEntry(e);
  if (hasExif) writeEntry({ tag: 0x8769, type: 4, count: 1, value: 0 });
  if (hasExif) tiff.writeUInt32LE(exifIfd, at - 4);
  tiff.writeUInt32LE(0, at);
  if (hasExif) {
    at = exifIfd;
    tiff.writeUInt16LE(1, at);
    at += 2;
    writeEntry({ tag: 0x9003, type: 2, count: 20, value: Buffer.from(`${o.dateTimeOriginal}\0`, 'latin1') });
    tiff.writeUInt32LE(0, at);
  }
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff.subarray(0, dataAt)]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
}
