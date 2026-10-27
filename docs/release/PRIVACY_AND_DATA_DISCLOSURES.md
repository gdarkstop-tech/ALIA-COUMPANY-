# Privacy & data disclosures: Dress My Wound | غير لي

**Verified on: 2026-10-15**

This is the single source for the app's privacy disclosures: the data inventory, the proposed Apple App Privacy answers, the proposed Google Play Data safety answers, the iOS privacy manifest, permissions, consent, account deletion, crash reports, tracking, and Egypt PDPL obligations. It covers the iOS and Android app in `apps/mobile` (Expo SDK 57 / React Native 0.86.3), the API in `apps/api` (Fastify, PostgreSQL with row-level security) and the support site in `apps/site`.

- Requirements come only from `docs/release/evidence/STORE_REQUIREMENTS_EVIDENCE.md` (verified 2026-10-14). Keys such as [A3], [G1] and [EG1] point to [Official sources](#official-sources).
- Every statement about behaviour was checked against the code named in the row.
- Companion docs: `APPLE_APP_STORE_CHECKLIST.md`, `GOOGLE_PLAY_CHECKLIST.md`, `PAYMENT_COMPLIANCE.md` and `RELEASE_STATUS.md`. `RELEASE_STATUS.md` holds the outcome of the final Android rebuild, which this document does not state.
- This is not legal advice. Every answer marked *proposed* needs counsel sign-off.

> **Bottom line: the app is NOT ready for submission, and these disclosures are NOT final.**
> - Nothing has run on a physical or virtual device: there is no `/dev/kvm` and no macOS here.
> - No Apple, Google, Expo/EAS or PDPC account exists.
> - All legal documents are **DRAFT** (`LEGAL_DOCUMENT_STATUS = 'DRAFT_PENDING_LEGAL_REVIEW'`, version `2026-10-draft`).
> - These are placeholders: the legal entity name, the privacy and support email, the support domain, the hosting provider and region, the SMS/email providers, the retention periods, the DPO, the Apple Team ID and the store product IDs.
> - Reading the code for this document found 14 gaps, listed in [section 10](#10-gaps-found-while-writing-this-document).

---

## How to read this document

| Status | Meaning here |
|---|---|
| `CODE_READY` | Implemented in the repo (code, SQL or config). Not confirmed in a built binary. |
| `BUILT` | Confirmed in a locally built native artifact (Android APK inspected with aapt2). |
| `STORE_METADATA_READY` | Text or asset is in `store/` and passes the automated format checks. |
| `NEEDS_ACCOUNT_ACTION` | Needs App Store Connect, Play Console, EAS, hosting, a domain, a mailbox or a PDPC portal account. |
| `NEEDS_REGULATORY_EVIDENCE` | Needs Egyptian regulatory evidence (PDPC licence or permit, Ministry of Health, EDA). |
| `NEEDS_LEGAL_APPROVAL` | Needs counsel sign-off. |
| `NEEDS_OFFICIAL_ASSETS` | Needs official brand files. No privacy item needs them; the policy pages carry no logo. |
| `NEEDS_STORE_REVIEW` | Only Apple or Google can decide it. |
| `DEVICE_TESTED` · `READY_FOR_SUBMISSION` · `SUBMITTED` · `APPROVED` | **Not assigned to any line.** Nothing qualifies. |

`none (gap)` is not a status. It marks a line that has not reached `CODE_READY`; [section 10](#10-gaps-found-while-writing-this-document) lists these.

**Verification labels:**
- `verified by automated test (<file>)`
- `verified by native build inspection`
- `verified by config inspection` (includes reading the code and SQL)
- `not verified`

E2E tests run with Playwright on the **Expo web build**. That is a proxy, not a native run.

**Requirement labels:** only `[verified-official]` evidence findings are treated as requirements. Everything else is marked **to confirm**.

---

## 0. Placeholders that block every disclosure

| Placeholder | Where it appears | Status |
|---|---|---|
| Legal entity (data controller) name | `packages/shared/src/legal.ts` (`CONTROLLER_EN` / `CONTROLLER_AR`); `store/metadata/*.json` `copyright` | `NEEDS_LEGAL_APPROVAL` |
| Privacy contact email | `legal.ts` (`CONTACT`) | `NEEDS_ACCOUNT_ACTION` · `NEEDS_LEGAL_APPROVAL` |
| Support domain: privacy URL and deletion URL | `store/metadata/*.json` → `https://<SUPPORT_DOMAIN_TO_CONFIRM>/privacy` and `/delete-account` | `NEEDS_ACCOUNT_ACTION` |
| Support email on the site | `apps/site/build.ts` (`SUPPORT_EMAIL`, default `[support email — to be confirmed]`) | `NEEDS_ACCOUNT_ACTION` |
| Hosting provider and region (decides cross-border transfer) | `legal.ts`: `[hosting provider and region — to be confirmed]` | `NEEDS_ACCOUNT_ACTION` · `NEEDS_REGULATORY_EVIDENCE` |
| SMS and email delivery providers | `legal.ts`. `apps/api/src/integrations/messaging.ts` wires no real provider: production reports `NOT_CONFIGURED` and sends nothing. | `NEEDS_ACCOUNT_ACTION` |
| Retention periods for retained records | `legal.ts`: `[retention period — to be confirmed by legal]` | `NEEDS_LEGAL_APPROVAL` |
| DPO name and contact | Absent from all documents | `NEEDS_LEGAL_APPROVAL` · `NEEDS_REGULATORY_EVIDENCE` |
| API URL baked into the 2026-10-14 APK | `https://api.dressmywound.invalid` | `NEEDS_ACCOUNT_ACTION` |
| Store product IDs (IAP) | `app.billing_plan_offers` `apple_product_id` / `google_product_id` are NULL (migration `0007`) | `NEEDS_ACCOUNT_ACTION` |

---

## 1. Data inventory: what the code actually collects

"Deletion" means what `app.delete_my_account()` (migration `0006_compliance_foundation.sql`) does. `POST /v1/me/account-deletion` calls it after re-authentication.

| # | Data | Stored in | Purpose | Linked to user | Shared with third parties | Retention | On `app.delete_my_account` | Status · Verification |
|---|---|---|---|---|---|---|---|---|
| 1.1 | Account identity: name, email, phone, verification flags. Phone-only accounts get a synthetic email `…@phone.ghayarly.invalid` (`PHONE_ONLY_EMAIL_DOMAIN`). | `auth."user"` | Sign-in, account management | Yes | Not today. When wired, the SMS/email provider receives the phone or email to deliver OTP and reset messages (a processor; provider TBD). | Life of the account | **Scrubbed into a tombstone:** `name='Deleted account'`, `email='deleted-<id>@deleted.invalid'`, `phoneNumber=NULL`, `image=NULL`, 2FA off. The row `id` and `createdAt` are kept so retained records stay referentially intact. | `CODE_READY` · verified by automated test (`apps/api/test/compliance.test.ts`: deleted account cannot sign in; email can be re-registered) |
| 1.2 | Credentials: password hash, 2FA secret and backup codes, pending verification codes | `auth."account"`, `auth."twoFactor"`, `auth."verification"` | Authentication | Yes | No | Life of the account | **Deleted** | `CODE_READY` · verified by automated test (`compliance.test.ts`); app role cannot read them (`apps/api/test/rls.test.ts`) |
| 1.3 | Sessions: token, expiry, **IP address**, **user agent** | `auth."session"` (Better Auth). On device, the session cookie lives in Keychain/Keystore via `expo-secure-store` (`apps/mobile/src/lib/auth-client.ts`). | Account security | Yes | No | Until expiry or sign-out | **Deleted** (all devices) | `CODE_READY` · verified by automated test (`compliance.test.ts`: sessions revoked) |
| 1.4 | App profile: display name, locale, active role, `assistant_name`, onboarding timestamp, `account_kind`; role grants | `app.user_profiles`, `app.user_roles` | App functionality | Yes | No | Life of the account | `display_name → 'Deleted account'`; `assistant_name`, `active_role → NULL`; roles get `revoked_at`. Locale, `account_kind`, timestamps and revoked role rows are kept. | `CODE_READY` · verified by config inspection |
| 1.5 | **Patient health profile** (self and family): name, date of birth, sex, blood type and its provenance, governorate, city, phone, emergency contact name, phone and relation | `app.patients` | Personal and family medical record | Yes | No. In this build no clinician or other user gets access: `patient_access` grants go only to the creator, and care relationships are not implemented. | Until the account is deleted. A user cannot hard-delete a record (`rls.test.ts`). | **Deleted** when the caller is the linked person or the sole manager. Otherwise only the caller's access is revoked and the profile stays with its other managers. `linked_user_id` is cleared. | Creation blocked without health consent, in the database. `CODE_READY` · verified by automated test (`compliance.test.ts`) |
| 1.6 | Family access grants: relationship, access level, consent basis, consent statement version, attestation time | `app.patient_access` | Lawful basis for managing another person's data | Yes | No | Life of the grant | Cascade-deleted with the profile; otherwise set to `REVOKED` (row kept) | `CODE_READY` · verified by automated test (`apps/api/test/patients.test.ts`, `compliance.test.ts`) |
| 1.7 | **Health entries**: allergies, conditions, medications, surgeries (title, detail, note, provenance) | `app.patient_health_entries` | Medical record | Yes | No | Never hard-deleted. Users mark errors as `ENTERED_IN_ERROR`. | Cascade-deleted with the profile (1.5) | `CODE_READY` · verified by automated test (`patients.test.ts`: entered-in-error, not deleted; `rls.test.ts`: no hard delete) |
| 1.8 | Clinician profile: names (AR/EN), gender, specialty, subspecialty, years of experience, bio, affiliation, previous experience, skills, governorate, city, fee, availability, service radius. `service_area` is an approximate centroid that no API endpoint writes in this build. | `app.provider_profiles` (+ `provider_working_hours`, `provider_services`) | Clinician discovery and verification | Yes | Shown to patients **after approval**: name, specialty, availability, services and approximate area | Life of the account | **Deleted**, including credentials, verification events, hours and services. **Exception:** when ledger entries exist (1.11), the profile is suspended, names become `Deleted account` / `حساب محذوف`, bio, affiliation, previous experience, skills and `service_area` are cleared, and hours and services are deleted. Provider type, gender, specialty, subspecialty, years of experience, governorate, city and fee are **kept** (gap 3). | `CODE_READY` · verified by automated test (`compliance.test.ts`: ledger case suspended and scrubbed) |
| 1.9 | **Clinician credentials**: kind (`NATIONAL_ID`, `MEDICAL_LICENSE`, …), issuer, **identifier**, issue and expiry dates, document object key. No upload is implemented in this build. | `app.provider_credentials`, `app.provider_verification_events` | Verifying licensed clinicians | Yes | No. Patients see only "verified", never licence numbers. | Life of the account | Deleted with the profile, **but kept in the ledger case** (gap 3) | `CODE_READY` · verified by automated test (`rls.test.ts`: credentials not readable by patients) |
| 1.10 | Cart: product variant, quantity, optional family profile | `app.cart_items` | TetraSol store | Yes | No | Until removed | **Deleted** | `CODE_READY` · verified by config inspection |
| 1.11 | Clinician earnings ledger (written by settlement jobs; none exist in this build) | `app.provider_ledger_entries` (append-only) | Legal and accounting obligations | Yes | No | **Retained.** Period TBD by legal. | **Kept**; status `COMPLETED_WITH_RETENTION` | `CODE_READY` · verified by automated test (`compliance.test.ts`) |
| 1.12 | Consent history (section 6) | `app.consent_events` (append-only) | Proof of consent | Yes | No | **Retained.** Period TBD by legal. | **Kept** (`consentHistoryRetained: true`) | `CODE_READY` · verified by automated test (`compliance.test.ts`: append-only even for the app role) |
| 1.13 | Security audit log: actor, action, entity, patient id, metadata | `app.audit_log` (append-only) | Security, accountability for sensitive-data access | Yes, by user ID | No | **Retained.** Period TBD by legal. | **Kept**; the actor now points to the tombstone | `CODE_READY` · verified by automated test (`rls.test.ts`: append-only, readable only with `audit.read`) |
| 1.14 | Deletion record: method and summary | `app.account_deletions` (append-only) | Proof of erasure | Tombstone ID only | No | **Retained.** Period TBD by legal. | Created by the deletion | `CODE_READY` · verified by config inspection |
| 1.15 | **Subscription data**, only when `billing.store_subscriptions` is ON and the store adapters are configured (both OFF / `NOT_CONFIGURED` today): random `app_account_token`; entitlement (plan, source, status, product ID, Apple `originalTransactionId` / Google `purchaseToken`, expiry, auto-renew); store event summaries `{sandbox, productId}` | `app.billing_accounts`, `app.entitlements`, `app.store_events` | Granting paid tiers after server verification | Yes | The token goes to Apple (`appAccountToken`) or Google (`obfuscatedAccountId`) with each purchase (`useStoreBilling.ts`). Apple and Google process the purchase as the store. | Not defined | **Not touched**: kept and linked to the tombstone (gap 4) | `CODE_READY` · verified by automated test (`apps/api/test/billing.test.ts`: verification-only grants; clients cannot write entitlements) |
| 1.16 | Client error reports (section 8) | API log output (pino); log store TBD | Crash diagnosis | **No**: no user ID or session in the payload or log line. IP caveat in section 8. | No | Log retention TBD | Not linked to the account, so nothing to delete | `CODE_READY` · verified by config inspection |
| 1.17 | Server request logs: method, URL (contains record UUIDs, not names), **client IP**, request ID. Fastify default request logging. Cookies and the Authorization header are redacted. | API log output; store TBD | Operations, security | Indirectly (IP) | No | TBD (hosting) | Not deleted | `CODE_READY` · verified by config inspection (`apps/api/src/server.ts`) |
| 1.18 | On device: locale, theme and `activePatientId` (a UUID) in AsyncStorage (`src/lib/storage.ts`); session cookie in SecureStore. Android `allowBackup: false`. | Device only | Preferences | No | No | Until uninstall | Deletion signs out and clears the query cache; AsyncStorage preferences stay (gap 14, minor) | `CODE_READY` · verified by automated test (`scripts/release/check.ts`: backup disabled) |
| 1.19 | **AI assistant consent**: `AI_ASSISTANT_PROCESSING` grant/withdrawal with document version (off by default) | `app.consent_events` | Explicit permission before messages go to an AI provider (Apple 5.1.2(i)) | Yes | No | As 1.12 | Kept (as 1.12) | `CODE_READY` · verified by automated test (`apps/api/test/ai.test.ts`) |
| 1.20 | **AI conversations**: the person's messages, the assistant's replies (or fixed emergency/refusal notices), title, and optionally which profile's summary was shared. Only when the person uses the assistant (`ai.assistant` OFF: internal test accounts only). | `app.ai_conversations`, `app.ai_messages` | Answering the person's questions | Yes; readable only by the owner (RLS) — staff, admins and the control centre cannot read content | **When a provider is configured:** the message text, recent conversation history and, if the person opted in for that conversation, a summary (age, sex, allergies, conditions, medications — no name or contacts) are sent to the configured AI provider as a processor, with an HMAC-derived end-user reference. Provider names, regions and their retention: **to be confirmed by legal**. No provider is configured today. | Until the person deletes the conversation or the account (period TBD by legal) | **Deleted** | `CODE_READY` · verified by automated test (`ai.test.ts`: admin sees no messages; deletion removes conversations) |
| 1.21 | **AI usage records**: route, plan tier, provider, model, token counts, cost, outcome, timestamps — no message content | `app.ai_usage` | Weekly allowances, spending cap, billing reconciliation | Yes, by user ID | No | **Retained** for billing; period TBD by legal | **Kept**, linked to the tombstone; conversation link cleared | `CODE_READY` · verified by automated test (`ai.test.ts`) |
| 1.22 | **AI answer reports**: reason, optional note, snapshot of the reported answer and — only if the person ticks the box — of the question before it; model, status, reviewer actions | `app.ai_response_reports`, `app.ai_report_events` (append-only) | Safety review of AI answers | Yes | No. Read by Trust & Safety / clinical reviewers through an audited function only | Until the account is deleted (period for incident statistics TBD by legal) | **Snapshots redacted**; reason, model and outcome kept for safety statistics | `CODE_READY` · verified by automated test (`apps/api/test/ai-reports.test.ts`) |
| 1.23 | AI assistant preferences: reply language, level of detail (assistant name is 1.4) | `app.ai_preferences` | Answer style | Yes | Sent to the AI provider as settings with each request | Life of the account | **Deleted** | `CODE_READY` · verified by automated test (`ai-reports.test.ts`) |

**Not collected by this build:**
- Photos, videos and wound photos: no camera or picker code, and the permissions are blocked.
- Location: no permission requested, and no API writes `service_area`.
- Contacts, microphone and audio.
- Advertising ID: `AD_ID` is blocked.
- Analytics and usage events: no analytics SDK.
- Payment card data: `commerce.checkout` is OFF, checkout is a preview only, and Paymob is not live.
- AI chat content from the public: `ai.assistant` is OFF, so only internal test accounts can use the assistant, and no AI provider key is configured (rows 1.19–1.21 describe what is stored once it is used).
- User-to-user messages and in-app support tickets.
- Device IDs.

Each of these needs this document, the manifest, the Apple label and the Data safety form updated **before** it ships.

---

## 2. Apple App Privacy (nutrition label): proposed answers

Requirement: [verified-official] App Privacy details are required for new apps and updates. They cover the developer's practices and those of integrated third-party code, and can be updated without an app update [A13]. Each data type needs a linked flag, a tracking flag and purposes [A13]. The manifest and label keys are fixed [A12].

| Data type (manifest key) | Collected now? | Linked | Tracking | Purposes | Basis in code | In `app.config.ts` manifest | Status · Verification |
|---|---|---|---|---|---|---|---|
| Name (`…Name`) | Yes | Yes | No | App Functionality | 1.1, 1.5, 1.8, emergency contact | ✓ | `NEEDS_ACCOUNT_ACTION` · `NEEDS_LEGAL_APPROVAL` · verified by config inspection |
| Email Address (`…EmailAddress`) | Yes (email accounts) | Yes | No | App Functionality | 1.1 | ✓ | same |
| Phone Number (`…PhoneNumber`) | Yes | Yes | No | App Functionality | 1.1, 1.5 (patient and emergency-contact phone) | ✓ | same |
| Health (`…Health`) | Yes, only after explicit consent | Yes | No | App Functionality | 1.5, 1.7. Putting date of birth and sex under Health is **to confirm**. | ✓ | same |
| User ID (`…UserID`) | Yes | Yes | No | App Functionality | Account ID; purchase account token (1.15) | ✓ | same |
| Other User Content (`…OtherUserContent`) | Yes | Yes | No | App Functionality | Free-text health notes; clinician bio and experience | ✓ | same |
| Crash Data (`…CrashData`) | Yes | **No** | No | App Functionality | 1.16 | ✓ (`Linked=false`) | same |
| Purchase History (`…PurchaseHistory`) | **Only when subscriptions are enabled** (review accounts can buy while the flag is off) | Yes | No | App Functionality | 1.15 | **✓** declared in the manifest (2026-10-22) | to add to the label |
| Physical Address | Governorate and city only, no street address | — | — | — | 1.5, 1.8. **To confirm:** whether a partial address counts. The conservative choice is to declare it. | ✗ | `NEEDS_LEGAL_APPROVAL` |
| Other data (clinician national ID and licence numbers) | Yes (clinicians) | Yes | No | App Functionality | 1.9. **To confirm:** which type covers identity-document numbers. | ✗ | `NEEDS_LEGAL_APPROVAL` |
| Location, Photos or Videos, Audio, Contacts, Payment Info, Device ID, Product Interaction, Performance Data, Customer Support, Sensitive Info | **No** | — | — | — | See "Not collected" above | ✗ (correct) | verified by config inspection |

**Proposed summary:**
- *Data Used to Track You*: **none**.
- *Data Linked to You*: Contact Info (Name, Email, Phone), Health, Identifiers (User ID), User Content (Other User Content), plus Purchases once subscriptions are enabled.
- *Data Not Linked to You*: Diagnostics (Crash Data).

Before submission:
1. Generate Xcode's privacy report (Product > Archive > Generate Privacy Report [A12]) and reconcile it with this table. This needs macOS (`NEEDS_ACCOUNT_ACTION`).
2. Reconcile third-party SDK data. The only store SDK is `expo-iap` (StoreKit 2 / Play Billing); Paymob is not integrated.

Apple reviews the label, so this is also `NEEDS_STORE_REVIEW`.

---

## 3. Google Play Data safety: proposed answers

Requirement: [verified-official] The form is required for closed, open and production tracks. It must cover third-party SDK data, includes Health info, an encryption-in-transit question and a deletion-request question, and needs a privacy policy [G1]. **To confirm:** the category labels below must be checked against the live Play Console form.

| Category → type | Collected | Shared | Required / optional | Purposes (proposed) | Basis |
|---|---|---|---|---|---|
| Personal info → Name | Yes | No* | Required | App functionality, Account management | 1.1, 1.5, 1.8 |
| Personal info → Email address | Yes | No* | Optional (phone-only sign-up exists) | Account management | 1.1 |
| Personal info → Phone number | Yes | No* | Optional | Account management, App functionality | 1.1, 1.5 |
| Personal info → User IDs | Yes | No* | Required | Account management | 1.1, 1.15 |
| Personal info → Address | **To confirm** (governorate and city only) | No | Optional | App functionality | 1.5, 1.8 |
| Personal info → Other info | **To confirm** (clinician ID and licence numbers) | No | Required for clinicians | App functionality, Fraud prevention/security | 1.9 |
| Health and fitness → Health info | Yes | No | **Optional** (explicit consent, DB-enforced) | App functionality | 1.5, 1.7 |
| Financial info → Purchase history | Only when subscriptions are ON | No* | Optional | App functionality | 1.15 |
| App activity → Other user-generated content | **To confirm** (free-text notes, bios) | No | Optional | App functionality | 1.7, 1.8 |
| App info and performance → Crash logs | Yes | No | Required (automatic) | App functionality (**to confirm**: some teams pick Analytics) | 1.16 |
| Device or other IDs | No (`AD_ID` blocked; no device IDs) | — | — | — | — |

\* "Shared: No" assumes hosting, SMS and email providers count as processors acting on our instructions, and that the store purchase token is store processing. **To confirm** against the form's definition of sharing. Session and request-log IP addresses (1.3, 1.17): how to declare them is **to confirm**.

| Security practice | Proposed answer | Code evidence | Status · Verification |
|---|---|---|---|
| Data encrypted in transit | **Yes.** [G1] says to answer yes only if every SDK uses TLS. | `app.config.ts` refuses preview/production builds without a public `https://` `EXPO_PUBLIC_API_URL`. iOS ATS `NSAllowsArbitraryLoads=false` in the generated Info.plist. Android cleartext is off by default on Android 9+ [E2], with no `usesCleartextTraffic`. TLS termination on the server is a hosting task. | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` · verified by automated test (`scripts/release/check.ts`: ATS) and config inspection |
| Users can request deletion | **Yes:** in-app path plus web URL (section 7) | `app/settings/delete-account.tsx`; `apps/site` `/delete-account` | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` (URL hosting) |
| Third-party SDK coverage | Only `expo-iap` talks to an external store. There are no ads, analytics or crash SDKs. | `apps/mobile/package.json` | verified by config inspection |

The whole form is `NEEDS_ACCOUNT_ACTION` · `NEEDS_LEGAL_APPROVAL` · `NEEDS_STORE_REVIEW`.

---

## 4. iOS privacy manifest (`PrivacyInfo.xcprivacy`)

Requirements, all [verified-official]:
- A valid manifest is required; invalid ones are rejected (ITMS-91056) [A6].
- Every Required Reason API use needs an approved reason (since 2024-05-01) [A7].
- Reasons come from Apple's fixed list [A8].
- Expo writes `ios.privacyManifests` at prebuild [A11].
- React Native 0.86 merges the `NSPrivacyAccessedAPITypes` of every pod into the app manifest at `pod install`. It does **not** merge collected data types [A10].
- Listed third-party SDKs need their own manifest, plus a signature when they are binary [A9].

### 4.1 Configured in `apps/mobile/app.config.ts` and generated by `expo prebuild --platform ios`

The generated file is `apps/mobile/ios/DressMyWound/PrivacyInfo.xcprivacy`, bundle `com.aliagroup.dressmywound`, inspected on 2026-10-15.

| Key | Value | Reason meaning [A8] | Status · Verification |
|---|---|---|---|
| `NSPrivacyTracking` | `false` | No tracking | `CODE_READY` · verified by automated test (`scripts/release/check.ts`) |
| `NSPrivacyTrackingDomains` | `[]` | — | `CODE_READY` · verified by config inspection |
| `NSPrivacyAccessedAPICategoryUserDefaults` | `CA92.1` | Read and write data accessible only to the app | `CODE_READY` · verified by config inspection |
| `NSPrivacyAccessedAPICategoryFileTimestamp` | `C617.1` | Metadata of files inside the app container | same |
| `NSPrivacyAccessedAPICategorySystemBootTime` | `35F9.1` | Measure elapsed time between in-app events | same |
| `NSPrivacyAccessedAPICategoryDiskSpace` | `E174.1` | Check space before writing files | same. **To confirm** on the merged manifest which dependency needs it [A7]. |
| `NSPrivacyCollectedDataTypes` | Name, EmailAddress, PhoneNumber, Health, UserID, OtherUserContent, PurchaseHistory (each `Linked=true`); CrashData (`Linked=false`). All have `Tracking=false` and purpose `AppFunctionality`. | Matches section 2 | `CODE_READY` · verified by automated test (`check.ts`: declares Health) and config inspection |

### 4.2 Aggregation and third-party SDK manifests

- Third-party SDK manifests are **aggregated at `pod install`**. The generated Podfile passes `:privacy_file_aggregation_enabled => podfile_properties['apple.privacyManifestAggregationEnabled'] != 'false'`, and `Podfile.properties.json` has no override, so aggregation is ON [A10] [A11]. Keep it on.
- **Not verified:** `pod install`, the merged manifest and any Xcode archive. There are no CocoaPods or Xcode on Linux. No iOS binary exists.
- **To confirm** at the first TestFlight upload (ITMS-91061 or signature emails):
  - whether the Hermes xcframework ships a valid manifest and signature (unresolved in the evidence) [A9];
  - the `expo-iap` pod's manifest.
- Status: `CODE_READY` · `NEEDS_ACCOUNT_ACTION` (Apple Developer account + EAS/macOS build) · `NEEDS_STORE_REVIEW`.

---

## 5. Permissions

### 5.1 Requested today: none at runtime

| Platform | Facts | Status · Verification |
|---|---|---|
| iOS | The generated production Info.plist has **no `NS*UsageDescription` keys**. Face ID is suppressed by `expo-secure-store` `faceIDPermission: false`. `withReleaseHardening` removes `NSLocalNetworkUsageDescription` and `NSBonjourServices` from store variants. There are no `request*Permission` calls in `apps/mobile/src`. | `CODE_READY` · verified by automated test (`check.ts`: no Face ID string, no local-network prompt) and config inspection |
| Android, final 2026-10-15 release APK (aapt2) | `INTERNET`, `VIBRATE`, `ACCESS_WIFI_STATE`, `ACCESS_NETWORK_STATE`, `com.android.vending.BILLING` (from `expo-iap`, Google Play Billing), `<package>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`. No runtime (dangerous) permissions; no biometric permissions. No `PermissionsAndroid` use in the code. | `BUILT` · verified by native build inspection (`scripts/release/verify-android.sh`) |
| Android, source configuration | `USE_BIOMETRIC` and `USE_FINGERPRINT` (pulled in by `expo-secure-store`) are in `blockedPermissions`; they were present in a superseded 2026-10-14 build and are absent from the final build. `com.android.vending.BILLING` must **not** be blocked [E1]. `android.permissions: []`. There are 18 blocked permissions, including `CAMERA`, location, `RECORD_AUDIO`, `READ_MEDIA_*`, `READ_CONTACTS` and `AD_ID`. | `CODE_READY` · verified by automated test (`check.ts`: 7 blocked entries asserted; `scripts/release/verify-android.sh` allow-list in CI job `android-native`) |

### 5.2 Rule for adding camera, photos, notifications or location later

No feature may add a permission without **all** of the following in the same change:
1. Remove it from `blockedPermissions` [E1].
2. Add it to the `verify-android.sh` allow-list and the `check.ts` assertions.
3. Update sections 1 to 4 of this document, `ios.privacyManifests`, the Apple label and the Data safety form.
4. Update the privacy policy, and bump the consent version if the change is material.

| Capability | iOS rule | Android / Play rule | Source |
|---|---|---|---|
| All | [verified-official] Ask only when the feature is used. Request only data relevant to core function. Paid functionality must not depend on granting access. Users need an easy way to withdraw. | [verified-official] Health-sensitive permissions need a prominent in-app disclosure and affirmative consent before the runtime prompt. | [A1] [G5] |
| Purpose strings | [verified-official] Not blank, under 4,000 bytes, accurate and specific, localized. Binaries that reference a protected API without its key are rejected (ITMS-90683). Add AR and EN strings through Expo `locales` (`ios.NS*UsageDescription`). | — | [A4] [A5] |
| Camera (wound photos) | `NSCameraUsageDescription` in AR and EN | Unblock `CAMERA` only with the disclosure screen; log the consent. `expo-image-picker` adds `RECORD_AUDIO` by default; set `microphonePermission: false`. | [A4] [G5] |
| Photos | Prefer the system picker (PHPicker) over full-library access | [verified-official] Keep `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO` and `READ_MEDIA_VISUAL_USER_SELECTED` blocked; use the system Photo Picker. | [A1] [G6] |
| Notifications | [verified-official] Never require push to access a feature or a subscription benefit (5.1.2(i)) | Same principle. The Android permission mechanics are **to confirm** (not in the evidence). Promotional pushes need `MARKETING_COMMUNICATIONS` consent and, under PDPL, an E-Marketing licence (section 11). | [A1] [EG1] |
| Location (if ever) | Foreground only; offer manual address entry as an alternative | [verified-official] Background location needs a declaration form, a video and a prominent disclosure. Avoid it. | [A1] [G7] |

Status of the rule: `CODE_READY` (enforced today by `blockedPermissions` + `check.ts` + `verify-android.sh`) · verified by automated test (`scripts/release/check.ts`).

---

## 6. Consent model

| Consent (`app.consent_type`) | Required? | Where asked | Enforcement | Withdrawal |
|---|---|---|---|---|
| `TERMS_OF_SERVICE` | Yes | **Consent gate after sign-in** (`app/consent.tsx`). `app/index.tsx` redirects whenever `missingRequired` is non-empty: new accounts, phone-OTP sign-ups, and everyone after a version bump. | **Client only:** the API does not refuse other requests (gap 2). The API rejects "withdrawal" with `REQUIRED_CONSENT_USE_ACCOUNT_DELETION`. | Only by deleting the account |
| `PRIVACY_POLICY` | Yes | Same gate; links to the in-app document | Same | Same |
| `HEALTH_DATA_PROCESSING` | Only to store health data | **Explicit, separate, never pre-ticked:** a checkbox in patient onboarding (`app/onboarding/patient.tsx`, `testID=health-consent`) and a switch in the Privacy center | **In the database:** `app.create_patient_profile` and the `health_entries_guard` INSERT trigger raise `HEALTH_DATA_CONSENT_REQUIRED` unless the latest event grants the **current** version. UPDATEs are not checked (gap 1). | Privacy center switch with a confirmation sheet. New health records stop; existing ones stay until account deletion. |
| `MARKETING_COMMUNICATIONS` | No | Gate (unticked by default) and Privacy center switch | Recorded only; nothing is sent | Switch |

**Ledger (`app.consent_events`)**
- Fields: `user_id`, `consent_type`, `document_version` (must equal `app.settings['consent.current_versions']`, otherwise `STALE_CONSENT_VERSION`), `granted`, `source` (`ios`/`android`/`web`), `locale` (`ar`/`en`), `occurred_at`. The server pins `occurred_at` for the app role.
- **Append-only:** the `forbid_mutation` trigger blocks changes, and RLS lets users insert only their own rows.
- Current versions are all `2026-10-draft`. Bumping a version forces every user to consent again, and the gate shows an "updated" notice.
- Not stored: the IP address, the device, or a hash of the displayed text (gap 11).
- The text shown is the AR or EN version from `packages/shared/src/legal.ts`.

**Family profiles:** each grant records `consent_basis` (`SELF`, `GUARDIAN_OF_MINOR`, `ADULT_CONSENT_ATTESTED`, `LEGAL_AUTHORITY_ATTESTED`) and the attested statement version. Age is computed from the date of birth on the server: a minor requires `GUARDIAN_OF_MINOR` (`MINOR_REQUIRES_GUARDIAN_BASIS`).

| Line | Status · Verification |
|---|---|
| DB-enforced health consent; stale-version rejection; terms-withdrawal refusal; append-only ledger | `CODE_READY` · verified by automated test (`apps/api/test/compliance.test.ts`) |
| Consent gate after sign-in; explicit health consent in onboarding | `CODE_READY` · verified by automated test (`e2e/tests/flow-a-patient.spec.ts`, Expo web) |
| Privacy center pause and resume of health consent | `CODE_READY` · verified by automated test (`e2e/tests/flow-f-privacy.spec.ts`, Expo web) |
| Guardian basis for minors | `CODE_READY` · verified by automated test (`apps/api/test/patients.test.ts`) |
| Whether this consent satisfies PDPL "explicit written" consent | `NEEDS_LEGAL_APPROVAL` (section 11) |

---

## 7. Account deletion

Requirements, all [verified-official]:
- In-app deletion is required for apps with account creation, enforced since 2022-06-30 [A1] [A2].
- It must be easy to find and must delete the account record and personal data; deactivation alone is not enough [A3].
- Manual deletion must state its timeline and confirm completion [A3].
- Auto-renewing subscribers must be told that billing continues through Apple [A3].
- Google requires a prominent in-app path **and** a working web link to request deletion without the app. Retained data must be disclosed [G2].

| # | Item | Implementation | Status · Verification |
|---|---|---|---|
| 7.1 | In-app path, all roles | Me → **Privacy & consent** → **Delete account**. `features/AccountScreen.tsx` is used by both `patient/(tabs)/me.tsx` and `clinician/(tabs)/me.tsx`, so it covers patients, doctors and nurses. | `CODE_READY` · verified by automated test (`e2e/tests/flow-f-privacy.spec.ts`, Expo web, patient only) |
| 7.2 | Confirmation and re-authentication | The user types `DELETE`. Accounts with a password must enter it; phone-only accounts must have signed in within 15 minutes (`FRESH_SESSION_MS`). Rate limit: 5 per 15 minutes per session. | `CODE_READY` · verified by automated test (`compliance.test.ts`: typed confirmation and current password); phone-only path verified by config inspection |
| 7.3 | Timing and confirmation | **Immediate and synchronous.** Sessions are revoked server-side; the app signs out, clears its cache and shows "Your account has been deleted." | `CODE_READY` · verified by automated test (`compliance.test.ts`; `flow-f-privacy.spec.ts`: old credentials rejected) |
| 7.4 | What is deleted or kept | See section 1, "On `app.delete_my_account`". The screen lists **deleted:** sign-in details and devices, own health profile and records, family profiles only the user manages, cart, clinician profile, services and availability. It lists **kept:** profiles shared with another family member; financial records of completed clinician payouts; the audit log and consent history without name or contact details. The two kept-list omissions are gaps 3 and 4. | `CODE_READY` · `NEEDS_LEGAL_APPROVAL` (retention wording and periods) |
| 7.5 | Subscription warning | When `entitlements.storeManaged`, the screen warns that deletion does not cancel the App Store or Play subscription (`billing.activeStoreSubscription`). The web page says the same. | `CODE_READY` · verified by config inspection |
| 7.6 | Web URL | `apps/site` builds `/delete-account` (EN and AR, naming Dress My Wound / غير لي). It gives the in-app steps and an email request path, and lists deleted and kept data. Store field `google.accountDeletionUrl` = `https://<SUPPORT_DOMAIN_TO_CONFIRM>/delete-account` (**placeholder**). The page is not hosted and the support email is a placeholder. | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` |
| 7.7 | Email (support) deletion path | **No tooling.** `app.delete_my_account('SUPPORT')` can only delete the caller's own account, and no admin endpoint invokes it. No completion time is stated (gap 5). | `none (gap)` · `NEEDS_LEGAL_APPROVAL` |
| 7.8 | Store reviewers | Review accounts (`apps/api/src/db/seed-review.ts`) can be deleted and re-seeded. They never see real patients or real clinicians (only synthetic clinician profiles); they see the same approved public catalogue (TetraSol products, nursing service types) as real users, which contains no personal data. | `CODE_READY` · verified by automated test (`compliance.test.ts`: review isolation) |
| 7.9 | Acceptance | Whether Apple and Google accept the flow, including the healthcare-specific retention | `NEEDS_STORE_REVIEW` |

---

## 8. Crash and error reports

| Item | Implementation | Status · Verification |
|---|---|---|
| Client | `apps/mobile/src/lib/errorReporting.ts` captures uncaught JS errors (global handler, iOS and Android) and errors caught by the route-level `ErrorBoundary` in `app/_layout.tsx`. It sends at most 20 reports per app run to `POST /v1/telemetry/client-errors`. Payload: error `name`, `message` (≤500), `stack` (≤4000), `route`, `platform`, `appVersion`, `appVariant`, `fatal`. No user ID, form values or tokens. | `CODE_READY` · verified by config inspection |
| Server | `compliance/routes.ts` re-redacts emails, numbers and `token`/`cookie`/`password` fragments. It replaces UUIDs in the route with `:id` and truncates the stack to 2000 characters in production. The log line contains **no user ID, session or IP**. Rate limit: 20 per minute. | `CODE_READY` · verified by config inspection. No automated test covers redaction. |
| Caveat | The Fastify default request log, enabled in `server.ts`, records the client IP and request ID for **every** request, including this one. Within the log store, a report can therefore be correlated with an IP (gap 8). | `none (gap)` |
| Third-party crash SDK | None. Adding one (for example Sentry) requires updating sections 1 to 4 first. | verified by config inspection |

---

## 9. No tracking, no ads, no ATT

| Item | Facts | Status · Verification |
|---|---|---|
| ATT | [verified-official] Tracking means linking app data with other companies' data for ads or ad measurement, or sharing it with data brokers. It needs ATT permission [A14]. The app has no ad or attribution SDK, no `expo-tracking-transparency` and no `NSUserTrackingUsageDescription`, so it shows **no ATT prompt** and must not add one. | `CODE_READY` · verified by config inspection |
| Manifest | `NSPrivacyTracking=false`, no tracking domains | `CODE_READY` · verified by automated test (`scripts/release/check.ts`) |
| Android advertising ID | `com.google.android.gms.permission.AD_ID` is blocked | `BUILT` (absent from the 2026-10-14 APK) · verified by native build inspection; verified by automated test (`check.ts`) |
| Ads and analytics | None in `apps/mobile/package.json` | verified by config inspection |
| Health data and marketing | [verified-official] Health data may not be used for advertising, marketing or data-mining without permission (5.1.3), and personal data may not be shared without permission (5.1.2(i)) [A1]. The critique notes that 5.1.3 is rated inconsistently in the evidence. Marketing consent is a separate, optional, unticked choice. No marketing sending is implemented. | `CODE_READY` · verified by automated test (`e2e/tests/flow-a-patient.spec.ts`, Expo web: consent gate) |
| In-app statement | "We do not sell your data, show ads, or track you across other apps." (`privacy.noTracking`, shown on the consent gate and the privacy center) | `CODE_READY` · `NEEDS_LEGAL_APPROVAL` |

---

## 10. Gaps found while writing this document

These are findings from reading the code; none is fixed here.

1. ~~Health consent covers INSERT only.~~ Fixed 2026-10-15: profile edits and changes to an entry's content also require current health-data consent (database guards; `compliance.test.ts`). Marking an entry as entered-in-error stays possible.
2. **Terms and privacy consent is enforced only in the app.** The API serves domain requests for accounts without current Terms or Privacy consent. Health data is the exception, because the database enforces it.
3. **Deletion ledger case** — partly fixed 2026-10-15: clinician credentials (ID and licence numbers) are deleted, verification notes cleared, and city, subspecialty and fee scrubbed (`compliance.test.ts`). Provider type, gender, specialty, years of experience and governorate stay with the retained payout records; the in-app and web "kept" lists do not say so yet.
4. **Deletion does not touch subscription data.** `billing_accounts`, `entitlements` and `store_events` stay, linked to the tombstone, and this is not disclosed.
5. **The email deletion path has no tooling and no stated completion time.** Apple requires a stated timeline for manual deletion [A3], and PDPL requires a response within 6 working days [EG1].
6. ~~`NSPrivacyCollectedDataTypePurchaseHistory` missing from `ios.privacyManifests`.~~ Fixed 2026-10-22 (declared, linked, App Functionality); the privacy policy draft now describes store subscription data. Physical Address and the clinician-identifier type are to confirm.
7. **The privacy policy draft is incomplete** (section 12).
8. **Crash reports can be correlated with an IP** through the default request logs (section 8).
9. **No data export (access or portability) endpoint exists**, and no ticket queue tracks data-subject requests.
10. **No breach-response runbook** exists in the repo (72-hour PDPC clock).
11. **The consent ledger stores version and locale but no hash of the displayed text.** The evidence implication for Executive Regulations Article 14 is secondary (**to confirm**).
12. **No age check at sign-up or on the `SELF` profile.** The Terms require users to be 18 or older.
13. **Retention in database backups and logs is undefined** (hosting is TBD).
14. **AsyncStorage preferences are not cleared on deletion.** They are locale, theme and a profile UUID, with no health content.

---

## 11. Egypt PDPL (Law 151/2020) and Executive Regulations (Decree 816/2025)

Health data is processed for Egyptian users, so these obligations apply before go-live. **No PDPC account, licence or DPO exists.**

| # | Obligation | Evidence confidence · source | What the code does | Status |
|---|---|---|---|---|
| P1 | Health data is **sensitive** personal data; children's data is always sensitive | [verified-official] [EG1] | Separate, explicit, DB-enforced health consent (section 6). Minors exist only as guardian-managed profiles. | `CODE_READY` · `NEEDS_LEGAL_APPROVAL` |
| P2 | A **PDPC licence or permit** (3-year licence or 1-year permit) is required to process data. Types: Controller, Processor, Controller/Processor, E-Marketing, Cross-Border Transfer, Visual Monitoring. | [verified-official] [EG1] | None; outside the code | `NEEDS_REGULATORY_EVIDENCE` · `NEEDS_LEGAL_APPROVAL` |
| P3 | **E-Marketing** licence if promotional messages are sent | [verified-official] licence type [EG1] | `MARKETING_COMMUNICATIONS` consent is recorded; no sending is implemented | `NEEDS_LEGAL_APPROVAL` (before any campaign) |
| P4 | **Explicit written consent** for sensitive data; electronic is acceptable; in **Arabic** | **To confirm.** Statute Art. 12 and ER Art. 14 come from secondary copies [EG3] [EG4]. The Arabic-language requirement comes from a law-firm summary [EG7]. | Unticked checkbox and switch; AR and EN consent text; ledger records version and locale | `CODE_READY` · `NEEDS_LEGAL_APPROVAL` |
| P5 | Secure records of sensitive-data consents and of erasure, correction and stop-processing requests (ER Art. 14(7)) | **To confirm** [EG4] | `consent_events`, `account_deletions` and `audit_log` are append-only. Support-route requests are not tracked (gaps 5, 9). | `CODE_READY` (partial) · `NEEDS_LEGAL_APPROVAL` |
| P6 | **Children:** guardian's explicit consent under 15, including its time scope; guardian consent also for ages 15 to 18 | **To confirm** [EG4] | `GUARDIAN_OF_MINOR` is required for anyone under 18 (DB). Time scope is not captured. Account holders are 18+ by the Terms only (gap 12). | `CODE_READY` (partial) · `NEEDS_LEGAL_APPROVAL` |
| P7 | **Cross-border transfer** requires a prior PDPC licence or permit, plus explicit consent, if data leaves Egypt (cloud hosting included) | [verified-official] [EG1]. The cloud example comes from [EG7] (**to confirm**). | Hosting region is a placeholder. No cross-border consent screen exists. No external AI is used yet: no provider key is configured and `ai.assistant` is OFF. A provider outside Egypt would need this permit before launch (`AI_GATEWAY.md`, step 8). | `NEEDS_REGULATORY_EVIDENCE` · `NEEDS_ACCOUNT_ACTION` (hosting choice) · `NEEDS_LEGAL_APPROVAL` |
| P8 | Appoint a **DPO** and register them with the PDPC | **To confirm** [EG3] [EG7] | No DPO in the documents | `NEEDS_LEGAL_APPROVAL` · `NEEDS_REGULATORY_EVIDENCE` |
| P9 | Record of processing activities (ROPA) with retention periods | **To confirm** [EG7] | Section 1 is a starting inventory; retention periods are placeholders | `NEEDS_LEGAL_APPROVAL` |
| P10 | **Breach:** notify the PDPC within **72 hours**; notify data subjects within 3 days (the FAQ also says 3 working days) | [verified-official] [EG1] | No runbook (gap 10) | `NEEDS_LEGAL_APPROVAL` |
| P11 | Data-subject rights (access, withdrawal, rectification, erasure, restriction, objection, portability) answered within **6 working days** | [verified-official] [EG1] | In app: view and correct records, withdraw health and marketing consent, delete the account. Missing: export, restriction and objection handling, a request queue (gap 9). | `CODE_READY` (partial) · `NEEDS_LEGAL_APPROVAL` |
| P12 | Name the PDPC as supervisory authority: hotline **17372**, **info@pdpc.gov.eg** | [verified-official] [EG2] | The policy says only "complain to the competent authority" | `NEEDS_LEGAL_APPROVAL` |
| P13 | Timing: the Executive Regulations are Decree 816/2025, effective about 2 Nov 2025. Full enforcement is expected from **about 1 Nov 2026** (31 Oct per one firm), about 17 days after this document's date. | Decree number official-but-ambiguous [EG1]. Dates and grace period come from secondary sources [EG4] [EG5] [EG6]. All **to confirm**. | — | `NEEDS_LEGAL_APPROVAL` |
| P14 | Penalties for sensitive-data or cross-border breaches: at least 3 months' imprisonment and/or EGP 500,000 to 5,000,000 | **To confirm** [EG3] | — | informational |
| P15 | The PDPC portal requires Digital Egypt sign-in (Egyptian national ID); foreign entities need a local representative | **To confirm** [EG5] | — | `NEEDS_ACCOUNT_ACTION` |

---

## 12. Legal documents: status DRAFT

Source: `packages/shared/src/legal.ts` (`privacy`, `terms`, `health-consent`, `medical-disclaimer`, each in EN and AR). The app (`/legal/<id>`, which shows "Draft document — pending legal review") and `apps/site` render the same source.

| Item | Requirement | Gap in the draft | Status · Verification |
|---|---|---|---|
| Policy linked in-app and in store metadata | [verified-official] Apple 5.1.1(i) [A1]. Google requires an active, public, non-geofenced, non-PDF URL naming the app or developer [G3] [G4]. | Linked in-app from the gate and the Privacy center. Store URLs are placeholders, and the policy is not hosted. | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` · verified by automated test (`flow-f-privacy.spec.ts`: policy opens) |
| Content: what is collected, third parties, retention and deletion, revoking consent | [verified-official] [A1] | Covered in outline. Missing: subscription and purchase data and Apple/Google processing; request-log IPs; the DPO; PDPC contacts; the 6-working-day response; cross-border; named processors; retention periods; the clinician-credential retention (gap 3). | `NEEDS_LEGAL_APPROVAL` |
| Statements that must stay true | — | "Payments are not processed in this version" holds only while `commerce.checkout` and `billing.store_subscriptions` are OFF. "Clinicians see a patient's record only within an active care relationship" is forward-looking: no clinician access exists in this build. | `NEEDS_LEGAL_APPROVAL` |
| Versioning | — | `LEGAL_DOCUMENT_VERSION` and `consent.current_versions` (`2026-10-draft`) must be bumped together on approval | `CODE_READY` · verified by config inspection |

---

## 13. Summary by category

| Category | Items |
|---|---|
| **Completed implementation** (`CODE_READY`) | DB-enforced health consent; append-only consent ledger; consent gate; explicit onboarding consent; Privacy center; in-app deletion for all roles; deletion web page source; anonymous error reports; privacy manifest; no tracking; permission blocking; `allowBackup=false`; HTTPS-only release config |
| **Verified by automated test** | `apps/api/test/compliance.test.ts` (11), `rls.test.ts`, `patients.test.ts`, `billing.test.ts` (15), `scripts/release/check.ts` (58/58 on 2026-10-22), `e2e/tests/flow-a-patient.spec.ts` and `flow-f-privacy.spec.ts` (Expo web only) |
| **Verified by native build inspection** | Android permission set and absent `AD_ID` in the 2026-10-14 APK. That APK is debug-signed, predates `expo-iap` and contains a since-fixed JS crash, so **it must not be distributed**. |
| **Requires developer account** | App Store Connect label; Play Data safety; hosting the privacy and deletion URLs; support mailbox; Xcode privacy report; TestFlight manifest check; hosting region; PDPC portal |
| **Requires official assets** | None for privacy disclosures |
| **Requires legal approval** | All legal documents (DRAFT); retention periods; the 14 gaps in section 10; label and Data safety answers; P1 to P13 |
| **Requires regulatory evidence** | PDPC licence or permit (P2); cross-border permit (P7); DPO registration (P8) |
| **Requires Apple or Google review** | Acceptance of the label, Data safety, the deletion flow, and the third-party SDK manifests and signatures |

---

## Official sources

`[verified-official]` in the evidence unless marked **to confirm**.

- **A1**: https://developer.apple.com/app-store/review/guidelines/ (5.1.1(i)–(v), 5.1.1(ix), 5.1.2(i), 5.1.3; 5.1.3 is rated inconsistently in the evidence)
- **A2**: https://developer.apple.com/news/?id=12m75xbj (5.1.1(v) enforcement, 2022-06-30)
- **A3**: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- **A4**: https://developer.apple.com/documentation/uikit/requesting-access-to-protected-resources
- **A5**: https://docs.expo.dev/guides/localization/
- **A6**: https://developer.apple.com/documentation/bundleresources/adding-a-privacy-manifest-to-your-app-or-third-party-sdk
- **A7**: https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api
- **A8**: https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype
- **A9**: https://developer.apple.com/support/third-party-SDK-requirements/
- **A10**: https://github.com/facebook/react-native/blob/0.86-stable/packages/react-native/scripts/cocoapods/privacy_manifest_utils.rb
- **A11**: https://docs.expo.dev/guides/apple-privacy/
- **A12**: https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests
- **A13**: https://developer.apple.com/app-store/app-privacy-details/
- **A14**: https://developer.apple.com/app-store/user-privacy-and-data-use/
- **G1**: https://support.google.com/googleplay/android-developer/answer/10787469?hl=en (Data safety)
- **G2**: https://support.google.com/googleplay/android-developer/answer/13327111?hl=en (account deletion)
- **G3**: https://support.google.com/googleplay/android-developer/answer/16679511?hl=en (Health Content and Services)
- **G4**: https://support.google.com/googleplay/android-developer/answer/10144311 (privacy policy)
- **G5**: https://support.google.com/googleplay/android-developer/answer/13996367?hl=en (health-sensitive permissions)
- **G6**: https://support.google.com/googleplay/android-developer/answer/16935362?hl=en (photo and video permissions)
- **G7**: https://support.google.com/googleplay/android-developer/answer/9799150?hl=en (background location)
- **E1**: https://docs.expo.dev/guides/permissions/
- **E2**: https://docs.expo.dev/versions/latest/sdk/build-properties/
- **EG1**: https://portal.pdpc.gov.eg/faq (sensitive data, licences, cross-border, 72 hours, 6 working days; Decree 816/2025 number official-but-ambiguous)
- **EG2**: https://portal.pdpc.gov.eg/ (PDPC contacts)
- **EG3**: https://www.privacylaws.com/media/3263/egypt-data-protection-law-151-of-2020.pdf (**to confirm**: secondary copy, unofficial translation)
- **EG4**: https://alhasswalawfirm.com/law-library/decree-816-2025 (**to confirm**: law-firm reproduction)
- **EG5**: https://www.bakermckenzie.com/en/insight/publications/2026/10/egypt-personal-data-protection-law-update (**to confirm**: secondary)
- **EG6**: https://cms.law/en/are/legal-updates/egypt-s-pdpl-executive-regulations-issued-one-year-compliance-countdown-begins (**to confirm**: critique "additionally verified")
- **EG7**: https://www.clydeco.com/en/insights/2026/01/egypt-regulatory-update-on-data-privacy (**to confirm**: critique "additionally verified")
