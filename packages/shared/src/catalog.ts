import { z } from 'zod';
import { CONTENT_APPROVAL_STATUSES, STOCK_STATUSES } from './enums';

/**
 * Admin Console — catalogue management contracts (migration 0008).
 *
 * The store sells only company-owned brands (TetraSol today). Brands, categories and products are
 * data, so a future company product line is added by an administrator without an app update.
 * Lifecycle: DRAFT → PUBLISHED ⇄ UNPUBLISHED → ARCHIVED. Only APPROVED content can be published;
 * editing customer-facing medical text sends a product back to review and off the store; the
 * approver must be a different person from the last editor (enforced by the database).
 */
export const PUBLICATION_STATUSES = ['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];
export const STOCK_REASONS = ['INITIAL', 'RESTOCK', 'SALE', 'RETURN', 'DAMAGE', 'CORRECTION'] as const;
export const DISCOUNT_KINDS = ['PERCENT', 'FIXED_AMOUNT'] as const;
export const DISCOUNT_SCOPES = ['ALL', 'CATEGORY', 'PRODUCT', 'VARIANT', 'BUNDLE'] as const;
export const PRODUCT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** 2 MB — enforced again by the database. */
export const PRODUCT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase letters, digits and dashes').max(80);
const text = (max: number) => z.string().trim().max(max);
const required = (max: number) => z.string().trim().min(1).max(max);

// ---------------------------------------------------------------- brands & categories
export const brandBody = z.object({
  name: z.string().trim().min(2).max(60),
  ownerEntity: z.string().trim().min(2).max(160),
  ownershipReference: z.string().trim().min(3).max(300),
});
export const brandPatchBody = brandBody.omit({ name: true }).partial().extend({ active: z.boolean().optional() });
export type Brand = { name: string; ownerEntity: string; ownershipReference: string; active: boolean; createdAt: string };

export const categoryBody = z.object({ slug, nameAr: required(60), nameEn: required(60), sortOrder: z.number().int().min(0).max(10_000).default(100) });
export const categoryPatchBody = categoryBody.partial().extend({ active: z.boolean().optional() });
export type Category = { id: string; slug: string; nameAr: string; nameEn: string; sortOrder: number; active: boolean };

// ---------------------------------------------------------------- products
const productContent = {
  nameAr: required(120),
  nameEn: required(120),
  summaryAr: required(300),
  summaryEn: required(300),
  descriptionAr: required(4000),
  descriptionEn: required(4000),
  usageAr: required(2000),
  usageEn: required(2000),
  /** Approved uses — only what the brand owner's authorised product information supports. */
  approvedUsesAr: text(2000),
  approvedUsesEn: text(2000),
  warningsAr: text(2000),
  warningsEn: text(2000),
  regulatoryNote: text(500).nullable().optional(),
};
export const productCreateBody = z.object({ slug, brand: z.string().trim().min(2).max(60), categoryId: z.string().uuid().nullable().optional(), sortOrder: z.number().int().min(0).max(10_000).default(100), ...productContent });
export const productPatchBody = z
  .object({ brand: z.string().trim().min(2).max(60), categoryId: z.string().uuid().nullable(), sortOrder: z.number().int().min(0).max(10_000), ...productContent })
  .partial();
export const productApprovalBody = z.object({
  /** Reference to the brand owner's / regulatory approval of exactly this text (document id, letter, ticket). */
  approvalReference: z.string().trim().min(3).max(200),
});
export const productPublicationBody = z.object({ status: z.enum(['PUBLISHED', 'UNPUBLISHED', 'ARCHIVED']) });

export const variantBody = z.object({
  sku: z.string().trim().regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/, 'uppercase letters, digits and dashes'),
  labelAr: required(80),
  labelEn: required(80),
  pricePiasters: z.number().int().min(1).max(100_000_000),
  sortOrder: z.number().int().min(0).max(10_000).default(100),
  lowStockThreshold: z.number().int().min(0).max(100_000).default(5),
  /** Only for variants whose quantity is not tracked; tracked variants derive it from the quantity. */
  stockStatus: z.enum(STOCK_STATUSES).optional(),
});
export const variantPatchBody = variantBody.omit({ sku: true }).partial().extend({ active: z.boolean().optional() });
export const stockAdjustBody = z.object({
  delta: z.number().int().min(-100_000).max(100_000).refine((n) => n !== 0, 'must not be zero'),
  reason: z.enum(STOCK_REASONS),
  note: text(300).optional(),
});

export const imageUploadBody = z.object({
  contentType: z.enum(PRODUCT_IMAGE_TYPES),
  /** Base64 of the file (≤ 2 MB decoded). The server checks the bytes match the declared type. */
  dataBase64: z.string().min(100).max(Math.ceil((PRODUCT_IMAGE_MAX_BYTES * 4) / 3) + 8),
  altAr: text(200).default(''),
  altEn: text(200).default(''),
  sortOrder: z.number().int().min(0).max(10_000).default(100),
});
export const imagePatchBody = z.object({ altAr: text(200), altEn: text(200), sortOrder: z.number().int().min(0).max(10_000) }).partial();

export type AdminVariant = {
  id: string;
  sku: string;
  labelAr: string;
  labelEn: string;
  pricePiasters: number;
  stockStatus: (typeof STOCK_STATUSES)[number];
  stockQuantity: number | null;
  lowStockThreshold: number;
  active: boolean;
  sortOrder: number;
};
export type ProductImageMeta = { id: string; contentType: string; width: number | null; height: number | null; altAr: string; altEn: string; sortOrder: number; bytes: number };
export type StockMovement = { id: string; variantId: string; delta: number; quantityAfter: number; reason: (typeof STOCK_REASONS)[number]; note: string | null; actorName: string | null; createdAt: string };

export type AdminProductListItem = {
  id: string;
  slug: string;
  brand: string;
  nameAr: string;
  nameEn: string;
  categoryId: string | null;
  contentStatus: (typeof CONTENT_APPROVAL_STATUSES)[number];
  publicationStatus: PublicationStatus;
  isDemo: boolean;
  variantCount: number;
  fromPricePiasters: number | null;
  lowStock: boolean;
  imageId: string | null;
  updatedAt: string;
};
export type AdminProduct = AdminProductListItem & {
  summaryAr: string;
  summaryEn: string;
  descriptionAr: string;
  descriptionEn: string;
  usageAr: string;
  usageEn: string;
  approvedUsesAr: string;
  approvedUsesEn: string;
  warningsAr: string;
  warningsEn: string;
  regulatoryNote: string | null;
  sortOrder: number;
  approvalReference: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  lastEditedByName: string | null;
  /** True when the caller edited the content last — they cannot approve it (separation of duties). */
  editedByMe: boolean;
  publishedAt: string | null;
  archivedAt: string | null;
  /** Only never-published drafts can be deleted; everything else is archived. */
  deletable: boolean;
  variants: AdminVariant[];
  images: ProductImageMeta[];
  stockMovements: StockMovement[];
};

// ---------------------------------------------------------------- discounts
export const discountBody = z
  .object({
    nameAr: required(80),
    nameEn: required(80),
    /** Empty = applied automatically; otherwise entered by the customer at checkout. */
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{4,24}$/).nullable().optional(),
    kind: z.enum(DISCOUNT_KINDS),
    value: z.number().int().min(1).max(100_000_000),
    scope: z.enum(DISCOUNT_SCOPES),
    targetId: z.string().uuid().nullable().optional(),
    minSubtotalPiasters: z.number().int().min(0).max(100_000_000).default(0),
    startsAt: z.string().datetime({ offset: true }).optional(),
    endsAt: z.string().datetime({ offset: true }).nullable().optional(),
    active: z.boolean().default(false),
  })
  .refine((d) => d.kind !== 'PERCENT' || d.value <= 90, { message: 'A percentage discount is at most 90%', path: ['value'] })
  .refine((d) => (d.scope === 'ALL') === !d.targetId, { message: 'Choose a target for this scope (and none for ALL)', path: ['targetId'] });
export const discountPatchBody = z.object({ active: z.boolean(), endsAt: z.string().datetime({ offset: true }).nullable(), nameAr: required(80), nameEn: required(80) }).partial();
export type Discount = {
  id: string;
  nameAr: string;
  nameEn: string;
  code: string | null;
  kind: (typeof DISCOUNT_KINDS)[number];
  value: number;
  scope: (typeof DISCOUNT_SCOPES)[number];
  targetId: string | null;
  minSubtotalPiasters: number;
  startsAt: string;
  endsAt: string | null;
  active: boolean;
};

// ---------------------------------------------------------------- bundles
export const bundleBody = z.object({ slug, nameAr: required(120), nameEn: required(120), descriptionAr: text(1000).default(''), descriptionEn: text(1000).default(''), pricePiasters: z.number().int().min(1).max(100_000_000) });
export const bundlePatchBody = bundleBody.omit({ slug: true }).partial();
export const bundleItemsBody = z.object({ items: z.array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(1).max(10) })).min(1).max(20) });
export const bundlePublicationBody = z.object({ status: z.enum(['PUBLISHED', 'UNPUBLISHED', 'ARCHIVED']) });
export type Bundle = {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  pricePiasters: number;
  /** Sum of the items at their current prices — the saving shown to customers is computed, not typed. */
  itemsValuePiasters: number;
  publicationStatus: PublicationStatus;
  items: { variantId: string; quantity: number; productNameAr: string; productNameEn: string; variantLabelAr: string; variantLabelEn: string; unitPricePiasters: number }[];
};

// ---------------------------------------------------------------- analytics
export type CatalogAnalytics = {
  days: number;
  /** Real paid orders only. Checkout is not enabled yet, so this is zero until a payment integration exists. */
  paidOrders: number;
  revenuePiasters: number;
  checkoutEnabled: boolean;
  funnel: { productViews: number; addToCart: number; checkoutPreviews: number };
  products: { productId: string; nameAr: string; nameEn: string; views: number; addToCart: number; paidUnits: number }[];
  lowStock: { variantId: string; sku: string; productNameEn: string; productNameAr: string; quantity: number; threshold: number }[];
};
