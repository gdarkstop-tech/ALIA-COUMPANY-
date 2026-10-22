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
  { flag: 'care.home_visit_booking', pattern: /home[- ]?(visit|care|nursing)|nurse (at|to) (your )?(home|door)|book(ing)? (a |an )?(nurse|doctor|visit|appointment)|زيارة منزلية|زيارات منزلية|رعاية منزلية|الرعاية المنزلية|تمريض منزلي|احجز|حجز (موعد|زيارة|ممرض)/i },
  { flag: 'care.video_consultation', pattern: /video (consultation|call|visit|chat)|tele-?(medicine|health|consult)|online consultation|استشارة (بالفيديو|عن بعد|أونلاين)|مكالمة فيديو|الطب عن بعد/i },
  { flag: 'ai.assistant', pattern: /\bA\.?I\b|artificial intelligence|machine learning|chat ?bot|smart assistant|virtual (assistant|nurse|doctor)|(ال)?ذكاء (ال)?اصطناعي|مساعد (ذكي|افتراضي)|تعلم الآلة/i },
  { flag: 'ai.wound_assessment', pattern: /wound (photo|picture|image|scan|analysis|assessment|detection)|(analy[sz]e|scan) (your )?wound|تحليل (صور(ة)? )?الجرح|فحص الجرح بالصور/i },
  { flag: 'clinical.diagnostic_suggestions', pattern: /symptom checker|(instant|automatic|smart|AI|online) diagnos|diagnoses? (you|your)|get (a )?diagnosis|تشخيص (فوري|ذكي|آلي|تلقائي)|يشخص (حالتك|مرضك)|فاحص الأعراض/i },
  { flag: 'billing.store_subscriptions', pattern: /\bsubscri(be|ption)s?\b|premium plan|gold plan|platinum plan|\bin-app purchase|اشترا?ك(ات)?\b|اشتراك|الباقة (الذهبية|البلاتينية|المميزة)|باقة (ذهبية|بلاتينية|مدفوعة)/i },
  { flag: 'commerce.checkout', pattern: /\b(buy|order|shop|checkout|pay) (now|online|in[- ]app)|add to cart|cash on delivery|delivered to your (door|home)|اطلب الآن|اشترِ الآن|اشتري الآن|الدفع عند الاستلام|توصيل (للمنزل|لباب)/i },
];

/** Placeholders that must be gone before submission (English and Arabic drafting conventions). */
export const PLACEHOLDER_PATTERN = /<[A-Z_]+_TO_CONFIRM>|to be confirmed|\[to confirm|TO CONFIRM|يُؤكَّد لاحق[اًا]|يؤكد لاحق[اًا]|يحدد(ه|ها)? الفريق القانوني|يُحدَّد لاحق[اًا]|\[[^\]]*—[^\]]*\]/i;

/** Consumer mail providers: a real person's address (developer logins, staff) never belongs in the repo. */
export const PERSONAL_EMAIL_PATTERN = /[\w.+-]+@(gmail|googlemail|yahoo|ymail|rocketmail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|pm|gmx|yandex|zoho|mail|inbox|tutanota|fastmail)\.(com|me|ch|net|org|de|ru|eg|co\.uk|fr|it|es)\b/i;
