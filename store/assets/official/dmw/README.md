# Dress My Wound | غير لي — official identity (supplied)

## What was received (2026-10-28)

| File (`reference/`) | What it is | Size | SHA-256 |
|---|---|---|---|
| `DMW_Brand_Usage_Board.webp` | Brand usage board: glass app icon, light / dark / brand-colour / mono variants, colour palette | 1774 × 887 | `6fc9ad3c11c2a5f8ba9bea399a6b93231a3f790e5527101faf6775b313783e95` |
| `DMW_Inside_Full_Wordmark_Reference.webp` | Full wordmark with the "Operations & Clinical Review Console" subtitle | 1672 × 941 | `f566920e028265275a5da4fc2c65659a24d78de1beab9a86fccfbbeaa836a25a` |

Both were attached by the project owner in the development session and are stored unchanged.

**Not received:** `DMW_Brand_Handoff.zip`, named in the request. There are no original vector, font or
icon master files in this repository. Every asset below is derived from the two raster references.
When the archive arrives, replace `packages/tokens/src/dmw-artwork.ts` with paths from the original
vectors (or re-trace), then run `pnpm brand:assets`.

## How the assets are made (reproducible)

1. `pnpm brand:trace` — `scripts/brand/trace-dmw-reference.py` (Pillow, NumPy, OpenCV, potracer)
   separates the board colours in the wordmark reference at 4× supersampling and traces them with
   potrace into `packages/tokens/src/dmw-artwork.ts`: emblem (orange, silver, ECG) and letterforms
   ("Dress My" dark, "Wound" orange). Shapes are traced, never redrawn.
2. `packages/tokens/src/dmw.ts` paints them with the board colours — Primary Orange `#F97316`,
   Text/Dark `#1F2937` (soft white `#F8FAFC` on dark surfaces), Medical Silver `#9CA3AF` — and the
   reference's light-to-deep shading. The app, the admin console and the generator use this one module.
3. `pnpm brand:assets` — `scripts/brand/generate-assets.ts` renders every icon, splash and store file
   from the vectors in Chromium (no bitmap upscaling), then `scripts/brand/flatten-icon.py` fixes the
   store formats (opaque RGB iOS icons, RGBA Play icon).

## Rules kept

- **External app icon** = the emblem only (cross, heart, ECG pulse, leaf). **No text.** Centred and
  scaled uniformly — never stretched or cropped — inside each platform's safe area (Android: 27 dp
  radius in the 66 dp safe zone; splash: inside the Android 12+ circle).
- **Internal wordmark** = emblem + "Dress My Wound", tagline-free, as supplied.
- The **console subtitle** is live, localised text in the admin console only — never in the artwork,
  never on patient-facing screens.
- **No Arabic inside the artwork.** غير لي is set as text next to it.
- TetraSol files (`../tetrasol/`) are not touched by this pipeline.

## Exports (`exports/`)

| File | Use |
|---|---|
| `dmw-emblem.svg`, `dmw-wordmark.svg`, `dmw-wordmark-inverse.svg` | Vector masters (inverse = light lettering for dark backgrounds) |
| `dmw-icon-light-1024.png`, `dmw-icon-dark-1024.png`, `dmw-icon-tinted-1024.png` | App icon appearances (same as the iOS icon files) |
| `dmw-icon-brand-1024.png`, `dmw-icon-mono-1024.png` | Board variants: white emblem on orange; single-colour dark emblem on white |
| `dmw-emblem-2048.png` | Emblem on transparency |
| `dmw-wordmark-4096.png`, `dmw-wordmark-inverse-4096.png` | Wordmark on transparency |
| `dmw-wordmark-console-2400.png` | Admin lockup with the console subtitle (documents and slides about the console) |

App files are listed in `docs/release/BRAND_IDENTITY.md` §11.

## Still needed

- The original vector files (`DMW_Brand_Handoff.zip`).
- Brand-owner sign-off of the traced vectors and of the rendered icon set.
- Viewing the icons and splash on real devices: so far only static checks, `expo prebuild` output
  inspection and Expo **web** screenshots have been done.
