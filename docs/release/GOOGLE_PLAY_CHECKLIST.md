# Google Play checklist — Dress My Wound | غير لي (Android)

**Verified on: 2026-10-14**

Package `com.aliagroup.dressmywound` · Expo SDK 57 / React Native 0.86 · source: `apps/mobile`.
Requirements come from `docs/release/evidence/STORE_REQUIREMENTS_EVIDENCE.md` (verified 2026-10-14). Source keys like [G3] point to the URLs in [Official sources](#official-sources).

> **Bottom line: the Android app is NOT ready for submission.** No line below is `DEVICE_TESTED`, `READY_FOR_SUBMISSION`, `SUBMITTED` or `APPROVED`. This environment has no emulator (no `/dev/kvm`), no macOS and no developer accounts. The only release build is local and debug-signed. It predates a crash fix and has never run on a device.

---

## How to read this document

**Status column.** It shows the highest status the line has reached, then any open blockers, using only this taxonomy:

| Status | Meaning here |
|---|---|
| `CODE_READY` | Implemented in the repo (config or code). Not yet seen in a native build. |
| `BUILT` | Seen in a locally built native artifact (APK/AAB). |
| `DEVICE_TESTED` | Exercised on a physical or virtual Android device. **Nothing has this status.** |
| `STORE_METADATA_READY` | Listing text or asset is in `store/metadata` / `store/assets` and passes automated limit checks. |
| `NEEDS_ACCOUNT_ACTION` | Needs the Play Console, an Expo/EAS account, a domain or a Google Cloud account. |
| `NEEDS_REGULATORY_EVIDENCE` | Needs Egyptian regulatory evidence (EDA, Ministry of Health, PDPC). |
| `NEEDS_LEGAL_APPROVAL` | Needs counsel sign-off (legal texts, declarations, retention). |
| `NEEDS_OFFICIAL_ASSETS` | Needs official brand files or real store screenshots. |
| `NEEDS_STORE_REVIEW` | Only Google can confirm it (review, policy support). |
| `READY_FOR_SUBMISSION` · `SUBMITTED` · `APPROVED` | **Not used. Nothing qualifies.** |

`not CODE_READY` means the line has not reached the first status yet.

**Verification column.** Each line uses one or more of these labels: `verified by automated test (<file>)`, `verified by native build inspection`, `verified by config inspection`, `not verified`.

**Requirement labels.** Only `[verified-official]` findings are treated as requirements. Anything else is marked **to confirm**.

---

## 0. What was actually built and inspected

| Fact | Value | How verified |
|---|---|---|
| Build | `expo prebuild` + `./gradlew assembleRelease bundleRelease`, `APP_VARIANT=production`: **BUILD SUCCESSFUL** (APK + AAB) | native build inspection |
| API URL baked in | `EXPO_PUBLIC_API_URL=https://api.dressmywound.invalid` (**placeholder**) | config inspection |
| Identity | `com.aliagroup.dressmywound`, versionCode `1`, versionName `1.0.0` | native build inspection (aapt2 badging) |
| SDK levels | minSdk `24`, targetSdk `36`, compileSdk `36` | native build inspection (aapt2 badging) |
| ABIs | `arm64-v8a armeabi-v7a x86 x86_64` | native build inspection (aapt2 badging) |
| Labels | default `Dress My Wound`, `ar` → `غير لي` | native build inspection (aapt2 badging) |
| Signing | `CN=Android Debug` (local debug key). **Not distributable.** | native build inspection (apksigner) |
| Known defect | That APK had a JS crash (removed palette keys in Avatar). It is fixed in source, so **the APK/AAB must be rebuilt**. | — |
| Device runs | **None** | not verified |

---

## 1. Technical requirements

| # | Item | Requirement | What the repo / build shows | Status | Verification |
|---|---|---|---|---|---|
| 1.1 | Target API level | [verified-official] From 2026-08-31, new apps and updates must target API 36 or higher (extension to 2026-11-01). [G1] [G2] | targetSdk **36** (Expo SDK 57 default [E1]). `app.config.ts` does not override it. | `BUILT` | verified by native build inspection |
| 1.2 | minSdk | Play sets no minimum in the evidence. Expo SDK 57 supports Android 7+ [E1]. The RN 0.86 catalog uses minSdk 24 [E2]. | minSdk **24** (Android 7.0). | `BUILT` | verified by native build inspection |
| 1.3 | 64-bit | [verified-official] Each 32-bit ABI must ship with its 64-bit pair [G5]. New app bundles must support 64-bit [G3]. | All four ABIs ship. `reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64`. | `BUILT` | verified by native build inspection |
| 1.4 | Android App Bundle | [verified-official] New apps must publish as AAB [G6]. | `eas.json` `production` and `preview-store` use `buildType: app-bundle`. A local `bundleRelease` AAB was produced (debug-signed). APK profiles (`development`, `preview`) are for sideloading only. | `BUILT` · `NEEDS_ACCOUNT_ACTION` (EAS store build) | verified by native build inspection; verified by config inspection (`eas.json`) |
| 1.5 | 16 KB memory pages | [verified-official] Apps with native code must support 16 KB pages, and new bundles uploaded to Play Console must too [G3]. Verification methods are in [G4]. | `zipalign -c -P 16 -v 4`: **Verification successful**. `readelf`: **44/44** 64-bit `.so` files have LOAD alignment ≥ `0x4000`. `expo.useLegacyPackaging=false`. **Not done yet:** `bundletool dump config` on the AAB (expect `PAGE_ALIGNMENT_16K`) and a 16 KB emulator run. Re-run all checks on the rebuilt AAB and after `expo-iap` lands. | `BUILT` | verified by native build inspection (APK) |
| 1.6 | Edge-to-edge | [verified-official] At API 36, apps cannot opt out of edge-to-edge [G9]. On Expo SDK 54+ it is always on [E3]. System bar colors are deprecated [G8]. | No opt-out in config. `edgeToEdgeEnabled=true` in the generated `gradle.properties`. Insets come from `react-native-safe-area-context` in `src/ui/Screen.tsx`, `Sheet.tsx`, `Toast.tsx`, `features/TabBar.tsx`, `app/_layout.tsx`, `app/welcome.tsx`. **Not checked on a device** (gesture vs 3-button navigation, Arabic RTL). | `CODE_READY` | verified by config inspection |
| 1.7 | Predictive back | [verified-official] Platform behavior at API 36: `onBackPressed` and `KEYCODE_BACK` are not delivered [G9]. The Expo key `android.predictiveBackGestureEnabled` defaults to `false` [E4]. No Play requirement for predictive back was found (**to confirm**). | `predictiveBackGestureEnabled: true` → release manifest has `enableOnBackInvokedCallback=true`. No `BackHandler` or `beforeRemove` use in `apps/mobile/src`. **Needs an Android 16 device test** of sheets, modals, multi-step onboarding and delete-account. Documented fallback: set the key to `false`. | `BUILT` | verified by native build inspection |
| 1.8 | Large screens | [verified-official] At API 36, on displays ≥ 600dp the orientation and resizability locks are ignored [G10]. | `orientation: 'portrait'` (`screenOrientation=1`). The manifest supports `large`/`xlarge` screens. Tablet and foldable layouts are untested. | `BUILT` | verified by native build inspection; layouts not verified |
| 1.9 | HTTPS only | [verified-official] Cleartext traffic is off by default on Android 9+ [E8]. | `app.config.ts` refuses preview/production builds without a public `https://` API URL. The release manifest has no `usesCleartextTraffic` or `networkSecurityConfig`. | `BUILT` | verified by native build inspection; verified by config inspection |
| 1.10 | `allowBackup=false` | Project rule (keep medical data out of cloud backup). Not a Play requirement in the evidence. | `android:allowBackup=false` in the release manifest. | `BUILT` | verified by native build inspection; verified by automated test (`scripts/release/check.ts`) |
| 1.11 | Reproducible EAS image | [verified-official] The `latest` image alias moves. `sdk-57` maps to `ubuntu-26.04-jdk-17-ndk-r27b-sdk-57` [E6]. | `eas.json` base still sets `"android": { "image": "latest" }`. Pin it to `sdk-57`. | `not CODE_READY` | verified by config inspection |
| 1.12 | Version codes | [verified-official] Use remote versioning with `autoIncrement` [E7]. | `cli.appVersionSource: "remote"` and `autoIncrement: true` on store profiles. No `versionCode` in `app.config.ts`. | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` (EAS project) | verified by config inspection |

---

## 2. Permissions

### 2.1 Permissions in the built release manifest

Source: aapt2 on the local production APK. Library origins come from the manifest-merger report of the current development-variant build.

| Permission | Comes from | Runtime prompt | Verdict |
|---|---|---|---|
| `android.permission.INTERNET` | app template, `expo-file-system` | no (install-time) | keep |
| `android.permission.VIBRATE` | `expo-haptics` | no | keep |
| `android.permission.ACCESS_NETWORK_STATE` | `expo-network` | no | keep |
| `android.permission.ACCESS_WIFI_STATE` | `expo-network` | no | keep. aapt2 reports an implied feature `android.hardware.wifi`. Check the Play device catalog that no phones are filtered out (**to confirm**). |
| `android.permission.USE_BIOMETRIC` | `androidx.biometric` via `expo-secure-store` (biometric mode is unused) | — | **removed since that build**: added to `blockedPermissions`. The regenerated (development-variant) `AndroidManifest.xml` has `tools:node="remove"`, and the merger report shows USE_BIOMETRIC `REJECTED`. **Not re-verified in a production release build.** |
| `android.permission.USE_FINGERPRINT` | same | — | **removed since that build**, same caveat |
| `com.aliagroup.dressmywound.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | `androidx.core` 1.18.0 (signature-level, app-internal) | no | keep |

Not present in the release manifest: `com.android.vending.BILLING`, `AD_ID`, any location, camera, microphone, media, storage or contacts permission.

### 2.2 Permission policy items

| # | Item | Requirement | What the repo / build shows | Status | Verification |
|---|---|---|---|---|---|
| 2.1 | Blocked permissions | [verified-official] `android.blockedPermissions` strips permissions that libraries add [E5]. | `app.config.ts` blocks `ACCESS_BACKGROUND_LOCATION`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `CAMERA`, `RECORD_AUDIO`, `READ/WRITE/MANAGE_EXTERNAL_STORAGE`, `READ_MEDIA_IMAGES/VIDEO/AUDIO`, `READ_MEDIA_VISUAL_USER_SELECTED`, `SYSTEM_ALERT_WINDOW`, `USE_BIOMETRIC`, `USE_FINGERPRINT`, `READ_CONTACTS`, `READ_PHONE_STATE`, `com.google.android.gms.permission.AD_ID`. `android.permissions: []`. | `CODE_READY` (USE_BIOMETRIC/USE_FINGERPRINT block) · `BUILT` (all others absent in the release APK) | verified by automated test (`scripts/release/check.ts` asserts 7 of these); verified by native build inspection |
| 2.2 | Photo and video permissions | [verified-official] Apps targeting API 33+ may request `READ_MEDIA_IMAGES/VIDEO` only if the system Photo Picker is not enough [G11]. | No media permissions. No image picker or camera code in `apps/mobile/src` (wound photos are not shipped). When photos ship: use the system Photo Picker, keep `READ_MEDIA_*` blocked, and unblock `CAMERA` only if the camera is used. | `BUILT` | verified by native build inspection; verified by automated test (`scripts/release/check.ts`) |
| 2.3 | Background location | [verified-official] Background location needs a declaration form, a video and a prominent disclosure [G12]. | No location is used. `ACCESS_BACKGROUND_LOCATION` is blocked. No Play declaration is needed. | `BUILT` | verified by native build inspection; verified by automated test (`scripts/release/check.ts`) |
| 2.4 | Health-sensitive permissions | [verified-official] Under the Health apps policy, `CAMERA`, location and `RECORD_AUDIO` need a prominent disclosure and affirmative consent [G13]. | None requested. A disclosure and consent screen must come with any future camera or location feature. | `BUILT` | verified by native build inspection |

---

## 3. Accounts, signing and testing tracks

| # | Item | Requirement | What the repo shows | Status | Verification |
|---|---|---|---|---|---|
| 3.1 | Play App Signing and upload key | [verified-official] App bundles require Play App Signing. The developer keeps an upload key; new apps get a Google-generated signing key by default. The signing-key choice is fixed once a release reaches open testing or production [G7]. | No keystore, `.p12`, `.pem` or service-account key in the repo. Local builds are debug-signed. EAS will create and hold the upload keystore (`eas credentials`). For App Links, register the **Play app-signing** SHA-256: `apps/site/build.ts` writes `.well-known/assetlinks.json` only when `ANDROID_CERT_SHA256` is set, and App Links are configured only when `APP_LINK_DOMAIN` is set. | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` | verified by automated test (`scripts/release/check.ts`, no committed keys); verified by native build inspection (debug cert) |
| 3.2 | Developer account type | [verified-official] Health apps must use a Play Console **Organization** account. It needs a D-U-N-S number that matches the Dun & Bradstreet profile [G14] [G15]. | No account exists. The legal entity name is a placeholder (`<ALIA_GROUP_LEGAL_ENTITY_TO_CONFIRM>` in `store/metadata/*.json`). | `NEEDS_ACCOUNT_ACTION` · `NEEDS_LEGAL_APPROVAL` | not verified |
| 3.3 | 12 testers for 14 days | [verified-official] Applies to **personal** accounts created after 2023-11-13: a closed test with at least 12 testers opted in for 14 consecutive days before production access [G16]. That Organization accounts are exempt is an inference (**to confirm**). | If an Organization account is used (3.2), plan for the rule not to apply. If a personal account is used by mistake, budget 14+ days, plus the production-access review (the evidence notes up to 7 days). | `NEEDS_ACCOUNT_ACTION` | not verified |
| 3.4 | Android developer verification | [verified-official] Register app package names for developer verification. Since 2026-09-30, unregistered Play packages are removed [G17]. Auto-registration of new apps created in Play Console and global device enforcement in 2027 come from a search summary only (**to confirm**) [G18]. | `com.aliagroup.dressmywound` is **proposed** (`app.config.ts`). Confirm the company controls the domain and that the ID is free; it is permanent once used. `.staging` and `.dev` would be separate Play apps if ever uploaded. | `NEEDS_ACCOUNT_ACTION` | verified by config inspection |
| 3.5 | Testing tracks | [verified-official] The Data safety form is required for closed, open and production tracks; internal-testing-only apps are exempt [G26]. The Health apps declaration is required before any closed, open or production release [G29]. | `eas.json` `submit.production` and `submit.preview-store` → `track: internal`, `releaseStatus: draft`. No Play service-account key is referenced (it must stay out of the repo). Plan: internal (team) → closed (pilot clinicians, after 5.6 and 5.7) → production. Whether the very first upload must be manual in Play Console is not in the evidence (**to confirm**). | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` | verified by config inspection |

---

## 4. Store listing (`store/metadata/en.json`, `ar.json`, `store/assets/google-play/`)

| # | Item | Requirement | What the repo shows | Status | Verification |
|---|---|---|---|---|---|
| 4.1 | Title | [verified-official] 30 characters max [G19]. No emoji, ALL CAPS, price or ranking wording [G20]. | EN `Dress My Wound` (14), AR `غير لي` (6). | `STORE_METADATA_READY` | verified by automated test (`scripts/release/check.ts`) |
| 4.2 | Short description | [verified-official] 80 characters max [G19]. No "Best/#1/New/Free", CTA, emoji or line breaks [G21]. | EN 77 chars, AR 62 chars. Plain, factual. | `STORE_METADATA_READY` | verified by automated test (`scripts/release/check.ts`) |
| 4.3 | Full description | [verified-official] 4000 characters max [G19]. Non-device health apps **must** state in the description that the app is *"not a medical device and does not diagnose, treat, cure, or prevent any medical condition"* and remind users to consult a healthcare professional [G28]. | EN 965 chars, AR 778 chars, with the emergency number 123. **Gap:** the text says "does not diagnose or treat and is not an emergency service". The verbatim phrase and the consult-a-professional reminder are **missing** in EN and AR. `check.ts` does not test for them. | `not CODE_READY` · `NEEDS_LEGAL_APPROVAL` (Arabic wording) | verified by automated test (length, 123); disclaimer gap verified by config inspection |
| 4.4 | App icon | [verified-official] 512×512, 32-bit PNG with alpha, sRGB, ≤ 1024 KB, full square with no pre-rounded corners [G22]. | `icon-512.png`: 512×512 RGBA, 11 KB. Brand is **PROVISIONAL** (`packages/tokens/src/brand.ts`; no official TetraSol or Alia Group logo files). | `STORE_METADATA_READY` (format) · `NEEDS_OFFICIAL_ASSETS` | verified by automated test (`scripts/release/check.ts`) |
| 4.5 | Feature graphic | [verified-official] Required to publish. 1024×500, JPEG or 24-bit PNG, no alpha [G21]. | `feature-graphic-1024x500.png`: 1024×500 RGB, no alpha. Provisional brand. Only one version exists; the evidence recommends a right-to-left Arabic variant. | `STORE_METADATA_READY` (format) · `NEEDS_OFFICIAL_ASSETS` | verified by automated test (`scripts/release/check.ts`) |
| 4.6 | Screenshots | [verified-official] At least 2 to publish, up to 8 per device type. JPEG or 24-bit PNG, 320–3840 px, long side ≤ 2× short side. At least 4 at ≥ 1080 px, 9:16, are needed for recommendation formats [G21]. | **None exist.** `docs/screenshots/milestone-1-overview.png` is not a store screenshot. Capture 4–8 per locale (EN, AR right-to-left) from a native build with synthetic data, at 1080×1920. Raw 1080×2400 captures break the 2:1 rule. | `NEEDS_OFFICIAL_ASSETS` | not verified |
| 4.7 | Contact details | [verified-official] A support email is required; phone and website are optional and shown publicly [G19]. | Placeholders: `https://<SUPPORT_DOMAIN_TO_CONFIRM>/`. `apps/site` shows "[support email — to be confirmed]" until `SUPPORT_EMAIL` is set. | `NEEDS_ACCOUNT_ACTION` | verified by config inspection |
| 4.8 | Category and tags | [verified-official] Category definitions and up to 5 tags are set in Store settings [G23]. | Recommendation: **Medical**. See 4.8a. | `NEEDS_ACCOUNT_ACTION` | not verified |
| 4.9 | Languages | [verified-official] One localized title per language [G19]. | EN (`en-GB`) and AR files exist. The `ar.json` `locale` field is `ar-SA`; enter it as Play's Arabic (`ar`) listing. | `STORE_METADATA_READY` | verified by config inspection |

### 4.8a Category: Medical vs Health & Fitness

| | Medical | Health & Fitness |
|---|---|---|
| Play definition [G23] | "Drug and clinical references, calculators, handbooks for healthcare providers, medical journals and news" | "Personal fitness, workout tracking, diet and nutritional tips, health and safety" |
| Fit with what ships | Personal and family health records (allergies, conditions, medications, surgeries), access to licensed clinicians, wound-care products | No fitness, workout or diet features |
| Evidence note | Google's health-app guidance names telehealth, patient portals and disease management as medical apps (evidence implication on [G23]) | — |

**Recommendation: Medical.** Neither definition fits exactly. The app's core is health records plus licensed clinicians, which is closer to Medical, and nothing in the product is fitness-related. It also matches the Apple recommendation, so the two stores stay consistent. The category does not change the Health apps declaration (5.7), which every app must complete.

---

## 5. App content (Play Console → Policy → App content)

| # | Item | Requirement | What the repo shows | Status | Verification |
|---|---|---|---|---|---|
| 5.1 | Privacy policy | [verified-official] Must be linked in Play Console **and** in the app. Active, public, not geofenced, not a PDF, labelled as a privacy policy, naming the developer or the app [G27] [G28]. | In-app: Privacy center → Legal documents → Privacy policy (`settings/privacy.tsx`, `testID=open-privacy-policy`). Web: `apps/site` builds `/privacy` (EN + AR). Both render `packages/shared/src/legal.ts`, whose status is **`DRAFT_PENDING_LEGAL_REVIEW`**. Not hosted; the domain is a placeholder. | `CODE_READY` · `NEEDS_LEGAL_APPROVAL` · `NEEDS_ACCOUNT_ACTION` | verified by config inspection |
| 5.2 | Ads declaration | [verified-official] Must be declared before Target audience [G24]. | No ad or analytics SDK in `apps/mobile/package.json`. `AD_ID` is blocked. Answer: **no ads**. | `BUILT` · `NEEDS_ACCOUNT_ACTION` | verified by automated test (`scripts/release/check.ts`); verified by native build inspection |
| 5.3 | App access (reviewer logins) | [verified-official] Give reviewers working credentials for every gated area; up to 5 instruction sets [G31]. An active demo account is required [G17]. | `apps/api/src/db/seed-review.ts` creates **Patient, Doctor and Nurse** accounts. Email + password, `emailVerified = true` (no OTP), `account_kind = 'REVIEW'`. They see only synthetic `is_demo` catalogue rows. The script needs `REVIEW_EMAIL_DOMAIN` (a company domain), `REVIEW_ACCOUNT_PASSWORD` (≥ 16 chars, never committed), the owner DB URL and a live production backend. Reviewers may delete an account; re-run the script to recreate it. **No subscriber account set**: subscriptions are off and product IDs are NULL (section 6). | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` | verified by automated test (`apps/api/test/compliance.test.ts`: review isolation, no self-promotion) |
| 5.4 | Content rating (IARC) | **to confirm** (finding is official-but-ambiguous): the questionnaire is required for new apps. Egypt is in no listed rating authority, so IARC Generic presumably applies [G24]. | Not started. Answer honestly about health information and digital purchases (if subscriptions are enabled). | `NEEDS_ACCOUNT_ACTION` | not verified |
| 5.5 | Target audience | [verified-official] A target age group must be declared. Including children brings in the Families policy [G25] [G24]. | Declare **18+**. Minors exist only as guardian-managed family profiles, enforced in the DB (migration `0006`: `MINOR_REQUIRES_GUARDIAN_BASIS`). **Gap:** there is no age check on the account holder's own `SELF` profile; `0006` checks age only for family profiles. Listing assets must not appeal to children. | `CODE_READY` (guardian rule) · `NEEDS_LEGAL_APPROVAL` · `NEEDS_ACCOUNT_ACTION` | verified by automated test (`apps/api/test/patients.test.ts`); SELF-age gap verified by config inspection |
| 5.6 | Data safety form | [verified-official] Required for closed, open and production tracks. Must cover third-party SDKs, include Health info, encryption in transit and the deletion question, and needs a privacy policy [G26]. | Answers come from **`docs/release/PRIVACY_AND_DATA_DISCLOSURES.md`**. From code: no ads or analytics SDKs; HTTPS is enforced (1.9); client error reports (`/telemetry/client-errors`) carry no form values; the deletion URL is in 5.8. | `NEEDS_ACCOUNT_ACTION` · `NEEDS_LEGAL_APPROVAL` | not verified |
| 5.7 | Health apps declaration | [verified-official] **Every** app on a closed, open or production track must complete it, even with no health features [G29] [G28]. | Categories: see 5.7a. | `NEEDS_ACCOUNT_ACTION` · `NEEDS_LEGAL_APPROVAL` · `NEEDS_REGULATORY_EVIDENCE` | not verified |
| 5.8 | Account deletion | [verified-official] Required: (1) a prominent in-app deletion path and (2) a working web link to request deletion without the app. Retained data must be disclosed [G30]. | **In app:** Me → Privacy & consent → Delete account (`settings/delete-account.tsx`). Re-authentication (password, or a sign-in within 15 minutes for phone-only accounts), typed `DELETE`, immediate deletion, sessions revoked. It warns that a store subscription keeps billing. Server: `POST /me/account-deletion` → `app.delete_my_account`. **Web:** `apps/site` → `/delete-account` (EN + AR). It names the app, gives the in-app path and an email request path, and lists deleted vs retained data. Not hosted; the email and domain are placeholders. | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` · `NEEDS_LEGAL_APPROVAL` (retention wording) | verified by automated test (`apps/api/test/compliance.test.ts`: re-auth, erasure, tombstoning, shared-profile and ledger retention). The UI flow `e2e/tests/flow-f-privacy.spec.ts` runs on Expo **web** and has not been re-run since the latest changes. |
| 5.9 | In-app medical reminders | [verified-official] Remind users to consult a healthcare professional [G28]. | The health tab shows `EmergencyNotice` (tel:123) and `MedicalDisclaimer` ("does not diagnose or treat"). The Terms say "Always follow the advice of a qualified clinician." The in-app disclaimer does not explicitly say "consult a healthcare professional". | `CODE_READY` · `NEEDS_LEGAL_APPROVAL` | verified by config inspection |

### 5.7a Health apps declaration: proposed selections (final choice needs counsel)

| Category [G29] | Proposed | Why (from shipped code) |
|---|---|---|
| Healthcare Services and Management | **Select** | Personal and family health records; finding verified doctors and nurses |
| Diseases and Conditions Management (includes skin care) | **Likely** | Conditions and allergies are recorded; wound-care product store |
| Medication and Treatment Management | **Likely** | Medications are recorded (self-reported) |
| Clinical Decision Support | Do not select now | `clinical.diagnostic_suggestions` is OFF and cannot be enabled without a regulatory evidence reference (DB CHECK) |
| Medical Device Apps | Do not select unless regulated | `ai.wound_assessment` is OFF. Whether any feature is software as a medical device under Egyptian Drug Authority rules is unresolved (`NEEDS_REGULATORY_EVIDENCE`). |

The flag gating above is verified by automated test (`apps/api/test/compliance.test.ts`: regulated features OFF by default; HIGH-risk flags need an evidence reference). Confirm the category names against the live Play Console form.

---

## 6. Billing (Play Billing vs external gateway)

| # | Item | Requirement | What the repo shows | Status | Verification |
|---|---|---|---|---|---|
| 6.1 | Rail classification | [verified-official] Physical goods and services must **not** use Play Billing [G33]. Regulated clinical services should not [G34]. Digital in-app purchases must not be steered elsewhere [G33]. Egypt has Play Billing in EGP 0.90–49,000.00 [G35] and no alternative-billing program [G36]. | `packages/shared/src/billing.ts`: `resolvePaymentRail` (physical/clinical → `EXTERNAL_GATEWAY`; digital on Android → `GOOGLE_PLAY_BILLING`). `mayLinkOutForPayment` is never true for digital purchases in the native apps. | `CODE_READY` | verified by automated test (`apps/api/test/billing.test.ts`) |
| 6.2 | Play Billing Library version | [verified-official] From 2026-08-31 (extension to 2026-11-01), new apps and updates must use **PBL 8 or later**. PBL 9 is supported until 2028-08-31 [G32]. | `expo-iap` **6.0.2** → OpenIAP `openiap-google` **4.0.2** → `com.android.billingclient:billing` **9.1.0** [E10] [E11]. `src/features/billing/useStoreBilling.ts` already imports `expo-iap`, **but at the time of writing it is not in `apps/mobile/package.json` or `node_modules`**, so it is not installed or type-checked. The built APK has **no** billing client or `com.android.vending.BILLING`. IAP needs a development or store build, not Expo Go [E9]. Do **not** add `com.android.vending.BILLING` to `blockedPermissions` [E5]. | `not CODE_READY` (becomes `CODE_READY` once installed and type-checked) | verified by native build inspection (billing absent); verified by config inspection |
| 6.3 | Server verification and notifications | [verified-official] Entitlement state must be server-authoritative (evidence implication on [G32]). | The server verifies via the Play Developer API and acknowledges after verification (`billing/routes.ts`). RTDN webhook `/webhooks/google/rtdn` uses OIDC push auth. Without `GOOGLE_PLAY_PACKAGE_NAME`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64`, `GOOGLE_RTDN_AUDIENCE` and `GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL`, the adapter reports `NOT_CONFIGURED` and grants nothing. The 3-day acknowledgement rule is not in the evidence (**to confirm**). | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` (service account, Pub/Sub, RTDN) | verified by automated test (`apps/api/test/billing.test.ts`: verify-before-grant, account-token replay blocked, refund via notification, duplicate/stale events, no direct DB writes, NOT_CONFIGURED refusal) |
| 6.4 | Products and flag | — | `billing_plan_offers` product and base-plan IDs are **NULL** (migration `0007`), so nothing is purchasable. Flag `billing.store_subscriptions` is OFF by default. Reference prices (Gold 299/2,990 EGP, Platinum 699/6,990 EGP) are within the Egypt range [G35]. | `NEEDS_ACCOUNT_ACTION` | verified by config inspection |
| 6.5 | Gold/Platinum mixing digital and real-world perks | **to confirm** (official-but-ambiguous): Play Billing is required when a SKU is more digital than physical, or marketed as digital [G34]. | Gold and Platinum list `REAL_WORLD` benefits (priority matching, reduced platform fees, priority support). Classification needs written confirmation from Play policy support. | `NEEDS_STORE_REVIEW` · `NEEDS_LEGAL_APPROVAL` | not verified |

---

## 7. AI-Generated Content policy

| Requirement | What the repo shows | Status | Verification |
|---|---|---|---|
| **to confirm** (from the critique's additional verification, not a tagged finding): apps whose central feature is AI generation, including chatbots, must offer in-app reporting of offensive AI output [G37]. | Applies **only if** an AI feature ships. No AI chat UI exists: the patient home shows a "not configured" card. `ai.assistant` and `ai.wound_assessment` are OFF, `HIGH` risk, and cannot be enabled without `evidence_ref` (DB CHECK in migration `0006`). If enabled later, add in-app report/flag, re-do the IARC questionnaire and update Data safety. | `NEEDS_REGULATORY_EVIDENCE` | verified by automated test (`apps/api/test/compliance.test.ts`) |

---

## 8. Dated upcoming requirements (not blocking today)

| When | Requirement [source] | Impact here |
|---|---|---|
| 2027-01-27 | API 37 targets: `READ_CONTACTS` needs a declaration; one-time precise location must use the location button [G11] [G12] | `READ_CONTACTS` is blocked; no location used |
| 2027-02-01 | Updates without 16 KB support cannot be released [G4] | Already aligned (1.5); keep checking every AAB |
| 2027-02 | Memory thresholds; ≥ 25% DEX optimization for apps with > 10 MB DEX [G3] | R8 is off (`enableMinifyInReleaseBuilds` default false [E8]). Check DEX size in the Play bundle explorer after the first upload. |
| 2027-04 | Apps with sign-in must support zero-tap restore (Restore Credentials API). Healthcare may request an exemption [G3]. | Decide: implement it, or file the exemption before enforcement |
| 2027-08-31 | PBL 8 deprecated [G32] | `expo-iap` 6.0.2 uses PBL 9.1.0 (OK until 2028-08-31) |

---

## 9. Summary by owner

- **Completed implementation (in code):** target/min SDK, ABIs, AAB profiles, permission blocking, `allowBackup=false`, HTTPS-only builds, edge-to-edge insets, predictive-back opt-in, in-app and web account deletion, privacy center, review-account seeding, payment-rail classification, server-side Play verification and RTDN, regulated-feature flags.
- **Verified by automated test:** `apps/api/test/compliance.test.ts` (11), `apps/api/test/billing.test.ts` (10), `apps/api/test/patients.test.ts`, `scripts/release/check.ts` (46 checks), `packages/tokens` contrast tests (43); `expo-doctor` 21/21. E2E (Playwright, Expo **web**, not native) exists for flows A–F but has **not** been re-run since the latest changes.
- **Verified by native build inspection only:** target 36, minSdk 24, ABIs, 16 KB alignment (APK), manifest permissions, `allowBackup`, `enableOnBackInvokedCallback`, debug signing. **The build must be redone** after the crash fix, the biometric-permission block and `expo-iap`.
- **Requires developer or other accounts:** Organization Play account + D-U-N-S, package registration, EAS project, upload key, Play signing cert in `assetlinks.json`, service account + RTDN, product IDs, support domain and email, hosting `apps/site`, review-account domain and password, all App content forms, category and tags, production API URL.
- **Requires official assets:** official logo/brand (tokens are `PROVISIONAL`), store icon and feature graphic re-export, EN and AR screenshots.
- **Requires legal approval:** privacy policy, terms, health consent, medical disclaimer (all `DRAFT_PENDING_LEGAL_REVIEW`), the verbatim Play health disclaimer in AR, Data safety answers, retention statements, Health declaration categories, 18+ policy and the missing SELF-age check, hybrid-tier classification.
- **Requires regulatory evidence:** whether any feature is a medical device (EDA), plus Ministry of Health licensing for `care.home_visit_booking` and `care.video_consultation` (flags OFF) and any AI feature (flags OFF).
- **Requires Google review:** first-release review, App content forms, the Health apps declaration, production access if a personal account is used, and Play policy support's view on hybrid tiers.

### Device tests needed before any line can become `DEVICE_TESTED`

Run on a physical Android 16 phone and on a 16 KB emulator image (`adb shell getconf PAGE_SIZE` → `16384` [G4]), using a rebuilt, EAS-signed AAB through internal testing:

1. Launch and crash-free navigation through every role.
2. Predictive back on sheets, modals, onboarding and delete-account.
3. Edge-to-edge with gesture and 3-button navigation, in EN and AR (RTL).
4. Account deletion end-to-end.
5. Play Billing sandbox purchase, restore and manage, once `expo-iap` and the products exist.
6. A tablet or foldable sanity check (1.8).

---

## Official sources

All are `[verified-official]` in the evidence file unless marked **to confirm**.

- **G1** — https://developer.android.com/google/play/requirements/target-sdk
- **G2** — https://support.google.com/googleplay/android-developer/answer/11926878
- **G3** — https://support.google.com/googleplay/android-developer/answer/17492799?hl=en
- **G4** — https://developer.android.com/guide/practices/page-sizes (the verification methods are verified-official; the 16 KB timeline is official-but-ambiguous)
- **G5** — https://developer.android.com/google/play/requirements/64-bit
- **G6** — https://support.google.com/googleplay/android-developer/answer/9844279?hl=en
- **G7** — https://support.google.com/googleplay/android-developer/answer/9842756?hl=en
- **G8** — https://developer.android.com/about/versions/15/behavior-changes-15
- **G9** — https://developer.android.com/about/versions/16/behavior-changes-16
- **G10** — https://developer.android.com/about/versions/17/behavior-changes-17
- **G11** — https://support.google.com/googleplay/android-developer/answer/16935362?hl=en
- **G12** — https://support.google.com/googleplay/android-developer/answer/9799150?hl=en
- **G13** — https://support.google.com/googleplay/android-developer/answer/13996367?hl=en
- **G14** — https://support.google.com/googleplay/android-developer/answer/10788890?hl=en
- **G15** — https://support.google.com/googleplay/android-developer/answer/13634885
- **G16** — https://support.google.com/googleplay/android-developer/answer/14151465?hl=en
- **G17** — https://support.google.com/googleplay/android-developer/answer/16984799?hl=en
- **G18** — https://developer.android.com/developer-verification/guides/google-play-console (**to confirm**: from a search summary; the page was not fetched)
- **G19** — https://support.google.com/googleplay/android-developer/answer/9859152
- **G20** — https://support.google.com/googleplay/android-developer/answer/9898842
- **G21** — https://support.google.com/googleplay/android-developer/answer/9866151
- **G22** — https://developer.android.com/distribute/google-play/resources/icon-design-specifications
- **G23** — https://support.google.com/googleplay/android-developer/answer/9859673
- **G24** — https://support.google.com/googleplay/android-developer/answer/9859655 (the target-audience rules are verified-official; the content-rating finding is official-but-ambiguous, **to confirm**)
- **G25** — https://support.google.com/googleplay/android-developer/answer/9867159?hl=en
- **G26** — https://support.google.com/googleplay/android-developer/answer/10787469?hl=en
- **G27** — https://support.google.com/googleplay/android-developer/answer/10144311
- **G28** — https://support.google.com/googleplay/android-developer/answer/16679511?hl=en
- **G29** — https://support.google.com/googleplay/android-developer/answer/14738291?hl=en
- **G30** — https://support.google.com/googleplay/android-developer/answer/13327111?hl=en
- **G31** — https://support.google.com/googleplay/android-developer/answer/9859455
- **G32** — https://developer.android.com/google/play/billing/deprecation-faq
- **G33** — https://support.google.com/googleplay/android-developer/answer/9858738?hl=en
- **G34** — https://support.google.com/googleplay/android-developer/answer/10281818?hl=en (the clinical-services rule is verified-official; the mixed digital/physical SKU rule is official-but-ambiguous, **to confirm**)
- **G35** — https://play.google.com/supported-locations?hl=en
- **G36** — https://support.google.com/googleplay/android-developer/answer/16954621?hl=en
- **G37** — https://support.google.com/googleplay/android-developer/answer/13985936 (**to confirm**: from the critique's additional verification, not a tagged finding)
- **E1** — https://docs.expo.dev/versions/latest/
- **E2** — https://raw.githubusercontent.com/facebook/react-native/0.86-stable/packages/react-native/gradle/libs.versions.toml
- **E3** — https://expo.dev/changelog/sdk-54
- **E4** — https://docs.expo.dev/versions/v57.0.0/config/app/
- **E5** — https://docs.expo.dev/guides/permissions/
- **E6** — https://docs.expo.dev/build-reference/infrastructure/
- **E7** — https://docs.expo.dev/build-reference/app-versions/
- **E8** — https://docs.expo.dev/versions/latest/sdk/build-properties/
- **E9** — https://docs.expo.dev/guides/in-app-purchases/
- **E10** — https://openiap.dev/docs/setup/expo
- **E11** — https://repo1.maven.org/maven2/io/github/hyochan/openiap/openiap-google/4.0.2/openiap-google-4.0.2.pom

[G1]: https://developer.android.com/google/play/requirements/target-sdk
[G2]: https://support.google.com/googleplay/android-developer/answer/11926878
[G3]: https://support.google.com/googleplay/android-developer/answer/17492799?hl=en
[G4]: https://developer.android.com/guide/practices/page-sizes
[G5]: https://developer.android.com/google/play/requirements/64-bit
[G6]: https://support.google.com/googleplay/android-developer/answer/9844279?hl=en
[G7]: https://support.google.com/googleplay/android-developer/answer/9842756?hl=en
[G8]: https://developer.android.com/about/versions/15/behavior-changes-15
[G9]: https://developer.android.com/about/versions/16/behavior-changes-16
[G10]: https://developer.android.com/about/versions/17/behavior-changes-17
[G11]: https://support.google.com/googleplay/android-developer/answer/16935362?hl=en
[G12]: https://support.google.com/googleplay/android-developer/answer/9799150?hl=en
[G13]: https://support.google.com/googleplay/android-developer/answer/13996367?hl=en
[G14]: https://support.google.com/googleplay/android-developer/answer/10788890?hl=en
[G15]: https://support.google.com/googleplay/android-developer/answer/13634885
[G16]: https://support.google.com/googleplay/android-developer/answer/14151465?hl=en
[G17]: https://support.google.com/googleplay/android-developer/answer/16984799?hl=en
[G18]: https://developer.android.com/developer-verification/guides/google-play-console
[G19]: https://support.google.com/googleplay/android-developer/answer/9859152
[G20]: https://support.google.com/googleplay/android-developer/answer/9898842
[G21]: https://support.google.com/googleplay/android-developer/answer/9866151
[G22]: https://developer.android.com/distribute/google-play/resources/icon-design-specifications
[G23]: https://support.google.com/googleplay/android-developer/answer/9859673
[G24]: https://support.google.com/googleplay/android-developer/answer/9859655
[G25]: https://support.google.com/googleplay/android-developer/answer/9867159?hl=en
[G26]: https://support.google.com/googleplay/android-developer/answer/10787469?hl=en
[G27]: https://support.google.com/googleplay/android-developer/answer/10144311
[G28]: https://support.google.com/googleplay/android-developer/answer/16679511?hl=en
[G29]: https://support.google.com/googleplay/android-developer/answer/14738291?hl=en
[G30]: https://support.google.com/googleplay/android-developer/answer/13327111?hl=en
[G31]: https://support.google.com/googleplay/android-developer/answer/9859455
[G32]: https://developer.android.com/google/play/billing/deprecation-faq
[G33]: https://support.google.com/googleplay/android-developer/answer/9858738?hl=en
[G34]: https://support.google.com/googleplay/android-developer/answer/10281818?hl=en
[G35]: https://play.google.com/supported-locations?hl=en
[G36]: https://support.google.com/googleplay/android-developer/answer/16954621?hl=en
[G37]: https://support.google.com/googleplay/android-developer/answer/13985936
[E1]: https://docs.expo.dev/versions/latest/
[E2]: https://raw.githubusercontent.com/facebook/react-native/0.86-stable/packages/react-native/gradle/libs.versions.toml
[E3]: https://expo.dev/changelog/sdk-54
[E4]: https://docs.expo.dev/versions/v57.0.0/config/app/
[E5]: https://docs.expo.dev/guides/permissions/
[E6]: https://docs.expo.dev/build-reference/infrastructure/
[E7]: https://docs.expo.dev/build-reference/app-versions/
[E8]: https://docs.expo.dev/versions/latest/sdk/build-properties/
[E9]: https://docs.expo.dev/guides/in-app-purchases/
[E10]: https://openiap.dev/docs/setup/expo
[E11]: https://repo1.maven.org/maven2/io/github/hyochan/openiap/openiap-google/4.0.2/openiap-google-4.0.2.pom
