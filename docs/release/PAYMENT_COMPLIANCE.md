# Payment compliance: Dress My Wound | غير لي

Verified on: 2026-10-15

Code re-read and billing tests re-run on 2026-10-21. That run used commit `89cc0d4` plus the uncommitted working-tree changes present at the time (§5.6, §6).

> **Overall: NOT ready for submission. Store subscriptions are not ready to switch on.**
> - The feature flag `billing.store_subscriptions` is **OFF**.
> - No Apple or Google product exists. Every store product ID in the database is `NULL`.
> - Both server store adapters report `NOT_CONFIGURED`. Paymob also reports `NOT_CONFIGURED`, so TetraSol checkout is a preview only.
> - Gold and Platinum benefits are not delivered. Only the family-profile limit is enforced in code.
> - The mixed digital and real-world plan design has no official answer from either store (§8).
> - No iOS binary exists. The 2026-10-15 Android production build contains the Play Billing client, but it is signed only with the local debug key, points at a placeholder API, and has never run on a device.
> - No purchase has ever been made against either store.
> - No line in this document is `DEVICE_TESTED`, `READY_FOR_SUBMISSION`, `SUBMITTED` or `APPROVED`.
>
> Overall release status is kept in [`RELEASE_STATUS.md`](RELEASE_STATUS.md).

- **Scope:**
  - which payment rail each kind of purchase uses, and the policy basis for it
  - plans and prices
  - the server-side entitlement service, and what its tests prove
  - the feature flag and the Paymob state
  - the open issue on mixed digital and real-world benefits
  - account deletion while a subscription is active
  - configuration that needs developer accounts
- **Requirements** come only from [`evidence/STORE_REQUIREMENTS_EVIDENCE.md`](evidence/STORE_REQUIREMENTS_EVIDENCE.md), verified 2026-10-14.
  - Only `[verified-official]` findings are treated as requirements. Everything else is marked **to confirm**.
  - Source IDs such as `[A1]` resolve to URLs in §12.
- **Companion documents:** [`APPLE_APP_STORE_CHECKLIST.md`](APPLE_APP_STORE_CHECKLIST.md), [`GOOGLE_PLAY_CHECKLIST.md`](GOOGLE_PLAY_CHECKLIST.md) §6, [`PRIVACY_AND_DATA_DISCLOSURES.md`](PRIVACY_AND_DATA_DISCLOSURES.md) and [`RELEASE_STATUS.md`](RELEASE_STATUS.md).

---

## 0. How to read this document

**Statuses** are used exactly as listed: `CODE_READY` · `BUILT` · `DEVICE_TESTED` · `STORE_METADATA_READY` · `NEEDS_ACCOUNT_ACTION` · `NEEDS_REGULATORY_EVIDENCE` · `NEEDS_LEGAL_APPROVAL` · `NEEDS_OFFICIAL_ASSETS` · `NEEDS_STORE_REVIEW` · `READY_FOR_SUBMISSION` · `SUBMITTED` · `APPROVED`.
- A line can have several statuses: first the stage it has reached, then whatever still blocks it.
- **open (not CODE_READY)** means engineering work is still outstanding, so the line has reached no status yet. The store checklists use the same convention.
- `BUILT` means **Android only**, and only the local 2026-10-15 production APK and AAB (§5.5). They are debug-signed and cannot be distributed. Anything changed after that build, including the working-tree changes in §5.6, is not in it. Nothing is `BUILT` for iOS.

**Verification labels:**
- **verified by automated test (file):** the named test passed on the 2026-10-15 baseline run. Billing and compliance tests were also re-run on 2026-10-21.
- **verified by native build inspection:** `aapt2` inspection of the local Android APK, plus the AAB's manifest. It never refers to an iOS binary.
- **verified by config inspection:** source, migration or configuration files were read.
- **not verified:** none of the above.

E2E tests run against the Expo **web** build, which is only a proxy for the native apps. The web build has no store: `apps/mobile/src/features/billing/iap.web.ts` fails closed. So **no E2E test exercises a purchase**.

---

## 1. At a glance

| Bucket | What falls in it |
|---|---|
| **Completed implementation** (`CODE_READY`) | Payment-rail classifier, with no override parameter. Apple and Google verification adapters on the server. Entitlement service: account-token binding, idempotent append-only event log, stale-event protection, refund and revocation handling, and sandbox purchases limited to review and internal accounts in production. Apple and Google webhooks. Acknowledgement of Google purchases. Restore. Manage-subscription deep links. Plans screen. Deletion notice for an active store subscription. `expo-iap` 6.0.2 client, type-checked. |
| **Built** (`BUILT`, Android only) | The local 2026-10-15 production APK and AAB contain the Play Billing client: `com.android.vending.BILLING`, `com.google.android.play.billingclient.version` = `9.1.0`, and `ProxyBillingActivity`/`ProxyBillingActivityV2` (both `exported=false`). §5.5 |
| **Verified by automated test** | `apps/api/test/billing.test.ts` (§6). `apps/api/test/compliance.test.ts`: flags OFF by default, users cannot promote themselves to a review account, deletion. `e2e/tests/a11y.spec.ts` (web build only): the Plans screen renders and passes WCAG 2.2 A/AA checks. |
| **Requires developer account** (`NEEDS_ACCOUNT_ACTION`) | Organization accounts and app records. Subscription group and products. Play subscriptions and base plans. Store price points. App Store Server Notifications URL. Google service account, Pub/Sub topic and RTDN push subscription. Apple root certificates on the server. Server environment variables. Product IDs in `app.billing_plan_offers`. Sandbox and license testers. Paymob merchant account. §10 |
| **Requires official assets** (`NEEDS_OFFICIAL_ASSETS`) | Final native store screenshots: today's drafts are temporary placeholders, and none may show prices (2.3.7 [A1]). Product display names. IAP review screenshots, if required (**to confirm**). |
| **Requires legal approval** (`NEEDS_LEGAL_APPROVAL`) | The "Paid plans" section of the Terms (working tree; the legal entity name is still a placeholder). Auto-renew disclosure wording. Deletion-screen subscription wording. Retention of billing records after deletion. The choice between Option A and Option B (§8). |
| **Requires regulatory evidence** (`NEEDS_REGULATORY_EVIDENCE`) | Real-world perks tied to visits or consultations depend on `care.home_visit_booking` (Ministry of Health licensing evidence) and `care.video_consultation` (telemedicine licensing evidence). Both flags are OFF. |
| **Requires Apple or Google review** (`NEEDS_STORE_REVIEW`) | Written clarification on mixed digital and real-world benefits (§8). Review of the IAP and Play products at submission. |
| **Open engineering** (not `CODE_READY`) | Benefits are not delivered (G-1). Android tier changes (G-3). Untested Google and production-only paths (G-6, G-7). `.env.example` (G-8). No automated check of the PBL manifest entry (G-9). Ignored notifications are not logged (G-10). The classifier is not applied to products or bookings (2.6). The deletion notice does not name the store (9.3). Billing rows remain after deletion (9.5). Defects in the working-tree change-plan flow (5.6). No iOS build (B-4). |

---

## 2. Payment classification (`packages/shared/src/billing.ts`)

| Class | Digital | Example (`PAYMENT_CLASS_RULES`) | iOS rail | Android rail | Web rail | Link-out to pay allowed in the native app | Policy basis |
|---|---|---|---|---|---|---|---|
| `PHYSICAL_PRODUCT` | no | TetraSol dressings delivered to the home | `EXTERNAL_GATEWAY` | `EXTERNAL_GATEWAY` | `EXTERNAL_GATEWAY` | yes | Apple 3.1.3(e) [A1]; Play Payments §3 [G1] |
| `PHYSICAL_SERVICE` | no | A nurse home visit for wound dressing | `EXTERNAL_GATEWAY` | `EXTERNAL_GATEWAY` | `EXTERNAL_GATEWAY` | yes | Apple 3.1.3(e) [A1]; Play §3 [G1]; regulated clinical services [G2] |
| `ELIGIBLE_PERSON_TO_PERSON_SERVICE` | no | A real-time 1:1 consultation with one licensed doctor | `EXTERNAL_GATEWAY` | `EXTERNAL_GATEWAY` | `EXTERNAL_GATEWAY` | yes | Apple 3.1.3(d) [A1]; clinical services and non-replayable 1:1 services [G2] |
| `DIGITAL_SUBSCRIPTION` | yes | Gold / Platinum plans | `APPLE_IAP` | `GOOGLE_PLAY_BILLING` | `EXTERNAL_GATEWAY` | **no** | Apple 3.1.1 and 3.1.3 intro [A1]; storefront list [A3]; Play no-steering rule [G1]; no alternative billing in Egypt [G4] |
| `DIGITAL_FEATURE` | yes | A one-off unlock of an in-app feature | `APPLE_IAP` | `GOOGLE_PLAY_BILLING` | `EXTERNAL_GATEWAY` | **no** | same as the row above |

- **`resolvePaymentRail(cls, platform)`:**
  - Non-digital classes go to `EXTERNAL_GATEWAY`.
  - Digital classes go to `APPLE_IAP` on iOS, `GOOGLE_PLAY_BILLING` on Android, and `EXTERNAL_GATEWAY` on web.
  - There is deliberately no override parameter.
- **`mayLinkOutForPayment(cls, platform)`** returns `platform === 'web' || !digital`.
- **What the rails mean today:**
  - `EXTERNAL_GATEWAY` means Paymob, which is not configured (§7).
  - "Web" is a development and E2E harness. **No web sale of anything is implemented.**
- **Database (migration `0007`):**
  - The `app.payment_class` enum exists.
  - Constraint `paid_plans_are_digital` requires every plan except `SILVER` to be `DIGITAL_SUBSCRIPTION`.
  - `SILVER` is free. The API gives it `rail: null` and the reason `FREE_PLAN`.
- **API:** `GET /v1/billing/plans?platform=ios|android|web` (default `web`) returns `rail`, `purchasable` and `unavailableReason` for each plan. The reason is `FREE_PLAN`, `FEATURE_DISABLED` or `STORE_NOT_CONFIGURED`.

| # | Item | Status | Verified |
|---|---|---|---|
| 2.1 | Physical goods, physical services and eligible 1:1 services go to `EXTERNAL_GATEWAY` on every platform. | `CODE_READY` | verified by automated test (`apps/api/test/billing.test.ts`) |
| 2.2 | Digital subscriptions and features go to the platform store inside the native apps. | `CODE_READY` | verified by automated test (`apps/api/test/billing.test.ts`) |
| 2.3 | The native apps never link out to pay for a digital purchase. | `CODE_READY` | `mayLinkOutForPayment`: verified by automated test (`apps/api/test/billing.test.ts`). No screen calls it yet. The guarantee comes from the app having no external payment link at all: the only `Linking.openURL` calls are `tel:` (`features/compliance/Safety.tsx`) and the store's manage-subscription URL (`useStoreBilling.ts`). Verified by config inspection. |
| 2.4 | Paid plans can only be `DIGITAL_SUBSCRIPTION`. | `CODE_READY` | verified by config inspection (`0007_billing_entitlements.sql`) |
| 2.5 | No external-purchase or alternative-billing programme is configured. | `CODE_READY` · `BUILT` (Android) | Config: `apps/mobile/app.config.ts` pins `['expo-iap', { android: { store: 'play' } }]` and has no `SKExternalPurchase*` keys. Verified by config inspection. Android: the 2026-10-15 manifest has the `BILLING` permission and no alternative-billing or external-offer entries. Verified by native build inspection. iOS: the prebuild output predates `expo-iap`, so it must be re-run (Apple checklist). |
| 2.6 | The classifier is applied to TetraSol products, bookings and consultations. | open (not CODE_READY) | Only `app.billing_plans` has a payment class, and `resolvePaymentRail` is called only by `GET /v1/billing/plans`. Verified by config inspection. |
| 2.7 | The two stores treat consultations differently. Google exempts **all** regulated clinical services from Play Billing [G2]. Apple exempts only **real-time 1:1** services; one-to-few and one-to-many services must use IAP (3.1.3(d) [A1]). Whether asynchronous or AI-plus-clinician consults qualify on Apple is **to confirm**. The classifier gives a class the same rail on both platforms, so asynchronous, recorded or group consultations must never be classed `ELIGIBLE_PERSON_TO_PERSON_SERVICE` for iOS. No such service exists today, and `care.video_consultation` is OFF. | open (not CODE_READY) | not verified |

---

## 3. Policy basis

### 3.1 Apple (all `[verified-official]` unless marked)

The App Review Guidelines in force are marked "Last Updated: June 8, 2026". That revision did not change 3.1.x [A2].

| Rule | Requirement (summary) | Source | How the project applies it |
|---|---|---|---|
| 3.1.1 | Unlocking in-app features, subscriptions or premium content must use IAP. Apps may not use their own unlock mechanisms. Apps should offer a way to restore purchases. | [A1] | `DIGITAL_*` classes go to `APPLE_IAP`. A **Restore purchases** button calls `POST /v1/billing/restore`. |
| 3.1.1 / 3.1.1(a) | The External Purchase Link entitlement is limited to specific storefronts. Elsewhere (except the US), no buttons, external links or calls to action may point to non-IAP purchasing. | [A1] | `mayLinkOutForPayment` is `false` for digital purchases in the native apps. |
| External-purchase storefronts | Link entitlement: the 27 EU countries plus Iceland, Norway and Russia. External Purchase: the EU and South Korea. **Egypt is in neither.** Apple updates these lists "from time to time". | [A3] | No `SKExternalPurchase*` keys or entitlements. Re-check the lists before each release. |
| 3.1.2(a) | Auto-renewable subscriptions must provide ongoing value, last at least 7 days and be available on all of the user's devices. | [A1] | Only monthly and yearly periods exist. Entitlements are stored per account on the server, so they apply on every device. **Gap:** the benefits are not delivered yet (G-1). |
| 3.1.2(b)/(c) and Schedule 2 §3.8(b) | Upgrades and downgrades must be seamless within one subscription group. Before asking the user to subscribe, the app must say what they get. It must disclose the title, length and price, and link to the Privacy Policy and Terms in the app. | [A4] | One group is planned (§10.1). The screen shows the plan name, period, store price, auto-renew disclosure, and Terms and Privacy links. |
| Subscription sign-up screen | Show the subscription name, duration and content. Show the full renewal price, localized, as the most prominent price. Give existing subscribers a way to sign in or restore. State the trial length and post-trial price. Apple recommends `showManageSubscriptions`. | [A5] | The store's own `displayPrice` is shown, one per offer, with no per-month equivalent. No trials are configured. Restore and Manage are both present. **Never seen on a device.** |
| 3.1.3 intro | Apps that use other purchase methods under 3.1.3 must not, inside the app, encourage users to buy outside IAP. Communication outside the app is allowed. | [A1] | No Paymob or web offer for plans appears in the app or in `store/metadata/*.json`. |
| 3.1.3(b) | Content or subscriptions bought elsewhere can be used in the iOS app only if they are also sold as IAP in the app. | [A1] | Entitlement sources are `APPLE`, `GOOGLE` and `ADMIN_GRANT` only. No web or Paymob plan sale exists. **Sequencing rule:** a plan bought on Play also unlocks on iOS (G-2), so Apple products must go live before or together with Google products. |
| 3.1.3(d) | Real-time person-to-person services between two individuals, including medical consultations, may use non-IAP payment. One-to-few and one-to-many services must use IAP. | [A1] | `ELIGIBLE_PERSON_TO_PERSON_SERVICE` goes to `EXTERNAL_GATEWAY` (see 2.7). |
| 3.1.3(e) | Physical goods, and services consumed outside the app, must use purchase methods other than IAP. | [A1] | `PHYSICAL_*` classes go to `EXTERNAL_GATEWAY`. |
| 2.1(a)/(b) | Provide demo account details. IAPs must be complete, visible to the reviewer and functional. | [A1] | Review accounts exist (`apps/api/src/db/seed-review.ts`) and can buy while the flag is OFF (5.2.7). **Gap:** a reviewer who buys Gold gets no enforced benefit while the flag is OFF (G-1). |
| 2.3.2 / 2.3.7 | Metadata must say clearly which features need an additional purchase. No prices in the name, subtitle or screenshots. | [A1] | `store/metadata/*.json` has no plan wording yet. That is acceptable while IAP is off, but required if IAP ships. |
| 5.1.1(ix) | Healthcare apps should be submitted by the legal entity that provides the services. | [A1] | §10.1 |
| Account deletion | Users with an active auto-renewable subscription must be told that billing continues through Apple and asked to cancel. Deletion may be scheduled for the subscription's expiry only if immediate deletion is also offered. | [A6] | §9 |
| Tax | For Egypt, Apple acts as commissionaire and collects and remits tax on App Store sales. | [A4] | Keep IAP revenue and Paymob revenue in separate books. |
| Mixed subscription | **Official-but-ambiguous; to confirm.** No Apple rule covers one subscription that combines in-app features with real-world benefits. A forum question on exactly this case got no Apple answer. | [A7] | §8 |

### 3.2 Google Play (all `[verified-official]` unless marked)

| Rule | Requirement (summary) | Source | How the project applies it |
|---|---|---|---|
| Payments §3 | Physical goods and physical services must not use Play Billing. | [G1] | `PHYSICAL_*` classes go to `EXTERNAL_GATEWAY`. |
| No steering | Users may not be steered to another payment method for in-app digital purchases (webviews, buttons, links, messaging, sign-up flows). Exceptions: §3, and enrolled §8/§9 programmes in eligible regions. | [G1] | No link-out for digital purchases. |
| Regulated clinical services | Services provided by or for a licensed healthcare provider to diagnose or manage conditions should not use Play Billing. | [G2] | `PHYSICAL_SERVICE` and `ELIGIBLE_PERSON_TO_PERSON_SERVICE` go to `EXTERNAL_GATEWAY`. |
| 1:1 services | Paid 1:1 online services between two individuals that are not available for replay do not require Play Billing. | [G2] | As above. A replayable session would lose this exemption and would rely on the clinical-services rule instead. |
| Mixed SKUs | **Official-but-ambiguous; to confirm.** Play Billing is required when a SKU includes more digital than physical value, or is marketed as digital. No numeric test is given. | [G2] | §8 |
| Egypt | Play purchases are supported for buyers in Egypt, in EGP from 0.90 to 49,000.00. | [G3] | All reference prices fall inside this range (§4). |
| No alternative billing | No user-choice, alternative-billing or billing-choice programme is open to users in Egypt. A "Rest of World" rollout is announced for 2027-09-30; that date is forward-looking. | [G4] | `expo-iap` is pinned to `store: 'play'`. Revisit after 2027-09-30. |
| Play Billing Library | New apps and updates must use PBL 8 or later from 2026-08-31 (extension to 2026-11-01). PBL 8 is deprecated on 2027-08-31 and PBL 9 on 2028-08-31. The `com.google.android.play.billingclient.version` manifest entry must survive manifest merging. | [G5] | `expo-iap` 6.0.2 → `openiap-google` 4.0.2 → `billing` **9.1.0** [E2]. The entry is present in the built APK and AAB (B-1). |
| App access | Reviewers must get everything needed to reach any part behind a login or membership. Up to five instruction sets are allowed. | [G6] | Patient, Doctor and Nurse review accounts exist. A subscriber instruction set is needed if Gold or Platinum ship. |
| Account deletion | Provide an in-app deletion path and a working web link. Healthcare apps may add steps. | [G7] | §9 |
| Organization account | Health apps must use an Organization developer account with a D-U-N-S number. | [G8] | §10.2 |
| Cross-platform access | **To confirm.** The evidence critique lists this as "additionally verified" without a `[verified-official]` tag: an app may give access to content paid for elsewhere, and Google does not require parity across platforms. | [G2] | No web sale exists today. |

### 3.3 Not in the evidence: confirm before relying on these
- Whether App Store Server Notifications V2 and Play RTDN are store **requirements**. The code implements both, but the evidence critique lists subscription lifecycle mechanics as "missing".
- The Google acknowledgement deadline. The critique and a code comment mention 3 days, with automatic refund of unacknowledged purchases. This is unverified.
- The durations of grace period, account hold and billing retry.
- Commission rates (Apple Small Business Program or the standard rate; Play's subscription rate) and Play's fee terms for Egypt. All are unresolved in the evidence.
- The Google Play Subscriptions policy (offer transparency, cancellation, trial disclosure). It is missing from the evidence.
- Account prerequisites: the App Store Connect Paid Applications agreement with banking and tax details, and the Play payments profile.
- Whether Apple offers EGP price points matching 299, 2,990, 699 and 6,990.
- Whether IAP products need review screenshots, and how they are attached to a version for review.
- The disclosure wording "at least 24 hours before the end of the period", used in `billing.disclosure` (`packages/i18n`) and in the working-tree Terms.
- The manage-subscription URL formats in §5.2.15. They are code constants.
- The Apple root certificate source named in an `env.ts` comment (`AppleRootCA-G3.cer` from apple.com/certificateauthority).
- That purchase testing needs the production identifiers, so the `.staging` and `.dev` variants would need their own app records and products. The evidence marks this as an inference [E4].
- Paymob items: PCI DSS scope, merchant KYC, and Apple Pay through Paymob. All are listed as "missing" in the critique.

---

## 4. Plans and prices (migration `0007_billing_entitlements.sql`)

| Plan (EN / AR) | Period | Business reference price | `reference_price_piasters` | Apple product ID | Google product / base plan | Family profiles |
|---|---|---|---|---|---|---|
| Silver / فضي | MONTHLY | free | 0 | none (free plan, never sold) | none | `NULL` (pending business decision) |
| Gold / ذهبي | MONTHLY | 299 EGP | 29,900 | `NULL` | `NULL` / `NULL` | 4 |
| Gold / ذهبي | YEARLY | 2,990 EGP | 299,000 | `NULL` | `NULL` / `NULL` | 4 |
| Platinum / بلاتيني | MONTHLY | 699 EGP | 69,900 | `NULL` | `NULL` / `NULL` | 8 |
| Platinum / بلاتيني | YEARLY | 6,990 EGP | 699,000 | `NULL` | `NULL` / `NULL` | 8 |

- **Reference prices are business data.** The migration labels them "Spec §20 business prices".
- **Customer prices are the price points set in App Store Connect and Play Console.**
  - The app shows the store's localized `displayPrice`, fetched through `expo-iap`.
  - A Subscribe button appears only when a store price exists.
  - Otherwise the reference price appears with a label: "Reference price {price}" / "السعر المرجعي {price}".
- Play's Egypt range (0.90 to 49,000.00 EGP) covers all four prices [G3]. Apple's EGP price points are **to confirm**.
- All store product IDs are `NULL`, so nothing can be bought.

| Plan | `DIGITAL` benefits | `REAL_WORLD` benefits |
|---|---|---|
| Silver | Personal health profile and medical record · Basic family support · Find verified doctors and nurses · TetraSol store | none |
| Gold | You + up to 4 family profiles · Enhanced family dashboard · Enhanced reminders and weekly health summary | Priority matching · Reduced eligible platform fees · Priority support |
| Platinum | You + up to 8 family profiles · Premium family management and advanced summaries | Highest eligible matching priority · Enhanced booking benefits · Concierge-style support where staffed |

The Plans screen tags each `REAL_WORLD` item "Real-world benefit" (Arabic: "ميزة خارج التطبيق").

| # | Item | Status | Verified |
|---|---|---|---|
| 4.1 | Plans and reference prices are seeded, and Silver is the free default. | `CODE_READY` | verified by automated test (`apps/api/test/billing.test.ts`, "lists plans with the resolved rail…": plan order, Gold 29,900 / 299,000) |
| 4.2 | Store products and EGP price points exist. | `NEEDS_ACCOUNT_ACTION` | verified by config inspection (every product ID is `NULL`) |
| 4.3 | Plan benefits are delivered. Outside the billing module and the Plans screen, only `app.family_profile_limit()` reads the plan. No dashboard, reminders, summaries, priority matching or fee discount reads the plan. | open (not CODE_READY) | verified by config inspection |
| 4.4 | Plans and offers can be edited. Row-level security allows an ADMIN to update them, but **no API route or admin page exists**. Product IDs must be set with a reviewed SQL change run by the database owner (§10.4). | open (not CODE_READY) | verified by config inspection |
| 4.5 | The benefit copy matches the outcome of §8. | `NEEDS_LEGAL_APPROVAL` · `NEEDS_STORE_REVIEW` | not verified |
| 4.6 | Terms and plan data agree. The working-tree Terms section "Paid plans" (`packages/shared/src/legal.ts`) says "Plans unlock app features only; clinical services and TetraSol products are paid separately". The seeded Gold and Platinum benefits still list `REAL_WORLD` perks. One of the two must change once §8 is decided. | open (not CODE_READY) · `NEEDS_LEGAL_APPROVAL` | verified by config inspection |

---

## 5. Entitlement service

### 5.1 Purchase flow (as coded)
1. The app loads `GET /v1/billing/plans?platform=…` and `GET /v1/system/features`. Both are evaluated for the caller. If store subscriptions are unavailable to the caller, or the platform is web, the app never connects to the store (`useStoreBilling.ts`).
2. `GET /v1/billing/account-token` returns the caller's random UUID from `app.billing_accounts`, creating it on first use.
3. `expo-iap` `requestPurchase` sends that token as the StoreKit `appAccountToken` (iOS) or the Play `obfuscatedAccountId` (Android).
4. On `purchaseUpdatedListener`, the app posts the purchase to the server:
   - iOS: `POST /v1/billing/apple/verify` with `{signedTransactionInfo: purchase.purchaseToken}`. `expo-iap` documents `purchaseToken` as the iOS JWS.
   - Android: `POST /v1/billing/google/verify` with `{productId, purchaseToken}`.
   - **Not verified on a device.**
5. The server verifies the purchase with the store and normalizes it (`apps/api/src/modules/billing/events.ts`). It then checks, in order: availability (flag or review account), the sandbox rule, the account token and the product mapping. Then it calls `app.billing_apply_event()`.
6. Google only: once the purchase is bound, the server acknowledges it if it is not already acknowledged.
7. The app refreshes entitlements, then calls `finishTransaction`. **The app never unlocks anything from a client-side purchase result.**
8. Later changes arrive server-to-server through `POST /webhooks/apple/app-store-notifications` and `POST /webhooks/google/rtdn`. Server notifications are applied whether the flag is ON or OFF, so refunds and expiries are always recorded.

### 5.2 Controls

| # | Control | Implementation (`apps/api/src/modules/billing/routes.ts`, `apps/api/src/integrations/billing.ts`, `0007`) | Status | Verified |
|---|---|---|---|---|
| 5.2.1 | Apple verification | `createAppleStore` builds `SignedDataVerifier` instances from Apple's App Store Server Library (`@apple/app-store-server-library`). Inputs: root certificates (`.cer`/`.der`) from `APPLE_ROOT_CERTS_DIR` (startup fails if the directory has none); the bundle ID; the app's Apple ID (required when `NODE_ENV=production`); and online checks (`APPLE_IAP_ONLINE_CHECKS`, default on). It tries the Production verifier first, then Sandbox. A failure returns 422 `INVALID_STORE_SIGNATURE`. | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` | Real signature verification is never exercised, because tests replace the adapter with a fixture. Verified by config inspection. |
| 5.2.2 | Google verification | Play Developer API `purchases.subscriptionsv2` GET, through `GoogleAuth` with the `androidpublisher` scope. The verified product ID must equal the one the client sent, otherwise 422. | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` | verified by config inspection only |
| 5.2.3 | Fail closed without credentials | Without credentials, each adapter reports `NOT_CONFIGURED` and every call returns 503 `STORE_NOT_CONFIGURED`. Plans report `STORE_NOT_CONFIGURED`, and nothing is granted. | `CODE_READY` | verified by automated test (`apps/api/test/billing.test.ts`) |
| 5.2.4 | Account-token binding | **Ownership check:** the purchase's token must equal the caller's `app_account_token`, otherwise 403 `PURCHASE_ACCOUNT_MISMATCH`.<br>**One row per subscription:** `UNIQUE (source, external_ref)`, where `external_ref` is the Apple `originalTransactionId` or the Google `purchaseToken`.<br>**Re-binding:** a subscription moves to another account only when a **newer** verified transaction carries that account's token, or when the bound account was deleted. Any other mismatch is recorded as `IGNORED_ACCOUNT_MISMATCH`. Client verify then answers 403 `SUBSCRIPTION_BELONGS_TO_ANOTHER_ACCOUNT`, but store notifications always get 200. | `CODE_READY` | verified by automated test (`apps/api/test/billing.test.ts`: a replay by another account gets 403; a newer purchase re-binds; a late notification for the old owner returns 200 `IGNORED_ACCOUNT_MISMATCH`) |
| 5.2.5 | The product-to-plan mapping comes from the server only | `planForProduct` reads `app.billing_plan_offers`. Silver is never matched. An unknown product gets 422 `UNKNOWN_PRODUCT` (client) or `IGNORED_UNKNOWN_PRODUCT` (notification). | `CODE_READY` | Mapping: covered indirectly by an automated test (`billing.test.ts`: the fixture product maps to Gold). Unknown-product path: verified by config inspection. |
| 5.2.6 | Sandbox purchases accepted in production only for review and internal accounts | "Sandbox" means an Apple `environment` other than `Production`, or a Google `testPurchase`. Client verify in production from an account whose `account_kind` is not `REVIEW` or `INTERNAL_TEST` gets 403 `SANDBOX_PURCHASE_NOT_ALLOWED`. Server notifications get `IGNORED_SANDBOX` (`app.billing_is_test_account`). | `CODE_READY` | The production branch is verified by config inspection only, because tests do not run as production (G-7). Users cannot set their own `account_kind`: verified by automated test (`apps/api/test/compliance.test.ts`, "users cannot promote themselves to a review account"). |
| 5.2.7 | Feature-flag gate | While the flag is OFF, verify returns 409 `FEATURE_DISABLED`. `REVIEW` and `INTERNAL_TEST` accounts are exempt through `app.store_subscriptions_available()`, which feeds `GET /v1/system/features` and `GET /v1/billing/plans`. So App Review can buy the submitted products while subscriptions stay off for everyone else. | `CODE_READY` | verified by automated test (`billing.test.ts`: 409 while OFF; a reviewer sees purchasable plans, a regular user sees `FEATURE_DISABLED`) |
| 5.2.8 | Idempotent, append-only event log | **Idempotency:** `app.store_events` has `UNIQUE (source, external_event_id)`; a repeated event returns `DUPLICATE` and changes nothing. Event IDs are the Apple `notificationUUID`, the Pub/Sub `messageId`, or a synthetic ID for client verify and restore.<br>**Append-only:** a `BEFORE UPDATE OR DELETE` trigger (`app.forbid_mutation`) blocks edits.<br>**Concurrency:** events for one subscription are serialised with a transaction-scoped advisory lock.<br>**Data kept:** the summary stores only `{sandbox, productId}`, never receipts or tokens. Reading requires `audit.read`.<br>**Outcomes:** `APPLIED`, `IGNORED_STALE`, `IGNORED_UNKNOWN_SUBSCRIPTION`, `IGNORED_NOT_SUBSCRIPTION`, `IGNORED_ACCOUNT_MISMATCH`. | `CODE_READY` | Duplicate handling: verified by automated test (`billing.test.ts`). Trigger and lock: verified by config inspection. |
| 5.2.9 | Stale-event protection | An event older than `last_event_at` returns `IGNORED_STALE`, unless it is `REFUNDED` or `REVOKED`; those always win for the current period. A refund or revocation of an **earlier** billing period (its expiry is before the stored one) returns `IGNORED_STALE`, and the paid current period stays active. `last_event_at` only moves forward. | `CODE_READY` | verified by automated test (`billing.test.ts`: a stale `DID_RENEW` after a refund is ignored; a refund of an earlier period keeps Gold) |
| 5.2.10 | Refunds and revocation | **Apple:** a `revocationDate` gives `REFUNDED`, or `REVOKED` on a `REVOKE` notification. `REFUND`, `REVOKE`, `EXPIRED` and `GRACE_PERIOD_EXPIRED` notifications map to terminal statuses. A transaction superseded by an upgrade (`isUpgraded`) is never applied.<br>**Google:** `voidedPurchaseNotification` gives `REFUNDED` only for the latest order (`orderId` = `latestOrderId`). Every RTDN re-fetches state from the Play Developer API instead of trusting the notification body. | `CODE_READY` | Apple: verified by automated test (`billing.test.ts`). Google: verified by config inspection. |
| 5.2.11 | Access rule | Only `ACTIVE` and `GRACE_PERIOD` grant access, and only while `expires_at` is in the future. `BILLING_RETRY` grants nothing. The highest tier wins; the default is `SILVER` (`app.effective_plan`). | `CODE_READY` | verified by automated test (`billing.test.ts`: state mapping; the plan returns to Silver after a refund) |
| 5.2.12 | Clients cannot write entitlements | The app database role has no INSERT, UPDATE or DELETE grant on `app.entitlements`. Only the `SECURITY DEFINER` function `app.billing_apply_event` writes, and it rejects `ADMIN_GRANT`. No admin-grant API exists. | `CODE_READY` | verified by automated test (`billing.test.ts`, "clients cannot write entitlements directly") |
| 5.2.13 | Acknowledging Play purchases | `acknowledgeIfNeeded` runs on every path that binds a purchase (verify, restore, RTDN). It acts when the outcome is `APPLIED` or `DUPLICATE`, the status grants access, and Google reports `ACKNOWLEDGEMENT_STATE_PENDING`. A purchase that cannot be bound stays unacknowledged (fail closed). What Google then does, and when, is **to confirm** (§3.3). | `CODE_READY` | verified by config inspection (Google paths untested: G-6) |
| 5.2.14 | Restore Purchases | The app reads `getAvailablePurchases` and posts them to `POST /v1/billing/restore`: at most 10 per store, de-duplicated, 10 requests per minute per account. Each purchase goes through the same checks as verify. Per-item error codes come back in `restoreErrors`. The button is always visible. | `CODE_READY` | Route: no automated test. Button: renders in `e2e/tests/a11y.spec.ts` (web build). |
| 5.2.15 | Manage subscription | `expo-iap` `deepLinkToSubscriptions` (on Android with package and SKU). The fallback `manageSubscriptionUrl` opens `https://apps.apple.com/account/subscriptions` or `https://play.google.com/store/account/subscriptions?sku=…&package=…`. These are code constants, not from the evidence (**to confirm**). The button is shown when a store entitlement is `ACTIVE` or `GRACE_PERIOD`. | `CODE_READY` | verified by config inspection; never opened on a device |
| 5.2.16 | Apple server notifications | `POST /webhooks/apple/app-store-notifications` with `{signedPayload}`. It verifies the notification, transaction and renewal info with the same verifiers. A payload that is not a subscription returns 200 `IGNORED_NOT_SUBSCRIPTION`. The account is resolved from the bound subscription or from `appAccountToken`. Limit: 600 requests per minute. | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` (URL) | verified by automated test (`billing.test.ts`, fixture verifier: refund, duplicate, stale, account mismatch) |
| 5.2.17 | Google RTDN | `POST /webhooks/google/rtdn`. The `Authorization: Bearer` OIDC token is verified: the audience must be `GOOGLE_RTDN_AUDIENCE`, `email_verified` must be true, and the email must equal `GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL`. `packageName` must equal `GOOGLE_PLAY_PACKAGE_NAME`, otherwise 403 `WRONG_PACKAGE`. State is re-fetched from Google, and the Pub/Sub `messageId` is the idempotency key. | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` | verified by config inspection only |
| 5.2.18 | Audit and rate limits | Every `APPLIED` event writes `billing.entitlement.updated` (with `reboundFrom` when a subscription moves account) to `app.audit_log`. Verify allows 30 requests per minute and restore 10, both keyed on the account (`sessionKey`). Webhooks allow 600 per minute. | `CODE_READY` | verified by config inspection |

### 5.3 Status mapping (`events.ts`)

| Store input | Entitlement status | Grants access |
|---|---|---|
| Apple `revocationDate` set | `REFUNDED` (`REVOKED` on a `REVOKE` notification) | no |
| Apple notification `REFUND` / `REVOKE` / `EXPIRED` / `GRACE_PERIOD_EXPIRED` | `REFUNDED` / `REVOKED` / `EXPIRED` / `EXPIRED` | no |
| Apple billing retry, grace end in the future | `GRACE_PERIOD` (expires at grace end) | yes |
| Apple billing retry, no grace | `BILLING_RETRY` | no |
| Apple `expiresDate` in the future | `ACTIVE` | yes |
| Apple non-subscription transaction, or `isUpgraded` | nothing recorded | no |
| Google `ACTIVE` | `ACTIVE` | yes |
| Google `CANCELED` | `ACTIVE` until expiry, then `EXPIRED` | until expiry |
| Google `IN_GRACE_PERIOD` | `GRACE_PERIOD` | yes |
| Google `ON_HOLD` | `BILLING_RETRY` | no |
| Google `PAUSED` / `EXPIRED` | `EXPIRED` | no |
| Google `PENDING`, `PENDING_PURCHASE_CANCELED`, unspecified | nothing recorded | no |
| Google voided purchase (latest order) | `REFUNDED` | no |

### 5.4 Known gaps and risks

| # | Gap | Effect | Status | Verified |
|---|---|---|---|---|
| G-1 | Benefits are not delivered (4.3). | **While the flag is ON**, `app.family_profile_limit()` takes the limit from the plan, and the flag cannot be enabled while any active plan has no limit (`PLAN_FAMILY_LIMITS_REQUIRED`). Silver's limit is still `NULL`.<br>**While the flag is OFF**, the global setting `family.max_managed_profiles` (default 8) applies to everyone, including review accounts. So a reviewer who buys Gold sees "Your plan" change but gets no functional difference.<br>The other listed benefits have no implementation. Selling them now conflicts with 3.1.2(a) "ongoing value" and 2.1(b) "functional" [A1]. | family limit `CODE_READY`; everything else open (not CODE_READY) | family limit: verified by automated test (`billing.test.ts`); the rest by config inspection |
| G-2 | Cross-store access and 3.1.3(b). | `app.effective_plan` ignores which store sold the plan, so a Play purchase unlocks the plan on iOS. That is allowed only if the same plans are also sold as IAP on iOS [A1]. | open (release-sequencing rule) | verified by config inspection |
| G-3 | Android tier changes. | The Android purchase request passes no `subscriptionOffers` (base-plan offer token) and no replacement parameters, and `linkedPurchaseToken` is never used. Two things are **to confirm** on a device: whether OpenIAP selects an offer automatically, and whether Play's own subscription settings can switch between separate products. The working-tree screen sends Android tier changes to Play's settings (5.6). | open (not CODE_READY) | verified by config inspection; not tested |
| G-5 | Purchases with no account token. | A purchase made outside the app's purchase flow carries no `appAccountToken` or `obfuscatedAccountId`, so it can never be bound. Restore then fails with `PURCHASE_ACCOUNT_MISMATCH`, which the working tree reports as `OTHER_ACCOUNT`. A support procedure is needed. | open (not CODE_READY) | verified by config inspection |
| G-6 | Google paths are untested. | Google verify, acknowledgement, restore and RTDN never run in tests, because the Google fixture is `NOT_CONFIGURED`. | open (not CODE_READY) | not verified |
| G-7 | Production-only branches are untested. | The sandbox rule and the Production Apple verifier run only with `NODE_ENV=production`. | open (not CODE_READY) | not verified |
| G-8 | `apps/api/.env.example` is incomplete. | It lists none of the `APPLE_IAP_*`, `APPLE_ROOT_CERTS_DIR` or `GOOGLE_*` variables, only `PAYMOB_*`. | open (not CODE_READY) | verified by config inspection |
| G-9 | No automated check of the PBL manifest entry. | `com.google.android.play.billingclient.version` must survive merging [G5]. It is present in the local build (B-1), but `scripts/release/verify-android.sh` checks only the `BILLING` permission. No EAS-built, store-signed AAB has been checked. | open (not CODE_READY) | verified by native build inspection (entry present); verified by config inspection (no check) |
| G-10 | Some ignored notifications leave no trace. | `IGNORED_SANDBOX` and `IGNORED_UNKNOWN_PRODUCT` return 200 before `app.billing_apply_event` runs, so nothing is written to `app.store_events`. A misconfigured product ID would fail silently. | open (not CODE_READY) | verified by config inspection |

(G-4, acknowledgement only on the verify route, was fixed on 2026-10-15 and is covered by 5.2.13.)

### 5.5 Billing client in native builds

| # | Item | Facts | Status | Verified |
|---|---|---|---|---|
| B-1 | The Android production build (2026-10-15) contains the Play Billing client. | Package `com.aliagroup.dressmywound`, versionCode 1, targetSdk 36. The manifest has: the `com.android.vending.BILLING` permission; `com.google.android.play.billingclient.version` = `9.1.0` (in both the APK and the AAB); `com.android.billingclient.api.ProxyBillingActivity` and `ProxyBillingActivityV2` (both `exported=false`); `dev.hyo.openiap.PROVIDER` metadata; and a `<queries>` entry for `com.android.vending.billing.InAppBillingService.BIND`. `BILLING` is correctly absent from `blockedPermissions` [E3]. `verify-android.sh` passed on this APK. | `BUILT` | verified by native build inspection (`aapt2 dump badging` / `xmltree`; strings in the AAB's protobuf manifest) |
| B-2 | That build cannot be distributed or used for purchases. | It is signed only with the local debug key; store signing happens in EAS and Play App Signing. Its API URL is the placeholder `https://api.dressmywound.invalid`. It predates the working-tree changes in 5.6. | `BUILT` · `NEEDS_ACCOUNT_ACTION` | verified by native build inspection |
| B-3 | Android development client | `com.aliagroup.dressmywound.dev` (arm64-v8a, x86_64) also contains Play Billing `9.1.0` and can be installed with `adb install`. IAP needs a development or store build, not Expo Go [E1]. Whether purchases can be tested under the `.dev` package ID is **to confirm** [E4]. | `BUILT` | verified by native build inspection; never run on a device |
| B-4 | iOS | No binary exists. The iOS prebuild output predates `expo-iap`, so the StoreKit 2 client has never been compiled. A build needs macOS and Xcode, or an EAS cloud build with an Apple Developer account. | open (not BUILT) · `NEEDS_ACCOUNT_ACTION` | not verified |
| B-5 | 2026-10-14 production APK | Superseded. It crashed at launch and declared biometric permissions. Do not use it. | superseded | verified by native build inspection |

### 5.6 Working-tree changes to the client (uncommitted on 2026-10-21; not in any build)

| # | Change | Status | Verified |
|---|---|---|---|
| 5.6.1 | Purchase errors are now specific (`billing.error_*`): `VERIFY_FAILED`, `STORE_UNAVAILABLE`, `OTHER_ACCOUNT`, `PENDING_APPROVAL`, `NETWORK`, `ALREADY_OWNED`, `PURCHASE_FAILED`. A failed server verification leaves the transaction unfinished so the store delivers it again. A `finishTransaction` failure after a successful verification is reported as a non-fatal client error. | open (not CODE_READY): uncommitted | verified by config inspection |
| 5.6.2 | Restore now tells the user when the store could not be reached (`restoreFailed`) and when some items were refused (`restoreIssues`). | open (not CODE_READY): uncommitted | verified by config inspection |
| 5.6.3 | Change plan in the store. With an active store subscription, the Subscribe button becomes "Change plan in {store}" in two cases: on Android for every tier change, and on either platform when the plan was bought in the other store. A notice says where the plan is billed (`managedInOtherStore`). **Defect 1:** across stores, the label names the other store, but `billing.manage` opens **this** device's store (StoreKit sheet or Play), where that subscription cannot be managed. **Defect 2:** on Android the button opens Play's subscription settings, which may not offer a switch between separate products (G-3). Whether the cross-store notice is acceptable under the 3.1.3 rules is **to confirm** [A1]. | open (not CODE_READY) | verified by config inspection |

---

## 6. What the tests prove (`apps/api/test/billing.test.ts`)

**Test counts:**
- The 2026-10-15 baseline (`RELEASE_STATUS.md`) recorded **10** billing tests and **11** compliance tests.
- Commit `79ea7ff` (2026-10-15 21:53 UTC) added five billing tests and one compliance test.
- At `89cc0d4` the file has **15** tests. A re-run on 2026-10-21 passed 15/15 billing and 12/12 compliance tests. The totals in `RELEASE_STATUS.md` need refreshing.

| Test | Proves |
|---|---|
| payment classification › routes physical goods, physical services and 1:1 consultations to the external gateway on every platform | `EXTERNAL_GATEWAY` for the three non-digital classes on iOS, Android and web. |
| … › routes digital subscriptions and features to the platform store inside the apps | `APPLE_IAP` on iOS and `GOOGLE_PLAY_BILLING` on Android, for both digital classes. |
| … › never allows linking out to pay for digital purchases in the native apps | `mayLinkOutForPayment` is false for digital purchases on iOS and Android, and true for physical purchases. |
| store event normalization › maps Apple transaction + renewal state to access | `ACTIVE`, `EXPIRED`, `GRACE_PERIOD`, `BILLING_RETRY`, `REFUNDED`, and `EXPIRED` from a notification. |
| … › maps Google subscription states | A cancelled subscription keeps its paid time; on hold gives `BILLING_RETRY`; pending gives nothing. |
| … › ignores non-subscription Apple transactions and flags sandbox purchases | A consumable gives `null`; `Sandbox` sets `sandbox=true`; the event type is `CLIENT_VERIFY`. |
| … › never lets a transaction superseded by an upgrade restore access | An `isUpgraded` Apple transaction normalizes to nothing. |
| entitlement service › lists plans with the resolved rail and an honest unavailability reason | Plan order; Silver is `FREE_PLAN`; the rail per platform; nothing purchasable; Gold reference prices. |
| … › refuses to verify anything when the store is not configured | 503 `STORE_NOT_CONFIGURED`; the plan stays Silver. |
| … › review accounts can buy while subscriptions are off for everyone else | A reviewer sees subscriptions available and Gold purchasable; a regular account sees `FEATURE_DISABLED`. |
| … › grants only after server verification, bound to the purchasing account; refunds revoke access | With the flag OFF: 409. The flag cannot be enabled while Silver has no family limit. A forged payload: 422. A valid purchase gives Gold with `storeManaged`. A replay by another account: 403, and that account stays Silver. A refund notification is `APPLIED`; its duplicate is `DUPLICATE`; the plan returns to Silver with status `REFUNDED`. A stale renewal is `IGNORED_STALE`. |
| … › once subscriptions are on, the family-profile limit comes from the plan | With Silver set to 1, a second family profile gets `FAMILY_LIMIT_REACHED`. |
| … › a newer purchase from another app account on the same Apple ID re-binds; notifications never fail on a mismatch | B's newer transaction moves Gold from A to B. A late notification about A's transaction returns 200 `IGNORED_ACCOUNT_MISMATCH`. |
| … › a refund of an earlier billing period leaves the current paid period active | `REFUND` for an earlier period gives `IGNORED_STALE`, and the plan stays Gold. |
| … › clients cannot write entitlements directly, even bypassing the API | A direct `INSERT` through the app database role is denied. |

**Method:** both store adapters are replaced by fixtures that return already-"verified" payloads. The Google fixture is `NOT_CONFIGURED`. The test turns the flag ON partway through and resets it, Silver's limit and the product ID in `afterAll`.

**Related tests:**
- `apps/api/test/compliance.test.ts`: every regulated flag, including `billing.store_subscriptions`, is OFF by default; users cannot promote themselves to a review account; deletion tests.
- `e2e/tests/a11y.spec.ts`: Plans screen and delete-account screen (web build).
- `e2e/tests/flow-d-tetrasol.spec.ts`: simulated checkout (web build).
- `e2e/tests/flow-f-privacy.spec.ts`: in-app deletion (web build), with no store subscription involved.

**Not proven by any test:**
- Real Apple JWS or certificate-chain verification.
- Any Play Developer API call, acknowledgement or RTDN.
- The restore route.
- The production sandbox rule.
- Unknown products.
- The `expo-iap` client on any device.
- Manage-subscription links.
- The deletion-screen subscription notice.
- The working-tree changes in 5.6.

---

## 7. Feature flag, Paymob and what users see today

| # | Item | State | Status | Verified |
|---|---|---|---|---|
| 7.1 | `billing.store_subscriptions` | Seeded **OFF** in `0006_compliance_foundation.sql`, risk `MEDIUM`, no regulatory evidence reference required. An ADMIN toggles it on the admin console Feature flags page (`apps/admin/src/app/features/page.tsx`, `PATCH /admin/features/:key`). Two-step verification is required for this when `MFA_ENFORCEMENT=required`. Turning it on applies to every user of that backend. App Review does **not** need it on (5.2.7). The trigger `feature_flags_billing_guard` blocks enabling it while Silver's family limit is `NULL`. | `CODE_READY` | verified by automated test (`apps/api/test/compliance.test.ts`, "exposes every regulated feature as OFF by default"; `billing.test.ts`, the guard) |
| 7.2 | Plans screen while the flag is OFF | Patients reach it from Me → Plans & subscription (`apps/mobile/src/app/settings/subscription.tsx`). It lists Silver, Gold and Platinum with labelled reference EGP prices and "Subscriptions are not available yet.", and has no Subscribe button. Restore, the auto-renew disclosure, and the Terms and Privacy links are visible. **Decision needed:** hide the entry while the flag is OFF, or ship working IAP. | open (not CODE_READY) | verified by config inspection; renders in `e2e/tests/a11y.spec.ts` (web build) |
| 7.3 | Paymob gateway (`apps/api/src/integrations/payments.ts`) | `status` is hard-coded to `NOT_CONFIGURED`, even when `PAYMOB_*` variables are set. `createIntent` throws, and `verifyWebhook` returns `false`. Its invariants are design only for now: hosted checkout only, PAID only after a verified webhook, and an idempotency key on every intent. | open (not CODE_READY) · `NEEDS_ACCOUNT_ACTION` (merchant account) | verified by config inspection |
| 7.4 | TetraSol checkout | `POST /store/checkout/preview` computes totals on the server and returns `canPlaceRealOrder: false` with the notice `PAYMENT_NOT_CONFIGURED_SIMULATION_ONLY`. `commerce.checkout` is OFF. **It is a preview only; no order is placed and nothing is charged.** | `CODE_READY` (simulation only) | verified by automated test (`e2e/tests/flow-d-tetrasol.spec.ts`, web build) |
| 7.5 | Paymob `PaymentIntentRequest.purpose` includes `'SUBSCRIPTION'`. | Nothing calls it. It must never sell Gold or Platinum inside the iOS or Android apps (3.1.1 and 3.1.3 intro [A1]; [G1]). A future web sale would also need the same plans as IAP on iOS (3.1.3(b) [A1]). Remove it, or restrict it to web. | open (not CODE_READY) | verified by config inspection |
| 7.6 | Payment for visits and consultations | `care.home_visit_booking` and `care.video_consultation` are OFF. Both require a regulatory evidence reference before they can be enabled. | `NEEDS_REGULATORY_EVIDENCE` | verified by automated test (`apps/api/test/compliance.test.ts`) |

---

## 8. OPEN ISSUE: mixed digital and real-world benefits in Gold and Platinum

**What official guidance says:**
- **Apple:** 3.1.1 requires IAP for in-app features, and 3.1.3(e) requires non-IAP payment for services consumed outside the app [A1]. Apple has published nothing on a subscription that combines the two. The forum question on exactly this case has no Apple answer [A7] (official-but-ambiguous).
- **Google:** Play Billing is required when a SKU is "more digital than physical" or is marketed as digital [G2] (official-but-ambiguous; no numeric test). Payments §3 forbids Play Billing when the payment is primarily for physical services [G1].
- **Neither store** says whether "priority matching" (an in-app ranking for a real-world visit) is digital or physical.
- **The evidence contradicts itself.** The Apple research topic suggests Option B; the Google topic suggests Option A. The critique says neither has official confirmation, and that one classification should apply to both stores.

**What the repository does today:**
- The plan data has the Option B shape: paid plans must be `DIGITAL_SUBSCRIPTION`, and the `REAL_WORLD` benefits sit inside them. No perk is implemented (G-1).
- The working-tree Terms read like Option A: "Plans unlock app features only" (4.6).

| | **Option A:** the store subscription holds only digital benefits | **Option B:** one IAP / Play subscription that includes the perks |
|---|---|---|
| Sold through the store | Gold and Platinum with `DIGITAL` benefits only: family profiles, dashboard, reminders, summaries, family management. | Gold and Platinum including priority matching, reduced platform fees, priority or concierge support, and booking benefits. |
| Real-world perks | Removed from the plans and priced into services paid through Paymob, for example as an option on the visit. Offered regardless of subscription status, and never presented as a cheaper alternative to IAP. | Delivered as entitlements. The visit itself is still paid through Paymob, with the plan discount applied on the server. |
| Code changes | Remove the `REAL_WORLD` rows from Gold and Platinum `benefits`. Build the digital benefits. Add perk pricing to booking once Paymob and booking ship. | Build the digital benefits **and** priority matching and the fee discount, reading `effective_plan`. Rewrite the Terms "Paid plans" text. |
| Apple risk | Least conflict with 3.1.3(e). The remaining risk is that 3.1.2(a) "ongoing value" rests on the digital features alone. | Selling perks for services consumed outside the app through IAP may conflict with 3.1.3(e). No official answer exists [A7]. |
| Google risk | A clearly digital SKU goes through Play Billing. Perks paid through Paymob fall under §3 and the clinical-services rule. | The real-world share may make Play Billing inappropriate under §3, and the "more digital than physical" test is unresolved [G1] [G2]. |
| Commercial | Less bundled value; perks need their own prices. Store commission applies only to the digital value. | A simpler offer, but store commission also applies to the perk value (rates **to confirm**). |
| Reversibility | Perks can be added to the plans later if both stores confirm. | Removing perks from existing subscribers later risks a 3.1.2(a) bait-and-switch finding [A1]. |
| Dependencies | Perks priced into visits depend on `care.*` licensing evidence (7.6). | The same, and the plans cannot be fully delivered until visits exist. |

**Recommendation:**
1. **Keep `billing.store_subscriptions` OFF** until there is written clarification from **both** Apple App Review and Google Play policy support. Record the date and reference of each answer in this document.
2. Ask both stores the same questions (drafts below), then apply **one** classification to both stores.
3. If launch cannot wait for the answers, Option A has the smaller policy surface: it removes the conflict instead of depending on an interpretation, and it is easier to reverse. This is an engineering opinion, not an official position.
4. Whichever option is chosen, deliver the benefits (G-1) and align the Terms and plan data (4.6) before enabling the flag.

**Draft questions** (to be sent by the account holder):
- *To App Review:* "Our auto-renewable subscriptions Gold and Platinum unlock in-app digital features through In-App Purchase. May the same subscription also include (a) priority when the app matches a patient with a licensed home-care nurse, (b) a reduced platform fee on in-person visits that are paid separately under 3.1.3(e), and (c) priority customer support? If not, must these be removed from the subscription or sold separately outside IAP?"
- *To Google Play policy support:* "Is a subscription made of the digital features above plus (a) to (c) 'more digital than physical' under the Payments policy? May (a) to (c) be included in a Play Billing subscription, given that §3 forbids Play Billing for physical services?"

| # | Item | Status | Verified |
|---|---|---|---|
| 8.1 | Written clarification from Apple App Review | `NEEDS_STORE_REVIEW` | not verified |
| 8.2 | Written clarification from Google Play policy support | `NEEDS_STORE_REVIEW` | not verified |
| 8.3 | Decision between Option A and Option B, with the benefits, Terms and store metadata updated to match | `NEEDS_LEGAL_APPROVAL` | not verified |
| 8.4 | Perks tied to visits and consultations depend on licensing evidence | `NEEDS_REGULATORY_EVIDENCE` | verified by config inspection (both flags OFF, evidence required) |

---

## 9. Account deletion with an active subscription

**Requirements:**
- **Apple [A6]:** users with an active auto-renewable subscription must be told that billing continues through Apple and asked to cancel. Deletion may be scheduled for the subscription's expiry only if immediate deletion is also offered.
- **Google [G7]:** an in-app deletion path plus a working web link.

| # | Item | Implementation | Status | Verified |
|---|---|---|---|---|
| 9.1 | In-app notice | `apps/mobile/src/app/settings/delete-account.tsx` shows a warning (`testID="delete-active-subscription"`) when `storeManaged` is true, meaning a store entitlement is `ACTIVE`, `GRACE_PERIOD` or `BILLING_RETRY`.<br>EN: "You have an active store subscription. Deleting your account does not cancel it — cancel it in Manage subscription to stop being billed."<br>AR: "لديك اشتراك فعّال عبر المتجر. حذف الحساب لا يلغيه — ألغِه من "إدارة الاشتراك" لإيقاف الخصم." | `CODE_READY` · `NEEDS_LEGAL_APPROVAL` (wording) | verified by config inspection; no test covers this path, because the web E2E build has no store subscription |
| 9.2 | Immediate deletion | `app.delete_my_account` deletes immediately and never schedules deletion, so the "scheduled only if immediate deletion is also offered" condition never arises. | `CODE_READY` | verified by automated test (`apps/api/test/compliance.test.ts`, deletion tests) |
| 9.3 | The notice names the store and links to it | The text says "store subscription" and does not name Apple or Google, whereas Apple's guidance says "billing continues through Apple" [A6]. This screen has no Manage subscription button, so the user has to open Plans & subscription. Fix: insert `{store}` and add a Manage button that calls `useStoreBilling().manage`. | open (not CODE_READY) | verified by config inspection |
| 9.4 | Web deletion page | The `/delete-account` page built by `apps/site/build.ts` says (EN and AR) that an App Store or Google Play subscription is billed by Apple or Google, must be cancelled in the store account, and is not cancelled by deleting the account. | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` (domain and hosting; `SUPPORT_EMAIL` is a placeholder) | verified by config inspection |
| 9.5 | Billing records after deletion | `app.delete_my_account` (migration 0006) keeps the scrubbed `auth."user"` row as a tombstone. So `app.billing_accounts`, `app.entitlements` and `app.store_events` stay linked to it. They are not listed in "What we keep" (`deletion.keptItems`). A subscription bound to a deleted account can be re-bound by a newer transaction (5.2.4). Decide what to retain, then update the function, the wording and the privacy policy. | open (not CODE_READY) · `NEEDS_LEGAL_APPROVAL` | verified by config inspection |

---

## 10. Configuration that needs accounts

Every step in this section is `NEEDS_ACCOUNT_ACTION` and not verified, unless stated otherwise.

### 10.1 Apple (App Store Connect)
1. **Organization developer account.**
   - Under 5.1.1(ix), healthcare apps should be submitted by the legal entity that provides the service [A1].
   - Enrollment needs a legal entity, a D-U-N-S number and a public website [A8].
   - The legal entity name is still a placeholder in `packages/shared/src/legal.ts`, and the Apple Team ID is a placeholder.
2. **Agreements:** the Paid Applications agreement, banking and tax (**to confirm**; not in the evidence).
3. **App record** for `com.aliagroup.dressmywound`, the production variant. That ID is still a proposed value (see `app.config.ts`). Whether `.staging` needs its own record and products is **to confirm** [E4].
4. **One subscription group** with Platinum ranked above Gold (3.1.2(b) [A4]).
   - Four auto-renewable products: Gold monthly, Gold yearly, Platinum monthly, Platinum yearly.
   - Each needs EN and AR display names and descriptions.
   - Each needs an EGP price point chosen against the reference prices in §4. Price-point availability is **to confirm**.
   - The products must be complete and visible to the reviewer (2.1(b) [A1]).
5. **App Store Server Notifications V2 URL:** `https://<API_HOST>/webhooks/apple/app-store-notifications`, for both production and sandbox. Whether this is a store requirement is **to confirm** (§3.3).
6. **App's Apple ID:** set `APPLE_IAP_APP_APPLE_ID` from App Information. The production server cannot verify Production transactions without it.
7. **Sandbox testing:**
   - `apps/api/src/db/seed-review.ts` seeds the review accounts with `account_kind = 'REVIEW'`.
   - Internal testers who need sandbox purchases against the production API must be set to `INTERNAL_TEST` by the database owner.
8. **App Review notes:**
   - Plans use IAP.
   - TetraSol products and visits use Paymob under 3.1.3(e). Real-time 1:1 consultations use Paymob under 3.1.3(d).
   - Review accounts can buy while subscriptions are off for the public.
   - Include the answer from §8.

### 10.2 Google (Play Console and Google Cloud)
1. **Organization Play Console account** with a D-U-N-S number; health apps must use one [G8].
2. **App** `com.aliagroup.dressmywound`.
   - Any upload must be an EAS-built AAB signed through Play App Signing. The local AAB is debug-signed (B-2).
   - Whether an AAB containing Play Billing must be uploaded before subscriptions can be created is **to confirm**.
3. **Subscriptions:** one product per plan and period, each with a single base plan.
   - Why: the client passes no offer token (G-3) and reads one `displayPrice` per product.
   - ID formats enforced by migration 0007: product `^[a-z0-9._]{1,100}$`, base plan `^[a-z0-9-]{1,63}$`.
   - EGP prices must be within 0.90 to 49,000.00 [G3].
4. **Server service account** with the `androidpublisher` scope, granted access in Play Console (exact permission names are **to confirm**). Store its JSON key, base64-encoded, in the secret manager, never in the repo. Keep it separate from any `eas submit` account.
5. **Real-time developer notifications:**
   - Create a Pub/Sub topic and link it in Play Console. The permissions Google's publisher needs on the topic are **to confirm**.
   - Create a **push** subscription to `https://<API_HOST>/webhooks/google/rtdn` with authentication enabled, so it sends an OIDC token signed by a dedicated service account.
   - Set its audience as `GOOGLE_RTDN_AUDIENCE` and that account's email as `GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL`.
6. **License testers** for test purchases. A `testPurchase` is accepted in production only for `REVIEW` and `INTERNAL_TEST` accounts.
7. **App access:** add a subscriber instruction set if Gold or Platinum ship [G6].

### 10.3 Server environment (`apps/api/src/config/env.ts`)

| Variable | Value | Needed for |
|---|---|---|
| `APPLE_IAP_BUNDLE_ID` | `com.aliagroup.dressmywound` | Apple adapter |
| `APPLE_IAP_APP_APPLE_ID` | Numeric app Apple ID from App Store Connect | Apple adapter (required in production) |
| `APPLE_ROOT_CERTS_DIR` | Directory of Apple root certificates (`.cer`/`.der`). The source named in the code comment is **to confirm**. | Apple adapter (startup fails if the directory is empty) |
| `APPLE_IAP_ONLINE_CHECKS` | default `true` | Apple verifier online checks |
| `GOOGLE_PLAY_PACKAGE_NAME` | `com.aliagroup.dressmywound` | Google adapter; RTDN package check |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64` | from the secret manager | Google adapter |
| `GOOGLE_RTDN_AUDIENCE` | audience set on the push subscription | RTDN authentication |
| `GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL` | the push service account's email | RTDN authentication |

- If any one of the four Google variables is missing, the Google adapter stays `NOT_CONFIGURED`.
- The Apple adapter needs the bundle ID and the certificate directory, plus the Apple ID in production.
- None of these variables are in `.env.example` (G-8).

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
1. The §8 answers are recorded, an option is chosen, and the benefits, Terms (4.6) and metadata are updated to match.
2. The benefits are implemented and tested (G-1). Silver's family limit is decided, because the database refuses to enable the flag without it.
3. G-3, G-5 to G-10 and 5.6.3 are fixed or explicitly accepted. Apple products go live before or together with Google products (G-2).
4. Accounts, products, server environment and product IDs are set up on a **staging** backend first.
5. Purchase, restore, manage, cross-store, refund and expiry are tested on physical iOS and Android devices with sandbox and license testers. Only after that may any line be marked `DEVICE_TESTED`.
6. Legal approves the Terms "Paid plans" section, the disclosure wording, the deletion wording, and how billing data appears in the privacy policy (§1, §9).
7. The metadata states which features need an additional purchase (2.3.2 [A1]), and Play's app-access settings include subscriber instructions [G6].
8. App Review does not need the flag on: review accounts can already buy (5.2.7). A reviewer who signs up with a new, non-review account will see `FEATURE_DISABLED`, so the review notes must point to the seeded accounts.

---

## 11. Separation summary

| Category | Lines |
|---|---|
| Completed implementation (`CODE_READY`) | 2.1–2.5 · 4.1 · 5.2.1–5.2.18 · 7.1 · 7.4 (simulation) · 9.1 · 9.2 · 9.4 |
| Built (`BUILT`, Android only; verified by native build inspection) | 2.5 · B-1 · B-2 · B-3 |
| Verified by automated test | 2.1–2.3 · 4.1 · 5.2.3 · 5.2.4 · 5.2.7–5.2.12 · 5.2.16 · 7.1 · 7.4 (web) · 7.6 · 9.2 · G-1 (family limit) |
| Requires developer account (`NEEDS_ACCOUNT_ACTION`) | 4.2 · 5.2.1 · 5.2.2 · 5.2.16 · 5.2.17 · 7.3 · 9.4 · B-2 · B-4 · §10 |
| Requires official assets (`NEEDS_OFFICIAL_ASSETS`) | Final native store screenshots with no prices (2.3.7 [A1]); product display names; IAP review screenshots if required (**to confirm**) |
| Requires legal approval (`NEEDS_LEGAL_APPROVAL`) | 4.5 · 4.6 · 8.3 · 9.1 · 9.5 · Terms "Paid plans" · disclosure wording |
| Requires regulatory evidence (`NEEDS_REGULATORY_EVIDENCE`) | 7.6 · 8.4 |
| Requires Apple or Google review (`NEEDS_STORE_REVIEW`) | 4.5 · 8.1 · 8.2 · IAP and Play product review at submission |
| Open engineering (not `CODE_READY`) | 2.6 · 2.7 · 4.3 · 4.4 · 4.6 · G-1 (benefits) · G-2 · G-3 · G-5 to G-10 · 5.6.1–5.6.3 · B-4 · 7.2 · 7.3 · 7.5 · 9.3 · 9.5 |
| Not reached by any line | `DEVICE_TESTED` · `STORE_METADATA_READY` · `READY_FOR_SUBMISSION` · `SUBMITTED` · `APPROVED` |

---

## 12. Official sources

All of these are cited from [`evidence/STORE_REQUIREMENTS_EVIDENCE.md`](evidence/STORE_REQUIREMENTS_EVIDENCE.md) (verified 2026-10-14).

| ID | URL | Used for |
|---|---|---|
| A1 | https://developer.apple.com/app-store/review/guidelines/ | 2.1(a)/(b), 2.3.2, 2.3.7, 3.1.1, 3.1.1(a), 3.1.2(a), 3.1.3 intro, 3.1.3(b)/(d)/(e), 5.1.1(ix) |
| A2 | https://developer.apple.com/news/?id=a233fmpw | June 8, 2026 guideline revision (3.1.x unchanged) |
| A3 | https://developer.apple.com/documentation/bundleresources/information-property-list/skexternalpurchasemultilink.md | External-purchase storefronts (Egypt not included) |
| A4 | https://developer.apple.com/support/terms/apple-developer-program-license-agreement/ | 3.1.2(b)/(c) and Schedule 2 §3.8(b) disclosures; Egypt tax collection |
| A5 | https://developer.apple.com/app-store/subscriptions/ | Subscription sign-up screen; restore; manage |
| A6 | https://developer.apple.com/support/offering-account-deletion-in-your-app/ | Account deletion with an active subscription |
| A7 | https://developer.apple.com/forums/thread/698791 | Mixed digital and real-world subscription: no Apple answer (official-but-ambiguous) |
| A8 | https://developer.apple.com/programs/enroll/ | Organization enrollment (legal entity, D-U-N-S, website) |
| G1 | https://support.google.com/googleplay/android-developer/answer/9858738?hl=en | Payments policy §3; no steering |
| G2 | https://support.google.com/googleplay/android-developer/answer/10281818?hl=en | Regulated clinical services; 1:1 services; mixed SKUs (official-but-ambiguous); cross-platform access (to confirm) |
| G3 | https://play.google.com/supported-locations?hl=en | Egypt: Play purchases in EGP 0.90 to 49,000.00 |
| G4 | https://support.google.com/googleplay/android-developer/answer/16954621?hl=en | No alternative billing in Egypt; Rest of World rollout 2027-09-30 |
| G5 | https://developer.android.com/google/play/billing/deprecation-faq | Play Billing Library deprecation; manifest entry |
| G6 | https://support.google.com/googleplay/android-developer/answer/9859455 | App access instructions for reviewers |
| G7 | https://support.google.com/googleplay/android-developer/answer/13327111?hl=en | Account deletion (in-app and web) |
| G8 | https://support.google.com/googleplay/android-developer/answer/10788890?hl=en | Organization account for health apps |
| E1 | https://docs.expo.dev/guides/in-app-purchases/ | IAP needs a development or store build, not Expo Go |
| E2 | https://openiap.dev/docs/setup/expo | `expo-iap` 6.0.2 → OpenIAP 4.0.2 → Play Billing 9.1.0, StoreKit 2 |
| E3 | https://docs.expo.dev/guides/permissions/ | `blockedPermissions`; never block `com.android.vending.BILLING` |
| E4 | https://docs.expo.dev/build-reference/variants/ | App variants (store IAP tied to production IDs is an inference, to confirm) |
