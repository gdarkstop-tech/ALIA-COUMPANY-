import { crc32 } from 'node:zlib';

/**
 * Minimal writers for the approved-presentation export (ADR 0015): a ZIP image package (stored, not
 * compressed — JPEGs do not compress further) and a one-case PDF. Both are built only from the
 * approved snapshot of a presentation case; no patient identifier is ever passed in.
 */
export type ZipEntry = { name: string; data: Buffer };

export function zipStore(entries: ZipEntry[], date = new Date()): Buffer {
  const dosTime = ((date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2)) & 0xffff;
  const dosDate = (((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate()) & 0xffff;
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    if (!/^[A-Za-z0-9._/-]{1,120}$/.test(e.name) || e.name.includes('..')) throw new Error('Invalid entry name');
    const name = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, e.data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(e.data.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + e.data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

export type PdfImage = { jpeg: Buffer; width: number; height: number; caption: string };

const pdfText = (s: string) => s.replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');

function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n+/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if ((line + ' ' + word).trim().length > max) {
        if (line) out.push(line);
        line = word.slice(0, max);
      } else line = (line + ' ' + word).trim();
    }
    out.push(line);
  }
  return out;
}

/**
 * One A4 page of text (title + paragraphs, Helvetica, ASCII only: the writer has no Arabic shaping —
 * Arabic captions travel in the image package instead) followed by one page per photo.
 */
export function renderCasePdf(title: string, paragraphs: string[], images: PdfImage[]): Buffer {
  const objects: (string | Buffer)[] = [];
  const add = (o: string | Buffer) => objects.push(o) && objects.length;
  const catalog = add('');
  const pages = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds: number[] = [];
  const page = (content: string, xobjects: string) => {
    const stream = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >>${xobjects} >> /Contents ${stream} 0 R >>`));
  };
  const lines = [...wrap(title, 70).map((l) => ({ l, size: 16 })), { l: '', size: 11 }, ...paragraphs.flatMap((p) => [...wrap(p, 95).map((l) => ({ l, size: 10 })), { l: '', size: 10 }])];
  let y = 800;
  const text = lines
    .slice(0, 60)
    .map(({ l, size }) => {
      const t = `BT /F1 ${size} Tf 40 ${y} Td (${pdfText(l)}) Tj ET`;
      y -= size + 5;
      return t;
    })
    .join('\n');
  page(text, '');
  images.forEach((img, i) => {
    const xo = add(Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`, 'latin1'),
      img.jpeg,
      Buffer.from('\nendstream', 'latin1'),
    ]));
    const scale = Math.min(515 / img.width, 700 / img.height);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const content = `q ${w} 0 0 ${h} 40 ${800 - h} cm /Im${i} Do Q\n${wrap(img.caption, 95).slice(0, 4).map((l, k) => `BT /F1 10 Tf 40 ${780 - h - k * 14} Td (${pdfText(l)}) Tj ET`).join('\n')}`;
    page(content, ` /XObject << /Im${i} ${xo} 0 R >>`);
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
  objects[pages - 1] = `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let length = parts[0]!.length;
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), typeof o === 'string' ? Buffer.from(o, 'latin1') : o, Buffer.from('\nendobj\n', 'latin1')]);
    parts.push(chunk);
    length += chunk.length;
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}
