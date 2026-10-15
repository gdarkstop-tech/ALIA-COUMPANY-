# Payment compliance: Dress My Wound | غير لي

Verified on: 2026-10-15

> **Overall: NOT ready for submission, and store subscriptions are not ready to switch on.** The feature flag `billing.store_subscriptions` is OFF. No Apple or Google product exists. Both server store adapters report `NOT_CONFIGURED`. Paymob reports `NOT_CONFIGURED`, so checkout is a preview only. No Gold or Platinum benefit is enforced in code yet. The mixed digital/real-world plan design has no official answer from either store. No line in this document is `DEVICE_TESTED`, `READY_FOR_SUBMISSION`, `SUBMITTED` or `APPROVED`: no iOS binary exists; the final Android production build (2026-10-15) contains the Play Billing client but is signed only with the local debug key, points at a placeholder API and has never run on a device; and no purchase has ever been made against either store. Overall release status lives in `docs/release/RELEASE_STATUS.md`.

- **Scope:** which payment rail each kind of purchase uses, the policy basis, plans and prices, the server-side entitlement service, what the tests prove, the open mixed-benefits issue, account deletion with an active subscription, and the configuration that needs developer accounts.
- **Requirements** come only from `docs/release/evidence/STORE_REQUIREMENTS_EVIDENCE.md` (verified 2026-10-14). Only `[verified-official]` findings are treated as requirements. Everything else is marked **to confirm**. Source IDs such as [A1] resolve to URLs in §12.
- **Companion documents:** `docs/release/APPLE_APP_STORE_CHECKLIST.md` §8, `docs/release/GOOGLE_PLAY_CHECKLIST.md` §6, `docs/release/RELEASE_STATUS.md`.

---

## 0. How to read this document

**Status taxonomy.** Statuses are used exactly as listed: `CODE_READY` · `BUILT` · `DEVICE_TESTED` · `STORE_METADATA_READY` · `NEEDS_ACCOUNT_ACTION` · `NEEDS_REGULATORY_EVIDENCE` · `NEEDS_LEGAL_APPROVAL` · `NEEDS_OFFICIAL_ASSETS` · `NEEDS_STORE_REVIEW` · `READY_FOR_SUBMISSION` · `SUBMITTED` · `APPROVED`.
- A line can carry several statuses: the stage it has reached, then whatever still blocks it.
- **open (not CODE_READY)** means engineering work is still outstanding, so the line has not reached any status yet. This is the same convention the store checklists use.
- `BUILT` applies to **Android only**. The final production APK and AAB (2026-10-15, `APP_VARIANT=production`) contain `expo-iap` and Play Billing Library 9.1.0 (§5.5). They are debug-signed locally and cannot be distributed. No iOS binary exists, so nothing is `BUILT` for iOS. The 2026-10-14 production APK was superseded: it had a launch-crash bug and no billing client, and it must not be used.

**Verification labels:** verified by automated test (file) · verified by native build inspection · verified by config inspection · not verified.
- "Automated test" means the test passed on 2026-10-15.
- "Native build inspection" means `aapt2` inspection of the 2026-10-15 local Android APK and of the AAB's manifest. It never means an iOS binary.
- E2E tests run against the Expo **web** build, which is only a proxy for the native apps. The web build has no store (`apps/mobile/src/features/billing/iap.web.ts` fails closed), so **no E2E test exercises a purchase**.

---

## 1. At a glance

| Bucket | Items |
|---|---|
| **Completed implementation** (code) | Payment-rail classifier with no override parameter. Server-side Apple and Google verification adapters. Entitlement service: account-token binding, idempotent append-only event log, stale-event protection, refund and revocation handling, sandbox limited to review and internal accounts in production. Apple and Google webhooks. Google acknowledgement. Restore and Manage subscription. Plans screen. Deletion notice for active store subscriptions. `expo-iap` 6.0.2 client (type-checked). |
| **Built** (`BUILT`, Android only) | The 2026-10-15 Android production APK and AAB include the Play Billing client: `com.android.vending.BILLING`, `com.google.android.play.billingclient.version` = `9.1.0`, and `ProxyBillingActivity` (not exported). They are debug-signed, point at the placeholder API, and have never run on a device. No iOS binary exists (§5.5). |
| **Verified by automated test** | `apps/api/test/billing.test.ts` (10 tests, §6). `apps/api/test/compliance.test.ts` (all flags OFF by default; users cannot promote themselves to a review account; account deletion). `e2e/tests/a11y.spec.ts` (subscription screen renders and passes WCAG 2.2 A/AA checks on the web build). |
| **Requires developer account** (`NEEDS_ACCOUNT_ACTION`) | Organization accounts. App records. Subscription group and products. Play subscriptions and base plans. Store price points. App Store Server Notifications URL. Google Cloud service account, Pub/Sub topic and RTDN push. Apple root certificates on the server. Server environment variables. Product IDs in `app.billing_plan_offers`. License and sandbox testers. Paymob merchant account. |
| **Requires official assets** (`NEEDS_OFFICIAL_ASSETS`) | Final store screenshots: the drafts are temporary placeholders, and none may show prices (2.3.7 [A1]). Product display names and any IAP review screenshots (whether those screenshots are required is **to confirm**). |
| **Requires legal approval** (`NEEDS_LEGAL_APPROVAL`) | Subscription terms in the Terms of Use. Today `packages/shared/src/legal.ts` has no subscription section, and the legal entity name is a placeholder. Auto-renew disclosure wording. Deletion-screen subscription wording. Retention of billing records after account deletion. The choice between Option A and Option B (§8). |
| **Requires regulatory evidence** (`NEEDS_REGULATORY_EVIDENCE`) | Real-world perks tied to home visits or consultations depend on `care.home_visit_booking` (Ministry of Health licensing evidence) and `care.video_consultation` (telemedicine licensing evidence). Both flags are OFF. |
| **Requires Apple or Google review** (`NEEDS_STORE_REVIEW`) | Written clarification on mixed digital and real-world benefits (§8). IAP and Play Billing review of the products. |
| **Open engineering** (not `CODE_READY`) | Benefits are not enforced (G-1). Cross-store launch sequencing under 3.1.3(b) (G-2). Android upgrades and downgrades (G-3). Acknowledgement on restore and RTDN paths (G-4). Purchases with no account token (G-5). Untested Google paths (G-6). The production sandbox rule is untested (G-7). `.env.example` (G-8). No automated check for the `billingclient.version` manifest entry; the entry itself is present in the local build (G-9). No iOS build (B-4). The classifier is not yet applied to products, bookings or consultations (2.6). The deletion notice does not name the store (9.3). Billing rows survive account deletion (9.5). The Plans entry is visible while the flag is OFF (7.2). The unused Paymob `SUBSCRIPTION` purpose (7.5). |

---

## 2. Payment classification (`packages/shared/src/billing.ts`)

| Class | Digital | Example (from `PAYMENT_CLASS_RULES`) | iOS rail | Android rail | Web rail | May link out to pay in native app | Policy basis |
|---|---|---|---|---|---|---|---|
| `PHYSICAL_PRODUCT` | no | TetraSol dressings delivered to the home | `EXTERNAL_GATEWAY` | `EXTERNAL_GATEWAY` | `EXTERNAL_GATEWAY` | yes | Apple 3.1.3(e) [A1]; Play Payments §3 [G1] |
| `PHYSICAL_SERVICE` | no | A nurse home visit for wound dressing | `EXTERNAL_GATEWAY` | `EXTERNAL_GATEWAY` | `EXTERNAL_GATEWAY` | yes | Apple 3.1.3(e) [A1]; Play §3 [G1]; regulated clinical services [G2] |
| `ELIGIBLE_PERSON_TO_PERSON_SERVICE` | no | A real-time 1:1 consultation with one licensed doctor | `EXTERNAL_GATEWAY` | `EXTERNAL_GATEWAY` | `EXTERNAL_GATEWAY` | yes | Apple 3.1.3(d) [A1]; clinical services and non-replayable 1:1 services [G2] |
| `DIGITAL_SUBSCRIPTION` | yes | Gold / Platinum plans | `APPLE_IAP` | `GOOGLE_PLAY_BILLING` | `EXTERNAL_GATEWAY` | **no** | Apple 3.1.1, 3.1.3 intro [A1]; storefront list [A3]; Play §3 and no-steering rule [G1]; no alternative billing in Egypt [G4] |
| `DIGITAL_FEATURE` | yes | A one-off unlock of an in-app feature | `APPLE_IAP` | `GOOGLE_PLAY_BILLING` | `EXTERNAL_GATEWAY` | **no** | same as above |

- `EXTERNAL_GATEWAY` means Paymob, which is not configured (§7). "Web" is today a development and E2E harness. **No web sale of anything is implemented.**
- `resolvePaymentRail(cls, platform)` sends non-digital classes to `EXTERNAL_GATEWAY`. Digital classes go to `APPLE_IAP` on iOS, `GOOGLE_PLAY_BILLING` on Android and `EXTERNAL_GATEWAY` on web. It deliberately takes no override parameter.
- `mayLinkOutForPayment(cls, platform)` returns `platform === 'web' || !digital`.
- Database (migration `0007`): there is an `app.payment_class` enum. Constraint `paid_plans_are_digital` requires every plan except `SILVER` to be `DIGITAL_SUBSCRIPTION`.
- `GET /v1/billing/plans?platform=` returns `rail`, `purchasable` and `unavailableReason` (`FREE_PLAN` · `FEATURE_DISABLED` · `STORE_NOT_CONFIGURED`).

| # | Item | Status | Verified |
|---|---|---|---|
| 2.1 | Physical goods, physical services and eligible 1:1 services go to `EXTERNAL_GATEWAY` on every platform. | `CODE_READY` | verified by automated test (`apps/api/test/billing.test.ts`) |
| 2.2 | Digital subscriptions and features go to the platform store inside the native apps. | `CODE_READY` | verified by automated test (`apps/api/test/billing.test.ts`) |
| 2.3 | No link-out to pay for digital purchases in the native apps. | `CODE_READY` | verified by automated test (`apps/api/test/billing.test.ts`) for `mayLinkOutForPayment`. Verified by config inspection that no screen calls the function yet: the guarantee comes from the mobile app having no external payment link at all. The only `Linking.openURL` calls are `tel:` and the store's manage-subscription URLs. |
| 2.4 | Paid plans can only be `DIGITAL_SUBSCRIPTION` (database constraint). | `CODE_READY` | verified by config inspection (`0007_billing_entitlements.sql`) |
| 2.5 | No external-purchase or alternative-billing programme is configured. `expo-iap` is pinned to `{ android: { store: 'play' } }`, and there are no `SKExternalPurchase*` keys. | `CODE_READY` · `BUILT` (Android only) | verified by config inspection (`apps/mobile/app.config.ts`). Verified by native build inspection: the 2026-10-15 Android manifest has the `BILLING` permission and no alternative-billing or external-offer entries. The iOS prebuild must be re-run after `expo-iap` (see the Apple checklist §5.1). |
| 2.6 | The classifier is applied to TetraSol products, bookings and consultations. | open (not CODE_READY) | verified by config inspection: only billing plans carry a payment class. Store and booking tables do not, and Paymob is not implemented. |
| 2.7 | The two stores treat consultations differently. Google exempts **all** regulated clinical services from Play Billing, live or not [G2]. Apple exempts only **real-time 1:1** person-to-person services, and one-to-few or one-to-many services must use IAP (3.1.3(d) [A1]). Whether asynchronous chat or AI-plus-clinician consults qualify on Apple is **to confirm**. The classifier gives one class the same rail on both platforms. If asynchronous, recorded or group consultations are added, they must not be classed `ELIGIBLE_PERSON_TO_PERSON_SERVICE` for iOS. No such service exists today, and `care.video_consultation` is OFF. | open (not CODE_READY) | not verified |

---

## 3. Policy basis

### 3.1 Apple (all `[verified-official]` unless marked)

The App Review Guidelines in force are dated "Last Updated: June 8, 2026". That revision did not change 3.1.x [A2].

| Rule | Requirement (short) | Source | How the project applies it |
|---|---|---|---|
| 3.1.1 | Unlocking in-app features, subscriptions or premium content must use IAP. Apps may not use their own unlock mechanisms. Apps should offer a restore mechanism. | [A1] | `DIGITAL_*` classes go to `APPLE_IAP`. **Restore purchases** button plus `POST /v1/billing/restore`. |
| 3.1.1 / 3.1.1(a) | The External Purchase Link entitlement is limited to specific storefronts. In every other storefront except the US, no buttons, external links or calls to action pointing to non-IAP purchasing are allowed. | [A1] | `mayLinkOutForPayment` is `false` for digital purchases in the native apps. |
| Storefront list | Link entitlement: the 27 EU countries plus Iceland, Norway and Russia. External Purchase: the EU and South Korea. **Egypt is in neither.** The license agreement has alternative-payment terms only for Japan/Brazil, China mainland and the EU. Apple updates these lists "from time to time". | [A3] | No `SKExternalPurchase*` keys or entitlements. Re-check the lists before each release. |
| 3.1.2(a) | Auto-renewable subscriptions must give ongoing value, last at least 7 days and work on all of the user's devices. Bait-and-switch subscriptions are removed. | [A1] | Monthly and yearly periods only. Entitlements are per account on the server, so they apply on every device. **Gap:** the benefits are not enforced yet (G-1). |
| 3.1.2(b)/(c) and Schedule 2 §3.8(b) | Upgrades and downgrades must be seamless, using one subscription group. Before asking the user to subscribe, the app must describe what they get. It must disclose the title, length and price, with Privacy Policy and Terms links in the app. | [A1] [A4] | One group is planned (§10.1). The screen shows plan name, period, store price, auto-renew disclosure and Terms/Privacy links. The Terms text has no subscription section yet (§1). |
| Subscription sign-up screen | Show the name, duration and content; show the full renewal price, localized and as the most prominent price; offer sign-in or restore; state the length and post-trial price of any trial. Apple recommends `showManageSubscriptions`. | [A5] | Uses the store's `displayPrice`, with one price per offer and no per-month equivalent. No trials are configured. Restore and Manage are both present. Not verified on a device. |
| 3.1.3 intro | Apps using other purchase methods under 3.1.3 must not, inside the app, encourage users to buy outside IAP. Exceptions are the US storefront and 3.1.1(a)/3.1.3(a). Communication outside the app is allowed. | [A1] | No Paymob or web offer for plans appears in the app or the store metadata. |
| 3.1.3(b) | Content or subscriptions bought on other platforms can be used in the iOS app only if they are also sold as IAP in the app. | [A1] | No web or Paymob plan sale exists; entitlement sources are `APPLE`, `GOOGLE` and `ADMIN_GRANT` only. **Sequencing rule:** a Play-bought plan unlocks on iOS too (G-2), so Apple products must exist before or together with Google products. |
| 3.1.3(d) | Real-time person-to-person services between two individuals, including medical consultations, may use non-IAP payment. One-to-few and one-to-many services must use IAP. | [A1] | `ELIGIBLE_PERSON_TO_PERSON_SERVICE` goes to `EXTERNAL_GATEWAY` (see 2.7). |
| 3.1.3(e) | Physical goods, and services consumed outside the app, must use purchase methods other than IAP. | [A1] | `PHYSICAL_*` classes go to `EXTERNAL_GATEWAY`. |
| 2.1(a)/(b) | Provide demo account details. IAPs must be complete, visible to the reviewer and functional. | [A1] | Review accounts exist (`apps/api/src/db/seed-review.ts`). The flag must be ON in the review backend (§7). |
| 2.3.2 / 2.3.7 | Metadata must say clearly which features need an additional purchase. No prices in the name, subtitle or screenshots. | [A1] | `store/metadata/*.json` has no plan wording yet. That is fine while IAP is off, but it is required if IAP ships. |
| Account deletion | If an auto-renewable subscription is active, the app must tell users that billing continues through Apple and ask them to cancel. Deletion may be scheduled for the subscription's expiry only if immediate deletion is also offered. | [A6] | §9 |
| Tax | For Egypt, Apple Distribution International acts as commissionaire, and Apple collects and remits tax on App Store sales. | [A4] | Keep IAP revenue and Paymob revenue in separate books. |
| Mixed subscription | **official-but-ambiguous, to confirm.** Apple has no rule for one subscription that combines in-app features with real-world service benefits. A forum question on exactly this case got no Apple answer. | [A7] | §8 |

### 3.2 Google Play (all `[verified-official]` unless marked)

| Rule | Requirement (short) | Source | How the project applies it |
|---|---|---|---|
| Payments §3 | Physical goods and physical services must not use Play Billing. | [G1] | `PHYSICAL_*` classes go to `EXTERNAL_GATEWAY`. |
| No steering | No steering to another payment method for in-app digital purchases, whether through webviews, buttons, links, messaging or sign-up flows. The exceptions are §3 and enrolled §8/§9 programmes in eligible regions. | [G1] | No link-out for digital purchases. |
| Regulated clinical services | Services by or for a licensed healthcare provider to diagnose or manage conditions should not use Play Billing. | [G2] | `PHYSICAL_SERVICE` and `ELIGIBLE_PERSON_TO_PERSON_SERVICE` go to `EXTERNAL_GATEWAY`. |
| 1:1 services | Paid 1:1 online services between two individuals that are not available for replay do not require Play Billing. | [G2] | As above. A replayable session would lose this exemption and would have to rely on the clinical-services rule instead. |
| Mixed SKUs | **official-but-ambiguous, to confirm.** Play Billing is required when a SKU includes more digital than physical value, or is marketed as digital. | [G2] | §8 |
| Egypt | Play purchases are supported for buyers in Egypt, in EGP from 0.90 to 49,000.00. | [G3] | All reference prices fall inside this range (§4). |
| No alternative billing | No user-choice, alternative-billing or billing-choice programme is open to users in Egypt. "Rest of World" expansion is announced for 2027-09-30, which is forward-looking. | [G4] | `expo-iap` is pinned to `store: 'play'`. Revisit after 2027-09-30. |
| Billing Library | From 2026-08-31 (extension to 2026-11-01), new apps and updates must use PBL 8 or later. PBL 8 is deprecated on 2027-08-31 and PBL 9 on 2028-08-31. The `com.google.android.play.billingclient.version` manifest entry must survive manifest merging. | [G5] | `expo-iap` 6.0.2 depends on `openiap-google` 4.0.2, which depends on `billing` **9.1.0** [E2]. The merged manifest of the 2026-10-15 APK and AAB contains `com.google.android.play.billingclient.version` = `9.1.0` (verified by native build inspection; G-9). |
| App access | If any part of the app is behind a login or a membership, reviewers must be given everything needed to get in. Up to five instruction sets are allowed. | [G6] | Patient, Doctor and Nurse review accounts exist. There is no subscriber instruction set yet. The evidence suggests one for Gold/Platinum, but that is its implication, not a quoted rule. |
| Account deletion | Provide an in-app deletion path and a working web link. Healthcare apps may add steps. | [G7] | §9 |
| Cross-platform access | **to confirm.** The evidence critique lists this as "additionally verified" without a `[verified-official]` tag: an app may give access to content paid for elsewhere, and Google does not require parity across platforms. | [G2] | No web sale exists today. |

### 3.3 Not in the evidence: to confirm before relying on any of these
- Whether App Store Server Notifications V2 and Play RTDN are store **requirements**. The code implements both. The evidence critique lists subscription lifecycle mechanics as "missing".
- Google's acknowledgement deadline. The critique mentions 3 days with automatic refund of unacknowledged purchases, but it is not verified.
- Grace period, account hold and billing-retry durations.
- Commission rates (Apple Small Business Program 15% or standard 30%; Play's subscription rate) and Play's fee terms for Egypt. These are unresolved in the evidence.
- The Google Play Subscriptions policy (offer transparency, easy cancellation, trial disclosure), which is missing from the evidence.
- Prerequisites: the App Store Connect Paid Applications agreement with banking and tax forms, and the Play payments profile.
- Whether Apple offers EGP price points matching 299, 2,990, 699 and 6,990 EGP.
- Whether IAP products need review screenshots, and how they are attached to an app version for review.
- The wording "cancelled at least 24 hours before the end of the period" in the in-app disclosure (`billing.disclosure` in `packages/i18n/src/en.ts` and `ar.ts`).
- Paymob items: PCI DSS scope, merchant KYC, and Apple Pay through Paymob (listed as "missing" in the critique).
- That purchase testing needs the production identifiers, so the `.staging` variant would need its own app records and products. The evidence marks this as an inference [E4].

---

## 4. Plans and prices (migration `0007_billing_entitlements.sql`)

| Plan (EN / AR) | Period | Business reference price | `reference_price_piasters` | Apple product ID | Google product / base plan | Family profiles |
|---|---|---|---|---|---|---|
| Silver / فضي | MONTHLY | free | 0 | none (free plan, never sold) | none | `NULL` |
| Gold / ذهبي | MONTHLY | 299 EGP | 29,900 | `NULL` | `NULL` / `NULL` | 4 |
| Gold / ذهبي | YEARLY | 2,990 EGP | 299,000 | `NULL` | `NULL` / `NULL` | 4 |
| Platinum / بلاتيني | MONTHLY | 699 EGP | 69,900 | `NULL` | `NULL` / `NULL` | 8 |
| Platinum / بلاتيني | YEARLY | 6,990 EGP | 699,000 | `NULL` | `NULL` / `NULL` | 8 |

- **Reference prices are business data**; the migration labels them "Spec §20 business prices". **Customer prices are the store price points set in App Store Connect and Play Console.** The app shows the store's localized `displayPrice` (fetched through `expo-iap`). It shows a Subscribe button only when a store price exists. The reference price appears only as a labelled fallback ("Reference price {price}" / "السعر المرجعي {price}").
- Play's Egypt range of 0.90 to 49,000.00 EGP includes all four prices [G3]. Apple's EGP price points are **to confirm**.
- All store product IDs are `NULL`, so nothing can be bought.

| Plan | `DIGITAL` benefits | `REAL_WORLD` benefits |
|---|---|---|
| Silver | Personal health profile and medical record; Basic family support; Find verified doctors and nurses; TetraSol store | none |
| Gold | You + up to 4 family profiles; Enhanced family dashboard; Enhanced reminders and weekly health summary | Priority matching; Reduced eligible platform fees; Priority support |
| Platinum | You + up to 8 family profiles; Premium family management and advanced summaries | Highest eligible matching priority; Enhanced booking benefits; Concierge-style support where staffed |

The screen tags each `REAL_WORLD` item "Real-world benefit" (Arabic: "ميزة خارج التطبيق").

| # | Item | Status | Verified |
|---|---|---|---|
| 4.1 | Plans and reference prices are seeded, and Silver is the free default. | `CODE_READY` | verified by automated test (`apps/api/test/billing.test.ts`, "lists plans with the resolved rail…": plan order and Gold reference prices 29,900 / 299,000) |
| 4.2 | Store products and EGP price points. | `NEEDS_ACCOUNT_ACTION` | verified by config inspection (every product ID is `NULL`) |
| 4.3 | Plan benefits are actually delivered. **Nothing reads `effective_plan` or `family_profile_limit` outside the billing module and the Plans screen.** No priority matching or fee discount exists. | open (not CODE_READY) | verified by config inspection |
| 4.4 | Plans and offers can be edited. Row-level security allows an ADMIN to update, but **no API route or admin page exists**, so product IDs must be set with a reviewed SQL change run as the database owner (§10.4). | open (not CODE_READY) | verified by config inspection |
| 4.5 | Benefit copy matches the outcome of §8. | `NEEDS_LEGAL_APPROVAL` · `NEEDS_STORE_REVIEW` | not verified |

---

## 5. Entitlement service

### 5.1 Purchase flow (as coded)
1. The app loads `GET /v1/billing/plans?platform=…` and the feature flags. If `billing.store_subscriptions` is OFF, or the platform is web, the app never connects to the store (`useStoreBilling.ts`).
2. `GET /v1/billing/account-token` returns the caller's random UUID from `app.billing_accounts`, creating it on first use.
3. `expo-iap` `requestPurchase` sends that token as StoreKit `appAccountToken` (iOS) or Play `obfuscatedAccountId` (Android).
4. On `purchaseUpdatedListener`, the app posts `{signedTransactionInfo: purchase.purchaseToken}` to `POST /v1/billing/apple/verify`, or posts `{productId, purchaseToken}` to `POST /v1/billing/google/verify`. On iOS, `expo-iap`'s own type documentation says `purchaseToken` carries the JWS. **Not verified on a device.**
5. The server verifies with the store, normalizes the result (`apps/api/src/modules/billing/events.ts`), checks the flag, the sandbox rule, the account token and the product mapping, then calls `app.billing_apply_event()`.
6. Google only: after successful verification, the server acknowledges the purchase if it is not already acknowledged.
7. The app calls `finishTransaction` **only after** the server succeeds, then refreshes entitlements. The app never unlocks anything from a client-side purchase result.
8. Later changes arrive server-to-server through `POST /webhooks/apple/app-store-notifications` and `POST /webhooks/google/rtdn`.

### 5.2 Controls

| # | Control | Implementation | Status | Verified |
|---|---|---|---|---|
| 5.2.1 | Apple verification | `createAppleStore` builds `SignedDataVerifier` instances from Apple's App Store Server Library. Inputs: root certificates (`.cer`/`.der`) from `APPLE_ROOT_CERTS_DIR`, where startup fails if none are found; the bundle ID; the app's Apple ID, required when `NODE_ENV=production`; and online checks (`APPLE_IAP_ONLINE_CHECKS`, default on). It tries the Production verifier first, then Sandbox. A failure returns 422 `INVALID_STORE_SIGNATURE`. | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` | Real JWS verification is not exercised, because tests replace the adapter with a fixture. Verified by config inspection (`apps/api/src/integrations/billing.ts`). |
| 5.2.2 | Google verification | `purchases.subscriptionsv2` GET through `GoogleAuth` with the `androidpublisher` scope. The verified product ID must equal the requested one. | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` | verified by config inspection only |
| 5.2.3 | Fail closed without credentials | Without credentials, each adapter is `NOT_CONFIGURED` and every call returns 503 `STORE_NOT_CONFIGURED`. Plans report `STORE_NOT_CONFIGURED`, and nothing is granted. | `CODE_READY` | verified by automated test (`apps/api/test/billing.test.ts`) |
| 5.2.4 | Account-token binding | The purchase's token must equal the caller's `app_account_token`; otherwise 403 `PURCHASE_ACCOUNT_MISMATCH`. In the database, a subscription is bound to the first account that verified it (`SUBSCRIPTION_BELONGS_TO_ANOTHER_ACCOUNT`), enforced by `UNIQUE (source, external_ref)` (Apple `originalTransactionId`, Google `purchaseToken`). | `CODE_READY` | verified by automated test (`apps/api/test/billing.test.ts`: a replay by another account gets 403 and stays Silver). The database-level check is verified by config inspection. |
| 5.2.5 | Product-to-plan mapping comes from the server only | `planForProduct` reads `app.billing_plan_offers`. An unknown product gets 422 `UNKNOWN_PRODUCT`, or `IGNORED_UNKNOWN_PRODUCT` for notifications. | `CODE_READY` | Mapping covered indirectly by the automated test (fixture product maps to Gold). The unknown path is verified by config inspection. |
| 5.2.6 | Sandbox allowed in production only for review and internal accounts | Client verify: a sandbox purchase in production from an account whose `account_kind` is not `REVIEW` or `INTERNAL_TEST` gets 403 `SANDBOX_PURCHASE_NOT_ALLOWED`. Server notifications get `IGNORED_SANDBOX` (`app.billing_is_test_account`). Sandbox means Apple `environment` ≠ `Production`, or a Google `testPurchase`. Users cannot set their own `account_kind`. | `CODE_READY` | The production branch is verified by config inspection only, because tests do not run as production. Self-promotion is blocked: verified by automated test (`apps/api/test/compliance.test.ts`, "users cannot promote themselves to a review account"). |
| 5.2.7 | Feature-flag gate | Verify returns 409 `FEATURE_DISABLED` while the flag is OFF. `REVIEW` and `INTERNAL_TEST` accounts are exempt on the server, but the shipped app does not connect to the store while the flag is OFF, so that exemption cannot be reached from the app. | `CODE_READY` | verified by automated test (`apps/api/test/billing.test.ts`: 409 while OFF) |
| 5.2.8 | Idempotent, append-only event log | `app.store_events` has `UNIQUE (source, external_event_id)`, so a duplicate returns `DUPLICATE` and changes nothing. A `BEFORE UPDATE OR DELETE` trigger (`app.forbid_mutation`) blocks edits. The outcome enum is `APPLIED`, `IGNORED_STALE`, `IGNORED_UNKNOWN_SUBSCRIPTION` or `IGNORED_NOT_SUBSCRIPTION`. The summary stores only `{sandbox, productId}`, never receipts or tokens. Reading requires `audit.read`. Event IDs: Apple `notificationUUID`, Pub/Sub `messageId`, or a synthetic ID for client verify and restore. | `CODE_READY` | Duplicate handling: verified by automated test (`apps/api/test/billing.test.ts`). Trigger: verified by config inspection. |
| 5.2.9 | Stale-event protection | An event older than `last_event_at` returns `IGNORED_STALE` unless its status is `REFUNDED` or `REVOKED`, which always win. `last_event_at` only moves forward. | `CODE_READY` | verified by automated test (a stale `DID_RENEW` after a refund is ignored) |
| 5.2.10 | Refunds and revocation | Apple: a `revocationDate` gives `REFUNDED`, or `REVOKED` on a `REVOKE` notification. `REFUND`, `REVOKE`, `EXPIRED` and `GRACE_PERIOD_EXPIRED` map to terminal statuses. Google: `voidedPurchaseNotification` gives `REFUNDED`. Every other RTDN re-fetches state from the Play Developer API and never trusts the notification body. | `CODE_READY` | Apple refund: verified by automated test. Google: verified by config inspection. |
| 5.2.11 | Access rule | Only `ACTIVE` and `GRACE_PERIOD` grant access, and only while `expires_at` > now. `BILLING_RETRY` grants nothing. The highest tier wins; the default is `SILVER` (`app.effective_plan`). | `CODE_READY` | verified by automated test (state mapping; plan returns to Silver after refund) |
| 5.2.12 | Clients cannot write entitlements | The app role has no INSERT, UPDATE or DELETE grant. Only the `SECURITY DEFINER` function `app.billing_apply_event` writes, and it rejects `ADMIN_GRANT`. No admin-grant API exists. | `CODE_READY` | verified by automated test ("clients cannot write entitlements directly") |
| 5.2.13 | Google acknowledgement | Happens only on the `/v1/billing/google/verify` route, after verification succeeds. If verification fails, the purchase stays unacknowledged; that is deliberate fail-closed behavior, and its consequence under Google's rules is **to confirm** (§3.3). | `CODE_READY` (restore and RTDN paths: see G-4) | verified by config inspection |
| 5.2.14 | Restore Purchases | The app reads `getAvailablePurchases` and posts them to `POST /v1/billing/restore` (up to 50 per store, 10 requests per minute). Each purchase goes through the same verification. Per-item error codes come back in `restoreErrors`. The button is always visible. | `CODE_READY` | The route is not covered by an automated test. The button renders in `e2e/tests/a11y.spec.ts` (web). |
| 5.2.15 | Manage subscription | Uses `expo-iap` `deepLinkToSubscriptions` (on Android with package and SKU). The fallback `manageSubscriptionUrl` opens `https://apps.apple.com/account/subscriptions` or `https://play.google.com/store/account/subscriptions?sku=…&package=…`. These URLs are code constants, not from the evidence. The button is shown when a store entitlement is `ACTIVE` or `GRACE_PERIOD`. | `CODE_READY` | verified by config inspection; never opened on a device |
| 5.2.16 | Apple server notifications | `POST /webhooks/apple/app-store-notifications` with `{signedPayload}`, verified with `verifyAndDecodeNotification` plus the transaction and renewal info. A payload that is not a subscription returns 200 `IGNORED_NOT_SUBSCRIPTION`. The account is found from the bound subscription or from `appAccountToken`. Limit: 600 per minute. | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` (URL) | verified by automated test with a fixture verifier: refund, duplicate, stale |
| 5.2.17 | Google RTDN | `POST /webhooks/google/rtdn`. The `Authorization: Bearer` OIDC token is verified: audience must be `GOOGLE_RTDN_AUDIENCE`, `email_verified` must be true and the email must equal `GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL`. `packageName` must equal `GOOGLE_PLAY_PACKAGE_NAME`, otherwise 403 `WRONG_PACKAGE`. State is re-fetched from Google, and the Pub/Sub `messageId` is the idempotency key. | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` | verified by config inspection only |
| 5.2.18 | Audit and rate limits | Every `APPLIED` event writes `billing.entitlement.updated` to `app.audit_log`. Rate limits: verify 30 per minute, restore 10 per minute, webhooks 600 per minute. | `CODE_READY` | verified by config inspection |

### 5.3 Status mapping (`events.ts`)

| Store input | Entitlement status | Grants access |
|---|---|---|
| Apple `revocationDate` set | `REFUNDED` (or `REVOKED` on a `REVOKE` notification) | no |
| Apple notification `REFUND` / `REVOKE` / `EXPIRED` / `GRACE_PERIOD_EXPIRED` | `REFUNDED` / `REVOKED` / `EXPIRED` / `EXPIRED` | no |
| Apple in billing retry, grace end in the future | `GRACE_PERIOD` (expires at grace end) | yes |
| Apple in billing retry, no grace | `BILLING_RETRY` | no |
| Apple `expiresDate` in the future | `ACTIVE` | yes |
| Google `ACTIVE` | `ACTIVE` | yes |
| Google `CANCELED` | `ACTIVE` until expiry, then `EXPIRED` | until expiry |
| Google `IN_GRACE_PERIOD` | `GRACE_PERIOD` | yes |
| Google `ON_HOLD` | `BILLING_RETRY` | no |
| Google `PAUSED` / `EXPIRED` | `EXPIRED` | no |
| Google `PENDING`, `PENDING_PURCHASE_CANCELED`, unspecified | nothing recorded | no |
| Google voided purchase | `REFUNDED` | no |

### 5.4 Known gaps and risks

| # | Gap | Effect | Status | Verified |
|---|---|---|---|---|
| G-1 | Benefits are not enforced (4.3). | A paying subscriber would see no functional difference. This conflicts with 3.1.2(a) "ongoing value" and 2.1(b) "functional" [A1]. | open (not CODE_READY) | verified by config inspection |
| G-2 | Cross-store access and 3.1.3(b). | `app.effective_plan` ignores where a plan was bought, so a Play purchase unlocks the plan on iOS. That is allowed only if the same plans are also sold as IAP on iOS [A1]. Launch Apple products before or together with Google products. | open (release-sequencing rule) | verified by config inspection |
| G-3 | Android upgrades and downgrades. | The Android purchase request passes no `subscriptionOffers` (base-plan offer token) and no replacement parameters. `linkedPurchaseToken` is typed but never used. Buying a second tier may create a parallel subscription, the old token can stay `ACTIVE` until it expires, and the highest tier wins in the meantime. iOS handles switching within one subscription group. | open (not CODE_READY) | verified by config inspection; not tested |
| G-4 | Acknowledgement happens only on the verify route. | A purchase first reported through restore or RTDN is not acknowledged by the server. | open (not CODE_READY) | verified by config inspection |
| G-5 | Purchases with no account token. | A purchase made outside the app's own purchase flow carries no `appAccountToken` or `obfuscatedAccountId` and can never be bound, so restore fails with `PURCHASE_ACCOUNT_MISMATCH`. A subscription also stays bound to an account after that account is deleted. A support procedure is needed. | open (not CODE_READY) | verified by config inspection |
| G-6 | Google paths are untested. | Google verify, acknowledge, restore and RTDN are never exercised, because the Google fixture is `NOT_CONFIGURED`. | open (not CODE_READY) | not verified |
| G-7 | The production sandbox rule is untested. | The branch runs only when `NODE_ENV=production`. | open (not CODE_READY) | not verified |
| G-8 | `apps/api/.env.example` is incomplete. | It lists none of the `APPLE_IAP_*`, `APPLE_ROOT_CERTS_DIR` or `GOOGLE_*` variables. | open (not CODE_READY) | verified by config inspection |
| G-9 | PBL manifest entry. | `com.google.android.play.billingclient.version` must survive manifest merging [G5]. It does in the 2026-10-15 local APK and AAB (`9.1.0`). Still open: `scripts/release/verify-android.sh` allow-lists `com.android.vending.BILLING` but does not check this entry, and no EAS-built, store-signed AAB has been produced or checked yet. `BILLING` is correctly absent from `blockedPermissions` [E3]. | `BUILT` (local build) · open (no automated check) | verified by native build inspection (`aapt2 dump xmltree` on the APK; the AAB's protobuf manifest) |

### 5.5 Billing client in native builds

| # | Item | Facts | Status | Verified |
|---|---|---|---|---|
| B-1 | The Android production build contains the Play Billing client | Package `com.aliagroup.dressmywound`, versionCode 1, targetSdk 36. The manifest includes the `com.android.vending.BILLING` permission (from `expo-iap` and Play Billing), `com.google.android.play.billingclient.version` = `9.1.0`, `com.android.billingclient.api.ProxyBillingActivity` and `ProxyBillingActivityV2` (both `exported=false`), `dev.hyo.openiap.PROVIDER` meta-data, and a `<queries>` entry for `com.android.vending.billing.InAppBillingService.BIND`. `verify-android.sh` passes: the permission allow-list, 16 KB alignment and targetSdk 36. | `BUILT` | verified by native build inspection |
| B-2 | That build cannot be distributed or used for purchases | It is signed only with the local Android debug key; store signing happens in EAS and Play App Signing. Its API URL is the placeholder `https://api.dressmywound.invalid`, so no purchase could be verified on the server even if it were installed. | `BUILT` · `NEEDS_ACCOUNT_ACTION` | verified by native build inspection |
| B-3 | Android development client | `com.aliagroup.dressmywound.dev` (arm64-v8a, x86_64) also contains Play Billing 9.1.0 and can be installed with `adb install`. IAP needs a development or store build, not Expo Go [E1]. Whether purchases can be tested under the `.dev` package ID without its own Play products is **to confirm** [E4]. | `BUILT` | verified by native build inspection; never run on a device |
| B-4 | iOS | There is no binary. The iOS prebuild output predates `expo-iap` (Apple checklist §5.1), so the StoreKit 2 client has never been compiled. Building needs macOS and Xcode, or an EAS cloud build with an Apple Developer account. | open (not BUILT) · `NEEDS_ACCOUNT_ACTION` | not verified |
| B-5 | 2026-10-14 production APK | Superseded. It had a launch-crash bug and biometric permissions, and no billing client. Do not use it. | superseded | verified by native build inspection |

---

## 6. What the tests prove (`apps/api/test/billing.test.ts`: 10 tests, passing 2026-10-15)

| Test | Proves |
|---|---|
| payment classification › routes physical goods, physical services and 1:1 consultations to the external gateway on every platform | Rail is `EXTERNAL_GATEWAY` for the three non-digital classes on iOS, Android and web. |
| … › routes digital subscriptions and features to the platform store inside the apps | `APPLE_IAP` on iOS and `GOOGLE_PLAY_BILLING` on Android, for both digital classes. |
| … › never allows linking out to pay for digital purchases in the native apps | `mayLinkOutForPayment` is false for digital purchases on iOS and Android, and true for physical purchases. |
| store event normalization › maps Apple transaction + renewal state to access | `ACTIVE`, `EXPIRED`, `GRACE_PERIOD`, `BILLING_RETRY`, `REFUNDED`, and `EXPIRED` from a notification. |
| … › maps Google subscription states | Cancelled keeps paid time; on hold gives `BILLING_RETRY`; pending gives nothing. |
| … › ignores non-subscription Apple transactions and flags sandbox purchases | A consumable returns `null`; `Sandbox` sets `sandbox=true`; the event type is `CLIENT_VERIFY`. |
| entitlement service › lists plans with the resolved rail and an honest unavailability reason | Plan order, Silver is `FREE_PLAN`, the rail per platform, nothing purchasable, Gold reference prices. |
| … › refuses to verify anything when the store is not configured | 503 `STORE_NOT_CONFIGURED`; the plan stays Silver. |
| … › grants only after server verification, bound to the purchasing account; refunds revoke access | Flag OFF gives 409. A forged payload gives 422. A valid purchase gives Gold with `storeManaged`. A replay by another account gives 403 and stays Silver. A refund notification is `APPLIED`, its duplicate is `DUPLICATE`, and the plan returns to Silver with status `REFUNDED`. A stale renewal is `IGNORED_STALE`. |
| … › clients cannot write entitlements directly | A direct `INSERT` through the app database role is denied. |

**Method:** both store adapters are replaced by fixtures that return already "verified" payloads. The test turns the flag ON mid-test and resets it to OFF afterwards.

**Related tests:**
- `apps/api/test/compliance.test.ts`: every regulated flag, including `billing.store_subscriptions`, is OFF by default; users cannot promote themselves to a review account; account-deletion tests.
- `e2e/tests/a11y.spec.ts`: the subscription screen at 320 and 390 px on the web build.
- `e2e/tests/flow-d-tetrasol.spec.ts`: simulated checkout on the web build.
- `e2e/tests/flow-f-privacy.spec.ts`: in-app deletion on the web build, with no store subscription involved.

**Not proven by any test:**
- Real Apple JWS or certificate-chain verification.
- Any Google Play Developer API call, acknowledgement or RTDN.
- The restore route.
- The production sandbox rule.
- Unknown products.
- The database-level `SUBSCRIPTION_BELONGS_TO_ANOTHER_ACCOUNT` path (the replay test stops earlier, at the token check).
- The `expo-iap` client on any device.
- Manage-subscription links.
- The deletion-screen subscription notice.

---

## 7. Feature flag, Paymob and what users see today

| # | Item | State | Status | Verified |
|---|---|---|---|---|
| 7.1 | `billing.store_subscriptions` | Seeded **OFF** in `0006_compliance_foundation.sql`, risk `MEDIUM`, no regulatory-evidence reference required. An ADMIN toggles it on the admin console Feature flags page (`apps/admin/src/app/features/page.tsx`). There is **one flag per backend**: switching it on for App Review switches it on for every user of that backend. | `CODE_READY` | verified by automated test (`apps/api/test/compliance.test.ts`, "exposes every regulated feature as OFF by default") |
| 7.2 | Plans screen while OFF | Me > Plans & subscription (`apps/mobile/src/app/settings/subscription.tsx`) lists Silver, Gold and Platinum with labelled reference EGP prices and "Subscriptions are not available yet." There is no Subscribe button. Restore, the auto-renew disclosure and the Terms/Privacy links are visible. **Decision needed:** hide the entry while OFF, or ship working IAP. This matches the Apple checklist §8. | open (not CODE_READY) | verified by config inspection; screen renders in `e2e/tests/a11y.spec.ts` (web) |
| 7.3 | Paymob gateway (`apps/api/src/integrations/payments.ts`) | `status` is hard-coded to `NOT_CONFIGURED` even when the `PAYMOB_*` variables are set. `createIntent` throws, and `verifyWebhook` returns `false`. Three invariants are design only for now: hosted checkout only, PAID only after a verified webhook, and an idempotency key on every intent. | open (not CODE_READY) · `NEEDS_ACCOUNT_ACTION` (merchant account) | verified by config inspection |
| 7.4 | TetraSol checkout | `POST /store/checkout/preview` computes totals on the server and returns `canPlaceRealOrder: false` and the notice `PAYMENT_NOT_CONFIGURED_SIMULATION_ONLY`. `commerce.checkout` is OFF, and "Place order" is disabled. | `CODE_READY` (disabled) | verified by automated test (`e2e/tests/flow-d-tetrasol.spec.ts`, web build, simulated) |
| 7.5 | Paymob `PaymentIntentRequest.purpose` includes `'SUBSCRIPTION'`. | Nothing calls it today. It must never be used to sell Gold or Platinum inside the iOS or Android apps (3.1.1 and 3.1.3 intro [A1]; [G1]). Any future web sale would also require the same plans as IAP on iOS (3.1.3(b) [A1]). Recommendation: remove it, or restrict it to web. | open (not CODE_READY) | verified by config inspection |
| 7.6 | Payment for visits and consultations | `care.home_visit_booking` and `care.video_consultation` are OFF, and both require regulatory evidence before they can be enabled. | `NEEDS_REGULATORY_EVIDENCE` | verified by automated test (`apps/api/test/compliance.test.ts`, flags OFF) |

---

## 8. OPEN ISSUE: mixed digital and real-world benefits in Gold and Platinum

**What official guidance says:**
- **Apple:** 3.1.1 requires IAP for in-app features, and 3.1.3(e) requires non-IAP payment for services consumed outside the app [A1]. Apple has published nothing on a subscription that combines both. The forum question on exactly this case has no Apple answer [A7] (official-but-ambiguous).
- **Google:** Play Billing is required when a SKU is "more digital than physical" or is marketed as digital [G2] (official-but-ambiguous, with no numeric test). Payments §3 forbids Play Billing when the payment is primarily for physical services [G1].
- **Neither store** says whether "priority matching" (an in-app ranking for a real-world visit) is digital or physical.
- **The evidence contradicts itself.** The Apple research topic suggests Option B as the safest design; the Google research topic suggests Option A. The critique says neither has official confirmation and that one classification should apply to both stores.

**What the code does today:** the data model has the Option B shape. Paid plans must be `DIGITAL_SUBSCRIPTION`, and their `REAL_WORLD` benefits sit inside the same plan. No perk is implemented (G-1).

| | **Option A:** the store subscription contains only digital benefits | **Option B:** one IAP / Play subscription that includes the perks |
|---|---|---|
| Sold through the store | Gold and Platinum with `DIGITAL` benefits only: family profiles, dashboard, reminders, summaries, family management. | Gold and Platinum, including priority matching, reduced platform fees, priority or concierge support and booking benefits. |
| Real-world perks | Removed from the plans. Priced into services paid through Paymob, for example as an option on the visit itself. They are available whatever the user's subscription status and are never marketed as a cheaper alternative to IAP. | Delivered as entitlements. The visit itself is still paid through Paymob, with the plan discount applied on the server. |
| Code changes | Remove `REAL_WORLD` rows from the Gold and Platinum `benefits`. Implement the digital benefits. Add perk pricing to booking when Paymob and booking ship. | Implement the digital benefits **and** priority matching and the fee discount, reading `effective_plan`. |
| Apple risk | Lowest conflict with 3.1.3(e). Remaining risk: 3.1.2(a) "ongoing value" rests on the digital features alone. | Selling perks for services consumed outside the app through IAP may conflict with 3.1.3(e). No official answer exists [A7]. |
| Google risk | A clearly digital SKU goes through Play Billing, and the perks paid through Paymob fall under §3 and the clinical-services rule. | The real-world share may make Play Billing inappropriate under §3. The "more digital than physical" test is unresolved. |
| Commercial | Less bundled value. Perks need their own prices. Store commission applies only to digital value. | A simpler offer. Store commission also applies to the perk value (rates **to confirm**). |
| Reversibility | Perks can be added to the plans later if both stores confirm. | Removing perks from existing subscribers later risks a 3.1.2(a) bait-and-switch finding. |

**Recommendation:**
1. **Keep `billing.store_subscriptions` OFF** until there is written clarification from **both** Apple App Review and Google Play policy support. Record the date and reference number of each answer in this document.
2. Send both stores the same questions (below), and apply **one** classification to both stores.
3. If launch cannot wait for the answers, Option A has the smaller policy surface, because it removes the conflict rather than relying on an interpretation, and it is easier to reverse. This is an engineering opinion, not an official position.
4. Whichever option is chosen, implement the benefits before enabling the flag (G-1).

**Draft questions** (to be sent by the account holder):
- *To App Review:* "Our auto-renewable subscriptions Gold and Platinum unlock in-app digital features through In-App Purchase. May the same subscription also include (a) priority when the app matches the patient with a licensed home-care nurse, (b) a reduced platform fee on in-person visits that are paid separately under 3.1.3(e), and (c) priority customer support? If not, must these be removed from the subscription, or sold separately outside IAP?"
- *To Google Play policy support:* "Is a subscription made of the digital features above plus (a) to (c) 'more digital than physical' under the Payments policy? May (a) to (c) be included in a Play Billing subscription, given that §3 forbids Play Billing for physical services?"

| # | Item | Status | Verified |
|---|---|---|---|
| 8.1 | Written clarification from Apple App Review | `NEEDS_STORE_REVIEW` | not verified |
| 8.2 | Written clarification from Google Play policy support | `NEEDS_STORE_REVIEW` | not verified |
| 8.3 | Decision between Option A and Option B, with benefit copy updated to match | `NEEDS_LEGAL_APPROVAL` | not verified |
| 8.4 | Perks tied to visits and consultations depend on licensing evidence | `NEEDS_REGULATORY_EVIDENCE` | verified by config inspection (both flags OFF, evidence required) |

---

## 9. Account deletion with an active subscription

**Requirements:**
- Apple: users with an active auto-renewable subscription must be told that billing continues through Apple and be asked to cancel. Deletion may be scheduled for the subscription's expiry only if immediate deletion is also offered [A6].
- Google: an in-app deletion path plus a working web link [G7].

| # | Item | Implementation | Status | Verified |
|---|---|---|---|---|
| 9.1 | In-app notice | `apps/mobile/src/app/settings/delete-account.tsx` shows a warning when `storeManaged` is true, meaning a store entitlement is `ACTIVE`, `GRACE_PERIOD` or `BILLING_RETRY`. EN: "You have an active store subscription. Deleting your account does not cancel it — cancel it in Manage subscription to stop being billed." AR: "لديك اشتراك فعّال عبر المتجر. حذف الحساب لا يلغيه — ألغِه من "إدارة الاشتراك" لإيقاف الخصم." | `CODE_READY` · `NEEDS_LEGAL_APPROVAL` (copy) | verified by config inspection. No test covers this path, because the web E2E build has no store subscription. |
| 9.2 | Immediate deletion | `app.delete_my_account` deletes immediately and never schedules deletion, so the "scheduled only if immediate is also offered" condition never arises. | `CODE_READY` | verified by automated test (`apps/api/test/compliance.test.ts`, deletion tests) |
| 9.3 | The notice names the store and links to it | The text says "store subscription" and does not name Apple or Google, whereas Apple's guidance says "billing continues through Apple". There is no Manage subscription button on this screen, so the user has to open Plans & subscription. Recommendation: insert the store name (`{store}`) and add a Manage button that calls `useStoreBilling().manage`. | open (not CODE_READY) | verified by config inspection |
| 9.4 | Web deletion page | The `/delete-account` page built by `apps/site/build.ts` says: "An App Store or Google Play subscription is billed by Apple or Google — cancel it in your store account settings; deleting the account does not cancel it." | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` (domain and hosting; `SUPPORT_EMAIL` is a placeholder) | verified by config inspection |
| 9.5 | Billing records after deletion | `app.delete_my_account` (migration 0006) predates 0007. `app.billing_accounts`, `app.entitlements` and `app.store_events` stay linked to the anonymized user ID. They are not listed in "What we keep" (`deletion.keptItems`) or in the deletion summary. Decide what to retain, then update the function, the copy and the privacy policy. | open (not CODE_READY) · `NEEDS_LEGAL_APPROVAL` | verified by config inspection |

---

## 10. Configuration that needs accounts

Every line in this section is `NEEDS_ACCOUNT_ACTION` and not verified, unless stated otherwise.

### 10.1 Apple (App Store Connect)
1. **Organization developer account.** Under 5.1.1(ix), healthcare apps should be submitted by the legal entity that provides the service [A1]. Enrollment needs a legal entity, a D-U-N-S number and a public website [A8]. The legal entity name is still a placeholder in `packages/shared/src/legal.ts`.
2. **Agreements.** The Paid Applications agreement, banking and tax are **to confirm** (not in the evidence).
3. **App record** for bundle ID `com.aliagroup.dressmywound` (production variant). The `.staging` variant would need its own record and products (an inference [E4], **to confirm**).
4. **One subscription group** with Platinum ranked above Gold, as required by 3.1.2(b) [A1]. It holds four auto-renewable products: Gold monthly, Gold yearly, Platinum monthly and Platinum yearly. Each needs EN and AR display names and descriptions, plus an EGP price point chosen against the reference prices in §4 (price-point availability is **to confirm**). The products must be complete and visible to the reviewer (2.1(b) [A1]).
5. **App Store Server Notifications V2 URL:** `https://<API_HOST>/webhooks/apple/app-store-notifications`, for production and sandbox. Whether this is a store requirement is **to confirm**.
6. **Sandbox testing.** Review accounts are seeded with `account_kind = 'REVIEW'` by `apps/api/src/db/seed-review.ts`. Internal testers who need sandbox purchases against the production API must be set to `INTERNAL_TEST` by the database owner.
7. **App Review notes:** explain the rails. Plans use IAP. TetraSol products and visits use Paymob under 3.1.3(e). Real-time 1:1 consultations use Paymob under 3.1.3(d). Include the §8 answer.

### 10.2 Google (Play Console and Google Cloud)
1. **Organization Play Console account**, which health apps must use, with a D-U-N-S number [G8].
2. **App** `com.aliagroup.dressmywound`. Whether an AAB containing Play Billing must be uploaded before products can be created is **to confirm**. A local AAB with Play Billing 9.1.0 exists (B-1), but it is debug-signed. Any upload must be an EAS-built AAB signed through Play App Signing.
3. **Subscriptions.** Recommendation: **one subscription product per plan and period, each with a single base plan.** The current client passes no base-plan offer token (G-3) and reads a single `displayPrice` per product, so a product with two base plans would be ambiguous. ID formats are enforced by migration 0007: product `^[a-z0-9._]{1,100}$`, base plan `^[a-z0-9-]{1,63}$`. EGP prices must be within 0.90 to 49,000.00 [G3].
4. **Service account** with the `androidpublisher` scope, granted access in Play Console (exact permission names **to confirm**). Store its JSON key, base64-encoded, in the secret manager, never in the repo.
5. **Real-time developer notifications.** Create a Pub/Sub topic and connect it in Play Console. Create a **push** subscription to `https://<API_HOST>/webhooks/google/rtdn` with authentication enabled, so that it sends an OIDC token signed by a dedicated service account. Use the audience you set there as `GOOGLE_RTDN_AUDIENCE`, and that account's email as `GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL`. Topic permissions for Google's publisher are **to confirm**.
6. **License testers** for test purchases. A `testPurchase` is accepted in production only for `REVIEW` and `INTERNAL_TEST` accounts.
7. **App access:** add a subscriber instruction set if Gold or Platinum ship [G6].

### 10.3 Server environment (`apps/api/src/config/env.ts`)

| Variable | Value | Needed for |
|---|---|---|
| `APPLE_IAP_BUNDLE_ID` | `com.aliagroup.dressmywound` | Apple adapter |
| `APPLE_IAP_APP_APPLE_ID` | The numeric app Apple ID from App Store Connect, App Information | Apple adapter (required in production) |
| `APPLE_ROOT_CERTS_DIR` | A directory containing Apple root certificates (`.cer`/`.der`). The code comment names `AppleRootCA-G3.cer` from apple.com/certificateauthority; that source is not in the evidence and is **to confirm**. | Apple adapter (startup fails if the directory is empty) |
| `APPLE_IAP_ONLINE_CHECKS` | Default `true` | Apple verifier online checks |
| `GOOGLE_PLAY_PACKAGE_NAME` | `com.aliagroup.dressmywound` | Google adapter and RTDN package check |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64` | From the secret manager | Google adapter |
| `GOOGLE_RTDN_AUDIENCE` | The audience on the push subscription | RTDN authentication |
| `GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL` | The push service account's email | RTDN authentication |

If any one of the four Google variables is missing, the Google adapter stays `NOT_CONFIGURED`. The Apple adapter needs the bundle ID and certificate directory, plus the Apple ID in production.

### 10.4 Product IDs and the switch-on gate
Product IDs are set by the database owner through a reviewed SQL change, because no admin UI or API exists (4.4). The IDs below are placeholders:

```sql
UPDATE app.billing_plan_offers
   SET apple_product_id = '<APPLE_PRODUCT_ID>',
       google_product_id = '<PLAY_PRODUCT_ID>',
       google_base_plan_id = '<PLAY_BASE_PLAN_ID>'
 WHERE plan_code = 'GOLD' AND period = 'MONTHLY';
-- repeat for GOLD/YEARLY, PLATINUM/MONTHLY, PLATINUM/YEARLY
```

**Before `billing.store_subscriptions` may be switched ON anywhere real users can reach,** all of the following must be done:
1. The §8 answers are recorded, an option is chosen, and the benefit copy is updated.
2. The benefits are implemented and tested (G-1).
3. G-3 to G-7 are fixed or explicitly accepted. Apple products exist before or together with Google products (G-2).
4. Accounts, products, server environment and product IDs are set up on a **staging** backend.
5. Purchase, restore, manage, refund and expiry are tested on physical iOS and Android devices with sandbox and license testers. Only after that may any line be marked `DEVICE_TESTED`.
6. Legal: the subscription section in the Terms of Use, the disclosure wording, the deletion wording, and billing data in the privacy policy (§1, §9).
7. Metadata: the 2.3.2 wording on additional purchases [A1] and the Play subscriber app-access instructions [G6].
8. For App Review, turn the flag ON only in the backend the review build uses, keeping in mind that this applies to every user of that backend (7.1).

---

## 11. Separation summary

| Category | Lines |
|---|---|
| Completed implementation (`CODE_READY`) | 2.1–2.5 · 4.1 · 5.2.1–5.2.18 · 7.1 · 7.4 · 9.1 · 9.2 · 9.4 |
| Built (`BUILT`, Android only; verified by native build inspection) | 2.5 · G-9 (local build) · B-1 · B-2 · B-3 |
| Verified by automated test | 2.1–2.3 · 4.1 · 5.2.3 · 5.2.4 · 5.2.7–5.2.12 · 5.2.16 · 7.1 · 7.4 (web) · 7.6 · 9.2 |
| Requires developer account (`NEEDS_ACCOUNT_ACTION`) | 4.2 · 5.2.1 · 5.2.2 · 5.2.16 · 5.2.17 · 7.3 · 9.4 · B-2 · B-4 · §10 |
| Requires official assets (`NEEDS_OFFICIAL_ASSETS`) | Final store screenshots with no prices (2.3.7 [A1]); IAP review screenshots if required (**to confirm**) |
| Requires legal approval (`NEEDS_LEGAL_APPROVAL`) | 4.5 · 8.3 · 9.1 · 9.5 · Terms of Use subscription section · disclosure wording |
| Requires regulatory evidence (`NEEDS_REGULATORY_EVIDENCE`) | 7.6 · 8.4 |
| Requires Apple or Google review (`NEEDS_STORE_REVIEW`) | 4.5 · 8.1 · 8.2 · IAP and Play product review at submission |
| Open engineering (not `CODE_READY`) | 2.6 · 2.7 · 4.3 · 4.4 · G-1 to G-8 · G-9 (automated check) · B-4 · 7.2 · 7.3 · 7.5 · 9.3 · 9.5 |
| Not reached by any line | `DEVICE_TESTED` · `READY_FOR_SUBMISSION` · `SUBMITTED` · `APPROVED` |

---

## 12. Official sources

All of these are cited from `docs/release/evidence/STORE_REQUIREMENTS_EVIDENCE.md` (verified 2026-10-14).

| ID | URL | Used for |
|---|---|---|
| A1 | https://developer.apple.com/app-store/review/guidelines/ | 2.1, 2.3.2, 2.3.7, 3.1.1, 3.1.1(a), 3.1.2(a)/(b)/(c), 3.1.3 intro, 3.1.3(b)/(d)/(e), 5.1.1(ix) |
| A2 | https://developer.apple.com/news/?id=a233fmpw | June 8, 2026 guideline revision (3.1.x unchanged) |
| A3 | https://developer.apple.com/documentation/bundleresources/information-property-list/skexternalpurchasemultilink.md | External purchase storefronts (Egypt not included) |
| A4 | https://developer.apple.com/support/terms/apple-developer-program-license-agreement/ | Schedule 2 §3.8(b) disclosures; Egypt tax collection |
| A5 | https://developer.apple.com/app-store/subscriptions/ | Subscription sign-up screen, restore, manage |
| A6 | https://developer.apple.com/support/offering-account-deletion-in-your-app/ | Account deletion with an active subscription |
| A7 | https://developer.apple.com/forums/thread/698791 | Mixed digital and real-world subscription: no Apple answer (official-but-ambiguous) |
| A8 | https://developer.apple.com/programs/enroll/ | Organization enrollment |
| G1 | https://support.google.com/googleplay/android-developer/answer/9858738?hl=en | Payments policy §3; no steering |
| G2 | https://support.google.com/googleplay/android-developer/answer/10281818?hl=en | Regulated clinical services; 1:1 services; mixed SKUs (official-but-ambiguous); cross-platform access (to confirm) |
| G3 | https://play.google.com/supported-locations?hl=en | Egypt: EGP 0.90 to 49,000.00 |
| G4 | https://support.google.com/googleplay/android-developer/answer/16954621?hl=en | No alternative billing in Egypt; Rest of World 2027-09-30 |
| G5 | https://developer.android.com/google/play/billing/deprecation-faq | Play Billing Library deprecation; manifest entry |
| G6 | https://support.google.com/googleplay/android-developer/answer/9859455 | App access for reviewers |
| G7 | https://support.google.com/googleplay/android-developer/answer/13327111?hl=en | Account deletion (in-app and web) |
| G8 | https://support.google.com/googleplay/android-developer/answer/10788890?hl=en | Organization account for health apps |
| E1 | https://docs.expo.dev/guides/in-app-purchases/ | IAP needs a development or store build (not Expo Go) |
| E2 | https://openiap.dev/docs/setup/expo | `expo-iap` 6.0.2, OpenIAP 4.0.2, Play Billing 9.1.0 |
| E3 | https://docs.expo.dev/guides/permissions/ | `blockedPermissions`; never block `com.android.vending.BILLING` |
| E4 | https://docs.expo.dev/build-reference/variants/ | App variants (IAP tied to production IDs is an inference, to confirm) |
