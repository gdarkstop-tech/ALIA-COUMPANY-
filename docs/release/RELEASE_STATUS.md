# Release status — Dress My Wound | غير لي

**Verified on:** 2026-10-27 (first published 2026-10-15) · **Branch:** `claude/confident-babbage-ab865a`
**Scope:** native iOS + Android apps (Expo SDK 57 / React Native 0.86), API, admin console and the public support site.

> **Bottom line:** neither app is `READY_FOR_SUBMISSION`. The code, native configuration and release tooling are in place and the Android build is verified, but submission is blocked by developer accounts, official brand assets, approved legal texts, regulatory evidence, a business decision on subscription benefits, and on-device testing. Nothing has been `DEVICE_TESTED`, `SUBMITTED` or `APPROVED`.

## Status vocabulary

| Status | Meaning |
|---|---|
| `CODE_READY` | Implemented in the repository and covered by automated tests or config checks. |
| `BUILT` | A native binary was produced and inspected (not necessarily distributable). |
| `DEVICE_TESTED` | Exercised on a real or virtual iOS/Android device. **Nothing is at this level yet.** |
| `STORE_METADATA_READY` | Listing text, screenshots, URLs and declarations are final and approved. |
| `NEEDS_ACCOUNT_ACTION` | Needs Apple Developer / App Store Connect, Google Play Console, Expo/EAS or cloud access. |
| `NEEDS_OFFICIAL_ASSETS` | Needs authentic brand files from Alia Group / TetraSol. |
| `NEEDS_LEGAL_APPROVAL` | Needs Alia Group legal sign-off. |
| `NEEDS_REGULATORY_EVIDENCE` | Needs evidence from Egyptian regulators (MoHP, EDA, PDPC, Medical Syndicate). |
| `READY_FOR_SUBMISSION` / `SUBMITTED` / `APPROVED` | Store lifecycle. **Not reached.** |

## What was actually built and tested

| Check | Result | How |
|---|---|---|
| Unit + API tests | **215 passed** (api 159 · tokens 43 contrast · shared 9 · i18n 4) | `pnpm test` against PostgreSQL 16 with RLS |
| Admin catalogue + user management tests | included above | `apps/api/test/catalog.test.ts`, `accounts.test.ts` (separation of duties, publish gates, stock ledger, suspensions/blocks, appeals, care continuity) |
| AI gateway tests | 13 + 8 adapter tests, included above | `apps/api/test/ai.test.ts` (flags, consent, quotas under concurrency, budget, emergencies, refusals, fallback, privacy, audit), `ai-adapters.test.ts` (real Anthropic/OpenAI adapters against a stubbed HTTP layer — **not** the live APIs) |
| Compliance tests | 11 passed | `apps/api/test/compliance.test.ts` (health-data consent enforced in DB, flags, review-account isolation, account deletion) |
| Billing tests | 10 passed | `apps/api/test/billing.test.ts` (payment rails, store state mapping, fail-closed when unconfigured, account binding, refunds, no client writes) |
| Typecheck / lint | 8/8 workspaces, 0 lint warnings | `pnpm typecheck`, `pnpm lint` |
| Release checks | **66 passed, 0 failed**, 8 submission blockers | `pnpm release:check` (brand spelling, metadata limits, icons, production native config, no keys committed incl. AI keys). Blockers = placeholders in listings and legal texts (`--submission` fails), now including the AI notice's provider names. |
| Expo project health | 21/21 | `npx expo-doctor` (after the 57.0.29 patch updates) |
| End-to-end (web harness) | **22 passed** (projects `mobile-web` + `admin`; store-screenshot capture not run) | `npx playwright test --project=mobile-web --project=admin` after `pnpm db:reset` (2026-10-27): flows A–F incl. F3 AI assistant (simulator) and restricted account, admin E–E4 (verification, catalogue, users, AI control centre), Arabic RTL, accessibility 9 |
| Accessibility (web harness) | 6/6 | `e2e/tests/a11y.spec.ts`: axe-core WCAG 2.2 A/AA (no serious/critical), no overflow at 320/390 px, targets ≥ 44 px, EN + AR |
| Android production build | **BUILT** | `expo prebuild` + `gradlew assembleRelease bundleRelease` → APK + AAB, inspected with aapt2 / zipalign / readelf (below) |
| Android development client | **BUILT** | `gradlew assembleDebug` (arm64-v8a, x86_64) |
| iOS | **not built** | Native project generated with `expo prebuild --platform ios` and inspected; compiling requires macOS/Xcode or EAS Build with an Apple account |
| Public site | builds | `pnpm --filter @ghayarly/site build` (privacy, terms, health consent, medical disclaimer, account deletion) |

**The web harness is a proxy.** E2E and accessibility runs use the React Native app rendered by react-native-web. They validate logic, semantics, contrast and reflow. They do **not** replace VoiceOver/TalkBack, Dynamic Type, native gestures, StoreKit/Play Billing or on-device performance testing.

## Android — `BUILT` (not distributable)

| Item | Value (from the built APK) |
|---|---|
| Package | `com.aliagroup.dressmywound` (dev client: `com.aliagroup.dressmywound.dev`) |
| Version | versionName 1.0.0, versionCode 1 (store builds auto-increment remotely in EAS) |
| SDK | minSdk 24 · compileSdk 36 · **targetSdk 36** |
| ABIs | arm64-v8a, armeabi-v7a, x86, x86_64 |
| Labels | `Dress My Wound` · Arabic `غير لي` (dev: `Dress My Wound Dev` · `غير لي تطوير`) |
| Permissions | INTERNET, ACCESS_NETWORK_STATE, ACCESS_WIFI_STATE, VIBRATE, `com.android.vending.BILLING`, app-private DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION. No camera, media, location, contacts, biometric or AD_ID. |
| 16 KB pages | `zipalign -c -P 16` OK; 44/44 64-bit `.so` LOAD segments ≥ 16 KB aligned |
| Backup | `android:allowBackup="false"` |
| Predictive back | `enableOnBackInvokedCallback="true"` (needs on-device check) |
| Signing | **local debug key only** — not uploadable. Store signing is Play App Signing + EAS upload key (`NEEDS_ACCOUNT_ACTION`). |

The checks are automated in `scripts/release/verify-android.sh` and run in CI (`.github/workflows/ci.yml`, job `android-native`). An earlier local APK from 2026-10-14 had a launch-crash bug and extra biometric permissions. It is superseded and must not be used.

**Not done on Android:** no emulator (no KVM in the build environment) and no physical device, so install, launch, TalkBack, RTL rendering, keyboard insets, predictive back and Play Billing are untested.

## iOS — `CODE_READY` (configuration only)

Verified from the generated native project: display name `Dress My Wound` / `غير لي` (ar.lproj), iPhone only, deployment target 16.4, `ITSAppUsesNonExemptEncryption = false`, ATS with no arbitrary loads, no local-network/Bonjour/Face ID strings in store variants, and a privacy manifest with required-reason APIs and collected data types (no tracking).

Needs **macOS or EAS cloud** plus an **Apple Developer Program organisation account** for: compiling, signing (distribution certificate and provisioning profiles via EAS), TestFlight, StoreKit sandbox testing, VoiceOver testing and App Store Connect setup. EAS images are pinned to `sdk-57` (Xcode 26.6), which meets Apple's Xcode 26 / iOS 26 SDK upload rule. Plan the move to the iOS 27 SDK before April 2027 (see the Apple checklist).

## Status by area

| Area | Status | Verified by | What blocks the next level |
|---|---|---|---|
| Official names (EN `Dress My Wound`, AR `غير لي`) | CODE_READY | release check + APK labels | — |
| Brand system (TetraSol navy/orange, subtle Alia Group architecture) | CODE_READY (provisional) | contrast tests (43) | `NEEDS_OFFICIAL_ASSETS`: logos, colour specs, approval of the placeholder product mark |
| App icon, splash, Play icon, feature graphic | placeholders | release check (sizes/alpha) | `NEEDS_OFFICIAL_ASSETS` |
| Authentication, RLS, medical records, family profiles, provider dashboards, TetraSol-only store | CODE_READY | API tests + E2E A–E | `DEVICE_TESTED` |
| Consent (terms, privacy, health data, marketing) | CODE_READY | compliance tests + E2E A/F | `NEEDS_LEGAL_APPROVAL` (texts are drafts `2026-10-draft`) |
| In-app account deletion + web deletion page | CODE_READY | compliance tests + E2E F | public URL needs a real domain (`NEEDS_ACCOUNT_ACTION`) |
| Emergency notice (123) + medical disclaimer | CODE_READY | E2E | `NEEDS_REGULATORY_EVIDENCE` (confirm numbers with MoHP) |
| High-risk features (AI assistant, wound assessment, diagnostic suggestions, home visits, video consults) | OFF by server flag; the database refuses to enable regulated flags without an evidence reference | compliance tests | `NEEDS_REGULATORY_EVIDENCE` |
| AI gateway + patient text assistant (quotas, cost metering, cap, control centre) | CODE_READY, **flag OFF**, internal test accounts only; **no provider configured** (`NOT_CONFIGURED`) | AI tests + E2E F3/E4 (simulator only) | `NEEDS_ACCOUNT_ACTION` (business-owned provider keys, verified prices, monthly cap — `AI_GATEWAY.md`); `NEEDS_LEGAL_APPROVAL` (AI notice); `NEEDS_REGULATORY_EVIDENCE` (R2, R3, R13) |
| Admin catalogue management (products, images, variants, stock, prices, discounts, bundles, categories, analytics) | CODE_READY | API tests + E2E E2 | Real TetraSol product data and clinical approval of claims; brand ownership reference (`TO CONFIRM`) |
| Admin user management (search, suspend, block, reactivate, booking restriction, history, appeals) | CODE_READY | API tests + E2E E3 and F (restricted account) | Legal review of the reasons/appeals texts; staff MFA enrolment in production |
| Digital subscriptions (StoreKit 2 / Play Billing, server-verified entitlements) | CODE_READY, **flag OFF** | billing tests | `NEEDS_ACCOUNT_ACTION` (products, keys, webhooks) + business decision (below) |
| Physical checkout (Paymob) | not configured (simulated) | E2E D | `NEEDS_ACCOUNT_ACTION` (gateway contract) |
| Review accounts (isolated, synthetic data) | CODE_READY | compliance tests | Create in each environment with `review:seed` |
| Store listing text EN/AR | drafted, limits checked | release check | Not `STORE_METADATA_READY`: support URL/email, privacy URL, final screenshots, legal entity |
| Store screenshots | drafts only (web harness, on demand) | — | Native captures from real builds |
| Privacy disclosures (App Privacy, Data safety, privacy manifest) | drafted | config inspection | `NEEDS_LEGAL_APPROVAL`; Egypt PDPL licence (`NEEDS_REGULATORY_EVIDENCE`) |
| Signing and secrets | no keys in repo (release check) | release check | `NEEDS_ACCOUNT_ACTION` |

## Open items by owner

**Developer accounts (`NEEDS_ACCOUNT_ACTION`)**
- Apple Developer Program as an **organisation** (D-U-N-S), App Store Connect app record, bundle IDs `com.aliagroup.dressmywound(.dev/.staging)`, App Store Connect API key for `eas submit`.
- Google Play Console **organisation** account, app record, Play App Signing, a service account for `eas submit` (separate from the server billing service account).
- Expo/EAS project (`EAS_PROJECT_ID`, `EXPO_OWNER`) and EAS environment variables (`EXPO_PUBLIC_API_URL` per environment).
- Confirm the company controls `aliagroup` reverse-DNS and that the IDs are free (they are permanent).
- Production hosting for the API, database and public site with a real domain (support, privacy and account-deletion URLs; optional Universal/App Links).
- Store products: subscription group and products (Apple), subscriptions and base plans (Google), App Store Server Notifications and Play RTDN (Pub/Sub push with OIDC) pointing to the API.

**Official assets (`NEEDS_OFFICIAL_ASSETS`)**: Alia Group and TetraSol logos (vector), official colour specifications and usage rules, approval or replacement of the placeholder product mark and app icon.

**Legal (`NEEDS_LEGAL_APPROVAL`)**: legal entity name, privacy contact, hosting provider and region, retention periods, dispute-resolution clause (all marked `[to be confirmed]` in `packages/shared/src/legal.ts`); approval of the privacy policy, terms, health-data consent and medical disclaimer in Arabic and English.

**Regulatory (`NEEDS_REGULATORY_EVIDENCE`)**: Egypt PDPL (Law 151/2020 and Executive Regulations): licence for processing sensitive health data, DPO, and a cross-border transfer permit if hosting is outside Egypt. Ministry of Health licensing for home visits and remote consultations. EDA position on any AI or diagnostic feature (software as a medical device). Health-advertising approval for TetraSol promotion. App Store approval is **not** authorisation to provide regulated healthcare services.

**Business decision**: Gold/Platinum mix digital and real-world benefits. Get written guidance from Apple App Review and Google Play policy support before enabling store subscriptions (options in `PAYMENT_COMPLIANCE.md`). Silver's family-profile limit is not specified.

**Testing**: on-device testing on iPhone (VoiceOver, Dynamic Type, RTL) and Android 16 (TalkBack, predictive back, 16 KB device), StoreKit sandbox and Play licence testers, TestFlight and Play internal testing.

## Reproduce

```bash
pnpm install && pnpm db:reset
pnpm typecheck && pnpm lint && pnpm test && pnpm release:check
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e
# Android (local verification build, debug-signed):
cd apps/mobile && APP_VARIANT=production EXPO_PUBLIC_API_URL=https://api.example.invalid npx expo prebuild -p android --clean
cd android && ./gradlew assembleRelease bundleRelease && bash ../../../scripts/release/verify-android.sh app/build/outputs/apk/release/app-release.apk
# Store builds (needs accounts): eas build --profile production --platform all
```

## Related documents

[Apple App Store checklist](APPLE_APP_STORE_CHECKLIST.md) · [Google Play checklist](GOOGLE_PLAY_CHECKLIST.md) · [Privacy and data disclosures](PRIVACY_AND_DATA_DISCLOSURES.md) · [Payment compliance](PAYMENT_COMPLIANCE.md) · [Healthcare review](HEALTHCARE_REVIEW.md) · [Brand identity](BRAND_IDENTITY.md) · [Signing and secrets](SIGNING_AND_SECRETS.md) · [AI gateway](AI_GATEWAY.md) · [Requirements evidence](evidence/STORE_REQUIREMENTS_EVIDENCE.md)
