# Apple App Store and TestFlight checklist: Dress My Wound | غير لي

Verified on: 2026-10-15

> **Overall: NOT ready for submission.** No iOS binary exists. This environment has no macOS or Xcode, and there is no Apple Developer account. No line in this document is `DEVICE_TESTED`, `READY_FOR_SUBMISSION`, `SUBMITTED` or `APPROVED`. The iOS facts below come from three sources only: the generated native project (`expo prebuild --platform ios --no-install`), source and config files, and automated tests. None of them come from a compiled or running app.

- Product name: English **Dress My Wound**, Arabic **غير لي** (never "غيرني"). The source of truth is `packages/shared/src/brand.ts`. `scripts/release/check.ts` rejects any forbidden spelling.
- Companion documents: `docs/release/PRIVACY_AND_DATA_DISCLOSURES.md` (privacy label and data inventory), `docs/release/PAYMENT_COMPLIANCE.md` (IAP and payment rails), `docs/release/HEALTHCARE_REVIEW.md` and `docs/release/RELEASE_STATUS.md` (build outcomes). The code refers to all four. None of them was in `docs/release/` when this checklist was written. If any is still missing at submission time, treat it as an open item.

---

## 0. How to read this document

**Status taxonomy.** Statuses are used exactly as listed: `CODE_READY` · `BUILT` · `DEVICE_TESTED` · `STORE_METADATA_READY` · `NEEDS_ACCOUNT_ACTION` · `NEEDS_REGULATORY_EVIDENCE` · `NEEDS_LEGAL_APPROVAL` · `NEEDS_OFFICIAL_ASSETS` · `NEEDS_STORE_REVIEW` · `READY_FOR_SUBMISSION` · `SUBMITTED` · `APPROVED`.
- A line can carry several statuses: the stage it has reached, then whatever still blocks it.
- **open (not CODE_READY)** means engineering work is still outstanding, so the line has not reached any status yet. All open lines are collected again in §16.
- **not BUILT** means no iOS binary exists for that item.

**Verification labels:**
- **verified by automated test (file)**: a named test in the repo asserts the item, and the test passed on 2026-10-15.
- **verified by native build inspection**: for iOS, this means only the files that `expo prebuild --platform ios --no-install` generated in `apps/mobile/ios/` (`Info.plist`, `ar.lproj`/`en.lproj` `InfoPlist.strings`, `PrivacyInfo.xcprivacy`, `project.pbxproj`, `DressMyWound.entitlements`, `Images.xcassets`). That output dates from 2026-10-14 13:41 UTC, which is **before `expo-iap` was added** to `app.config.ts`. No `.ipa` exists and `pod install` never ran.
- **verified by config inspection**: read from source or config.
- **not verified**.

**Requirements.** A requirement appears here only when `docs/release/evidence/STORE_REQUIREMENTS_EVIDENCE.md` (verified 2026-10-14) rates it **[verified-official]**, and its official URL is cited next to it. Everything else is labelled **to confirm**.

---

## 1. Headline blockers

| # | Blocker | Status |
|---|---|---|
| 1 | No Apple Developer Program **Organization** account for the legal entity that provides the service (5.1.1(ix)). Enrollment needs a D-U-N-S number and a public website on the organization's domain (§6, §15). | NEEDS_ACCOUNT_ACTION |
| 2 | Several values are still placeholders: the legal entity name (`[Legal entity name of Alia Group — to be confirmed]`, `<ALIA_GROUP_LEGAL_ENTITY_TO_CONFIRM>`), the support domain (`<SUPPORT_DOMAIN_TO_CONFIRM>`), the support/privacy email, the review contact `+20` phone, the Apple Team ID (`<APPLE_TEAM_ID>`) and the store product IDs (`apple_product_id` is `NULL` for every offer). | NEEDS_ACCOUNT_ACTION, NEEDS_LEGAL_APPROVAL |
| 3 | No iOS build exists, so nothing has gone to TestFlight or been tested on a device. `eas.json` still uses `ios.image: "latest"` (should be pinned), and the iOS prebuild has not been re-run since `expo-iap` was added. | not BUILT; open (not CODE_READY) |
| 4 | Legal texts are `DRAFT_PENDING_LEGAL_REVIEW` (`packages/shared/src/legal.ts`, version `2026-10-draft`). The age rating, export-compliance and privacy-label answers also need sign-off. | NEEDS_LEGAL_APPROVAL |
| 5 | The app icon (light / dark / tinted) and splash use the **official Dress My Wound artwork** supplied 2026-10-28, vectorised from the reference images (`brandConfig.assets.productMark = 'OFFICIAL'`; BRAND_IDENTITY §4.2). The original vector handoff was not received and the renders await brand-owner sign-off. No Alia Group logo is drawn anywhere. No iOS screenshots exist. | NEEDS_OFFICIAL_ASSETS |
| 6 | Reviewer data gap: on the production backend, review accounts would see an **empty TetraSol store and no nursing services** (§13). | open (not CODE_READY) |
| 7 | Me > Plans & subscription shows Gold and Platinum while nothing can be bought, because `billing.store_subscriptions` is off and there are no product IDs. Either hide the screen or ship working IAP (§8). | open (not CODE_READY) |
| 8 | Review-risk UI: the "Assistant name" row appears while `ai.assistant` is off, and the Me > System status screen tells end users that integrations are not configured (§7). | open (not CODE_READY) |

---

## 2. Toolchain and upload rules

| Item | Requirement (source) | Project state | Status | Verified |
|---|---|---|---|---|
| Xcode 26 / iOS 26 SDK | **[verified-official]** Since 2026-04-28, every upload must be built with Xcode 26+ and the iOS 26 SDK. https://developer.apple.com/news/upcoming-requirements/ | Expo SDK 57 needs Xcode 26.4+ (**[verified-official]** https://docs.expo.dev/versions/latest/). The EAS image alias `sdk-57` is `macos-tahoe-26.5-xcode-26.6` (Xcode 26.6) (**[verified-official]** https://docs.expo.dev/build-reference/infrastructure/). `apps/mobile/eas.json` has `base.ios.image: "latest"`, and that alias moves to newer images. **Pin it to `"sdk-57"`.** | open (not CODE_READY) for the pin; NEEDS_ACCOUNT_ACTION for the build | verified by config inspection |
| April 2027 rule | **[verified-official]** From April 2027, uploads must use the iOS & iPadOS 27 SDK and target iOS 15 or later. Apple names the month only; the exact day is **to confirm**. https://developer.apple.com/app-store/submitting/ and https://developer.apple.com/news/?id=k1mtkt1k | Before April 2027, either upgrade to Expo SDK 58 or stay on SDK 57 and set `expo-build-properties` `ios.enableSceneSupport: true`. An SDK 57 app built with Xcode 27 without scene support does not launch correctly on iOS 27 (**[verified-official]** https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md#staying-on-sdk-57-with-xcode-27). iPhone Duo screenshots from April 2027 are **to confirm** (official-but-ambiguous, https://developer.apple.com/news/?id=kkphp5qo). | open (not CODE_READY), backlog | not verified |
| Deployment target | **[verified-official]** Since 2026-09-09, apps must target iOS 13+. https://developer.apple.com/news/upcoming-requirements/ | `IPHONEOS_DEPLOYMENT_TARGET = 16.4` (the SDK 57 floor). It already meets the April 2027 floor of iOS 15. Do not lower it. | CODE_READY | verified by native build inspection |
| Version and build number | **[verified-official]** With `cli.appVersionSource: "remote"`, EAS manages build numbers. https://docs.expo.dev/build-reference/app-versions/ | `version: '1.0.0'`, which becomes `CFBundleShortVersionString`. `production` and `preview-store` set `autoIncrement: true`. Run `eas build:version:sync` before any local native build. | CODE_READY | verified by config inspection |
| Developer Program License Agreement | **to confirm** (official-but-ambiguous): an updated DPLA was published 2026-10-13, and the Account Holder should accept it. https://developer.apple.com/news/?id=17mwd36z | Accept it after enrollment. | NEEDS_ACCOUNT_ACTION | not verified |

---

## 3. App identity

### 3.1 Bundle identifiers (`apps/mobile/app.config.ts`)

| `APP_VARIANT` | EAS profiles | Bundle ID | URL schemes in the build | Home-screen name EN / AR |
|---|---|---|---|---|
| `production` | `production` | `com.aliagroup.dressmywound` | `dressmywound`, `com.aliagroup.dressmywound` (Expo also adds the bundle ID as a scheme) | Dress My Wound / غير لي |
| `preview` | `preview`, `preview-store` | `com.aliagroup.dressmywound.staging` | `dressmywound-staging` | Dress My Wound Beta / غير لي تجريبي |
| `development` | `development`, `development-simulator` | `com.aliagroup.dressmywound.dev` | `dressmywound-dev` | Dress My Wound Dev / غير لي تطوير |

- [ ] **The ID is only a proposal.** `com.aliagroup.dressmywound` still needs two confirmations: that the company controls the matching domain, and that the ID is free in App Store Connect. Treat it as permanent once used (per the `app.config.ts` comment; **to confirm** in App Store Connect). You can override it without code changes through `APP_ID_BASE`. The AASA template (§4) hard-codes the production ID, so edit it too if you override. Status: CODE_READY, NEEDS_ACCOUNT_ACTION. Verified by native build inspection (`PRODUCT_BUNDLE_IDENTIFIER`).
- [ ] `APP_VARIANT` defaults to `development` when unset, which is the opposite of Expo's example. Every `eas.json` build profile sets it, but `eas submit`, `expo config` and CI must also export `APP_VARIANT=production` (**[verified-official]** variants pattern, https://docs.expo.dev/build-reference/variants/). Status: CODE_READY. Verified by config inspection.
- [ ] A TestFlight build from `preview-store` carries the `.staging` ID, so it needs its **own** App Store Connect app record and its own IAP products (an inference, **to confirm**). Recommendation: send the `production` profile to TestFlight. Status: NEEDS_ACCOUNT_ACTION. Not verified.
- [ ] Custom-scheme links can open any Expo Router screen. None of them can act destructively on its own: account deletion still needs the password (or a sign-in within the last 15 minutes) plus the typed word `DELETE`. Status: CODE_READY. Verified by config inspection (`apps/api/src/modules/compliance/routes.ts`) and by automated test (`apps/api/test/compliance.test.ts`: "requires typed confirmation and the current password").

### 3.2 Names, device family, orientation, icon, launch screen, RTL

| Item | Requirement (source) | Project state | Status | Verified |
|---|---|---|---|---|
| Localized home-screen name | Localized display names through Expo `locales` (**[verified-official]** https://docs.expo.dev/guides/localization/) | `en.lproj` sets `CFBundleDisplayName = "Dress My Wound"` and `ar.lproj` sets `CFBundleDisplayName = "غير لي"`. `CFBundleAllowMixedLocalizations = true`; `CFBundleLocalizations = [ar, en]`. | CODE_READY | verified by native build inspection; verified by automated test (`scripts/release/check.ts`: "Arabic display name is غير لي") |
| Store app name | **[verified-official]** 2 to 30 characters, localized. It can be edited only until the app is submitted, and after that only with a new version. https://developer.apple.com/help/app-store-connect/reference/app-information/app-information | EN 14 characters, AR 6 characters (`store/metadata/*.json`) | STORE_METADATA_READY | verified by automated test (`scripts/release/check.ts`) |
| Home-screen truncation risk | **to confirm.** The evidence has no Home Screen label limit. | "Dress My Wound" is 14 characters and 3 words, so iOS may shorten it with "…" on narrow devices or at large text sizes. "غير لي" carries little risk. The Beta/Dev names are longer, but they are internal only. Check on the smallest supported iPhone at default and large text. If the name truncates, the brand owner decides whether the home-screen name may differ from the store name. | CODE_READY | not verified |
| iPhone only | **[verified-official]** iPad screenshots are needed only when the app runs on iPad. https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications. Guideline 2.4.1 says iPhone apps *should* run on iPad when possible; it does not require it. https://developer.apple.com/app-store/review/guidelines/ | `supportsTablet: false` gives `TARGETED_DEVICE_FAMILY = "1"`. `UIRequiredDeviceCapabilities = [arm64]`. | CODE_READY | verified by native build inspection; verified by automated test (`scripts/release/check.ts`: "iPhone only") |
| Mac (Apple silicon) and Apple Vision Pro availability | **to confirm** (not in the evidence) | Not tested on those platforms. Recommendation: turn off availability in App Store Connect until it has been tested. | NEEDS_ACCOUNT_ACTION | not verified |
| Orientation | The evidence has no requirement. | `orientation: 'portrait'` gives `UISupportedInterfaceOrientations` = Portrait and PortraitUpsideDown. | CODE_READY | verified by native build inspection |
| App icon | **[verified-official]** A square 1024×1024 master with no pre-rounded corners; the system applies the mask. https://developer.apple.com/design/human-interface-guidelines/app-icons. The "no alpha in the 1024 icon" rule (ITMS-90717) is **to confirm** because only a secondary source supports it (https://developer.apple.com/forums/thread/795411). The project enforces it anyway. | `apps/mobile/assets/icon.png` and the generated `AppIcon.appiconset/App-Icon-1024x1024@1x.png` are both 1024×1024 RGB with no alpha. The artwork is the official Dress My Wound glass icon (emblem only, no text). Dark and tinted variants are configured through `ios.icon` and generated by prebuild into `AppIcon.appiconset` (`appearances: dark / tinted`). | CODE_READY, NEEDS_OFFICIAL_ASSETS (sign-off of the traced vectors) | verified by automated test (`scripts/release/check.ts`: "App Store icon has no alpha channel"); verified by native build inspection |
| Launch screen | The evidence has no requirement. | `expo-splash-screen` generates `SplashScreen.storyboard`, with `UILaunchStoryboardName = SplashScreen`, background `#FAF7F2` (light) / `#07152A` (dark), and the tagline-free Dress My Wound wordmark (`splash-wordmark.png` / `splash-wordmark-dark.png`, `imageWidth 260`) | CODE_READY | verified by native build inspection |
| Arabic RTL on iOS | **to confirm** (official-but-ambiguous): on SDK 57, verify RTL in a development or EAS build, not in Expo Go. It may also be necessary to declare Arabic as a supported locale. https://docs.expo.dev/guides/localization/ | `ExpoLocalization_supportsRTL = true` and `CFBundleLocalizations` includes `ar`. The `expo-localization` plugin sets no `supportedLocales` option. Whether `CFBundleLocalizations` is enough is **to confirm**. | CODE_READY | verified by automated test (`e2e/tests/rtl-arabic.spec.ts`, Expo **web** build only); native not verified |

---

## 4. Universal Links (conditional: off for v1)

| Item | Requirement (source) | Project state | Status | Verified |
|---|---|---|---|---|
| Associated Domains entitlement | **[verified-official]** Entitlement `applinks:<fqdn>`. AASA served at `https://<fqdn>/.well-known/apple-app-site-association` over HTTPS with no redirects. One file per subdomain. `appIDs` = `<TeamID>.<BundleID>`. Fetched through Apple's CDN. https://developer.apple.com/documentation/xcode/supporting-associated-domains | Added only when `APP_LINK_DOMAIN` is set. It is unset, so `DressMyWound.entitlements` is an empty dict. | CODE_READY (off) | verified by native build inspection |
| AASA file | Same source | `apps/site/well-known/apple-app-site-association.template.json` uses the current `appIDs` + `components` format: `["<APPLE_TEAM_ID>.com.aliagroup.dressmywound"]`, `/app/*`. `apps/site/build.ts` publishes it **only** when a real `APPLE_TEAM_ID` is supplied. It covers the production ID only. | CODE_READY, NEEDS_ACCOUNT_ACTION (Team ID, domain) | verified by config inspection |
| In-app link handling | **[verified-official]** Validate every URL parameter, discard malformed URLs, and never let a link directly delete content or expose sensitive data. https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app | There is **no handler for `/app/*`**: no `+native-intent` or `redirectSystemPath` in `apps/mobile/src/app`. | open (not CODE_READY) | verified by config inspection |

**v1 decision:** ship without Universal Links and leave `APP_LINK_DOMAIN` unset. Enable them only after a validated, auth-gated `/app/*` handler exists.

---

## 5. Privacy

### 5.1 Privacy manifest and required-reason APIs

Requirements, all **[verified-official]**:
- Approved reasons have been required since 2024-05-01: https://developer.apple.com/news/upcoming-requirements/ and https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api
- Invalid manifests are rejected: https://developer.apple.com/documentation/bundleresources/adding-a-privacy-manifest-to-your-app-or-third-party-sdk
- SDKs on Apple's list, **hermes** included, need their own manifest and signature: https://developer.apple.com/support/third-party-SDK-requirements/
- React Native 0.86 merges pod manifests at `pod install`: https://github.com/facebook/react-native/blob/0.86-stable/packages/react-native/scripts/cocoapods/privacy_manifest_utils.rb
- Reason codes: https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype

| Declared in `ios.privacyManifests` (written to `PrivacyInfo.xcprivacy`) | Status | Verified |
|---|---|---|
| `NSPrivacyTracking = false`, `NSPrivacyTrackingDomains = []` | CODE_READY | verified by native build inspection; verified by automated test (`scripts/release/check.ts`: "privacy manifest: no tracking") |
| UserDefaults `CA92.1` · FileTimestamp `C617.1` · SystemBootTime `35F9.1` | CODE_READY | verified by native build inspection |
| DiskSpace `E174.1`. **To confirm** that a dependency actually calls these APIs; keep the declaration only if one does. | CODE_READY | verified by native build inspection |
| Pod aggregation is on: the Podfile passes `privacy_file_aggregation_enabled` unless `apple.privacyManifestAggregationEnabled` is `'false'`, and `Podfile.properties.json` does not set it | CODE_READY | verified by native build inspection |

- [ ] **Re-run the iOS prebuild after `expo-iap`.** `expo-iap` 6.0.2 is installed and type-checked. Its config plugin (`node_modules/expo-iap/plugin/build/withIAP.js`) changes only the iOS **Podfile** (it adds the CocoaPods CDN source) unless `iosAlternativeBilling` is passed, and this app does not pass it. The package ships no `PrivacyInfo.xcprivacy`. Its iOS dependency, the `openiap` pod 4.0.2, was not inspected. Re-run `expo prebuild --platform ios --clean`, diff `Info.plist`, entitlements and `PrivacyInfo.xcprivacy`, then add any reasons that are missing. Status: open (not CODE_READY). Verified by config inspection.
- [ ] **The merged manifest is unverified.** The merge happens at `pod install`, which could not run here. Check the merged manifest from the first EAS build or archive. After the first upload, watch for ITMS-91061 and ITMS-91056 emails. Whether hermes ships a manifest and signature is **to confirm** (left unresolved in the evidence). Status: NEEDS_STORE_REVIEW (Apple's upload processing). Verified: not verified.

### 5.2 Data collection, App Privacy label, tracking, permissions

| Item | Requirement (source) | Project state | Status | Verified |
|---|---|---|---|---|
| Collected data types in the manifest | **[verified-official]** Fixed type and purpose keys. https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests | Name, EmailAddress, PhoneNumber, Health, UserID, OtherUserContent and PurchaseHistory (store subscription transactions) are declared as linked, not tracking, for AppFunctionality. CrashData is declared as **not linked**, matching the anonymous `/v1/telemetry/client-errors` reports. Still **to reconcile** in the PRIVACY doc: how to classify governorate/city, emergency contact, date of birth/sex, session device type/IP, clinician licence data and cart contents. | CODE_READY, NEEDS_LEGAL_APPROVAL | verified by native build inspection; verified by automated test (`scripts/release/check.ts`: "privacy manifest declares health data") |
| App Privacy details (nutrition label) in App Store Connect | **[verified-official]** Required for new apps and updates. It covers third-party code and can be updated without an app update. https://developer.apple.com/app-store/app-privacy-details/ | **Answers: see `docs/release/PRIVACY_AND_DATA_DISCLOSURES.md`.** The starting point that matches the manifest: *Data Linked to You* (App Functionality) = Contact Info (name, email, phone), Health, User ID, Other User Content. *Data Not Linked to You* = Crash Data. *Used to Track You* = none. Cross-check with Xcode Product > Archive > Generate Privacy Report, which needs macOS. | NEEDS_ACCOUNT_ACTION, NEEDS_LEGAL_APPROVAL | not verified |
| ATT / tracking | **[verified-official]** ATT applies only when the app tracks. https://developer.apple.com/app-store/user-privacy-and-data-use/ | No ad or attribution SDKs, no `NSUserTrackingUsageDescription`, no ATT prompt | CODE_READY | verified by native build inspection |
| Purpose strings | **[verified-official]** Every protected resource the app uses needs a specific, localized purpose string. https://developer.apple.com/documentation/uikit/requesting-access-to-protected-resources | None in the **production** variant: no camera, photo library, location, contacts or Face ID use (`expo-secure-store` runs with `faceIDPermission: false`), and `expo-image-picker` is not linked. Store builds strip `NSLocalNetworkUsageDescription` and `NSBonjourServices` (`withReleaseHardening`). Development and preview builds carry AR and EN `NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription` for wound photos (ADR 0015); they must be added to production only when the wound registry is approved for launch. | CODE_READY | verified by native build inspection; verified by automated test (`scripts/release/check.ts`: "no Face ID purpose string", "no dev-launcher local-network prompt in store builds") |
| App Transport Security | The evidence has no requirement. | Store builds use `NSAllowsArbitraryLoads = false` with no local-networking exception. `app.config.ts` refuses a non-HTTPS or localhost `EXPO_PUBLIC_API_URL` for preview and production builds. | CODE_READY | verified by native build inspection; verified by automated test (`scripts/release/check.ts`: "ATS: no arbitrary loads") |
| Privacy policy link, in App Store Connect **and** in the app (5.1.1(i)) | **[verified-official]** https://developer.apple.com/app-store/review/guidelines/ | In the app: Me > Privacy & consent > Privacy Policy (`/legal/privacy`, rendered natively), the consent gate, and the Plans screen. On the web: `apps/site` builds `/privacy` from the same source (`packages/shared/src/legal.ts`). The host is still `<SUPPORT_DOMAIN_TO_CONFIRM>` and the text is a DRAFT. | CODE_READY, NEEDS_ACCOUNT_ACTION, NEEDS_LEGAL_APPROVAL | verified by automated test (`e2e/tests/flow-f-privacy.spec.ts`, web build); verified by config inspection |
| Consent before health data; disclosure before sharing with third-party AI (5.1.2(i)); no PHI in iCloud (5.1.3) | **[verified-official]** https://developer.apple.com/app-store/review/guidelines/ | The database refuses health data without current `HEALTH_DATA_PROCESSING` consent, and the user can withdraw it in the Privacy center. AI features are off, so no data reaches any AI provider. The entitlements file is empty (no iCloud or CloudKit). Whether iCloud *device backups* count as "storing in iCloud" is **to confirm** (an inference in the evidence). | CODE_READY | verified by automated test (`apps/api/test/compliance.test.ts`: "blocks health data until explicit health-data consent is given", "withdrawing health-data consent stops new health entries"); verified by native build inspection |

---

## 6. Accounts and login

| Item | Requirement (source) | Project state | Status | Verified |
|---|---|---|---|---|
| Sign in with Apple (4.8) | **[verified-official]** Needed only when a third-party or social login sets up or authenticates the primary account. https://developer.apple.com/app-store/review/guidelines/ | **Not required.** Login uses the app's own Better Auth accounts only: email + password, Egyptian mobile + SMS OTP, and optional TOTP 2FA. There are no `socialProviders` and no `expo-apple-authentication`. Re-check this if a social login is ever added. | CODE_READY | verified by config inspection (`apps/api/src/auth/auth.ts`, `apps/mobile/package.json`) |
| In-app account deletion (5.1.1(v)) | **[verified-official]** Apps that support account creation must offer deletion inside the app. https://developer.apple.com/app-store/review/guidelines/. Apple's support page adds: the option must be easy to find; deactivation alone is not enough; a confirmation step is allowed; tell users what is retained; warn that an auto-renewable subscription keeps billing. https://developer.apple.com/support/offering-account-deletion-in-your-app/ | Path: Me > Privacy & consent > Delete account (`apps/mobile/src/app/settings/delete-account.tsx`). The user confirms with a password, or with a sign-in in the last 15 minutes for phone-only accounts, and types `DELETE`. `app.delete_my_account()` runs immediately: credentials, sessions and 2FA are removed and the identity becomes an anonymous tombstone. Shared family profiles and clinician payout ledger rows are retained, and the screen lists what is deleted and what is kept. A warning appears when a store subscription is active (`storeManaged`). | CODE_READY | verified by automated test (`apps/api/test/compliance.test.ts`, 4 account-deletion tests; `e2e/tests/flow-f-privacy.spec.ts`, web build only). Native: not verified. |
| Deletion: subscription follow-through | Same support page | The warning text says to cancel in Manage subscription, but the deletion screen has no Manage subscription button; that button is on the Plans screen. Optional improvement: link it from the deletion screen. | CODE_READY | verified by config inspection |
| Web deletion fallback | The evidence has no Apple requirement (Google requires one). | `apps/site` `/delete-account` (EN + AR). The support email is a placeholder until `SUPPORT_EMAIL` is set. | CODE_READY, NEEDS_ACCOUNT_ACTION | verified by config inspection |
| Organization account (5.1.1(ix)) | **[verified-official]** Apps that provide healthcare services should be submitted by the legal entity that provides them. https://developer.apple.com/app-store/review/guidelines/. Enrollment needs a legal entity (no DBA), a D-U-N-S number, a signer with binding authority, a public website on the organization's domain, and 99 USD per year. The organization appears as the seller. https://developer.apple.com/programs/enroll/ | No account exists. The legal entity name is a placeholder everywhere. | NEEDS_ACCOUNT_ACTION, NEEDS_LEGAL_APPROVAL | not verified |

---

## 7. Health and medical review

| Item | Requirement (source) | Project state | Status | Verified |
|---|---|---|---|---|
| 1.4.1 medical apps | **[verified-official]** Medical apps get greater scrutiny. They must disclose the methodology behind any accuracy claim, remind users to consult a doctor, and link any regulatory clearance. https://developer.apple.com/app-store/review/guidelines/ | The app makes no diagnostic or accuracy claims. My Health shows "Not for emergencies" with a `tel:123` button and the disclaimer "It does not diagnose or treat". A Medical disclaimer document is linked in the Privacy center. The store description says "does not diagnose or treat … not an emergency service … call 123". The company holds no clearance and claims none. | CODE_READY, NEEDS_LEGAL_APPROVAL (draft texts) | verified by config inspection; verified by automated test (`scripts/release/check.ts`: "metadata states the emergency/no-diagnosis limits") |
| Regulated features gated (1.4.1 / 1.4.2) | **[verified-official]** Same URL | `ai.assistant`, `ai.wound_assessment`, `clinical.diagnostic_suggestions`, `care.home_visit_booking` and `care.video_consultation` are seeded **off**. The DB `CHECK regulated_feature_needs_evidence` blocks enabling them without an `evidence_ref`. Only ADMINs can change flags, through the admin console Feature flags page (`apps/admin/src/app/features/page.tsx`). There are no dosage calculators. | CODE_READY; NEEDS_REGULATORY_EVIDENCE to enable any of them | verified by automated test (`apps/api/test/compliance.test.ts`: "exposes every regulated feature as OFF by default", "only admins manage flags, and HIGH-risk features need a regulatory evidence reference") |
| Emergency number | Egypt's numbers are **to confirm**: the evidence is official-but-ambiguous (a UK FCDO page). https://www.gov.uk/foreign-travel-advice/egypt/getting-help | Only **123 (ambulance)** is shown (`EMERGENCY_NUMBERS` in `packages/shared/src/compliance.ts`). Fire and police numbers are deliberately omitted because the sources conflict. Re-confirm with the Ministry of Health before release. | CODE_READY, NEEDS_REGULATORY_EVIDENCE | verified by config inspection |
| Regulated medical device declaration | **[verified-official]** Applies only to apps offered in the EU/EEA, UK or US whose category is Medical or Health & Fitness, or that answer "frequent" medical information. https://developer.apple.com/help/app-store-connect/manage-app-information/declare-regulated-medical-device-status | Set availability to **Egypt only** for v1. Adding EU, UK or US storefronts triggers the declaration. | NEEDS_ACCOUNT_ACTION | not verified |
| Category | **[verified-official]** Category definitions. https://developer.apple.com/app-store/categories/ | Recommended primary category: **Medical**. Secondary is optional. | NEEDS_ACCOUNT_ACTION | not verified |
| Review-risk UI (no specific evidence; **to confirm**) | n/a | (a) Patient Me shows an **"Assistant name"** row ("Give your health assistant a name.") while `ai.assistant` is off (`apps/mobile/src/features/AccountScreen.tsx`). (b) **Me > System status** (`apps/mobile/src/app/settings/system.tsx`) shows end users payments, SMS, AI, push and maps as not configured. (c) The subtitle "Family health & home care" and the keyword "home visit" stand next to `care.home_visit_booking` being off. Recommendation: hide (a) and (b) while their features are off; legal or marketing confirms (c). | open (not CODE_READY) | verified by config inspection |

---

## 8. In-App Purchase (summary; details in `docs/release/PAYMENT_COMPLIANCE.md`)

Rules, all **[verified-official]** at https://developer.apple.com/app-store/review/guidelines/ unless another URL is given:
- **3.1.1:** digital unlocks and subscriptions must use IAP, with a restore mechanism.
- **3.1.3(e):** physical goods and services consumed outside the app must *not* use IAP.
- **3.1.3(d):** real-time 1:1 consultations may use a non-IAP payment method.
- **3.1.3(b):** plans bought elsewhere are honoured on iOS only if they are also sold as IAP.
- **3.1.3 intro and 3.1.1(a):** no steering to other payment methods. Egypt is in no external-purchase or alternative-payment storefront list: https://developer.apple.com/documentation/bundleresources/information-property-list/skexternalpurchasemultilink.md
- **3.1.2(a)/(c) and Schedule 2:** one subscription group; clear title, duration and price; Terms and Privacy links. https://developer.apple.com/support/terms/apple-developer-program-license-agreement/ and https://developer.apple.com/app-store/subscriptions/
- **2.1(b):** IAPs must be complete, visible to the reviewer and functional.

| Item | Project state | Status | Verified |
|---|---|---|---|
| Rail classifier (`packages/shared/src/billing.ts`) | Digital purchases go to `APPLE_IAP` on iOS. Physical goods and services and eligible 1:1 services go to `EXTERNAL_GATEWAY`. There is no override parameter, and native apps never link out to pay for digital items. | CODE_READY | verified by automated test (`apps/api/test/billing.test.ts`, 3 classification tests) |
| Server verification and entitlements (`apps/api/src/integrations/billing.ts`, `modules/billing/*`, migration `0007`) | Uses the App Store Server Library to verify JWS signatures (Production first, then Sandbox). Access is granted only after server verification. Purchases are bound to the account through `appAccountToken`. Duplicate and stale events are handled, and refunds or revocations always win. Clients cannot write entitlements. Without `APPLE_IAP_BUNDLE_ID`, `APPLE_ROOT_CERTS_DIR` and (in production) `APPLE_IAP_APP_APPLE_ID`, the Apple adapter is `NOT_CONFIGURED` and grants nothing. These variables are missing from `apps/api/.env.example`. | CODE_READY; NEEDS_ACCOUNT_ACTION | verified by automated test (`apps/api/test/billing.test.ts`: "refuses to verify anything when the store is not configured", "grants only after server verification…", "clients cannot write entitlements directly") |
| Sandbox purchases in production | Sandbox purchases (App Review, TestFlight) are honoured in production only for accounts with `account_kind` `REVIEW` or `INTERNAL_TEST`. External TestFlight testers on the production API need `INTERNAL_TEST` accounts, which only the database owner can set. | CODE_READY | verified by config inspection (`apps/api/src/modules/billing/routes.ts`) |
| Client StoreKit 2 (`expo-iap` 6.0.2; `apps/mobile/src/features/billing/iap.ts`, `useStoreBilling.ts`) | Installed and type-checked. The config plugin is `['expo-iap', { android: { store: 'play' } }]`. The client connects only when `billing.store_subscriptions` is on, finishes a transaction only after the server verifies it, and fails closed on web (`iap.web.ts`). It has never been compiled for iOS. IAP needs a development or store build, not Expo Go (**[verified-official]** https://docs.expo.dev/guides/in-app-purchases/). | CODE_READY; not BUILT | verified by config inspection (`pnpm typecheck` passes) |
| Plans screen (`apps/mobile/src/app/settings/subscription.tsx`) | Restore Purchases, Manage subscription (shown when a store subscription is active), the auto-renew disclosure, Terms and Privacy links, and the store's localized price (falling back to a labelled reference EGP price). | CODE_READY, NEEDS_LEGAL_APPROVAL (disclosure text) | verified by automated test (`e2e/tests/a11y.spec.ts`, web build: subscription screen); verified by config inspection |
| Product IDs and subscription group | `billing_plan_offers.apple_product_id` is `NULL` for every offer, so nothing is purchasable. Create Gold and Platinum monthly and yearly products in **one** group in App Store Connect, then store their IDs. Whether the Paid Applications agreement must be signed first is **to confirm** (not in the evidence). | NEEDS_ACCOUNT_ACTION | verified by config inspection |
| Feature flag `billing.store_subscriptions` | Seeded **off**. To have IAP reviewed it must be **on** in the backend the review build talks to, and that also turns it on for every user of that backend. | CODE_READY | verified by automated test (`apps/api/test/compliance.test.ts`: all flags off by default) |
| App Store Server Notifications V2 | The endpoint `POST /webhooks/apple/app-store-notifications` exists; set its URL in App Store Connect. Whether this is a store requirement is **to confirm** (not researched in the evidence). | NEEDS_ACCOUNT_ACTION | verified by config inspection |
| Mixed digital and real-world benefits | Gold and Platinum list `REAL_WORLD` benefits: priority matching, reduced platform fees, priority support. Apple has published no rule for this mix, so it is **to confirm**. Get written clarification from App Review; the forum thread https://developer.apple.com/forums/thread/698791 has no Apple answer. | NEEDS_STORE_REVIEW | not verified |
| **Plans visible but not purchasable** | With the flag off, Me > Plans & subscription still lists Gold and Platinum with reference EGP prices and "Subscriptions are not available yet." **Decision needed:** either hide the entry while subscriptions are off (notes option [A]), or submit with IAP fully configured and the products attached for review (option [B]). | open (not CODE_READY) | verified by config inspection (`AccountScreen.tsx` shows the row with no flag check) |
| TetraSol checkout | `commerce.checkout` is off. The server returns `canPlaceRealOrder: false`, so "Place order" is disabled ("Placing orders is disabled until payments are configured") and the payment gateway is not configured. Once enabled it must use a non-IAP method (3.1.3(e)). | CODE_READY (disabled) | verified by config inspection; verified by automated test (`e2e/tests/flow-d-tetrasol.spec.ts`, web build, simulated checkout) |

---

## 9. Age rating

**Requirements, all [verified-official]:**
- The updated questionnaire covers in-app controls, capabilities and medical/wellness topics: https://developer.apple.com/news/?id=ks775ehf
- Social-media capability answers are required for submissions from September 2026: https://developer.apple.com/news/?id=tlur8uvi
- Rating mapping: health and wellness topics → 9+; infrequent medical/treatment information → 13+; frequent → 16+; unrestricted web access → 16+. https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions
- Answers must be honest (2.3.6).

| Question area | Proposed answer for **this build** (based on the code) | Note |
|---|---|---|
| Medical or treatment information | **Infrequent (13+)** is proposed, because care plans, AI and booking are off. **Frequent (16+)** is the conservative choice. Legal decides. | "Frequent" also triggers the medical-device declaration, but only for EU/UK/US storefronts. Re-answer when any gated feature turns on. |
| Health or wellness topics | Yes | |
| Messaging and chat | No. The build has no chat. | Re-answer if chat ships. |
| Social media capabilities | No. There is no feed, public profile or follower feature. | |
| User-generated content | Health records are private, visible only to the owner and authorised family. Nothing is shared publicly. | Legal confirms the wording. |
| Unrestricted web access | No. There is no WebView or in-app browser; the only external links are `tel:123` and the App Store subscriptions page. | |
| Advertising, gambling, contests, violence, mature or suggestive themes, alcohol/tobacco/drugs | None | |
| In-app controls (parental controls, age assurance) | None implemented. Terms set an 18+ account policy, and guardians manage child profiles. | |

Status: NEEDS_LEGAL_APPROVAL, NEEDS_ACCOUNT_ACTION (entered in App Store Connect). Verified: by config inspection (code facts); the answers themselves are not verified.

---

## 10. Export compliance

| Item | Requirement (source) | Project state | Status | Verified |
|---|---|---|---|---|
| `ITSAppUsesNonExemptEncryption` | **[verified-official]** `NO` declares no encryption or only exempt encryption (for example OS HTTPS). Without the key, App Store Connect asks on every upload and TestFlight shows "Missing Compliance". The developer is legally responsible for the answer, and a year-end self-classification report may still apply. https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations | `ios.config.usesNonExemptEncryption: false` produces `ITSAppUsesNonExemptEncryption = false`. The app uses only OS TLS and the Keychain (`expo-secure-store`); no custom crypto library was found. | CODE_READY, NEEDS_LEGAL_APPROVAL | verified by native build inspection; verified by automated test (`scripts/release/check.ts`: "ITSAppUsesNonExemptEncryption declared") |
| Egyptian rules on encryption (NTRA or import) | **to confirm** (unresolved in the evidence) | n/a | NEEDS_LEGAL_APPROVAL | not verified |

---

## 11. Store metadata (`store/metadata/en.json` locale `en-GB`, `ar.json` locale `ar-SA`)

Limits are **[verified-official]**: https://developer.apple.com/help/app-store-connect/reference/app-information/app-information and https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information. `scripts/release/check.ts` enforces them (46/46 checks passed on 2026-10-15).

| Field | Limit | EN | AR | Status | Verified |
|---|---|---|---|---|---|
| Name | 2 to 30 characters | 14 | 6 | STORE_METADATA_READY | verified by automated test (`scripts/release/check.ts`) |
| Subtitle | ≤ 30 characters; no unverifiable claims | 28 ("Your family's health records") | 19 ("السجل الصحي لعائلتك") | STORE_METADATA_READY, NEEDS_LEGAL_APPROVAL (see §7 (c)) | verified by automated test (`scripts/release/check.ts`) |
| Promotional text | ≤ 170 characters | 105 | 87 | STORE_METADATA_READY | verified by automated test (`scripts/release/check.ts`) |
| Description | ≤ 4000 characters, plain text | 1080 | 860 | STORE_METADATA_READY, NEEDS_LEGAL_APPROVAL | verified by automated test (`scripts/release/check.ts`) |
| Keywords | ≤ 100 **bytes**; each > 2 characters; no app or company names | 94 B | 93 B | STORE_METADATA_READY | verified by automated test (`scripts/release/check.ts`: keywords exclude Dress My Wound / غير لي / TetraSol / Alia) |
| What's New | Not available for the first version | "First release." (unused for v1) | same | STORE_METADATA_READY | verified by config inspection |
| Support URL | Required. Must lead to real contact information: address, email and phone, as local law may require. | `https://<SUPPORT_DOMAIN_TO_CONFIRM>/` | same | NEEDS_ACCOUNT_ACTION. The `apps/site` support page shows **only an email (a placeholder), with no address or phone**. | verified by config inspection |
| Privacy Policy URL | Required for iOS | `https://<SUPPORT_DOMAIN_TO_CONFIRM>/privacy` | same | NEEDS_ACCOUNT_ACTION, NEEDS_LEGAL_APPROVAL | verified by config inspection |
| Copyright | n/a | `© 2026 <ALIA_GROUP_LEGAL_ENTITY_TO_CONFIRM>` | same | NEEDS_LEGAL_APPROVAL | verified by config inspection |

- **Localizations [verified-official]:** the Egypt storefront's default language is English (U.K.), with Arabic as an additional language (https://developer.apple.com/help/app-store-connect/reference/app-store-localizations). Set the Arabic name `غير لي` under App Information > Arabic. Arabic screenshots must explicitly **replace** the screenshots it inherits from the primary language (https://developer.apple.com/help/app-store-connect/manage-app-information/localize-app-information). Status: NEEDS_ACCOUNT_ACTION.
- **Paid features [verified-official]:** the description must say which features need an additional purchase (2.3.2, https://developer.apple.com/app-store/review/guidelines/). The current text has no such line because nothing is sold. Add one only for notes option [B]. Status: open (not CODE_READY) if [B].
- **Accuracy check:** the description's claims match the code: clinicians reviewed by the team, a browse-only store, in-app deletion and consent-gated health data. The "TETRASOL STORE" paragraph is true for reviewers only once the review catalogue exists (§13). Status: STORE_METADATA_READY. Verified by config inspection.
- **Not checked by `scripts/release/check.ts`:** placeholder URLs and the copyright placeholder. Status: NEEDS_ACCOUNT_ACTION.
- **Digital Services Act status:** whether an Egypt-only app must still answer it is **to confirm** (unresolved in the evidence). Status: NEEDS_ACCOUNT_ACTION.

---

## 12. Screenshots

| Item | Requirement (source) | Project state | Status | Verified |
|---|---|---|---|---|
| Sizes | **to confirm** (official-but-ambiguous; Apple's page contradicts itself). Plan **both** portrait sets: **1206×2622** (Dynamic Island, medium) and **1320×2868** (Dynamic Island, large). 1 to 10 per size, `.png`/`.jpg`, **no alpha**. https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications | None exist. They need the iOS build on a Simulator (macOS) or on a device through TestFlight. Captures from the web harness are not the native app. | NEEDS_OFFICIAL_ASSETS | not verified |
| Locales | **[verified-official]** Arabic must replace the inherited screenshots (§11 URL) | An **EN set and an AR (RTL) set** for each size: 4 sets in total | NEEDS_OFFICIAL_ASSETS | not verified |
| Content | **[verified-official]** More than half of each device's screenshots must show the app in use, not splash or login (2.3.3). https://developer.apple.com/help/app-review/guideline-reference/2-3-3-screenshots. Also from https://developer.apple.com/app-store/review/guidelines/: no prices in the name, subtitle or screenshots (2.3.7); suitable for 4+ (2.3.8); fictional account data only (2.3.9). | Proposed shot list (at least 4 of every 6 in use): My Health record, Family profiles, Care directory (synthetic clinicians), Clinician profile, TetraSol browse (**crop out EGP prices**), Privacy & consent. Use the review accounts' synthetic data. No graphic wound images. | NEEDS_OFFICIAL_ASSETS | not verified |
| iPad | Not required while the app is iPhone-only (**[verified-official]**, same spec URL) | `supportsTablet: false` | CODE_READY | verified by native build inspection |

---

## 13. App Review information

| Item | Requirement (source) | Project state | Status | Verified |
|---|---|---|---|---|
| Demo account | **[verified-official]** For apps with login: a username and password that **must not expire**, extra accounts in Notes, and a live backend (2.1(a)). https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information | `apps/api/src/db/seed-review.ts` (`pnpm --filter @ghayarly/api review:seed`) idempotently creates `review.patient@`, `review.doctor@` and `review.nurse@<REVIEW_EMAIL_DOMAIN>`. All three share one password, which must be ≥ 16 characters, not a guessable word, and never committed. Each account gets `emailVerified = true` and `account_kind = 'REVIEW'`. The doctor and nurse get APPROVED synthetic profiles, labelled "Synthetic review profile — not a real clinician". The patient gets Terms, Privacy and Health-data consent. Production requires `--confirm-production` and the **owner** DB URL. Clinicians see only an MFA warning, because MFA is enforced server-side on admin feature-flag routes only. | CODE_READY; NEEDS_ACCOUNT_ACTION (an operator runs it against the backend the review build uses; needs a company-controlled `REVIEW_EMAIL_DOMAIN`) | verified by automated test (`apps/api/test/compliance.test.ts`: "review accounts see only synthetic catalogue rows; real accounts never see them", "users cannot promote themselves to a review account") |
| Review data completeness | 2.1(a) (same URL) | **Partly fixed 2026-10-15.** Review accounts now see the same approved public catalogue as real users (TetraSol products, nursing service types; no personal data), so the store is not empty once real products are approved. Clinicians stay synthetic for reviewers ("Dr. Review", "Nurse Review"), and Earnings/appointments are empty. Still open: approved TetraSol product content in production, and a sample ledger for the clinician review accounts. | partly `CODE_READY` · open | verified by automated test (`compliance.test.ts`: review isolation) |
| Reviewer deletes an account | The demo account must not expire (same URL) | Reviewers may delete the review accounts. Re-run `review:seed` after each review, and keep someone on hand who can re-create them during review. | NEEDS_ACCOUNT_ACTION | not verified |
| Contact | **[verified-official]** A phone number in international format with `+` (e.g. `+20…`). Notes ≤ 4000 bytes. (same URL) | The name, email and `+20` phone have not been provided. | NEEDS_ACCOUNT_ACTION | not verified |

### 13.1 App Review Notes: ready-to-paste draft (EN)

**Before pasting:** (1) the review catalogue exists (§13), or else delete "> TetraSol > browse"; (2) the Plans decision is made (§8): keep only [A] or only [B]; (3) the Assistant-name row and System status screen are hidden (§7); (4) every `<…>` is replaced. The draft is about 3.2 KB with both options, under the 4,000-byte limit.

```text
ABOUT THIS APP
Dress My Wound (Arabic name: غير لي) is published by <LEGAL ENTITY NAME>, Egypt, the organisation that operates the service. Adults keep a private health record for themselves and for family members they are authorised to manage, browse doctors and nurses whose credentials our team has reviewed, and browse TetraSol wound-care products. Arabic and English (Me > Language).

NOT A DIAGNOSTIC OR EMERGENCY SERVICE
The app does not diagnose or treat and makes no accuracy claims. My Health shows "Not for emergencies" with a button that dials 123 (ambulance, Egypt). We hold no regulatory clearance and claim none.

TURNED OFF IN THIS VERSION (server-side feature flags, off by default)
- AI health assistant, AI wound-photo assessment, diagnostic suggestions: off. No user data is sent to any AI service. The database refuses to enable them without a recorded regulatory evidence reference.
- Home-visit booking and video consultations: off.
- Store checkout: off. TetraSol is browse-only; "Place order" is disabled and no payment is taken.
- Subscriptions: <KEEP ONE>
  [A] Off. No In-App Purchase is offered and nothing can be bought.
  [B] Gold and Platinum are auto-renewable subscriptions sold only through In-App Purchase, in one subscription group. Me > Plans & subscription has Restore Purchases and Manage subscription. Some benefits are marked "Real-world benefit" (e.g. priority matching); no in-person service is sold in this version.

REVIEW ACCOUNTS (synthetic people only)
Sign in with email and password. All three accounts use the password in the Sign-In Information fields.
- Patient: review.patient@<REVIEW_EMAIL_DOMAIN> (in the Sign-In fields)
- Doctor: review.doctor@<REVIEW_EMAIL_DOMAIN>
- Nurse: review.nurse@<REVIEW_EMAIL_DOMAIN>
Review accounts are isolated: every patient and clinician they see is a synthetic, labelled record (e.g. "Dr. Review - Synthetic review profile - not a real clinician"), never a real patient or clinician; the TetraSol catalogue is the same approved catalogue real users see. Real users never see review data. No SMS code is needed. Doctor and Nurse accounts may show a recommendation to turn on two-step verification; it is not needed for review. Earnings and appointments are empty for review accounts.

SUGGESTED PATHS
Patient: My Health > add an entry (health-data consent already given) > Me > Family > add a profile > Care > open a clinician > TetraSol > browse.
Doctor / Nurse: Today, Availability, Verification; Nurse also Services.
Privacy: Me > Privacy & consent: Privacy Policy, Terms, Medical disclaimer, health-data consent (can be withdrawn), optional marketing consent.

ACCOUNT DELETION (Guideline 5.1.1(v))
Me > Privacy & consent > Delete account. Enter the password, type DELETE, confirm. Deletion is immediate and signs out every device; the screen lists what is deleted and what is kept for legal reasons. You may delete any review account; we re-create it afterwards. If you need one again during review, email <REVIEW_CONTACT_EMAIL>.

SIGN-IN, PRIVACY, TRACKING
Only our own accounts: email and password, Egyptian mobile number with SMS code, optional authenticator app. No third-party or social login. No ads, no tracking, no App Tracking Transparency prompt. The app does not access the camera, photo library, location or contacts.

CONTACT
<NAME>, <EMAIL>, <+20 PHONE>
```

Status of the notes: NEEDS_ACCOUNT_ACTION (placeholders), NEEDS_LEGAL_APPROVAL. Every statement was verified by config inspection against the code on 2026-10-15.

---

## 14. TestFlight

**Requirements, all [verified-official]** (https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers):
- Up to 100 internal and 10,000 external testers.
- A build is testable for 90 days.
- An internal group must exist before an external group can be created.
- The first build added to an external group goes to **Beta App Review**.
- Up to 6 builds can go to review per 24 hours, with one per version at a time.
- External testing requires a **Beta App Description** and a **Feedback Email**.

Beta review details are also **[verified-official]**: contact, demo account flag and credentials, and notes up to 4,000 characters. Credentials must stay valid for the whole review. https://developer.apple.com/documentation/appstoreconnectapi/betaappreviewdetail/attributes-data.dictionary

| Step | Status | Verified |
|---|---|---|
| Internal group (team): upload from the `production` profile | NEEDS_ACCOUNT_ACTION; not BUILT | not verified |
| External group (pilot clinicians and patients), then Beta App Review | NEEDS_ACCOUNT_ACTION, NEEDS_STORE_REVIEW | not verified |
| Beta App Description, Feedback Email, What to Test (drafts below) | NEEDS_ACCOUNT_ACTION (feedback mailbox) | not verified |
| Test purchases by external testers against the production API need `INTERNAL_TEST` accounts (§8) | NEEDS_ACCOUNT_ACTION | verified by config inspection |
| First device test of every flow, on iOS 16.4 and on a current iPhone, in EN and AR/RTL, light and dark | Never device-tested. Only the Expo **web** E2E suite (flows A–F, RTL, a11y 6/6) has run, and it is a proxy, not the native app. | not verified |

- **Draft Beta App Description:** "Dress My Wound (غير لي) keeps your family's health information private and organised and helps you find verified doctors and nurses in Egypt. This beta tests sign-up, health records, family profiles, the clinician directory, the TetraSol catalogue, privacy controls and account deletion. It is not an emergency service. In an emergency in Egypt call 123."
- **Draft What to Test:** "Sign up and the consent screens; add and edit health entries; add a family profile; switch between Arabic and English; withdraw and re-grant health-data consent; delete your test account (Me > Privacy & consent > Delete account). Report anything unclear, in Arabic or English."

---

## 15. EAS credentials, signing and submission workflow

| Task | Apple Developer (Organization) | D-U-N-S | App Store Connect app record | Expo account | macOS |
|---|---|---|---|---|---|
| Enroll in the Apple Developer Program as an Organization (**[verified-official]** https://developer.apple.com/programs/enroll/) | creates it | **yes** | n/a | n/a | no |
| Accept the latest DPLA (**to confirm**, §2) | yes | n/a | n/a | n/a | no |
| Register the bundle ID; create the app record (name, primary language English (U.K.), bundle ID, SKU) | yes | n/a | creates it | n/a | no |
| Distribution certificate and provisioning profile. EAS can create and store them when you sign in to Apple during `eas build` or `eas credentials` (**to confirm**; Expo credentials docs are not in the evidence) | yes | n/a | n/a | yes | no |
| `eas build -p ios --profile production`, run on EAS macOS cloud workers (**[verified-official]** https://docs.expo.dev/build-reference/infrastructure/) | yes | n/a | n/a | yes (`EAS_PROJECT_ID`, `EXPO_OWNER`, EAS env vars including an `https://` `EXPO_PUBLIC_API_URL`) | **no** |
| `eas submit -p ios`. `eas.json` has **no `submit.*.ios` block**, so add `ascAppId` or submit interactively. Needs an App Store Connect API key or an Apple ID sign-in. | yes | n/a | yes | yes | **no** |
| TestFlight groups, IAP products, Server Notifications URL, App Privacy answers, age rating, availability (Egypt only), App Review information | yes | n/a | yes | n/a | no |
| Server IAP config: `APPLE_IAP_BUNDLE_ID`, `APPLE_IAP_APP_APPLE_ID` (the app's Apple ID from the record), `APPLE_ROOT_CERTS_DIR` (Apple root `.cer` files) | n/a | n/a | yes | n/a | no |
| AASA Team ID (only if Universal Links are enabled) | yes | n/a | n/a | n/a | no |
| iOS Simulator screenshots; Xcode "Generate Privacy Report"; local `expo run:ios` or Xcode archive | for signing | n/a | n/a | n/a | **yes** |

- **macOS:** not needed when builds and submissions go through EAS cloud. It is needed only for local Xcode builds, the Simulator and Xcode's privacy report. Device screenshots taken from TestFlight builds avoid the need for macOS.
- **No signing material in git:** `.p8`, `.p12`, `.mobileprovision`, `.pem` and `.cer` files (except Apple root certificates) are rejected. Status: CODE_READY. Verified by automated test (`scripts/release/check.ts`: "no signing keys or certificates committed").

**Sequence (once the accounts exist):**
1. Pin `ios.image` to `sdk-57`.
2. Run `expo prebuild --platform ios --clean` and re-inspect the output (§5.1).
3. Run `eas build -p ios --profile production`.
4. Inspect the merged `PrivacyInfo.xcprivacy` and `Info.plist`; record the results in `RELEASE_STATUS.md`.
5. Run `eas submit -p ios --profile production`.
6. Test on TestFlight internal, then external (Beta App Review).
7. Device-test (§14).
8. Capture screenshots (§12).
9. Complete the App Privacy label, age rating, App Review information and availability.
10. Submit for review.

---

## 16. Status by owner

**Completed implementation (CODE_READY)**
- iOS config: bundle IDs and variants, localized names, iPhone-only, portrait, deployment target 16.4, ATS hardening, export-compliance key, privacy manifest (pre-`expo-iap` prebuild), no tracking, no purpose strings needed.
- In-app account deletion; Privacy center; consent gate; health-data consent enforced in the database; emergency notice (123); legal documents rendered in the app.
- Regulated-feature flags off, with an evidence `CHECK`; admin Feature flags page (ADMIN only).
- Payment-rail classifier; server-side Apple/Google verification and entitlements; `expo-iap` client (type-checked); Plans screen with Restore and Manage.
- Review-account provisioning script; static support, legal and deletion site generator with an AASA template.

**Verified by automated test (passing on 2026-10-22; current numbers in `RELEASE_STATUS.md`)**
- 165 unit and API tests (`apps/api` 109 including the compliance and billing regression tests, tokens 43, shared 9, i18n 4).
- `scripts/release/check.ts`: 58/58; `--submission` mode fails on the legal and listing placeholders, as it should until they are filled.
- `expo-doctor`: 21/21; typecheck: 8/8 workspaces; lint clean.
- Playwright on the Expo **web** build (a proxy, not native): flows A–F (incl. a deep-link consent-gate test), `rtl-arabic.spec.ts`, and `a11y.spec.ts` 9/9 (WCAG 2.2 A/AA via axe-core, 44 px targets, no page overflow and no control clipped by its container at 320, 360 and 390 px).
- No test covers native iOS behaviour.

**Open engineering items: open (not CODE_READY)**
1. Pin `eas.json` `ios.image` to `"sdk-57"` (§2).
2. Re-run the iOS prebuild after `expo-iap`; re-inspect `Info.plist`, entitlements and `PrivacyInfo.xcprivacy` (§5.1).
3. Hide Plans & subscription while `billing.store_subscriptions` is off, or ship working IAP (§8).
4. Approve real TetraSol product content in production (reviewers see the real approved catalogue) and add a sample ledger for the clinician review accounts (§13).
5. Hide the "Assistant name" row while `ai.assistant` is off, and hide Me > System status in store builds (§7).
6. Universal Links: add a validated, auth-gated `/app/*` handler before setting `APP_LINK_DOMAIN`, and add AASA entries per variant (§4).
7. Add `submit.production.ios` (`ascAppId`) to `eas.json`, or submit interactively (§15).
8. Support page: add the legal address and a `+20` phone (§11). Add the `APPLE_IAP_*` variables to `apps/api/.env.example`.
9. `PurchaseHistory` is now in the privacy manifest; also declare it in the App Privacy label, and for option [B] add the paid-features line to the description (§5.2, §11).
10. Plan the April 2027 move to Xcode 27 / the iOS 27 SDK (SDK 58, or `enableSceneSupport`) (§2).
11. (Resolved 2026-10-28.) `packages/tokens/src/brand.ts` no longer references the non-existent `store/assets/PLACEHOLDER_ASSETS.md`.

**Requires the developer account (NEEDS_ACCOUNT_ACTION):** Organization enrollment, D-U-N-S, company website and domain, DPLA acceptance, bundle ID and app record, Team ID, certificates and profiles through EAS, App Store Connect API key, IAP products and subscription group, Server Notifications URL, App Privacy answers, age rating, availability (Egypt only) and category, review accounts seeded on the review backend, and a review contact with a `+20` phone.

**Requires official assets (NEEDS_OFFICIAL_ASSETS):** the app icon (1024, no alpha), the splash mark, and EN + AR screenshot sets at 1206×2622 and 1320×2868. No official Alia Group or TetraSol logos have been supplied; the app shows those names as plain text only.

**Requires legal approval (NEEDS_LEGAL_APPROVAL):** privacy policy, terms, health-consent and medical-disclaimer texts (`2026-10-draft`); the legal entity name; retention periods; age-rating, export-compliance and privacy-label answers; subtitle, description and subscription-disclosure wording.

**Requires regulatory evidence (NEEDS_REGULATORY_EVIDENCE):**
- Enabling `ai.assistant`, `ai.wound_assessment`, `clinical.diagnostic_suggestions`, `care.home_visit_booking` or `care.video_consultation`.
- Offering the app in EU/EEA/UK/US storefronts, which triggers the medical-device declaration.
- Re-confirming the 123 ambulance number.
- Outside Apple's process, but required before go-live: Egypt's PDPL requires a PDPC licence for data users (**[verified-official]** https://portal.pdpc.gov.eg/faq).

**Requires Apple review (NEEDS_STORE_REVIEW):** TestFlight Beta App Review (external); App Review; Apple's upload-time privacy-manifest and SDK-signature checks; App Review's clarification on mixed digital and real-world subscription benefits.

No line is `BUILT` (iOS), `DEVICE_TESTED`, `READY_FOR_SUBMISSION`, `SUBMITTED` or `APPROVED`.

---

## 17. Official sources

Apple
- https://developer.apple.com/news/upcoming-requirements/
- https://developer.apple.com/app-store/submitting/
- https://developer.apple.com/news/?id=k1mtkt1k
- https://developer.apple.com/news/?id=kkphp5qo (official-but-ambiguous)
- https://developer.apple.com/news/?id=17mwd36z (official-but-ambiguous)
- https://developer.apple.com/news/?id=ks775ehf
- https://developer.apple.com/news/?id=tlur8uvi
- https://developer.apple.com/app-store/review/guidelines/ (last updated June 8, 2026)
- https://developer.apple.com/help/app-review/guideline-reference/2-3-3-screenshots
- https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications (official-but-ambiguous on sizes)
- https://developer.apple.com/help/app-store-connect/reference/app-information/app-information
- https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information
- https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions
- https://developer.apple.com/help/app-store-connect/reference/app-store-localizations
- https://developer.apple.com/help/app-store-connect/manage-app-information/localize-app-information
- https://developer.apple.com/help/app-store-connect/manage-app-information/declare-regulated-medical-device-status
- https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers
- https://developer.apple.com/documentation/appstoreconnectapi/betaappreviewdetail/attributes-data.dictionary
- https://developer.apple.com/app-store/categories/
- https://developer.apple.com/design/human-interface-guidelines/app-icons
- https://developer.apple.com/forums/thread/795411 (secondary source only; no-alpha icon rule)
- https://developer.apple.com/documentation/xcode/supporting-associated-domains
- https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app
- https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations
- https://developer.apple.com/documentation/bundleresources/adding-a-privacy-manifest-to-your-app-or-third-party-sdk
- https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api
- https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype
- https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests
- https://developer.apple.com/support/third-party-SDK-requirements/
- https://developer.apple.com/app-store/app-privacy-details/
- https://developer.apple.com/app-store/user-privacy-and-data-use/
- https://developer.apple.com/documentation/uikit/requesting-access-to-protected-resources
- https://developer.apple.com/support/offering-account-deletion-in-your-app/
- https://developer.apple.com/programs/enroll/
- https://developer.apple.com/app-store/subscriptions/
- https://developer.apple.com/support/terms/apple-developer-program-license-agreement/
- https://developer.apple.com/documentation/bundleresources/information-property-list/skexternalpurchasemultilink.md
- https://developer.apple.com/forums/thread/698791 (no Apple answer; mixed-benefit subscriptions)

Expo / React Native
- https://docs.expo.dev/versions/latest/
- https://docs.expo.dev/build-reference/infrastructure/
- https://docs.expo.dev/build-reference/app-versions/
- https://docs.expo.dev/build-reference/variants/
- https://docs.expo.dev/guides/localization/ (RTL statement official-but-ambiguous)
- https://docs.expo.dev/guides/in-app-purchases/
- https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md#staying-on-sdk-57-with-xcode-27
- https://github.com/facebook/react-native/blob/0.86-stable/packages/react-native/scripts/cocoapods/privacy_manifest_utils.rb

Egypt
- https://www.gov.uk/foreign-travel-advice/egypt/getting-help (official-but-ambiguous; emergency numbers)
- https://portal.pdpc.gov.eg/faq
