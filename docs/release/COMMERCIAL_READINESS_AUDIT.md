# Commercial and release readiness audit — 2026-11-07

Every statement below was checked against the code on branch `claude/confident-babbage-ab865a`.
"Works" means implemented and covered by automated tests on the web harness and API; **nothing has
been tested on a physical device** ([device test guide](DEVICE_TEST_GUIDE.md)).

## 1. Status by area

| Area | Works today | Simulated / disabled | Still to build | Needs from the owner |
|---|---|---|---|---|
| Doctor appointment booking | Directory of verified doctors (verification workflow, credentials, specialties, fees, working hours); admin can restrict an account's bookings | Booking button shows "not yet released" (`BOOKING_NOT_YET_RELEASED`) — nothing is advertised as bookable | Slots, booking, confirmation by the doctor, cancellation / no-show rules, reminders, payment, receipts | Booking and cancellation policy; fee and commission model; payment gateway |
| Nurse home visits | Nursing service catalogue, each nurse's services and prices, governorate / city coverage | Same — not bookable | Visit request, scheduling, address capture and privacy, dispatch / acceptance, visit notes, earnings ledger (table exists, demo rows only) | Service area and pricing policy; nurse contracts; payment gateway |
| TetraSol checkout | Catalogue (approved products only), cart, discounts, server-side checkout **preview** (no order is created; states payment is not configured) | `commerce.checkout` flag OFF; payment shown as `NOT_CONFIGURED` | Orders, Paymob payment intent + webhook (HMAC), fulfilment / shipping, invoices, refunds and returns | Paymob merchant account and keys; delivery partner; tax / invoicing rules; TetraSol product data and approved claims |
| Paymob payments | Adapter interface | Stub reports `NOT_CONFIGURED` even when keys exist; webhook verification always refuses | Real adapter verified in the Paymob sandbox | Merchant contract, integration IDs, HMAC secret |
| Apple StoreKit subscriptions (Silver / Gold / Platinum) | Server: signed-transaction verification with Apple's library, App Store Server Notifications V2, entitlement state machine (fixture tests); app: `expo-iap` purchase / restore | `NOT_CONFIGURED` (no bundle / app ID, root certificates) | Sandbox and TestFlight purchase tests | Apple Developer organisation, App Store Connect app, subscription products and prices, App Store Server Notification URL |
| Google Play subscriptions | Server: RTDN endpoint with Pub/Sub OIDC audience check, purchase verification through the Play Developer API; app: `expo-iap` | `NOT_CONFIGURED` | License-tester purchase tests | Play Console app, products, service account, Pub/Sub topic |
| E-mail and SMS | Development outbox (every message visible to developers) | Production `NOT_CONFIGURED` for both | **Provider adapters** (e-mail: SMTP / SES-type; SMS: an Egyptian sender-ID provider) with delivery status | Providers, sender domain (SPF / DKIM / DMARC), SMS sender ID registration |
| Production authentication | E-mail + password, sessions, device list, TOTP two-step (mandatory for staff and clinicians in production), strict sign-in / OTP limits, origin and CSRF checks, start-up refusal of unsafe production settings | Phone OTP and e-mail verification depend on SMS / e-mail | Nothing in the code beyond the e-mail / SMS adapters | — |
| Family / caregiver access | Profiles for family members with owner / guardian / caregiver access, consent attestation, RLS-enforced, tested | — | — | Legal review of guardian / minor rules |
| Clinical consent | Terms, privacy and health-data consent (append-only ledger, enforced by the database); AI assistant / voice / document consents; wound A / B / C; care shares with an explicit wound toggle | Texts are `2026-10-draft` | — | Legal approval of every consent text |
| Wound scanning | Registry complete (ADR 0015); production S3 + SSE-KMS adapter verified on an emulator (ADR 0017) | All wound flags OFF; production storage `NOT_CONFIGURED`; AI on wound photos disabled | — | Bucket, KMS key, contract, DPIA, PDPL / cross-border approvals, ethics approvals |
| AI | Gateway, routing, quotas, budgets, Finance Center, provider states and kill switch | Every real provider `NOT_CONFIGURED`; development simulator only | — | Business-owned provider keys, DPAs, verified prices, monthly budget |

## 2. Store-submission blockers (14)

The release check (`pnpm release:check`) reports 14 blockers: the English and Arabic store
listings and six legal / consent documents in both languages. **All 14 are placeholders for facts
only the company can supply.** None was filled in, because doing so would invent legal facts. The
check now lists every placeholder exactly, testing each sentence on its own; before, it showed only
the first match, and that match could be a false hit on JSON array brackets.

| Placeholder | Where | Supplied by |
|---|---|---|
| Support domain (support, privacy, terms and account-deletion URLs) | store listings EN / AR | Company (domain + hosting of `apps/site`) |
| Legal entity name of Alia Group | listings, privacy policy, terms | Company legal |
| Privacy contact e-mail | privacy policy | Company (DPO / privacy contact) |
| Hosting provider and region | privacy policy | Company (hosting decision) |
| Retention period (logs, backups) | privacy policy | Legal (design proposal: backups ≤ 30 days, ADR 0017) |
| Dispute-resolution clause | terms | Legal |
| AI provider names, processing locations, provider retention terms | privacy policy; AI assistant, voice, document consents; clinician AI terms | Legal, after choosing providers and signing DPAs |
| Providers' audio retention | voice consent | Legal |

Then: legal approval of all texts, bump the consent versions (`2026-10-draft` → approved
version), run `pnpm release:check --submission` (must show 0 blockers).

## 3. Owner-supplied requirements checklist

**Accounts and contracts**
- [ ] Apple Developer Program (organisation), App Store Connect app, subscription products
- [ ] Google Play Console app, subscription products, service account, RTDN Pub/Sub topic
- [ ] Expo / EAS project (`EAS_PROJECT_ID`, `EXPO_OWNER`), Play upload key, Apple certificates via EAS
- [ ] Hosting: PostgreSQL with point-in-time recovery, Redis, API hosting, CDN / WAF, domain + TLS
- [ ] Photo storage: private bucket, KMS key, `OBJECT_STORAGE_KEY` in the secret manager, `OBJECT_STORAGE_APPROVAL_REF` ([infra/storage](../../infra/storage/README.md))
- [ ] AI: business-owned keys per chosen provider, signed DPAs, verified prices, approved monthly budget ([AI gateway](AI_GATEWAY.md))
- [ ] Paymob merchant contract and keys; delivery partner for TetraSol orders
- [ ] E-mail provider and sender domain; SMS provider and registered sender ID

**Legal, regulatory and clinical**
- [ ] The eight placeholder facts above; legal approval of terms, privacy, health-data, AI and wound (A / B / C, presentation) texts
- [ ] PDPL registration / licence, DPIA, cross-border transfer authorisation where data leaves Egypt
- [ ] Confirmation of emergency numbers (Ministry of Health and Population)
- [ ] Medical-affairs approval of TetraSol product claims and of the presentation process; ethics approvals per research dataset
- [ ] Clinical validation before any AI clinical feature is enabled (wound assessment stays off)

**Testing**
- [ ] Staging environment with synthetic data only, then the device campaign in the [device test guide](DEVICE_TEST_GUIDE.md)
- [ ] StoreKit sandbox / TestFlight and Play license-tester purchase tests
- [ ] Penetration test of API, admin console and mobile app before launch

## 4. Recommended build order for the remaining product work
1. E-mail and SMS adapters (production sign-up and phone sign-in depend on them).
2. TetraSol orders + Paymob (sandbox) — the first revenue path that needs no clinical approval.
3. Doctor booking, then nurse home visits (largest scope: scheduling, payments, policies).
4. Store financial-report import for the Finance Center (store proceeds).
