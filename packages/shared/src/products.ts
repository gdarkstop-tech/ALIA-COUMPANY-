import { z } from 'zod';

/**
 * Company-product knowledge and controlled product discovery (migration 0025, ADR 0014).
 *
 * Product statements the assistant may use are approved, versioned entries with an evidence
 * reference. Keywords link a person's words to a product only through an approved keyword (and,
 * for a condition, an approved indication). The guard below rejects any assistant answer that names
 * a company product it was not given, or that makes a claim about a product (cure, guarantee, best,
 * no side effects, a discount…) that is not in that product's approved text.
 */
export const PRODUCT_KNOWLEDGE_KINDS = ['INDICATION', 'CLAIM', 'CONTRAINDICATION', 'FAQ', 'EDUCATION'] as const;
export type ProductKnowledgeKind = (typeof PRODUCT_KNOWLEDGE_KINDS)[number];
export const PRODUCT_KEYWORD_VARIANTS = ['KEYWORD', 'SYNONYM', 'MISSPELLING'] as const;
export type ProductKeywordVariant = (typeof PRODUCT_KEYWORD_VARIANTS)[number];
/** Candidate search topics (not claims): an indication names the one it covers. */
export const PRODUCT_TOPIC_SUGGESTIONS = ['diabetic-foot', 'pressure-ulcers', 'burns', 'surgical-wounds', 'deep-wounds', 'general-wound-care'] as const;

// ---------------------------------------------------------------- normalisation (mirrors app.search_normalize)
const ARABIC_MARKS = /[\u064B-\u065F\u0670\u0640]/g;
const FOLD: Record<string, string> = { أ: 'ا', إ: 'ا', آ: 'ا', ٱ: 'ا', ى: 'ي', ة: 'ه', ؤ: 'و', ئ: 'ي', '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
/** Lower case, Arabic marks removed, letter forms unified, punctuation to spaces, attached article removed. */
export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(ARABIC_MARKS, '')
    .replace(/[أإآٱىةؤئ٠-٩]/g, (c) => FOLD[c] ?? c)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/(^| )(وبال|وكال|وال|بال|كال|فال|ولل|لل|ال)([^ ]{2,})/g, '$1$3')
    .replace(/ +/g, ' ')
    .trim();
}
const has = (haystack: string, needle: string) => needle.length >= 2 && ` ${haystack} `.includes(` ${needle} `);

// ---------------------------------------------------------------- the answer guard
/** Claims never allowed about a product unless its own approved text says so (normalised forms). */
const UNAPPROVED_CLAIMS = [
  'cure', 'cures', 'cured', 'curing', 'guarantee', 'guaranteed', 'guarantees', '100', 'the best', 'best product', 'best treatment', 'best option',
  'best choice', 'only option', 'only product', 'only treatment', 'only solution', 'miracle', 'no side effects', 'completely safe', 'totally safe',
  'risk free', 'instant relief', 'instant results', 'instantly heals', 'permanent cure', 'permanent results', 'clinically proven', 'proven to',
  'heals all', 'heals any', 'heals every', 'better than', 'superior', 'number one', 'doctors recommend', 'recommended by doctors', 'discount',
  'promo', 'buy now', 'limited time',
  'يشفي', 'تشفي', 'شفاء تام', 'علاج نهائي', 'يعالج نهائيا', 'مضمون', 'مضمونه', 'نضمن', 'يضمن', 'افضل منتج', 'افضل علاج', 'افضل خيار', 'افضل من',
  'حل وحيد', 'منتج وحيد', 'علاج وحيد', 'خيار وحيد', 'معجزه', 'بدون اثار جانبيه', 'بلا اثار جانبيه', 'امن تماما', 'مفعول فوري', 'نتائج فوريه',
  'مثبت علميا', 'مثبت سريريا', 'رقم 1', 'ينصح به اطباء', 'يوصي به اطباء', 'خصم', 'تخفيض',
].map(normalizeSearch);

/** The first claim (normalised) found in `text` among the never-allowed claims plus `extra`; null when none. */
export function findUnapprovedClaim(text: string, extra: readonly string[] = []): string | null {
  const t = normalizeSearch(text);
  return [...UNAPPROVED_CLAIMS, ...extra.map(normalizeSearch)].find((c) => has(t, c)) ?? null;
}

export type ProductNameTerm = { productId: string | null; brand: string; term: string };
export type OfferedProduct = { label: 'P1' | 'P2'; productId: string; brand: string; approvedText: string };
export type ProductAnswerCheck = { ok: true; cited: ('P1' | 'P2')[] } | { ok: false; reason: 'UNOFFERED_PRODUCT' | 'UNAPPROVED_CLAIM'; detail: string };

/**
 * `terms`: every company product name, approved name keyword and brand (already normalised, from
 * app.product_name_terms). `offered`: what this answer was given, with its approved text.
 */
export function checkProductAnswer(answer: string, offered: OfferedProduct[], terms: ProductNameTerm[]): ProductAnswerCheck {
  const whole = normalizeSearch(answer);
  const allowed = (t: ProductNameTerm) => (t.productId ? offered.some((o) => o.productId === t.productId) : offered.some((o) => o.brand === t.brand));
  const named = terms.find((t) => has(whole, t.term) && !allowed(t));
  if (named) return { ok: false, reason: 'UNOFFERED_PRODUCT', detail: named.term };

  // Claims are checked in every sentence that mentions an offered product (by label, name or brand).
  for (const sentence of answer.split(/(?<=[.!?؟])\s+|\n+|•/)) {
    const s = normalizeSearch(sentence);
    const about = offered.filter((o) => sentence.includes(`[${o.label}]`) || terms.some((t) => (t.productId === o.productId || (!t.productId && t.brand === o.brand)) && has(s, t.term)));
    if (!about.length) continue;
    const approved = normalizeSearch(about.map((o) => o.approvedText).join('\n'));
    const claim = UNAPPROVED_CLAIMS.find((c) => has(s, c) && !has(approved, c));
    if (claim) return { ok: false, reason: 'UNAPPROVED_CLAIM', detail: claim };
  }
  const cited = new Set<'P1' | 'P2'>();
  for (const m of answer.matchAll(/\[(P[12])\]/g)) if (offered.some((o) => o.label === m[1])) cited.add(m[1] as 'P1' | 'P2');
  return { ok: true, cited: [...cited] };
}

// ---------------------------------------------------------------- API contracts
const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60);
const knowledgeFields = {
  topic: slug.nullable().optional(),
  titleAr: z.string().trim().min(2).max(200),
  titleEn: z.string().trim().min(2).max(200),
  bodyAr: z.string().trim().min(2).max(4000),
  bodyEn: z.string().trim().min(2).max(4000),
  evidenceReference: z.string().trim().min(3).max(300),
};
export const productKnowledgeBody = z
  .object({ productId: z.string().uuid(), kind: z.enum(PRODUCT_KNOWLEDGE_KINDS), ...knowledgeFields })
  .refine((b) => b.kind !== 'INDICATION' || !!b.topic, { message: 'An indication needs a topic', path: ['topic'] });
export const productKnowledgePatchBody = z.object({
  topic: knowledgeFields.topic,
  titleAr: knowledgeFields.titleAr.optional(),
  titleEn: knowledgeFields.titleEn.optional(),
  bodyAr: knowledgeFields.bodyAr.optional(),
  bodyEn: knowledgeFields.bodyEn.optional(),
  evidenceReference: knowledgeFields.evidenceReference.optional(),
});
export const productKeywordBody = z.object({
  productId: z.string().uuid(),
  indicationId: z.string().uuid().nullable().optional(),
  term: z.string().trim().min(2).max(80),
  locale: z.enum(['ar', 'en']),
  variant: z.enum(PRODUCT_KEYWORD_VARIANTS),
});

export type ProductKnowledgeStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'RETIRED';
/** A live, approved statement (public for products on sale). */
export type ProductKnowledgeItem = {
  versionId: string;
  kind: ProductKnowledgeKind;
  topic: string | null;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  version: number;
  approvedAt: string;
};
export type ProductKnowledgeAdmin = {
  id: string;
  productId: string;
  kind: ProductKnowledgeKind;
  topic: string | null;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  evidenceReference: string;
  status: ProductKnowledgeStatus;
  editedByMe: boolean;
  updatedAt: string;
  live: { versionId: string; version: number; approvedAt: string; approvedByMe: boolean } | null;
  versions: { version: number; approvedAt: string; supersededAt: string | null; note: string }[];
};
export type ProductKeywordAdmin = {
  id: string;
  productId: string;
  indicationId: string | null;
  indicationTitle: string | null;
  term: string;
  locale: 'ar' | 'en';
  variant: ProductKeywordVariant;
  status: 'PENDING' | 'APPROVED' | 'RETIRED';
  createdByMe: boolean;
  approvedAt: string | null;
  /** Approved, and (for a condition) its indication has a live approved version. */
  active: boolean;
};
export type ProductKnowledgeOverview = {
  product: { id: string; slug: string; nameAr: string; nameEn: string; contentStatus: string; publicationStatus: string; isDemo: boolean };
  entries: ProductKnowledgeAdmin[];
  keywords: ProductKeywordAdmin[];
};
export type ProductDiscoveryMatch = { productId: string; slug: string; nameAr: string; nameEn: string; term: string; match: 'PRODUCT' | 'INDICATION'; indication: { titleAr: string; titleEn: string; version: number } | null };
/** Product information shown with an assistant answer that cited it (decided by the server). */
export type AiProductCard = {
  label: 'P1' | 'P2';
  productId: string;
  slug: string;
  brand: string;
  nameAr: string;
  nameEn: string;
  summaryAr: string;
  summaryEn: string;
  warningsAr: string;
  warningsEn: string;
  imageId: string | null;
  indication: ProductKnowledgeItem | null;
};
