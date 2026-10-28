/**
 * Generates every Dress My Wound | غير لي raster and vector brand asset — app icons (iOS light /
 * dark / tinted, Android adaptive foreground / background / monochrome), splash images, favicons,
 * store graphics and high-resolution exports — from the official artwork's vector paths
 * (packages/tokens/src/dmw-artwork.ts, traced from the supplied reference by
 * scripts/brand/trace-dmw-reference.py). Nothing is upscaled from a bitmap: each size is rendered
 * directly from vectors by Chromium, so every output is sharp.
 *
 *   pnpm brand:assets                                  (runs this, then flatten-icon.py)
 *   PW_CHROMIUM_PATH=/path/to/chrome node scripts/brand/generate-assets.ts
 *
 * Rules kept here (docs/release/BRAND_IDENTITY.md):
 *   - The app icon is the emblem only — no text. The emblem is centred on its bounding box, scaled
 *     uniformly (never stretched) to fit a safe circle: Android's 66/108 dp adaptive safe zone,
 *     the circle Android 12+ uses for the splash icon, and a comfortable margin inside iOS's mask.
 *   - The wordmark never carries Arabic text or a subtitle; both are set as live text by the apps.
 *   - TetraSol logos are not touched here (scripts/brand/prepare-supplied-assets.py).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { brandConfig } from '../../packages/tokens/src/brand.ts';
import { dmwArtwork as art } from '../../packages/tokens/src/dmw-artwork.ts';
import { dmwAspect, dmwBox, dmwColors, dmwParts, dmwSvg, type DmwPaintOptions } from '../../packages/tokens/src/dmw.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const O = dmwColors.orange;

const svg = (w: number, h: number, body: string, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}</defs>${body}</svg>`;

// ---------------------------------------------------------------- emblem placement
const [ex, ey, ew, eh] = dmwBox(art, 'emblem');
const centre = { x: ex + ew / 2, y: ey + eh / 2 };
/** Farthest point of the emblem from its box centre (reference px) — measured in the browser below. */
let reach = Math.hypot(ew / 2, eh / 2);

/** The emblem centred at (cx, cy) and scaled so that no point lies farther than `radius` from it. */
function emblem(cx: number, cy: number, radius: number, paint: Omit<DmwPaintOptions, 'part'>, filter?: string) {
  const { defs, body } = dmwParts(art, { ...paint, part: 'emblem' });
  const k = radius / reach;
  const g = `<g transform="translate(${cx} ${cy}) scale(${k}) translate(${-centre.x} ${-centre.y})">${body}</g>`;
  return { defs, body: filter ? `<g filter="url(#${filter})">${g}</g>` : g };
}

// ---------------------------------------------------------------- glass surfaces
/** Soft glass: base tint, warm light from the lower left, an orange edge glow and a top sheen. */
function glass(s: number, id: string, mode: 'light' | 'dark') {
  const light = mode === 'light';
  const base = light ? ['#FFFDF9', '#FFF4E8', '#FDE5CF'] : ['#273449', '#162033', dmwColors.navy];
  const defs = `
    <linearGradient id="${id}-base" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${base[0]}"/><stop offset="0.55" stop-color="${base[1]}"/><stop offset="1" stop-color="${base[2]}"/></linearGradient>
    <radialGradient id="${id}-warm" cx="0.12" cy="0.95" r="0.62"><stop offset="0" stop-color="${O}" stop-opacity="${light ? 0.2 : 0.26}"/><stop offset="1" stop-color="${O}" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}-rim" cx="0.5" cy="0.5" r="0.7"><stop offset="0.62" stop-color="${O}" stop-opacity="0"/><stop offset="1" stop-color="${O}" stop-opacity="${light ? 0.26 : 0.34}"/></radialGradient>
    <linearGradient id="${id}-sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="${light ? 0.7 : 0.13}"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>
    <filter id="${id}-soft" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${s * 0.01}"/></filter>`;
  const body = `
    <rect width="${s}" height="${s}" fill="url(#${id}-base)"/>
    <rect width="${s}" height="${s}" fill="url(#${id}-warm)"/>
    <rect width="${s}" height="${s}" fill="url(#${id}-rim)"/>
    <path d="M0 0H${s}V${s * 0.2}C${s * 0.7} ${s * 0.3} ${s * 0.32} ${s * 0.36} 0 ${s * 0.58}Z" fill="url(#${id}-sheen)" filter="url(#${id}-soft)"/>`;
  return { defs, body };
}

function shadow(id: string, s: number, mode: 'light' | 'dark') {
  return `<filter id="${id}" x="-25%" y="-25%" width="150%" height="150%"><feDropShadow dx="0" dy="${s * 0.012}" stdDeviation="${s * 0.016}" flood-color="${mode === 'light' ? '#7C2D12' : '#000000'}" flood-opacity="${mode === 'light' ? 0.18 : 0.45}"/></filter>`;
}

/** Emblem reach on square icons: ≈ 70 % of the icon's width, clear of the iOS corner mask. */
const ICON = 0.36;

/** Full-bleed square app icon (the OS applies its own mask). */
function appIcon(s: number, mode: 'light' | 'dark') {
  const g = glass(s, 'g', mode);
  const e = emblem(s / 2, s / 2, s * ICON, { idPrefix: 'e' }, 'sh');
  return svg(s, s, g.body + e.body, g.defs + e.defs + shadow('sh', s, mode));
}

/** iOS tinted icon: grayscale emblem on black; iOS derives the tint from luminance. */
function tintedIcon(s: number) {
  const e = emblem(s / 2, s / 2, s * ICON, { idPrefix: 'e', flat: { orange: '#FFFFFF', wound: '#FFFFFF', ecg: '#FFFFFF', silver: '#9A9A9A' } });
  return svg(s, s, `<rect width="${s}" height="${s}" fill="#000000"/>${e.body}`, e.defs);
}

/** Brand-board "Brand Color" and "Mono" variants (marketing exports). */
function flatIcon(s: number, background: string, colour: string) {
  const e = emblem(s / 2, s / 2, s * ICON, { idPrefix: 'e', flat: { all: colour } });
  return svg(s, s, `<rect width="${s}" height="${s}" fill="${background}"/>${e.body}`, e.defs);
}

/** Android adaptive layers (108 dp canvas; launchers show the central 72 dp and keep 66 dp safe). */
const SAFE = 0.25; // radius as a fraction of the layer (27 dp): well inside the 33 dp safe circle
function adaptiveForeground(s: number) {
  const e = emblem(s / 2, s / 2, s * SAFE, { idPrefix: 'e' }, 'sh');
  return svg(s, s, e.body, e.defs + shadow('sh', s * 0.6, 'light'));
}
function adaptiveBackground(s: number) {
  const g = glass(s, 'g', 'light');
  return svg(s, s, g.body, g.defs);
}
function adaptiveMonochrome(s: number) {
  const e = emblem(s / 2, s / 2, s * SAFE, { idPrefix: 'e', flat: { all: '#FFFFFF' } });
  return svg(s, s, e.body, e.defs);
}

/** Splash icon: the emblem alone on transparency, inside the circle Android 12+ keeps visible. */
function splashIcon(s: number) {
  const e = emblem(s / 2, s / 2, s * 0.47, { idPrefix: 'e' });
  return svg(s, s, e.body, e.defs);
}

/** Rounded glass tile (favicons): transparent corners. */
function tile(s: number) {
  const g = glass(s, 'g', 'light');
  const e = emblem(s / 2, s / 2, s * ICON, { idPrefix: 'e' });
  return svg(s, s, `<clipPath id="c"><rect width="${s}" height="${s}" rx="${s * 0.22}"/></clipPath><g clip-path="url(#c)">${g.body}${e.body}</g>`, g.defs + e.defs);
}

/** The wordmark (tagline-free) on transparency, `w` wide. */
function wordmark(w: number, inverse: boolean) {
  const h = Math.round(w / dmwAspect(art, 'wordmark'));
  return { w, h, svg: dmwSvg(art, { part: 'wordmark', inverse, width: w, height: h }) };
}

function fontFace(): string {
  // Embedded as data URLs: pages rendered from setContent() cannot load file:// fonts.
  const dir = resolve(root, 'node_modules/@expo-google-fonts/ibm-plex-sans-arabic');
  const face = (weight: number, file: string) => `@font-face{font-family:Plex;font-weight:${weight};src:url(data:font/ttf;base64,${readFileSync(resolve(dir, file)).toString('base64')}) format('truetype')}`;
  return [face(500, '500Medium/IBMPlexSansArabic_500Medium.ttf'), face(600, '600SemiBold/IBMPlexSansArabic_600SemiBold.ttf')].join('\n');
}

/** Google Play feature graphic 1024×500: light glass, the wordmark, the Arabic name and endorsement as text. */
function featureGraphicHtml(): string {
  const w = 1024;
  const h = 500;
  const g = glass(w, 'g', 'light');
  const mark = wordmark(620, false);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fontFace()}
  html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}
  .bg{position:absolute;inset:0}
  .copy{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;font-family:Plex}
  .ar{font-size:44px;font-weight:600;line-height:1.3;color:${dmwColors.ink}}
  .by{font-size:16px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:#6B7280}
  </style></head><body><div class="bg">${svg(w, h, `<g transform="scale(1 ${h / w})">${g.body}</g>`, g.defs)}</div>
  <div class="copy">${mark.svg}<div class="ar" lang="ar" dir="rtl">${brandConfig.product.nameAr}</div><div class="by">by ${brandConfig.corporate.name}</div></div></body></html>`;
}

/** Admin console lockup (high-resolution export): wordmark + the console subtitle as set text. */
function consoleLockupHtml(w: number, h: number): string {
  const mark = wordmark(Math.round(w * 0.86), false);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fontFace()}
  html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:transparent}
  .wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${w * 0.012}px;font-family:Plex}
  .sub{display:flex;align-items:center;gap:${w * 0.015}px;width:${mark.w}px;color:#4B5563;font-weight:500;font-size:${w * 0.021}px;letter-spacing:${w * 0.0075}px;text-transform:uppercase;white-space:nowrap}
  .sub::before,.sub::after{content:"";flex:1;height:${Math.max(1, w * 0.0012)}px;background:#9CA3AF}
  </style></head><body><div class="wrap">${mark.svg}<div class="sub">Operations &amp; Clinical Review Console</div></div></body></html>`;
}

// ---------------------------------------------------------------- jobs
type Job = { out: string | string[]; width: number; height: number; html: string; transparent: boolean };
const page = (markup: string, w: number, h: number) => `<!doctype html><html><head><style>html,body{margin:0;width:${w}px;height:${h}px;background:transparent;overflow:hidden}svg{display:block}</style></head><body>${markup}</body></html>`;
const EXPORTS = 'store/assets/official/dmw/exports';

function jobs(): Job[] {
  const splash = wordmark(1200, false);
  const splashDark = wordmark(1200, true);
  const big = wordmark(4096, false);
  const bigInverse = wordmark(4096, true);
  const sq = (out: string | string[], s: number, markup: string, transparent: boolean): Job => ({ out, width: s, height: s, html: page(markup, s, s), transparent });
  return [
    // iOS (ios.icon light / dark / tinted); the light icon is also the top-level and App Store icon.
    sq(['apps/mobile/assets/icon.png', `${EXPORTS}/dmw-icon-light-1024.png`], 1024, appIcon(1024, 'light'), false),
    sq(['apps/mobile/assets/icon-ios-dark.png', `${EXPORTS}/dmw-icon-dark-1024.png`], 1024, appIcon(1024, 'dark'), false),
    sq(['apps/mobile/assets/icon-ios-tinted.png', `${EXPORTS}/dmw-icon-tinted-1024.png`], 1024, tintedIcon(1024), false),
    // Android adaptive icon layers.
    sq('apps/mobile/assets/adaptive-icon.png', 1024, adaptiveForeground(1024), true),
    sq('apps/mobile/assets/adaptive-icon-background.png', 1024, adaptiveBackground(1024), false),
    sq('apps/mobile/assets/adaptive-icon-monochrome.png', 1024, adaptiveMonochrome(1024), true),
    // Splash: emblem (Android, both schemes) and the tagline-free wordmark (iOS light / dark).
    sq('apps/mobile/assets/splash-icon.png', 1024, splashIcon(1024), true),
    { out: 'apps/mobile/assets/splash-wordmark.png', width: splash.w, height: splash.h, html: page(splash.svg, splash.w, splash.h), transparent: true },
    { out: 'apps/mobile/assets/splash-wordmark-dark.png', width: splashDark.w, height: splashDark.h, html: page(splashDark.svg, splashDark.w, splashDark.h), transparent: true },
    // Favicons.
    sq('apps/mobile/assets/favicon.png', 196, tile(196), true),
    sq('apps/admin/public/favicon.png', 196, tile(196), true),
    // Store.
    sq('store/assets/google-play/icon-512.png', 512, appIcon(512, 'light'), false),
    { out: 'store/assets/google-play/feature-graphic-1024x500.png', width: 1024, height: 500, html: featureGraphicHtml(), transparent: false },
    // High-resolution exports.
    sq(`${EXPORTS}/dmw-icon-brand-1024.png`, 1024, flatIcon(1024, O, '#FFFFFF'), false),
    sq(`${EXPORTS}/dmw-icon-mono-1024.png`, 1024, flatIcon(1024, '#FFFFFF', dmwColors.ink), false),
    sq(`${EXPORTS}/dmw-emblem-2048.png`, 2048, splashIcon(2048), true),
    { out: `${EXPORTS}/dmw-wordmark-4096.png`, width: big.w, height: big.h, html: page(big.svg, big.w, big.h), transparent: true },
    { out: `${EXPORTS}/dmw-wordmark-inverse-4096.png`, width: bigInverse.w, height: bigInverse.h, html: page(bigInverse.svg, bigInverse.w, bigInverse.h), transparent: true },
    { out: `${EXPORTS}/dmw-wordmark-console-2400.png`, width: 2400, height: 900, html: consoleLockupHtml(2400, 900), transparent: true },
  ];
}

/** Vector masters: the admin console serves these directly; designers get the same files. */
function vectors(): [string, string][] {
  const title = brandConfig.product.nameEn;
  const files: [string, string][] = [
    ['dmw-emblem.svg', dmwSvg(art, { part: 'emblem', title })],
    ['dmw-wordmark.svg', dmwSvg(art, { part: 'wordmark', title })],
    ['dmw-wordmark-inverse.svg', dmwSvg(art, { part: 'wordmark', inverse: true, title })],
  ];
  return [...files.map(([n, s]): [string, string] => [`apps/admin/public/brand/${n}`, s]), ...files.map(([n, s]): [string, string] => [`${EXPORTS}/${n}`, s])];
}

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' });
try {
  // Measure the emblem's true reach from its centre: rasterise it at 2× and find the farthest
  // visible pixel (robust for compound outlines and holes).
  const probe = await browser.newPage();
  await probe.setContent(page('', 10, 10));
  reach = await probe.evaluate(
    async ({ markup, w, h }) => {
      const k = 2;
      const img = new Image();
      img.src = `data:image/svg+xml;base64,${btoa(markup)}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = Math.ceil(w * k);
      c.height = Math.ceil(h * k);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      let r = 0;
      for (let y = 0; y < c.height; y++)
        for (let x = 0; x < c.width; x++) if (data[(y * c.width + x) * 4 + 3]! > 8) r = Math.max(r, Math.hypot(x + 0.5 - c.width / 2, y + 0.5 - c.height / 2));
      return r / k;
    },
    { markup: dmwSvg(art, { part: 'emblem', width: ew, height: eh }), w: ew, h: eh },
  );
  await probe.close();
  console.log(`emblem reach ${reach.toFixed(1)} px from its centre (box ${ew.toFixed(1)}×${eh.toFixed(1)})`);

  for (const job of jobs()) {
    const p = await browser.newPage({ viewport: { width: job.width, height: job.height }, deviceScaleFactor: 1 });
    await p.setContent(job.html, { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    const png = await p.screenshot({ omitBackground: job.transparent, clip: { x: 0, y: 0, width: job.width, height: job.height } });
    for (const out of [job.out].flat()) {
      const file = resolve(root, out);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, png);
      console.log(`wrote ${out} (${job.width}×${job.height}${job.transparent ? ', transparent' : ''})`);
    }
    await p.close();
  }
  for (const [out, content] of vectors()) {
    const file = resolve(root, out);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    console.log(`wrote ${out}`);
  }
} finally {
  await browser.close();
}
