# Google Play checklist — Dress My Wound | غير لي (Android)

**Verified on: 2026-10-15**

Package `com.aliagroup.dressmywound` (proposed) · Expo SDK 57 / React Native 0.86.3 · source `apps/mobile`.
Requirements come only from `docs/release/evidence/STORE_REQUIREMENTS_EVIDENCE.md` (verified 2026-10-14). Keys such as [G3] and [E5] point to [Official sources](#official-sources).
Companion docs: `docs/release/PRIVACY_AND_DATA_DISCLOSURES.md` (Data safety answers), `docs/release/PAYMENT_COMPLIANCE.md` (payment rails) and `docs/release/RELEASE_STATUS.md` (build log, including the outcome of the final Android rebuild).

> **Bottom line: the Android app is NOT ready for submission.** It has not run on any phone or emulator: this environment has no `/dev/kvm` and no macOS. No Play Console, Google Cloud or Expo/EAS account exists. The final local release build (2026-10-15, with `expo-iap` and the biometric-permission block) is **BUILT and inspected but debug-signed: it must not be distributed**. Store builds are produced and signed by EAS / Play App Signing. An earlier 2026-10-14 build contained a JS crash bug and is superseded.

---

## How to read this document

| Status | Meaning in this document |
|---|---|
| `CODE_READY` | Implemented in the repo (code or config). Not yet confirmed in a built APK/AAB. |
| `BUILT` | Confirmed in a locally built native artifact (aapt2, zipalign, readelf, apksigner). |
| `STORE_METADATA_READY` | Listing text or asset is in `store/` and passes the automated format and limit checks. |
| `NEEDS_ACCOUNT_ACTION` | Needs Play Console, Google Cloud, Expo/EAS, a domain or a mailbox. |
| `NEEDS_REGULATORY_EVIDENCE` | Needs Egyptian regulatory evidence (EDA, Ministry of Health, PDPC). |
| `NEEDS_LEGAL_APPROVAL` | Needs counsel sign-off. |
| `NEEDS_OFFICIAL_ASSETS` | Needs official brand files or real store screenshots. |
| `NEEDS_STORE_REVIEW` | Only Google can decide it (review, policy support). |
| `DEVICE_TESTED` · `READY_FOR_SUBMISSION` · `SUBMITTED` · `APPROVED` | **Not assigned to any line.** Nothing qualifies. |

`none (gap)` means the line has not reached `CODE_READY` yet.
**Verification labels:** `verified by automated test (<file>)` · `verified by native build inspection` · `verified by config inspection` · `not verified`.
**Requirement labels:** only `[verified-official]` evidence findings are treated as requirements. Everything else is marked **to confirm**.

---

## 0. What was built and inspected

| Artifact | Facts | Verification |
|---|---|---|
| **Final** release APK + AAB, 2026-10-15 (`APP_VARIANT=production`, `expo prebuild --clean` + `./gradlew assembleRelease bundleRelease`, Expo 57.0.29, `expo-iap` 6.0.2) | BUILD SUCCESSFUL. aapt2: `com.aliagroup.dressmywound`, versionCode `1`, versionName `1.0.0`, minSdk `24`, compileSdk `36`, targetSdkVersion `36`, native-code `arm64-v8a armeabi-v7a x86 x86_64`, label `Dress My Wound`, label-ar `غير لي`, `allowBackup=false`, `enableOnBackInvokedCallback=true`. `scripts/release/verify-android.sh`: targetSdk OK, permission allow-list OK, zip entries 16 KB aligned, 44/44 64-bit `.so` files aligned ≥ 16 KB. API URL baked in: `https://api.dressmywound.invalid` (**placeholder**). Signed with the local Android debug key (**not distributable**). | verified by native build inspection |
| Superseded release APK, 2026-10-14 | Built before `expo-iap`; contained a JS crash (removed palette keys in `Avatar`, fixed) and `USE_BIOMETRIC`/`USE_FINGERPRINT`. **Do not use.** | verified by native build inspection |
| Dev-client APK (`assembleDebug`, `APP_VARIANT=development`) | `com.aliagroup.dressmywound.dev`, label `Dress My Wound Dev` / AR `غير لي تطوير`, targetSdk 36. Debug-only permissions `SYSTEM_ALERT_WINDOW` and `CHANGE_WIFI_MULTICAST_STATE` come from the dev menu/launcher and are not in store builds. Never uploaded to Play. | verified by native build inspection |
| Device runs | **None.** No emulator (no KVM) and no physical device. | not verified |

Automated checks that passed on 2026-10-15: 158 unit/API tests (`apps/api` 102 across 7 files, including `test/compliance.test.ts` with 11 tests and `test/billing.test.ts` with 10; `packages/tokens` 43; `packages/shared` 9; `packages/i18n` 4); `scripts/release/check.ts` 46/46; `expo-doctor` 21/21; typecheck 8/8 workspaces; lint clean. Playwright E2E runs on the **Expo web build**, which is a proxy and not native: 13 passed (flows A–F, Arabic RTL and `e2e/tests/a11y.spec.ts` 6/6). Current totals live in `RELEASE_STATUS.md`.

---

## 1. Technical requirements

| # | Item | Requirement | Repo / build evidence | Status | Verification |
|---|---|---|---|---|---|
| 1.1 | Target API | [verified-official] From 2026-08-31, new apps and updates must target API 36+ (extension to 2026-11-01 on request) [G1] [G2]. | targetSdkVersion **36** in the built APK, the Expo SDK 57 default [E1]. `app.config.ts` does not override it. `scripts/release/verify-android.sh` fails below 36 and runs in CI job `android-native`. | `BUILT` | verified by native build inspection; automated check in `scripts/release/verify-android.sh` |
| 1.2 | minSdk | No Play minimum in the evidence. Expo SDK 57 supports Android 7+ [E1]. The RN 0.86 catalog sets minSdk 24 [E2]. `expo-iap` needs minSdk 23+ [E10]. | `node_modules/react-native/gradle/libs.versions.toml`: `minSdk = "24"`. `android/app/build.gradle` reads `rootProject.ext.minSdkVersion`. No override. | `CODE_READY` | verified by config inspection |
| 1.3 | 64-bit | [verified-official] Each 32-bit ABI must ship with its 64-bit pair [G5]. Apps with native code must support 64-bit [G3]. | The APK ships all four ABIs (`reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64`). `verify-android.sh` fails if `arm64-v8a` is missing. | `BUILT` | verified by native build inspection |
| 1.4 | Android App Bundle | [verified-official] New apps must publish as AAB [G6]. | `eas.json` `production` and `preview-store` use `buildType: app-bundle`. A local `bundleRelease` AAB was produced (debug-signed). APK profiles (`development`, `preview`) are for sideloading only. | `BUILT` · `NEEDS_ACCOUNT_ACTION` (signed EAS store build) | verified by native build inspection; verified by config inspection (`eas.json`) |
| 1.5 | 16 KB page size | [verified-official] Apps with native code must support 16 KB pages, and new app bundles uploaded to Play must support them [G3]. The verification methods are in [G4]. The enforcement timeline is official-but-ambiguous (**to confirm**); treat it as required now. | APK: `zipalign -c -P 16 -v 4` → *Verification successful*. `readelf`: **44/44** 64-bit `.so` files have LOAD alignment ≥ `0x4000`. `expo.useLegacyPackaging=false`. Both checks plus targetSdk and a permission allow-list are automated in `scripts/release/verify-android.sh` (CI job `android-native`). **Not done:** `bundletool dump config` on the AAB (expect `PAGE_ALIGNMENT_16K` [G4]) and a 16 KB emulator run. The checks must be repeated on the `expo-iap` build (see `RELEASE_STATUS.md`). Script caveats: it checks the APK only, not the AAB; it reads the lexicographically smallest LOAD alignment string per `.so`, so a library mixing `0x2000` and `0x10000` segments could pass incorrectly. | `BUILT` | verified by native build inspection; automated check in `scripts/release/verify-android.sh` |
| 1.6 | Edge-to-edge | [verified-official] At API 36, apps cannot opt out of edge-to-edge [G9]. Expo SDK 54+ always enables it [E3]. System bar colour APIs are deprecated [G8]. | No opt-out and no status-bar or nav-bar colour config. Generated `gradle.properties` has `edgeToEdgeEnabled=true`. Insets come from `react-native-safe-area-context` in `src/ui/Screen.tsx`, `Sheet.tsx`, `Toast.tsx`, `features/TabBar.tsx`, `app/_layout.tsx` and `app/welcome.tsx`. Not checked on a device: gesture vs 3-button navigation, Arabic RTL, and Arabic line heights (`elegantTextHeight` is ignored at API 36 [G9]). | `CODE_READY` | verified by config inspection |
| 1.7 | Predictive back | [verified-official] Platform behaviour at API 36: `onBackPressed` and `KEYCODE_BACK` are no longer delivered [G9]. The Expo key defaults to `false` [E4]. No Play policy requiring predictive back was found (**to confirm**). | **Enabled:** `predictiveBackGestureEnabled: true` → generated manifest has `android:enableOnBackInvokedCallback="true"`. There is no `BackHandler` or `beforeRemove` use in `apps/mobile/src`. **Needs an on-device Android 16 test** of sheets, modals, onboarding, checkout and delete-account. Documented fallback: set the key to `false`. | `CODE_READY` | verified by config inspection |
| 1.8 | Large screens | [verified-official] At API 36, orientation and resizability locks are ignored on displays ≥ 600dp [G10]. | `orientation: 'portrait'`. Tablet and foldable layouts were never checked. | `CODE_READY` (portrait lock only) | not verified (layouts) |
| 1.9 | HTTPS only | [verified-official] Cleartext traffic is off by default on Android 9+ [E8]. | `app.config.ts` refuses preview/production builds without a public `https://` `EXPO_PUBLIC_API_URL`. The generated manifest has no `usesCleartextTraffic`. | `CODE_READY` | verified by config inspection |
| 1.10 | `allowBackup=false` | Project rule to keep medical data out of Android cloud backup. Not a Play requirement in the evidence. | `android.allowBackup: false`. Generated manifest has `android:allowBackup="false"`. **To confirm** (engineering note, not in the evidence): `expo-secure-store` adds `dataExtractionRules`, whose `device-transfer` block includes shared preferences except `SecureStore`. Confirm that no health data lives in SharedPreferences. | `CODE_READY` | verified by automated test (`scripts/release/check.ts`); verified by config inspection |
| 1.11 | Versioning and build image | [verified-official] Remote versioning with `autoIncrement` [E7]. The `latest` image alias moves; `sdk-57` maps to `ubuntu-26.04-jdk-17-ndk-r27b-sdk-57` [E6]. | `cli.appVersionSource: "remote"` with `autoIncrement: true` on store profiles; no `versionCode` in `app.config.ts`. **Gap:** `eas.json` `base.android.image` is still `"latest"`. Pin it to `"sdk-57"`. | `CODE_READY` (versioning) · none (gap) (image pin) | verified by config inspection |
| 1.12 | Package name and variants | [verified-official] Set `APP_VARIANT` per profile and switch the package from it [E12]. | Production `com.aliagroup.dressmywound`, preview `.staging`, development `.dev` (`app.config.ts`). The ID is **proposed**: confirm the company controls the domain, because it is permanent once used. `APP_VARIANT` defaults to `development` when unset, and every `eas.json` profile sets it. Note: `submit.preview-store` targets Play internal testing with the **`.staging`** package. That would be a separate Play app with its own listing, App-content forms and package registration. | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` | verified by config inspection |

---

## 2. Permissions

### 2.1 Permissions in the final 2026-10-15 release APK (aapt2)

| Permission | Origin | Disposition |
|---|---|---|
| `android.permission.INTERNET` | app template, `expo-file-system` | kept |
| `android.permission.VIBRATE` | `expo-haptics` | kept |
| `android.permission.ACCESS_NETWORK_STATE` | `expo-network` | kept |
| `android.permission.ACCESS_WIFI_STATE` | `expo-network` | kept |
| `com.aliagroup.dressmywound.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | `androidx.core` (signature-level, app-internal) | kept |
| `com.android.vending.BILLING` | `expo-iap` (Google Play Billing) | kept — required for in-app subscriptions |
| `android.permission.USE_BIOMETRIC` | `androidx.biometric` via `expo-secure-store` (biometric mode unused) | **blocked** — absent from the built APK (it was present in the superseded 2026-10-14 build) |
| `android.permission.USE_FINGERPRINT` | same | **blocked** — absent from the built APK |

The final build contains exactly the six kept permissions above. `scripts/release/verify-android.sh` allows exactly that set and fails on anything else.

### 2.2 Permission policy items

| # | Item | Requirement | Repo / build evidence | Status | Verification |
|---|---|---|---|---|---|
| 2.1 | Blocked permissions | [verified-official] `android.blockedPermissions` is the only way to strip permissions that libraries add [E5]. | `android.permissions: []`. The block list has 18 entries: `ACCESS_BACKGROUND_LOCATION`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `CAMERA`, `RECORD_AUDIO`, `READ/WRITE/MANAGE_EXTERNAL_STORAGE`, `READ_MEDIA_IMAGES/VIDEO/AUDIO`, `READ_MEDIA_VISUAL_USER_SELECTED`, `SYSTEM_ALERT_WINDOW`, `USE_BIOMETRIC`, `USE_FINGERPRINT`, `READ_CONTACTS`, `READ_PHONE_STATE`, `com.google.android.gms.permission.AD_ID`. `check.ts` asserts 7 of them. `com.android.vending.BILLING` is correctly **not** blocked [E5]. | `BUILT` (absent from the 2026-10-14 APK) · `CODE_READY` (biometric block) | verified by automated test (`scripts/release/check.ts`); verified by native build inspection |
| 2.2 | Photo picker / media | [verified-official] Apps targeting API 33+ may request `READ_MEDIA_IMAGES/VIDEO` only when the system Photo Picker is not enough [G11]. | **No media permissions, and no photo or camera feature yet**: there is no image-picker or camera code in `apps/mobile/src`. When wound photos ship, use the system Photo Picker, keep `READ_MEDIA_*` blocked, and unblock `CAMERA` only with a disclosure (2.4). | `BUILT` | verified by native build inspection; verified by automated test (`scripts/release/check.ts`) |
| 2.3 | Background location | [verified-official] Needs a declaration form, a video and a prominent disclosure [G12]. | **No location of any kind.** `ACCESS_BACKGROUND_LOCATION` and the fine/coarse permissions are blocked. No declaration is needed. | `BUILT` | verified by native build inspection; verified by automated test (`scripts/release/check.ts`) |
| 2.4 | Health-sensitive permissions | [verified-official] `CAMERA`, location, `RECORD_AUDIO`, calendar and SMS need a prominent disclosure and affirmative consent [G13]. | None requested. Any future camera or location feature must ship with its own disclosure and consent screen. | `BUILT` | verified by native build inspection |

---

## 3. Developer account, signing and testing tracks

| # | Item | Requirement | Repo evidence | Status | Verification |
|---|---|---|---|---|---|
| 3.1 | Account type | [verified-official] Health and medical apps **must** use a Play Console **Organization** account, which needs a D-U-N-S number matching the Dun & Bradstreet profile [G14] [G15]. This is a requirement, not just a recommendation. | No account exists. The legal entity name is a placeholder (`<ALIA_GROUP_LEGAL_ENTITY_TO_CONFIRM>` in `store/metadata/*.json`, `[Legal entity name of Alia Group — to be confirmed]` in `packages/shared/src/legal.ts`). | `NEEDS_ACCOUNT_ACTION` · `NEEDS_LEGAL_APPROVAL` | not verified |
| 3.2 | 12 testers for 14 days | [verified-official] Applies only to **personal** accounts created after **2023-11-13**: a closed test with ≥ 12 testers opted in for 14 consecutive days before production access [G16]. That Organization accounts are exempt is an inference (**to confirm**). | With an Organization account (3.1), plan for the rule not to apply. If a personal account were used by mistake, budget 14+ days plus the production-access review. | `NEEDS_ACCOUNT_ACTION` | not verified |
| 3.3 | Android developer verification | [verified-official] Register app package names for developer verification. Since **2026-09-30**, unregistered Play packages are removed [G17]. Auto-registration of apps created in Play Console and global device enforcement in 2027 come from a search summary (**to confirm**) [G18]. | Register `com.aliagroup.dressmywound`, and `.staging` too if it is ever uploaded (1.12). | `NEEDS_ACCOUNT_ACTION` | verified by config inspection (package IDs) |
| 3.4 | Play App Signing and upload key | [verified-official] App bundles require Play App Signing. The developer holds an upload key; new apps get a Google-generated signing key by default. The key choice is fixed once a release reaches open testing or production [G7]. | **No keys in the repo.** `.gitignore` excludes `*.jks`, `*.keystore` (except `debug.keystore`), `*.p12`, `*.p8` and `service-account*.json`, and `check.ts` fails on committed keys or service-account JSON. EAS will create and hold the upload keystore (`eas credentials`). Local builds are debug-signed. App Links: `apps/site/build.ts` writes `.well-known/assetlinks.json` only when `ANDROID_CERT_SHA256` is set. Use the **Play app-signing** SHA-256 from Play Console → App integrity, not the upload key. `app.config.ts` adds the verified intent filter only when `APP_LINK_DOMAIN` is set. | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` | verified by automated test (`scripts/release/check.ts`); verified by native build inspection (debug certificate) |
| 3.5 | Testing tracks | [verified-official] Data safety is required for closed, open and production tracks; internal-testing-only apps are exempt [G26]. The Health apps declaration is required for any app on a closed, open or production track [G29]. | `eas.json` `submit.production` and `submit.preview-store` → `track: internal`, `releaseStatus: draft`. No Play service-account key is referenced (it must stay out of the repo). Plan: **internal** (team) → **closed** (pilot, after 5.6 and 5.7 are filed) → **production**. Whether the first upload must be manual in Play Console is not in the evidence (**to confirm**). | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` | verified by config inspection |

---

## 4. Store listing (`store/metadata/en.json` · `ar.json` · `store/assets/google-play/`)

| # | Item | Requirement | Repo evidence | Status | Verification |
|---|---|---|---|---|---|
| 4.1 | Title | [verified-official] ≤ 30 characters, one per language [G19]. No emoji, ALL CAPS, price or ranking words [G20]. | EN `Dress My Wound` (14), AR `غير لي` (6). | `STORE_METADATA_READY` | verified by automated test (`scripts/release/check.ts`) |
| 4.2 | Short description | [verified-official] ≤ 80 characters [G19]. No "Best/#1/Top/New/Free", calls to action, emoji or line breaks [G21]. | EN 77 characters, AR 62. Plain and factual. | `STORE_METADATA_READY` | verified by automated test (`scripts/release/check.ts`) |
| 4.3 | Full description | [verified-official] ≤ 4000 characters [G19]. Non-device health apps **must** state in the description that the app is *"not a medical device and does not diagnose, treat, cure, or prevent any medical condition"* and remind users to consult a healthcare professional [G28]. | EN 965 characters, AR 778, both with emergency number 123. **Gap:** both say only "does not diagnose or treat and is not an emergency service". The verbatim [G28] phrase and the consult-a-healthcare-professional reminder are **missing** in EN and AR, and `check.ts` only tests for "123". | `NEEDS_LEGAL_APPROVAL` (Arabic wording) · none (gap) (text + check) | verified by automated test (`scripts/release/check.ts`: length, 123); gap verified by config inspection |
| 4.4 | App icon | [verified-official] 512×512, 32-bit PNG with alpha, sRGB, ≤ 1024 KB, full square with no pre-rounded corners or shadow [G22]. | `icon-512.png`: 512×512 RGBA, 11 KB. It is a **temporary placeholder**: `packages/tokens/src/brand.ts` is `PROVISIONAL`, with `productMark: 'TEMPORARY_PLACEHOLDER'` and no official Alia Group or TetraSol logo. | `STORE_METADATA_READY` (format) · `NEEDS_OFFICIAL_ASSETS` | verified by automated test (`scripts/release/check.ts`) |
| 4.5 | Feature graphic | [verified-official] Required to publish. 1024×500, JPEG or 24-bit PNG with no alpha [G21]. | `feature-graphic-1024x500.png`: 1024×500 RGB (24-bit), **placeholder** brand. One version only; the evidence recommends an RTL Arabic variant. | `STORE_METADATA_READY` (format) · `NEEDS_OFFICIAL_ASSETS` | verified by automated test (`scripts/release/check.ts`) |
| 4.6 | Screenshots | [verified-official] ≥ 2 to publish, ≤ 8 per device type. JPEG or 24-bit PNG, 320–3840 px, long side ≤ 2× short side. ≥ 4 at ≥ 1080 px, 9:16, for recommendation formats [G21]. | **None exist.** Capture 4–8 per locale (EN, and AR in RTL) from a native build with synthetic data at 1080×1920. Raw 1080×2400 captures break the 2:1 rule. | `NEEDS_OFFICIAL_ASSETS` | not verified |
| 4.7 | Contact details | [verified-official] A support email is required; phone and website are optional and shown publicly [G19]. | Placeholders: `https://<SUPPORT_DOMAIN_TO_CONFIRM>/`. `apps/site` prints "[support email — to be confirmed]" until `SUPPORT_EMAIL` is set. `store/metadata` has no email field yet. | `NEEDS_ACCOUNT_ACTION` | verified by config inspection |
| 4.8 | Languages | [verified-official] One localized title per language; Arabic as `ar` [G19]. | `en.json` locale `en-GB`, `ar.json` locale `ar-SA`. Enter the Arabic text as Play's Arabic listing. | `STORE_METADATA_READY` | verified by config inspection |
| 4.9 | Category and tags | [verified-official] Category definitions; up to 5 tags, set in Store settings [G23]. | Recommendation: **Medical** (see 4.9a). | `NEEDS_ACCOUNT_ACTION` | not verified |

### 4.9a Category: Medical vs Health & Fitness

| | Medical | Health & Fitness |
|---|---|---|
| Play definition [G23] | "Drug and clinical references, calculators, handbooks for healthcare providers, medical journals and news" | "Personal fitness, workout tracking, diet and nutritional tips, health and safety" |
| What the shipped code does | Personal and family health records (allergies, conditions, medications, surgeries, blood type), verified doctor and nurse discovery, a clinician dashboard, a wound-care product store | No fitness, workout or diet feature |
| Evidence note | The evidence implication on [G23] notes that Google's health-app guidance names telehealth, patient portals and disease management as medical apps | — |

**Recommendation: Medical.** Neither definition fits word for word. The product is health records plus licensed clinicians, which is closer to Medical, and nothing in it is fitness-related. It also matches the Apple checklist, so both stores use the same category. The category does **not** change the Health apps declaration (5.7), which every app must complete.

---

## 5. App content (Play Console → Policy → App content)

Order: ads, app access and the privacy policy must be done before "Target audience and content" [G24].

| # | Item | Requirement | Repo evidence | Status | Verification |
|---|---|---|---|---|---|
| 5.1 | Privacy policy | [verified-official] Must be linked in Play Console **and** in the app. Active, public, not geofenced, not a PDF, labelled as a privacy policy, naming the developer or the app [G27] [G28]. | In the app: Me → Privacy & consent → Legal documents → Privacy policy (`app/settings/privacy.tsx`, `testID=open-privacy-policy`); the consent gate (`app/consent.tsx`) links it too. Web: `apps/site` builds `/privacy` (EN + AR) from the same source, `packages/shared/src/legal.ts`. Status `DRAFT_PENDING_LEGAL_REVIEW`, version `2026-10-draft`. Controller name and privacy contact are placeholders. Not hosted; the domain is a placeholder. | `CODE_READY` · `NEEDS_LEGAL_APPROVAL` · `NEEDS_ACCOUNT_ACTION` | verified by config inspection; consent gate verified by automated test (`e2e/tests/flow-a-patient.spec.ts`, Expo web) |
| 5.2 | Ads | [verified-official] Must be declared before Target audience [G24]. | No ad or analytics SDK in `apps/mobile/package.json`; `AD_ID` is blocked. Answer: **No ads**. | `BUILT` · `NEEDS_ACCOUNT_ACTION` | verified by native build inspection; verified by config inspection |
| 5.3 | App access (reviewer logins) | [verified-official] Give reviewers working credentials for every gated area, with up to 5 instruction sets [G31]. An active demo account is required [G17]. | `apps/api/src/db/seed-review.ts` creates **Patient, Doctor and Nurse** review accounts. They use email + password with `emailVerified = true`, so no OTP is needed. Two-step verification is enforced only on admin routes, so the clinician review accounts are not blocked by it. `account_kind = 'REVIEW'`: they see only synthetic `is_demo` catalogue rows, and real users never see those rows. The script needs `REVIEW_EMAIL_DOMAIN` (a company domain), `REVIEW_ACCOUNT_PASSWORD` (≥ 16 characters, never committed), the owner DB URL and a live production backend. Reviewers may delete an account; re-run the script to recreate it. **No subscriber review account exists:** subscriptions are OFF, Google product IDs are NULL, and the `ADMIN_GRANT` entitlement source has no grant endpoint. | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` | verified by automated test (`apps/api/test/compliance.test.ts`: review isolation; users cannot promote themselves to review accounts) |
| 5.4 | Content rating (IARC) | **to confirm** (official-but-ambiguous): the questionnaire is required for new apps. Egypt is in no listed rating authority, so IARC Generic presumably applies [G24]. | Not started. Answer honestly: health information and records, a product store with checkout (currently **simulated**, `commerce.checkout` OFF), no user-to-user chat in the current code, and digital subscriptions if they are enabled. Redo it if AI or messaging ships. | `NEEDS_ACCOUNT_ACTION` | not verified |
| 5.5 | Target audience | [verified-official] A target age group must be declared. Including children brings in the Families policy [G25] [G24]. | Declare **18+ only**. The Terms say "You must be 18 or older"; the privacy policy says "Accounts are for adults (18+)". Minors exist only as guardian-managed family profiles, enforced in the DB (migration `0006`: `MINOR_REQUIRES_GUARDIAN_BASIS`). **Gap:** no age check on the account holder's own `SELF` profile or at sign-up. Listing assets must not appeal to children. | `CODE_READY` (guardian rule) · `NEEDS_LEGAL_APPROVAL` · `NEEDS_ACCOUNT_ACTION` | verified by automated test (`apps/api/test/patients.test.ts`); SELF-age gap verified by config inspection |
| 5.6 | Data safety | [verified-official] Required for closed, open and production tracks. Must cover third-party SDKs, include Health info, encryption in transit and the deletion question, and needs a privacy policy [G26]. | **Answers: `docs/release/PRIVACY_AND_DATA_DISCLOSURES.md`.** Facts from code: no ads or analytics SDKs. Health data is stored only after explicit consent, enforced in the database. Release builds require an HTTPS API (1.9). Client error reports (`POST /v1/telemetry/client-errors`) carry no user ID or form values. `expo-iap` / Play Billing is the only store SDK. The deletion URL is in 5.8. | `NEEDS_ACCOUNT_ACTION` · `NEEDS_LEGAL_APPROVAL` | verified by automated test (`apps/api/test/compliance.test.ts`: health data blocked until consent); rest not verified |
| 5.7 | Health apps declaration | [verified-official] **Every** app on a closed, open or production track must complete it, even with no health features [G29] [G28]. | Proposed categories in 5.7a. | `NEEDS_ACCOUNT_ACTION` · `NEEDS_LEGAL_APPROVAL` · `NEEDS_REGULATORY_EVIDENCE` | not verified |
| 5.8 | Account deletion | [verified-official] Required: (1) a prominent in-app deletion path and (2) a working **web link** to request deletion without the app. Retained data must be disclosed [G30]. | **In app:** Me → Privacy & consent → Delete account (`app/settings/delete-account.tsx`). It requires re-authentication (password, or a sign-in within 15 minutes for phone-only accounts) and typing `DELETE`. Deletion is immediate and sessions are revoked. It lists deleted vs kept data and warns that a store subscription keeps billing. Server: `POST /v1/me/account-deletion` → `app.delete_my_account`. **Web:** `apps/site` → **`/delete-account`** (EN + AR). It names Dress My Wound / غير لي, gives the in-app path and an email request path, and lists deleted vs retained data. The Play field is `store/metadata/*.json` `google.accountDeletionUrl` = `https://<SUPPORT_DOMAIN_TO_CONFIRM>/delete-account` (**placeholder**). Not hosted; the support email is a placeholder. | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` · `NEEDS_LEGAL_APPROVAL` (retention wording) | verified by automated test (`apps/api/test/compliance.test.ts`: typed confirmation, password, erasure, shared-profile retention, session revocation, ledger retention); verified by automated test (`e2e/tests/flow-f-privacy.spec.ts`, Expo web, not native); phone-only 15-minute path verified by config inspection |
| 5.9 | In-app health reminders | [verified-official] Remind users to consult a healthcare professional [G28]. | The health tab shows `EmergencyNotice` with a `tel:123` button and `MedicalDisclaimer` ("does not diagnose or treat"). The Terms say "Always follow the advice of a qualified clinician." The in-app text never explicitly says "consult a healthcare professional". Only 123 (ambulance) is shown. Its source is official but ambiguous (UK FCDO page), so re-confirm it with the Ministry of Health. Fire and police numbers are deliberately not shown because sources conflicted. | `CODE_READY` · `NEEDS_LEGAL_APPROVAL` | verified by config inspection |

### 5.7a Health apps declaration: proposed selections (final choice by counsel)

| Category [G29] | Proposed | Why (from shipped code) |
|---|---|---|
| Healthcare Services and Management (appointments, telehealth, health records, billing) | **Select** | Personal and family health records; discovery of verified doctors and nurses |
| Diseases and Conditions Management (includes skin care) | **Select (likely)** | Conditions and allergies are recorded; wound-care (TetraSol) store |
| Medication and Treatment Management | **Select (likely)** | Medications are recorded (self-reported) |
| Clinical Decision Support | Do not select now | `clinical.diagnostic_suggestions` is OFF and cannot be enabled without a regulatory evidence reference |
| Medical Device Apps | Do not select unless regulated | `ai.wound_assessment` is OFF. Whether any feature is a medical device under Egyptian Drug Authority rules is unresolved (`NEEDS_REGULATORY_EVIDENCE`). |

Flag gating is verified by automated test (`apps/api/test/compliance.test.ts`: all features OFF by default; HIGH-risk flags need an evidence reference, enforced by a DB CHECK and an API 422). Confirm the category names against the live Play Console form.

---

## 6. Billing (Play Billing vs external gateway)

| # | Item | Requirement | Repo evidence | Status | Verification |
|---|---|---|---|---|---|
| 6.1 | Rail classification and no steering | [verified-official] Physical goods and services must **not** use Play Billing [G33]. Regulated clinical services should not [G34]. Digital purchases must not be steered elsewhere [G33]. Egypt has Play Billing in EGP 0.90–49,000.00 [G35] and no alternative-billing programme [G36]. | `packages/shared/src/billing.ts` `resolvePaymentRail`: physical goods, physical services and 1:1 services → `EXTERNAL_GATEWAY`; digital on Android → `GOOGLE_PLAY_BILLING`, with no override. `mayLinkOutForPayment` is never true for digital purchases in native apps. The subscription screen shows only store prices and store "Manage subscription" links. TetraSol checkout is **simulated**, `commerce.checkout` is OFF and the gateway is not configured. | `CODE_READY` | verified by automated test (`apps/api/test/billing.test.ts`) |
| 6.2 | Play Billing Library version | [verified-official] From 2026-08-31 (extension to 2026-11-01), new apps and updates must use **PBL 8+**. PBL 8 is deprecated on 2027-08-31 and PBL 9 on 2028-08-31. The `com.google.android.play.billingclient.version` manifest entry must survive merging [G32]. | **`expo-iap` 6.0.2 is installed and type-checked**: pinned in `apps/mobile/package.json`, present in `node_modules`, with config plugin `['expo-iap', { android: { store: 'play' } }]`. `openiap-versions.json` sets `google: 4.0.2` → `openiap-google` 4.0.2 → `com.android.billingclient:billing` **9.1.0** [E10] [E11]. The local Gradle cache holds `openiap-google` 4.0.2 and `billing` 9.1.0. IAP needs a dev or store build, not Expo Go [E9]. Still open: confirm `billingclient.version` in the merged manifest of the final AAB (see `RELEASE_STATUS.md`). | `CODE_READY` | verified by config inspection; type-checked (`pnpm typecheck`) |
| 6.3 | Client purchase flow | No evidence requirement beyond 6.1/6.2. | `src/features/billing/useStoreBilling.ts` connects only when `billing.store_subscriptions` is ON. It sends the purchase token to the server and calls `finishTransaction` **only after server verification**. It also implements Restore and Manage (Play subscription deep link). `iap.web.ts` fails closed on web. Never exercised against Play (no account, no products, no device). | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` | verified by config inspection; subscription screen renders in `e2e/tests/a11y.spec.ts` (Expo web; no purchase path) |
| 6.4 | Server verification and RTDN | Entitlements must be server-authoritative (evidence implication on [G32]). The 3-day acknowledgement rule is not a verified finding (**to confirm**). | The server verifies through the Play Developer API (`subscriptionsv2`) and acknowledges after verifying (`apps/api/src/modules/billing/routes.ts`). The RTDN webhook `/webhooks/google/rtdn` checks the Pub/Sub OIDC identity and re-fetches state from Google. Without `GOOGLE_PLAY_PACKAGE_NAME`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64`, `GOOGLE_RTDN_AUDIENCE` and `GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL`, the adapter is **`NOT_CONFIGURED`** and grants nothing. Tests: Google state mapping (unit) and the NOT_CONFIGURED refusal. Grant, account binding, refund, duplicate and stale-event handling are tested with an **Apple** fixture only. The Google verify, acknowledge and RTDN routes are not exercised by tests. | `CODE_READY` · `NEEDS_ACCOUNT_ACTION` (service account, Pub/Sub topic, RTDN) | verified by automated test (`apps/api/test/billing.test.ts`); Google routes verified by config inspection |
| 6.5 | Products and feature flag | — | `billing_plan_offers.google_product_id` and `google_base_plan_id` are **NULL** (migration `0007`), so nothing is purchasable. `billing.store_subscriptions` is **OFF**. Admins can switch it on the admin console Feature flags page (`apps/admin/src/app/features/page.tsx`; ADMIN role only, two-step verification enforced when `MFA_ENFORCEMENT=required`, which production config validation demands). Reference prices (Gold 299 / 2,990 EGP, Platinum 699 / 6,990 EGP) are within the Egypt range [G35]. | `NEEDS_ACCOUNT_ACTION` | verified by automated test (`apps/api/test/compliance.test.ts`: all flags OFF by default); verified by config inspection |
| 6.6 | Gold/Platinum mixing digital and real-world perks | **to confirm** (official-but-ambiguous): Play Billing is required when a SKU is more digital than physical, or is marketed as digital [G34]. | Gold and Platinum list `REAL_WORLD` benefits (priority matching, reduced platform fees, priority support). The classification needs written confirmation from Play policy support. | `NEEDS_STORE_REVIEW` · `NEEDS_LEGAL_APPROVAL` | not verified |

---

## 7. AI-Generated Content policy (only relevant if an AI flag is enabled)

| Requirement | Repo evidence | Status | Verification |
|---|---|---|---|
| **to confirm** (in the evidence only as the critique's "additionally verified" item, not a `[verified-official]` finding): apps whose central feature is AI generation, including chatbots, must offer in-app reporting or flagging of offensive AI output without leaving the app [G37]. | **No AI feature ships.** The patient home shows only a "not configured" card. `ai.assistant` and `ai.wound_assessment` are OFF and `HIGH` risk, and cannot be enabled without an `evidence_ref` (DB CHECK in migration `0006` plus an API 422). Before enabling either: add in-app report/flag, redo IARC (5.4), update Data safety (5.6) and the Health apps declaration (5.7), and name the AI provider in the privacy policy. | `NEEDS_REGULATORY_EVIDENCE` | verified by automated test (`apps/api/test/compliance.test.ts`) |

---

## 8. Dated upcoming requirements (not blocking today)

| When | Requirement [source] | Impact here |
|---|---|---|
| 2027-01-27 | API 37 targets: `READ_CONTACTS` needs a declaration; one-time precise location must use the location button [G11] [G12] | `READ_CONTACTS` is blocked; no location is used |
| 2027-02-01 | Updates without 16 KB support cannot be released [G4] (official-but-ambiguous timeline) | Already aligned (1.5); re-check every AAB |
| 2027-02 | Memory thresholds; ≥ 25% DEX optimization for apps with > 10 MB DEX [G3] | R8 is off (`enableMinifyInReleaseBuilds` defaults to false [E8]). Check DEX size in the bundle explorer after the first upload. |
| 2027-04 | Apps with sign-in must support zero-tap restore (Restore Credentials API). Healthcare apps may request an exemption [G3]. | Decide: implement it, or file the exemption before enforcement |
| 2027-08-31 | PBL 8 deprecated [G32] | PBL 9.1.0 via `expo-iap` is fine until 2028-08-31 |
| 2027-09-30 | Expanded billing choice reaches "Rest of World" [G36] (forward-looking) | Do not plan pricing around it |

---

## 9. Summary by owner

- **Completed implementation (code/config):** target and min SDK, ABIs, AAB profiles, permission blocking (incl. biometrics), `allowBackup=false`, HTTPS-only release builds, edge-to-edge insets, predictive-back opt-in, in-app and web account deletion, privacy center with consent switches, consent gate, review-account seeding, payment-rail classification, `expo-iap` (PBL 9.1.0) client, server-side Play verification and RTDN, flag gating of regulated features.
- **Verified by automated test:** `apps/api/test/compliance.test.ts` (11), `apps/api/test/billing.test.ts` (10), `apps/api/test/patients.test.ts`, `scripts/release/check.ts` (46 checks), Playwright on **Expo web** (`flow-a`…`flow-f`, `rtl-arabic`, `a11y`). `scripts/release/verify-android.sh` is configured in CI job `android-native`.
- **Verified by native build inspection (final 2026-10-15 APK with `expo-iap`):** targetSdk 36, minSdk 24, ABIs, 16 KB alignment, permission set (incl. `com.android.vending.BILLING`, no biometric permissions), labels, `allowBackup=false`, debug signing. Re-run `scripts/release/verify-android.sh` on every EAS-built artifact.
- **Requires developer or other accounts:** Organization Play account + D-U-N-S, package registration, EAS project and upload key, Play signing cert in `assetlinks.json`, Play service account for `eas submit`, Google Cloud service account + Pub/Sub RTDN, product and base-plan IDs, support domain and email, hosting `apps/site`, review-account domain and password, production API URL, all App content forms, category and tags.
- **Requires official assets:** official Alia Group / TetraSol logos (none drawn anywhere; tokens `PROVISIONAL`), final 512 icon and feature graphic (current files are temporary placeholders), EN and AR phone screenshots.
- **Requires legal approval:** privacy policy, terms, health consent, medical disclaimer (all `DRAFT_PENDING_LEGAL_REVIEW`), legal entity name, the verbatim [G28] disclaimer in EN and AR, Data safety answers, retention wording, Health apps declaration categories, 18+ policy and the missing SELF-age check, hybrid-tier classification.
- **Requires regulatory evidence:** whether any feature is a medical device (EDA); Ministry of Health licensing before `care.home_visit_booking` and `care.video_consultation` (OFF); any AI feature (OFF); confirmation of the 123 emergency number.
- **Requires Google review:** first-release review, App content forms, the Health apps declaration, Play policy support's view on hybrid tiers, and production access if a personal account were used.

### Device tests needed before any line can be marked as tested on a device

Use a rebuilt, **EAS-signed** AAB through internal testing, on a physical Android 16 phone and a 16 KB emulator image (`adb shell getconf PAGE_SIZE` → `16384` [G4]):

1. Launch, then crash-free navigation through Patient, Doctor and Nurse.
2. Predictive back on sheets, modals, onboarding, checkout and delete-account.
3. Edge-to-edge with gesture and 3-button navigation, in EN and AR (RTL), including Arabic text clipping.
4. Account deletion end to end, plus the web deletion page on the hosted domain.
5. Play Billing sandbox purchase, restore and manage, once products, the service account and the flag exist.
6. A tablet or foldable sanity check (1.8).

---

## Official sources

All are `[verified-official]` in the evidence file unless marked **to confirm**.

- **G1** — https://developer.android.com/google/play/requirements/target-sdk
- **G2** — https://support.google.com/googleplay/android-developer/answer/11926878
- **G3** — https://support.google.com/googleplay/android-developer/answer/17492799?hl=en
- **G4** — https://developer.android.com/guide/practices/page-sizes (verification methods verified-official; 16 KB timeline official-but-ambiguous, **to confirm**)
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
- **G18** — https://developer.android.com/developer-verification/guides/google-play-console (**to confirm**: critique "additionally verified", search summary only)
- **G19** — https://support.google.com/googleplay/android-developer/answer/9859152
- **G20** — https://support.google.com/googleplay/android-developer/answer/9898842
- **G21** — https://support.google.com/googleplay/android-developer/answer/9866151
- **G22** — https://developer.android.com/distribute/google-play/resources/icon-design-specifications
- **G23** — https://support.google.com/googleplay/android-developer/answer/9859673
- **G24** — https://support.google.com/googleplay/android-developer/answer/9859655 (target-audience rules verified-official; content-rating finding official-but-ambiguous, **to confirm**)
- **G25** — https://support.google.com/googleplay/android-developer/answer/9867159?hl=en
- **G26** — https://support.google.com/googleplay/android-developer/answer/10787469?hl=en
- **G27** — https://support.google.com/googleplay/android-developer/answer/10144311
- **G28** — https://support.google.com/googleplay/android-developer/answer/16679511?hl=en
- **G29** — https://support.google.com/googleplay/android-developer/answer/14738291?hl=en
- **G30** — https://support.google.com/googleplay/android-developer/answer/13327111?hl=en
- **G31** — https://support.google.com/googleplay/android-developer/answer/9859455
- **G32** — https://developer.android.com/google/play/billing/deprecation-faq
- **G33** — https://support.google.com/googleplay/android-developer/answer/9858738?hl=en
- **G34** — https://support.google.com/googleplay/android-developer/answer/10281818?hl=en (clinical-services rule verified-official; mixed digital/physical SKU rule official-but-ambiguous, **to confirm**)
- **G35** — https://play.google.com/supported-locations?hl=en
- **G36** — https://support.google.com/googleplay/android-developer/answer/16954621?hl=en
- **G37** — https://support.google.com/googleplay/android-developer/answer/13985936 (**to confirm**: critique "additionally verified", not a tagged finding)
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
- **E12** — https://docs.expo.dev/build-reference/variants/

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
[E12]: https://docs.expo.dev/build-reference/variants/
