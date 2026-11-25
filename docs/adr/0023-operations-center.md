# ADR 0023 — Admin Operations Center

- Status: accepted (2026-11-25) — implemented.
- Code: `apps/admin/src/app/ops/*` (overview, appointments, schedules, home-visits, orders, delivery,
  payments, notifications, incidents), `apps/admin/src/components/ops.tsx`, `ops-appointments.tsx`;
  API additions `GET /v1/admin/ops/schedules` (appointments module) and `GET /v1/admin/ops/refunds`
  (orders module).
- Tests: `apps/api/test/appointments.test.ts` (schedules: setup, load, no patient data, 403 for
  commerce staff and patients), `apps/api/test/orders.test.ts` (refund queue: payments.read only);
  E2E `e2e/tests/flow-e-ops.spec.ts` (every section, Arabic RTL, axe, no access for a reviewer).

## Context
Phase 8 added bookings, home visits, orders, payments and message delivery, each with an
operations API (ADR 0020–0022). Staff need one place to see what needs attention and to act —
without widening anyone's access, without clinical records, and without the console inventing
activity while providers (Paymob, e-mail, SMS) are not configured.

## Decision
1. **One console section, permission-shaped.** `/ops` is a single area in the existing admin
   console. Each section declares the permissions that show it: care sections (appointments,
   schedules, home-visit requests, message delivery) need `ops.read`; orders, fulfilment and
   delivery zones need `orders.manage`; payments and the refund queue need `payments.read`;
   incidents need `ops.read` or `orders.manage`. The tabs are filtered in the UI, but the API checks
   the same permission on every call and RLS limits the rows (commerce staff only ever receive
   commerce incidents; appointments are invisible to them). No new role or permission was added.
2. **No clinical data.** Appointment rows carry the booking display name, time, provider, area,
   price and status — never notes, addresses or contact numbers. The schedules endpoint returns
   only provider setup (hours, offerings, coverage, time off, booking block) and counts.
3. **Schedules are read-only.** The console shows why a provider cannot be booked
   (`provider_booking_block`) but never edits a clinician's hours: availability is the provider's
   own statement, and slots exist only where they published hours (no fabricated availability).
4. **Actions are the existing audited functions.** Cancel a booking, open or close a home-care
   area, process / ship / deliver / cancel an order, refund (administrators), reconcile
   (administrators), retry a message, acknowledge / resolve an incident — each calls the API route
   that already writes the audit log. Reasons are entered in an inline form under the row (no
   modal), which keeps keyboard and screen-reader users in context.
5. **Honest states.** Provider status comes from the server (`NOT_CONFIGURED` is shown as such,
   reconcile is disabled without a configured gateway). "Paid" appears only from the server's
   verified payment state. Home-visit pages repeat that nurses are never auto-assigned and that home
   visits are not an emergency service.

## Consequences
- An operations person with `ops.read` but not `orders.manage` sees no order data, and the reverse.
- Alerting (pager / chat) and an on-call rota are not part of this change; the overview is a
  pull-based screen.
