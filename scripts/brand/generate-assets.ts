/**
 * TEMPORARY PLACEHOLDER ARTWORK — not an official Alia Group, TetraSol or Dress My Wound logo.
 * No Alia Group or TetraSol logo is drawn anywhere; those names appear only as plain text.
 *
 * Generates the PROVISIONAL Dress My Wound | غير لي raster assets (app icon, Android adaptive
 * icon layers, splash, favicons, admin mark, store graphics) from the same vector geometry the app
 * renders (apps/mobile/src/ui/brand/geometry.ts), so every surface stays consistent.
 *
 * Replace these outputs — and flip brandConfig.status to 'OFFICIAL' — once approved artwork exists.
 *
 *   node scripts/brand/generate-assets.ts          (Node ≥ 22.18, uses the local Chromium)
 *   PW_CHROMIUM_PATH=/path/to/chrome node scripts/brand/generate-assets.ts
 *
 * Post-processing (alpha removal for the iOS icon) is done by scripts/brand/flatten-icon.py.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { latticeTilePath, pointedArchOutline, pointedArchPath } from '../../apps/mobile/src/ui/brand/geometry.ts';
import { brandConfig } from '../../packages/tokens/src/brand.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { navy, orange, brass } = brandConfig.hues;
const CREAM = '#F7F3EC';

/** The mark (arch + care cross) drawn inside a square of size s, scaled by `scale` around the centre. */
function markGlyph(s: number, opts: { archColor: string; crossColor: string; scale?: number }): string {
  const k = opts.scale ?? 1;
  const archW = s * 0.5;
  const archH = s * 0.6;
  const ax = (s - archW) / 2;
  const ay = s * 0.2;
  const arm = s * 0.085;
  const len = s * 0.15;
  const cx = s / 2;
  const cy = ay + archH * 0.62;
  return `<g transform="translate(${(s * (1 - k)) / 2} ${(s * (1 - k)) / 2}) scale(${k})">
    <path d="${pointedArchOutline(archW, archH, 0.5)}" transform="translate(${ax} ${ay})" stroke="${opts.archColor}" stroke-width="${s * 0.045}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <rect x="${cx - arm / 2}" y="${cy - len}" width="${arm}" height="${len * 2}" rx="${arm / 2}" fill="${opts.crossColor}"/>
    <rect x="${cx - len}" y="${cy - arm / 2}" width="${len * 2}" height="${arm}" rx="${arm / 2}" fill="${opts.crossColor}"/>
  </g>`;
}

function lattice(id: string, cell: number, color: string, opacity: number): { defs: string; fill: string } {
  return {
    defs: `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${cell}" height="${cell}"><path d="${latticeTilePath(cell)}" stroke="${color}" stroke-width="${cell / 28}" fill="none"/></pattern>`,
    fill: `<rect width="100%" height="100%" fill="url(#${id})" opacity="${opacity}"/>`,
  };
}

const svg = (w: number, h: number, body: string, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}</defs>${body}</svg>`;

function iconSquare(s: number): string {
  // Clean, modern icon: no texture. Full-bleed square (iOS / Google Play apply their own masks).
  return svg(s, s, `<rect width="${s}" height="${s}" fill="${navy}"/>${markGlyph(s, { archColor: CREAM, crossColor: orange, scale: 1.08 })}`);
}

function roundedTile(s: number): string {
  return svg(s, s, `<rect width="${s}" height="${s}" rx="${s * 0.23}" fill="${navy}"/>${markGlyph(s, { archColor: CREAM, crossColor: orange })}`);
}

/** Android adaptive foreground: glyph only, inside the 66/108 safe zone. */
function adaptiveForeground(s: number): string {
  return svg(s, s, markGlyph(s, { archColor: CREAM, crossColor: orange, scale: 0.78 }));
}

function adaptiveMonochrome(s: number): string {
  return svg(s, s, markGlyph(s, { archColor: '#FFFFFF', crossColor: '#FFFFFF', scale: 0.78 }));
}

function fontFace(): string {
  // Embedded as data URLs: pages rendered from setContent() cannot load file:// fonts.
  const dir = resolve(root, 'node_modules/@expo-google-fonts/ibm-plex-sans-arabic');
  const face = (weight: number, file: string) => `@font-face{font-family:Plex;font-weight:${weight};src:url(data:font/ttf;base64,${readFileSync(resolve(dir, file)).toString('base64')}) format('truetype')}`;
  return [face(400, '400Regular/IBMPlexSansArabic_400Regular.ttf'), face(600, '600SemiBold/IBMPlexSansArabic_600SemiBold.ttf'), face(700, '700Bold/IBMPlexSansArabic_700Bold.ttf')].join('\n');
}

/** Google Play feature graphic 1024×500: navy hero, lattice, arch-framed mark, bilingual name. */
function featureGraphicHtml(): string {
  const w = 1024;
  const h = 500;
  const l = lattice('l', 34, brass, 0.05);
  const archW = 230;
  const archH = 330;
  const art = svg(
    w,
    h,
    `<rect width="${w}" height="${h}" fill="${navy}"/>${l.fill}
     <g transform="translate(${w - archW - 110} ${h - archH})"><path d="${pointedArchPath(archW, archH, 0.42)}" fill="rgba(247,243,236,0.03)"/><path d="${pointedArchOutline(archW - 12, archH - 6, 0.42)}" transform="translate(6 6)" stroke="${brass}" stroke-opacity="0.35" stroke-width="1" fill="none"/></g>
     <g transform="translate(${w - archW - 110 + (archW - 150) / 2} ${h - archH + 120})">${markGlyph(150, { archColor: CREAM, crossColor: orange })}</g>`,
    l.defs,
  );
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fontFace()}
  html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}
  .art{position:absolute;inset:0}
  .copy{position:absolute;left:72px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;gap:10px;font-family:Plex;color:${CREAM}}
  .en{font-size:64px;font-weight:700;letter-spacing:-0.5px;line-height:1.1}
  .ar{font-size:52px;font-weight:600;line-height:1.3;direction:rtl;text-align:left}
  .rule{width:150px;height:1px;background:${brass};margin:10px 0 4px}
  .by{font-size:18px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:${brass}}
  </style></head><body><div class="art">${art}</div><div class="copy"><div class="en">${brandConfig.product.nameEn}</div><div class="ar" lang="ar">${brandConfig.product.nameAr}</div><div class="rule"></div><div class="by">by ${brandConfig.corporate.name}</div></div></body></html>`;
}

type Job = { out: string; width: number; height: number; html: string; transparent: boolean };
const page = (markup: string, w: number, h: number) => `<!doctype html><html><head><style>html,body{margin:0;width:${w}px;height:${h}px;background:transparent;overflow:hidden}</style></head><body>${markup}</body></html>`;

const jobs: Job[] = [
  { out: 'apps/mobile/assets/icon.png', width: 1024, height: 1024, html: page(iconSquare(1024), 1024, 1024), transparent: false },
  { out: 'apps/mobile/assets/adaptive-icon.png', width: 1024, height: 1024, html: page(adaptiveForeground(1024), 1024, 1024), transparent: true },
  { out: 'apps/mobile/assets/adaptive-icon-monochrome.png', width: 1024, height: 1024, html: page(adaptiveMonochrome(1024), 1024, 1024), transparent: true },
  { out: 'apps/mobile/assets/splash-icon.png', width: 1024, height: 1024, html: page(roundedTile(1024), 1024, 1024), transparent: true },
  { out: 'apps/mobile/assets/favicon.png', width: 196, height: 196, html: page(roundedTile(196), 196, 196), transparent: true },
  { out: 'apps/admin/public/mark.png', width: 256, height: 256, html: page(roundedTile(256), 256, 256), transparent: true },
  { out: 'apps/admin/public/favicon.png', width: 196, height: 196, html: page(roundedTile(196), 196, 196), transparent: true },
  { out: 'store/assets/google-play/icon-512.png', width: 512, height: 512, html: page(iconSquare(512), 512, 512), transparent: false },
  { out: 'store/assets/google-play/feature-graphic-1024x500.png', width: 1024, height: 500, html: featureGraphicHtml(), transparent: false },
];

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' });
try {
  for (const job of jobs) {
    const p = await browser.newPage({ viewport: { width: job.width, height: job.height }, deviceScaleFactor: 1 });
    await p.setContent(job.html, { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    const png = await p.screenshot({ omitBackground: job.transparent, clip: { x: 0, y: 0, width: job.width, height: job.height } });
    const out = resolve(root, job.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, png);
    await p.close();
    console.log(`wrote ${job.out} (${job.width}×${job.height}${job.transparent ? ', transparent' : ''})`);
  }
  // Keep a vector master next to the rasters for designers.
  writeFileSync(resolve(root, 'store/assets/shared/mark.svg'), roundedTile(1024));
} finally {
  await browser.close();
}
