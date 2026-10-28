import { createHash } from 'node:crypto';
import type { DocumentContentType, SyntheticLabReportSpec } from '@ghayarly/shared';
import { inspectImage } from './images';

/**
 * Identifies an uploaded medical document from its bytes (never from the declared type or name):
 * a PDF (`%PDF-` header and an end-of-file marker) or a well-formed JPEG / PNG / WebP image.
 */
export function inspectDocument(buf: Buffer): { type: DocumentContentType; sha256: string } | null {
  const sha256 = createHash('sha256').update(buf).digest('hex');
  if (buf.length >= 8 && buf.toString('latin1', 0, 5) === '%PDF-') {
    // A truncated upload has no %%EOF near the end.
    return buf.subarray(Math.max(0, buf.length - 2048)).includes('%%EOF') ? { type: 'application/pdf', sha256 } : null;
  }
  const img = inspectImage(buf);
  return img ? { type: img.type, sha256 } : null;
}

/** A synthetic report used by the evaluation suite (never a real record). */
export type SyntheticLabReport = SyntheticLabReportSpec;

const pdfText = (s: string) => s.replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');
const pad = (s: string, n: number) => (s.length >= n ? `${s.slice(0, n - 1)} ` : s + ' '.repeat(n - s.length));

/**
 * Renders a one-page PDF (Courier, ASCII only — the renderer has no Arabic shaping) from a
 * synthetic report definition, so extraction can be evaluated against known values.
 */
export function renderSyntheticLabPdf(r: SyntheticLabReport): Buffer {
  const lines = [
    'LABORATORY REPORT - SYNTHETIC TEST FIXTURE (NOT A REAL PATIENT)',
    r.labName ? `Laboratory: ${r.labName}` : '',
    'Patient: Test Patient (synthetic)    ID: 000000',
    r.collectedOn ? `Collected: ${r.collectedOn}` : '',
    '',
  ];
  if (r.rows.length) {
    lines.push(`${pad('Test', 26)}${pad('Result', 10)}${pad('Unit', 16)}${pad('Reference range', 18)}Flag`, '-'.repeat(76));
    for (const row of r.rows) lines.push(`${pad(row.test, 26)}${pad(row.value, 10)}${pad(row.unit ?? '', 16)}${pad(row.range ?? '', 18)}${row.flag ?? ''}`);
  }
  if (r.noise?.length) lines.push('', ...r.noise);
  const content = `BT /F1 10 Tf 40 800 Td 14 TL ${lines.map((l) => `(${pdfText(l)}) Tj T*`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
