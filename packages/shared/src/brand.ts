/**
 * Official product identity. Every user-facing surface (apps, emails, SMS, TOTP issuer, store
 * metadata, legal pages) must take the product name from here.
 *
 *   English: Dress My Wound        Arabic: غير لي   (wrong spellings: scripts/release/brand-rules.ts)
 *
 * Internal identifiers (npm scope `@ghayarly/*`, database roles, cookie prefix) intentionally keep
 * the original technical slug: renaming them would break migrations and live sessions.
 */
export const BRAND_NAME_EN = 'Dress My Wound';
export const BRAND_NAME_AR = 'غير لي';
export const CORPORATE_GROUP = 'Alia Group';
export const COMMERCE_BRAND = 'TetraSol';

export function brandName(locale: 'ar' | 'en'): string {
  return locale === 'ar' ? BRAND_NAME_AR : BRAND_NAME_EN;
}

// The list of forbidden spellings lives in scripts/release/brand-rules.ts (release tooling only),
// so the wrong names are never compiled into the app bundle.
