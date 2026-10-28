/**
 * Wound photo processing, encrypted object storage, signed media links and export writers
 * (ADR 0015). Pure units: no database.
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import * as jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertObjectKey, decryptObject, encryptObject, LocalEncryptedStore } from '../src/integrations/storage';
import { renderCasePdf, zipStore } from '../src/lib/export-files';
import { signMediaLink, verifyMediaLink } from '../src/lib/media-links';
import { processWoundImage, WoundImageError } from '../src/lib/wound-images';
import { exifBlock, testJpeg, withSegments } from './wound-fixtures';

describe('wound photo processing', () => {
  it('removes location, device and comment metadata from the original without touching a pixel', () => {
    const plain = testJpeg(640, 480);
    const tagged = withSegments(plain, [exifBlock({ orientation: 1, dateTimeOriginal: '2026:10:20 09:15:00', gps: 'GPS 30.0444N 31.2357E' }), xmp(), comment('Patient: Hoda Mahmoud')]);
    const p = processWoundImage(tagged, new Date('2026-10-28T00:00:00Z'));
    expect(p.contentType).toBe('image/jpeg');
    expect(p.metadataRemoved.sort()).toEqual(['COMMENT', 'EXIF', 'XMP']);
    const text = p.original.toString('latin1');
    expect(text).not.toContain('GPS');
    expect(text).not.toContain('Hoda');
    expect(text).not.toContain('Exif');
    // Same compressed image data: the original is not re-encoded.
    expect(p.original.equals(plain)).toBe(true);
    expect(p.cameraTakenAt).toBe('2026-10-20T09:15:00.000Z');
    expect(p.derived.toString('latin1')).not.toContain('Exif');
    expect(p.derivedWidth).toBe(640);
  });

  it('keeps only the orientation of a rotated phone photo and applies it to the derivative', () => {
    const p = processWoundImage(withSegments(testJpeg(1600, 900), [exifBlock({ orientation: 6, gps: 'GPS-SECRET' })]));
    expect(p.orientation).toBe(6);
    expect(p.original.toString('latin1')).not.toContain('GPS-SECRET');
    expect(p.original.toString('latin1')).toContain('Exif'); // orientation-only block
    expect([p.width, p.height]).toEqual([900, 1600]);
    expect([p.derivedWidth, p.derivedHeight]).toEqual([576, 1024]);
    const d = jpeg.decode(p.derived, { useTArray: true });
    expect([d.width, d.height]).toEqual([576, 1024]);
  });

  it('ignores an implausible camera clock', () => {
    const p = processWoundImage(withSegments(testJpeg(200, 200), [exifBlock({ dateTimeOriginal: '2099:01:01 00:00:00' })]), new Date('2026-10-28T00:00:00Z'));
    expect(p.cameraTakenAt).toBeNull();
  });

  it('removes PNG text chunks', () => {
    const png = new PNG({ width: 64, height: 48 });
    for (let i = 0; i < png.data.length; i++) png.data[i] = i % 4 === 3 ? 255 : (i * 7) % 256;
    const raw = PNG.sync.write(png);
    const text = Buffer.from('tEXtAuthor\0Hoda Mahmoud', 'latin1');
    const chunk = Buffer.alloc(12 + text.length - 4);
    chunk.writeUInt32BE(text.length - 4, 0);
    text.copy(chunk, 4);
    chunk.writeUInt32BE(crc32(text) >>> 0, 4 + text.length);
    const tagged = Buffer.concat([raw.subarray(0, 33), chunk, raw.subarray(33)]);
    const p = processWoundImage(tagged);
    expect(p.contentType).toBe('image/png');
    expect(p.metadataRemoved).toEqual(['PNG_TEXT']);
    expect(p.original.toString('latin1')).not.toContain('Hoda');
    expect(PNG.sync.read(p.original).data.equals(PNG.sync.read(raw).data)).toBe(true);
  });

  it('refuses anything that is not a readable JPEG or PNG', () => {
    const webp = Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'), Buffer.alloc(40)]);
    for (const bad of [Buffer.from('%PDF-1.4 not an image %%EOF'), webp, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), testJpeg(100, 100).subarray(0, 300)]) {
      expect(() => processWoundImage(bad)).toThrow(WoundImageError);
    }
    expect(() => processWoundImage(Buffer.alloc(13 * 1024 * 1024))).toThrow('IMAGE_TOO_LARGE');
  });

  it('gives photo-quality hints (not a medical assessment)', () => {
    expect(processWoundImage(testJpeg(800, 600, () => [8, 8, 8])).quality.warnings).toContain('TOO_DARK');
    expect(processWoundImage(testJpeg(800, 600, () => [128, 128, 128])).quality.warnings).toContain('BLURRY');
    expect(processWoundImage(testJpeg(320, 240)).quality.warnings).toContain('LOW_RESOLUTION');
    expect(processWoundImage(testJpeg(800, 600)).quality.warnings).toEqual([]);
  });
});

describe('encrypted object storage', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dmw-objects-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('stores ciphertext only, bound to its key, and deletes idempotently', async () => {
    const key = randomBytes(32);
    const store = new LocalEncryptedStore(dir, key);
    const body = Buffer.from('JFIF fake photo bytes with a recognisable marker ZZZ-PATIENT-ZZZ');
    await store.put('w/11111111-1111-4111-8111-111111111111.o', body);
    const files = await readdir(join(dir, 'w'));
    expect(files).toEqual(['11111111-1111-4111-8111-111111111111.o']);
    const onDisk = await readFile(join(dir, 'w', files[0]!));
    expect(onDisk.includes(Buffer.from('ZZZ-PATIENT-ZZZ'))).toBe(false);
    expect((await store.get('w/11111111-1111-4111-8111-111111111111.o')).equals(body)).toBe(true);
    // Moved to another key, or read with another master key: refused.
    expect(() => decryptObject(key, 'w/22222222-2222-4222-8222-222222222222.o', onDisk)).toThrow();
    expect(() => decryptObject(randomBytes(32), 'w/11111111-1111-4111-8111-111111111111.o', onDisk)).toThrow();
    const sealed = encryptObject(key, 'r/33333333-3333-4333-8333-333333333333.j', body);
    sealed[sealed.length - 1]! ^= 1;
    expect(() => decryptObject(key, 'r/33333333-3333-4333-8333-333333333333.j', sealed)).toThrow();
    await store.delete('w/11111111-1111-4111-8111-111111111111.o');
    await store.delete('w/11111111-1111-4111-8111-111111111111.o');
    expect(await readdir(join(dir, 'w'))).toEqual([]);
  });

  it('refuses keys it did not generate (no path traversal)', () => {
    for (const k of ['../etc/passwd', 'w/../../x', 'w/abc.o', '/w/11111111-1111-4111-8111-111111111111.o']) expect(() => assertObjectKey(k)).toThrow();
  });
});

describe('signed media links', () => {
  const key = randomBytes(32);
  const claim = { k: 'vault' as const, id: '11111111-1111-4111-8111-111111111111', v: 'derived' as const, u: 'user-1' };
  it('verify only untampered, unexpired links', () => {
    const { token } = signMediaLink(key, claim);
    expect(verifyMediaLink(key, token)).toMatchObject(claim);
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...claim, u: 'someone-else', exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url');
    expect(verifyMediaLink(key, `${forged}.${sig}`)).toBeNull();
    expect(verifyMediaLink(randomBytes(32), token)).toBeNull();
    expect(verifyMediaLink(key, `${body}.${sig}.x`)).toBeNull();
    const old = signMediaLink(key, claim, Date.now() - 10 * 60_000).token;
    expect(verifyMediaLink(key, old)).toBeNull();
  });
});

describe('export writers', () => {
  it('ZIP: a valid stored archive with correct CRCs', () => {
    const files = [{ name: 'images/01-day-1.jpg', data: testJpeg(50, 40) }, { name: 'captions.txt', data: Buffer.from('EN: Day 1\nAR: اليوم ١', 'utf8') }];
    const zip = zipStore(files);
    const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(zip.readUInt16LE(end + 10)).toBe(2);
    let at = zip.readUInt32LE(end + 16);
    for (const f of files) {
      expect(zip.readUInt32LE(at)).toBe(0x02014b50);
      const nameLen = zip.readUInt16LE(at + 28);
      expect(zip.toString('utf8', at + 46, at + 46 + nameLen)).toBe(f.name);
      expect(zip.readUInt32LE(at + 16)).toBe(crc32(f.data) >>> 0);
      const local = zip.readUInt32LE(at + 42);
      const data = zip.subarray(local + 30 + nameLen, local + 30 + nameLen + f.data.length);
      expect(data.equals(f.data)).toBe(true);
      at += 46 + nameLen;
    }
    expect(() => zipStore([{ name: '../evil', data: Buffer.alloc(1) }])).toThrow();
  });

  it('PDF: a text page and one page per photo', () => {
    const pdf = renderCasePdf('Case study', ['Paragraph one.', 'Paragraph two.'], [{ jpeg: testJpeg(80, 60), width: 80, height: 60, caption: 'Day 1' }, { jpeg: testJpeg(80, 60), width: 80, height: 60, caption: 'Day 7' }]);
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 3');
    expect(text.match(/\/Subtype \/Image/g)).toHaveLength(2);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const xref = Number(text.slice(text.lastIndexOf('startxref') + 10).trim().split('\n')[0]);
    expect(text.slice(xref, xref + 4)).toBe('xref');
  });
});

function xmp() {
  const body = Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta><rdf:Description GPSLatitude="30.04"/></x:xmpmeta>', 'latin1');
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
}
function comment(text: string) {
  const body = Buffer.from(text, 'latin1');
  const head = Buffer.from([0xff, 0xfe, 0, 0]);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
}
