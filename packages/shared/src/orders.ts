import { z } from 'zod';
import { GOVERNORATES } from './enums';

/** TetraSol orders and payments (ADR 0022). Amounts in piasters; prices always come from the server. */
export const ORDER_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'EXPIRED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const PAYMENT_STATUSES = ['UNPAID', 'PENDING', 'AUTHORIZED', 'PAID', 'SETTLED', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
/** The only statuses in which an order may be described as paid. */
export const PAID_STATUSES: readonly PaymentStatus[] = ['PAID', 'SETTLED', 'PARTIALLY_REFUNDED', 'REFUNDED'];

export const placeOrderBody = z
  .object({
    /** Client-generated per checkout attempt: retries and double taps return the same order. */
    idempotencyKey: z.string().trim().min(8).max(80),
    discountCode: z.string().trim().max(24).optional(),
    delivery: z.object({
      recipientName: z.string().trim().min(2).max(80),
      phone: z.string().trim().min(6).max(20),
      governorate: z.enum(GOVERNORATES),
      city: z.string().trim().min(1).max(80),
      district: z.string().trim().max(80).optional().nullable(),
      address: z.string().trim().min(5).max(300),
      notes: z.string().trim().max(300).optional().nullable(),
    }),
    /** What the customer saw. If the server total differs, the order is refused (PRICE_CHANGED). */
    expectedTotalPiasters: z.number().int().positive().optional(),
  })
  .strict();
export type PlaceOrderBody = z.infer<typeof placeOrderBody>;

export type OrderLine = { id: string; variantId: string | null; bundleId: string | null; sku: string | null; nameAr: string; nameEn: string; labelAr: string; labelEn: string; unitPricePiasters: number; quantity: number; lineTotalPiasters: number };
export type OrderEvent = { event: string; actorRole: 'CUSTOMER' | 'STAFF' | 'SYSTEM' | 'PAYMENT_PROVIDER'; status: OrderStatus; paymentStatus: PaymentStatus; note: string | null; at: string };
export type OrderPayment = { id: string; provider: 'PAYMOB'; mode: 'TEST' | 'LIVE'; status: PaymentStatus; amountPiasters: number; refundedPiasters: number; transactionId: string | null; createdAt: string; settledAt: string | null };
export type OrderRefund = { id: string; amountPiasters: number; reason: string; restock: boolean; status: 'REQUESTED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED'; failureCode: string | null; createdAt: string };

export type Order = {
  id: string;
  reference: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  /** True only when a verified provider payment exists (never inferred from the client). */
  paid: boolean;
  subtotalPiasters: number;
  discountPiasters: number;
  deliveryFeePiasters: number;
  totalPiasters: number;
  refundedPiasters: number;
  currency: 'EGP';
  discount: { code: string | null; nameAr: string | null; nameEn: string | null } | null;
  delivery: { recipientName: string; phone: string; governorate: string; city: string; district: string | null; address: string; notes: string | null };
  paymentExpiresAt: string;
  trackingReference: string | null;
  cancelReason: string | null;
  isDemo: boolean;
  lines: OrderLine[];
  events?: OrderEvent[];
  payments?: OrderPayment[];
  refunds?: OrderRefund[];
  can: { pay: boolean; cancel: boolean };
  createdAt: string;
};

export type StartPaymentResponse = { orderId: string; paymentId: string; checkoutUrl: string; mode: 'TEST' | 'LIVE' };

export const fulfilOrderBody = z.object({ action: z.enum(['PROCESS', 'SHIP', 'DELIVER']), trackingReference: z.string().trim().max(80).optional() }).strict();
export const staffCancelOrderBody = z.object({ reason: z.string().trim().min(5).max(500) }).strict();
export const refundOrderBody = z.object({ amountPiasters: z.number().int().positive(), reason: z.string().trim().min(5).max(500), restock: z.boolean().default(false) }).strict();
export const deliveryZoneBody = z
  .object({
    active: z.boolean(),
    feePiasters: z.number().int().min(0).max(1_000_000).nullable(),
    freeOverPiasters: z.number().int().positive().nullable().optional(),
    etaMinDays: z.number().int().min(0).max(30).nullable().optional(),
    etaMaxDays: z.number().int().min(0).max(60).nullable().optional(),
  })
  .strict();
export type DeliveryZone = { governorate: string; active: boolean; feePiasters: number | null; freeOverPiasters: number | null; etaMinDays: number | null; etaMaxDays: number | null };

export type OpsOrder = {
  id: string;
  reference: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  totalPiasters: number;
  refundedPiasters: number;
  governorate: string;
  itemCount: number;
  isDemo: boolean;
  createdAt: string;
  paidAt: string | null;
};
export type OpsPayment = {
  id: string;
  orderId: string;
  orderReference: string;
  mode: 'TEST' | 'LIVE';
  status: PaymentStatus;
  amountPiasters: number;
  refundedPiasters: number;
  transactionId: string | null;
  providerOrderId: string | null;
  settledAt: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
};
export type ReconcileResult = { checked: number; applied: number; unchanged: number; mismatches: number; errors: number; inquiry: 'AVAILABLE' | 'NOT_CONFIGURED' };
