/**
 * Corporate brand configuration — the ONE place to swap in official brand values.
 *
 * Hierarchy (docs/release/BRAND_IDENTITY.md):
 *   - Dress My Wound | غير لي  → the product identity (primary).
 *   - TetraSol                → exclusive product-commerce brand (store section only).
 *   - Alia Group              → corporate identity (endorsement line, architectural language).
 *
 * STATUS: PROVISIONAL. No official TetraSol or Alia Group brand guidelines or colour specifications
 * have been supplied to this repository. The TetraSol logo file and an orange swirl artwork (used as
 * the loader) were supplied by the project owner on 2026-10-28 (store/assets/official/tetrasol). The values below are design-team
 * provisional choices that follow the written direction (TetraSol: deep navy + signature orange;
 * Alia Group: warm stone, brass, restrained Mamluk/mashrabiya geometry). They are NOT claimed to be
 * official. Replace them here (and the logo assets listed in `assets`) once verified files arrive;
 * every component reads from this module, so no component code needs to change.
 */
export const brandConfig = {
  status: 'PROVISIONAL' as 'PROVISIONAL' | 'OFFICIAL',
  provisionalNote: 'Provisional values pending official TetraSol and Alia Group brand guidelines.',
  product: { nameEn: 'Dress My Wound', nameAr: 'غير لي' },
  corporate: { name: 'Alia Group', officialAssetsReceived: false },
  // officialAssetsReceived = the complete kit (guidelines and colour specs), not a single file.
  commerce: { name: 'TetraSol', officialAssetsReceived: false },
  /** Core brand hues (provisional). */
  hues: {
    /** TetraSol direction: deep navy — principal structural colour. */
    navy: '#0A1F3D',
    /** TetraSol direction: signature orange — deliberate highlights and key actions only. */
    orange: '#EE6B1F',
    /** Alia Group direction: warm limestone surface. */
    stone: '#FAF7F2',
    /** Alia Group direction: brushed brass detailing. */
    brass: '#A8844E',
  },
  /**
   * Asset slots. `null` = official file not supplied.
   *   - Logos are NEVER drawn or imitated. TetraSol: the supplied file is rendered as is (backdrop
   *     removed only) by TetraSolLogo in the mobile app and the admin console, in TetraSol contexts
   *     only. Alia Group: no file yet, so the name renders as plain text.
   *   - Dress My Wound product identity: OFFICIAL artwork supplied by the project owner on
   *     2026-10-28 (brand usage board + full wordmark, store/assets/official/dmw/reference). It is
   *     vectorised by scripts/brand/trace-dmw-reference.py (./dmw-artwork.ts) and painted by ./dmw.ts;
   *     scripts/brand/generate-assets.ts renders the app icons, splash and store assets from it.
   *     The handoff archive with the original vector files was not received: re-trace or replace
   *     ./dmw-artwork.ts when it arrives (docs/release/BRAND_IDENTITY.md §11).
   */
  assets: {
    tetrasolLogo: 'store/assets/official/tetrasol/tetrasol-logo-supplied.png' as string | null,
    /** Orange swirl (supplied with the TetraSol logo): the app's loading indicator. */
    loaderArtwork: 'store/assets/official/tetrasol/loader-swirl-supplied.png' as string | null,
    aliaGroupLogo: null as string | null,
    productMark: 'OFFICIAL' as 'TEMPORARY_PLACEHOLDER' | 'OFFICIAL',
    /** Where the official product mark comes from (traced from the supplied raster references). */
    productMarkSource: 'store/assets/official/dmw/reference' as string | null,
  },
} as const;

export type BrandConfig = typeof brandConfig;
