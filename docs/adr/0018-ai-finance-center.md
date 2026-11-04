# ADR 0018 — AI Finance Center: metered costs, budgets, reconciliation, verified revenue only

- Status: accepted (2026-11-04) — implemented; no real provider, store or payment gateway is connected, so the figures in development are zeros and "not connected" states
- Extends: [ADR 0008 AI gateway](0008-ai-gateway.md), [ADR 0016](0016-rate-limit-policy.md)
- Code: migration `0028_finance_center.sql`; `apps/api/src/modules/finance/routes.ts`; `packages/shared/src/finance.ts`; admin `src/app/finance/page.tsx`
- Tests: `apps/api/test/finance.test.ts`, `e2e/tests/flow-e-finance.spec.ts`

## Context
The owner needs to see what AI costs — today, this week, this month — by provider, model,
feature, subscription plan and account, against the approved budget, and to compare it with
revenue. The platform meters every AI request (provider-reported tokens × registry price) but did
not present it for finance. Revenue is a trap: store proceeds are reported by Apple and Google,
not to this platform; card payments are not configured; demo data exists. Showing estimates or
demo figures as revenue or profit would be misleading.

## Decision
1. **One read-only overview** (`GET /v1/admin/finance/overview`, permission `finance.read`):
   - spend today / week / month (Cairo calendar) and for the chosen period, **real providers
     only** — usage plus company evaluation runs; simulator requests are counted, never as money;
   - the part priced at an **unverified** registry price is shown separately ("estimated");
   - budget: monthly limit, month spend, straight-line projection, state (`NO_BUDGET`, `OK`,
     `WARNING` ≥ 80 %, `PROJECTED_OVER`, `EXCEEDED`), plan budgets and the 50/80/100 % alerts the
     gateway already raises;
   - breakdowns by provider, model (answered / failed, cost without a usable answer, cost per
     answer, per 1k output tokens), feature (route), plan; voice minutes; lab-report reading;
   - top accounts by an **8-character pseudonymous reference** — no names, contact details or content.
2. **Reconciliation.** Finance staff (`finance.manage`) enter what each provider invoiced for a
   month; the overview shows metered vs invoiced and the difference. Entries are append-only
   (corrections supersede) and audited.
3. **Revenue = verified records only.** Platform fees from the provider ledger (demo rows excluded
   and shown as such), store-verified subscription counts; App Store / Google Play proceeds and card
   payments are shown as **not connected**. No exchange rate is applied (costs USD, revenue EGP),
   no net result or profit is calculated, and the console lists what the numbers do not include.
4. **Nothing moves money.** There is no payout, withdrawal or transfer endpoint (tested).
5. **Least privilege.** `finance.read` / `finance.manage` are separate permissions (ADMIN today);
   subscription and ledger figures come from aggregate-only SECURITY DEFINER functions, so finance
   staff never need `users.read`.

## Consequences
- The owner sees real AI spend and budget risk as soon as a real provider is enabled.
- Revenue stays empty until store financial reports or a payment gateway are connected — by design.
- Provider invoices must be entered monthly to make reconciliation meaningful.

## Not done (needs owner input)
- Connecting App Store Connect / Play Console financial reports (proceeds after commission and tax).
- A dedicated finance role (today only ADMIN holds the permissions).
- Verified registry prices (all seeded prices are unverified, so any real usage shows as estimated).
