# ADR 0007 — Payments behind a gateway abstraction; no simulated success

- Status: accepted (2026-10-14)

## Decision
`PaymentGateway` (Paymob first) exposes `createIntent` and constant-time `verifyWebhook`. Until the
real Paymob adapter is implemented and verified against its sandbox, the gateway reports
`NOT_CONFIGURED` and throws on use. The checkout endpoint returns a server-computed **preview**
flagged `simulated: true, canPlaceRealOrder: false`; no order is created and the UI says so.
Payment success will only ever be set from a verified provider webhook/inquiry, with idempotency keys.
