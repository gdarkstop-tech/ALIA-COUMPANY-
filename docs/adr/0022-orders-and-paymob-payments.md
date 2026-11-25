# ADR 0022 — TetraSol orders and Paymob payments

- Status: accepted (2026-11-25). Implemented and tested against a **local mock of Paymob's documented
  API** only. No Paymob account, test or live, exists yet: the gateway is `NOT_CONFIGURED`,
  `commerce.checkout` is off, every delivery zone is off, and no real or sandbox payment was made.
- Code: migration `0032_orders_payments.sql`; `apps/api/src/integrations/payments.ts`;
  `apps/api/src/modules/orders/routes.ts`; `apps/api/src/modules/store/routes.ts` (preview).
- Tests: `apps/api/test/orders.test.ts` (21).
- Sources (fetched 2026-11-25): developers.paymob.com — Create Intention, Unified Checkout
  (Redirection), Transaction callbacks, HMAC Transaction Callback, Transaction Inquiry (by
  transaction ID; by order ID or reference), Authentication Request; refund / void request shapes
  from Paymob's own integration guide (github.com/PaymobAccept).

## Context
The store had a catalogue, cart, discounts and a checkout *preview*; nothing could be ordered or
paid. Phase 8 asks for real orders (stock, delivery fees, idempotency, fulfilment, cancellation,
refunds) and Paymob payments (server-side initialisation, verified callbacks, replay protection,
reconciliation, distinct payment states, test mode until authorised), without ever handling card
data or calling an order paid that was not verified, and without moving digital subscriptions off
Apple / Google billing.

## Decision
1. **The database decides.** `app.order_place` prices the customer's server-side cart from the
   catalogue (only items on sale), picks the best applicable discount with the preview's rules, adds
   the configured delivery fee of the governorate (`app.delivery_zones`, managed by commerce staff,
   all off by default; free-delivery threshold optional) and refuses a total that differs from what
   the customer saw (`PRICE_CHANGED`). The client never sends a price.
2. **No overselling.** Stock is reserved when the order is placed (`reserved_quantity`, a check
   constraint keeps it within `stock_quantity`), locking variants in a fixed order *before* any row
   referencing them is written (a first version deadlocked under concurrency; the test caught it).
   Units leave stock (`SALE` movement) only when payment is verified; unpaid orders expire after 30
   minutes and release them; cancellation before shipment releases or restocks. Untracked stock
   cannot be ordered. Tested: five customers racing for the last three units → exactly three orders.
3. **No duplicate orders.** One order per `(customer, idempotency key)`, serialised by an advisory
   lock; repeated or parallel submissions return the same order.
4. **States.** Order: `PENDING_PAYMENT → CONFIRMED → PROCESSING → SHIPPED → DELIVERED`, or
   `CANCELLED` / `EXPIRED`. Payment (separate): `UNPAID`, `PENDING`, `AUTHORIZED`, `PAID`, `SETTLED`,
   `FAILED`, `PARTIALLY_REFUNDED`, `REFUNDED`, `VOIDED`. The API's `paid` flag is true only for
   verified paid / settled / refunded states. Every change is in `app.order_events`.
5. **Paymob, as documented.** Intention API (`POST /v1/intention/`, `Authorization: Token <secret
   key>`) with the order total in piasters and our reference as `special_reference`; the customer pays
   on Paymob's hosted Unified Checkout (`eg.checkout.paymob.com/?publicKey=…&clientSecret=…`), so card
   data never reaches us. One order-level line is sent — no product names on the payment page.
6. **Callbacks.** `POST /v1/webhooks/paymob?hmac=…`: HMAC-SHA512 over Paymob's 20 fields in their
   documented order (verified against the sample string in Paymob's docs), timing-safe; forged or
   altered → 403. With an API key, the transaction is **re-read from Paymob** before anything
   changes. Each verified callback is recorded once (`payment_events`, unique key) — replays are
   no-ops. Amount, currency, Paymob order and test/live mode must match what we charged; otherwise a
   HIGH incident and no change. A payment never moves backwards (a late "failed" cannot unpay an
   order). Money arriving for an expired or cancelled order is recorded as paid and escalated (refund
   or fulfil) — never hidden. The customer redirect page verifies its signature but never changes an
   order (Paymob's own guidance).
7. **Reconciliation.** Every 10 minutes (and on demand from operations, audited) payments without a
   final state, or paid but not yet settled, are checked with Paymob's transaction inquiry (by
   transaction, or by Paymob order when the callback never arrived) and applied through the same
   function. Settlement (`is_settled`) moves `PAID → SETTLED`.
8. **Refunds.** `payments.refund` (administrators) only, bounded by paid minus refunded minus
   in-flight; the request is committed before Paymob is called, then settled with the outcome.
   Failures open a HIGH `REFUND_FAILED` incident; optional restock. All audited.
9. **Test mode.** Keys are classified test / live from their prefix; mixed keys or live keys without
   `PAYMOB_LIVE_APPROVED=true` leave the gateway `NOT_CONFIGURED`. Payments record their mode.
10. **Boundaries.** Physical TetraSol products only; subscriptions stay on StoreKit / Google Play
    (billing module untouched). Orders hold no clinical data; commerce staff (`orders.manage`,
    `payments.read`) never see appointments or care incidents. Account deletion cancels unpaid
    orders and removes delivery details of closed ones (orders kept for accounting).

## Not done / limits
- No real Paymob request has been made; the first sandbox test needs the company's Paymob test
  account (secret / public keys, HMAC secret, integration IDs, API key) and a public callback URL.
- No delivery-partner integration: tracking references are entered by staff.
- No invoices / e-receipts (Egyptian e-invoicing / ETA) yet.
- Cash on delivery is not offered.
