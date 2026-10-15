/**
 * Spellings of the product name that must never appear in user-facing copy (apps, admin, site,
 * store metadata, legal texts). Enforced by scripts/release/check.ts.
 *
 * Kept in release tooling, not in packages/shared, so the wrong spellings are never shipped inside
 * the app bundle. Official names: "Dress My Wound" | "غير لي" (packages/shared/src/brand.ts).
 */
export const FORBIDDEN_BRAND_SPELLINGS = ['Ghayarly', 'غيرني', 'غيّرلي', 'غيرلي'] as const;
