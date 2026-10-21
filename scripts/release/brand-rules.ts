/**
 * Spellings of the product name that must never appear in user-facing copy (apps, admin, site,
 * store metadata, legal texts). Enforced by scripts/release/check.ts.
 *
 * Kept in release tooling, not in packages/shared, so the wrong spellings are never shipped inside
 * the app bundle. Official names: "Dress My Wound" | "غير لي" (packages/shared/src/brand.ts).
 */
export const FORBIDDEN_BRAND_SPELLINGS = ['Ghayarly', 'غيرني', 'غيّرلي', 'غيرلي'] as const;

/**
 * Listing phrases that promise a feature which is OFF by default (server feature flags, migration
 * 0006). Advertising them requires RELEASE_ENABLED_FEATURES to name the flag (Apple 2.3.1, Google
 * metadata policy: the listing must match what the build does).
 */
export const OFF_BY_DEFAULT_FEATURE_CLAIMS: { flag: string; pattern: RegExp }[] = [
  { flag: 'care.home_visit_booking', pattern: /home[- ]?(visit|care)|book(ing)? (a )?(nurse|doctor|visit)|زيارة منزلية|زيارات منزلية|رعاية منزلية|الرعاية المنزلية|احجز/i },
  { flag: 'care.video_consultation', pattern: /video (consultation|call|visit)|telemedicine|استشارة (بالفيديو|عن بعد)/i },
  { flag: 'ai.assistant', pattern: /\bAI\b|artificial intelligence|chatbot|ذكاء اصطناعي|مساعد ذكي/i },
  { flag: 'ai.wound_assessment', pattern: /wound (photo|scan|analysis|assessment)|تحليل (صور )?الجرح/i },
  { flag: 'commerce.checkout', pattern: /\b(buy|order|checkout) (now|online)|اطلب الآن|اشترِ الآن/i },
];
