# Device test guide and acceptance checklist — Dress My Wound | غير لي

> **Status (2026-11-07): no physical-device or emulator testing has been performed.** Everything
> verified so far ran on the web harness (Expo web + admin console) and on static inspection of the
> built Android packages and the generated iOS project. This guide is what a tester runs on real
> phones; record results in the checklist at the end and keep screenshots / screen recordings in
> `docs/release/evidence/`.

## 1. Builds

| Variant | Purpose | Android | iOS |
|---|---|---|---|
| `production` | What stores receive. No camera, photo-library or microphone access; wound photos and realtime voice are not in the binary. | Built locally 2026-10-29 (APK + AAB, debug-signed, **not uploadable**): targetSdk 36, allow-listed permissions only, 44/44 64-bit libraries 16 KB-aligned (`scripts/release/verify-android.sh`). Store build: EAS `production` profile (Play App Signing). | Native project generated and inspected 2026-11-07 (bundle `com.aliagroup.dressmywound`, no camera / photo / microphone strings, privacy manifest present). **Not compiled** — needs EAS + Apple Developer account. |
| `preview` (Beta) | Internal testers: everything in production **plus** wound photos (camera / picker) and realtime voice. The server-side flags still decide whether either is usable. | Built locally 2026-10-29 (APK, arm64-v8a + armeabi-v7a, debug-signed): CAMERA, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS added and allow-listed. | Generated and inspected (bundle `…dressmywound.staging`, camera / photo / microphone strings present). TestFlight: EAS `preview-store` profile. **Not built.** |
| `development` | Developers: loads JavaScript from Metro. | Built locally (debug APK, arm64 + x86_64). | Simulator build via EAS `development-simulator`. Not built. |

Reproduce the Android builds: `OUT=<dir> EXPO_PUBLIC_API_URL=https://<staging-api> scripts/release/build-android-local.sh production preview dev`.

### What is needed before testing on a device (owner actions)
1. **A reachable staging API** over HTTPS (with its own database, Redis and the encrypted photo
   store). The local builds point at an unroutable placeholder, so they open but cannot sign in.
   Rebuild with `EXPO_PUBLIC_API_URL=https://<staging-api>` (or set it in the EAS `preview`
   environment).
2. **Expo account + `EAS_PROJECT_ID` / `EXPO_OWNER`** for cloud builds; **Apple Developer Program
   (organisation)** for any iOS build, TestFlight and StoreKit sandbox; **Google Play Console** for the
   internal testing track and Play Billing test cards.
3. Internal-test accounts on staging (seed: `pnpm --filter @ghayarly/api db:seed`, or review accounts
   via `review:seed`) — **never real patient data on staging**.
4. Devices: at least one recent Android (Android 15/16, e.g. Pixel 8), one low-end Android
   (Android 10–12, 3 GB RAM), one recent iPhone (iOS 26) and one older supported iPhone (iOS 16.4–17).

### Installing
- Android APK: `adb install -r dress-my-wound-preview-<version>.apk` (enable "Install unknown apps"),
  or EAS internal distribution link. The three variants have different application IDs and can be
  installed side by side.
- iOS: TestFlight invitation (`preview-store` build) or EAS internal distribution (registered UDIDs).

## 2. Test cases

Run every case in **English and Arabic**, **light and dark** system appearance, and at least once with
**large text** (Android font scale 1.3 / iOS Dynamic Type XL) and **TalkBack / VoiceOver** on.

| # | Area | Steps | Expected |
|---|---|---|---|
| D1 | App icon | Home screen, app switcher, settings → apps. iOS: light, dark and tinted icon styles. Android: themed icon (Android 13+). | Official Dress My Wound glass icon; no text in the icon; correct label `Dress My Wound` / `غير لي` (Beta / تجريبي for preview). |
| D2 | Splash + internal logo | Cold start in light and dark mode. | Splash per brand spec (Android emblem, iOS wordmark); in-app header uses the official wordmark; TetraSol logo unchanged where used. |
| D3 | Themes | Switch system appearance while the app is open. | All screens follow; no unreadable text; status bar icons readable. |
| D4 | Arabic RTL | Set the app (or device) to Arabic. Walk sign-in, home, records, store, settings. | Layout mirrored, Arabic copy throughout, numbers and dates localised, back gestures / chevrons mirrored. |
| D5 | Sign-up + consent | New account → Terms / Privacy → health-data consent → profile (governorate, city, mobile required). | Consents are separate, nothing preselected; cannot skip; data saved. |
| D6 | Wound permissions | Privacy center → Wound data permissions. | Scan (A), Research (B), Presentations (C) shown separately, all off; allowing A alone enables scanning; B and C can stay off. |
| D7 | Camera capture (**preview build**) | Wound Scan → new case → Take photo. Deny camera permission first, then allow. | System prompt shows the purpose text; denial explained with a way to settings; photo captured, uploaded, appears in the timeline; no photo saved to the camera roll by the app. |
| D8 | Photo picker (**preview**) | Choose photo from library. | System picker (no full-library permission on Android 13+ / limited access on iOS); only the chosen photo is read; EXIF/GPS removed (check case detail "metadata removed"). |
| D9 | Before / after | Case with ≥ 2 photos → compare. | Side by side by day number; no claim of healing; AI analysis shown as off / not validated. |
| D10 | Scan withdrawal | Withdraw A. | New photos blocked with an explanation; existing record kept; link to permissions. |
| D11 | AI text chat | Assistant (internal-test account; needs a configured provider on staging, otherwise the screen says unavailable). | Emergency notice reachable; general information only; reporting an answer works; allowance shown. |
| D12 | Realtime voice (**preview**) | Start a voice conversation; deny then allow microphone. | Purpose text shown; speech is captured only while the conversation is open; ends cleanly when backgrounded; usage counted. |
| D13 | Lab report upload | Upload a PDF and a photo of a synthetic lab report. | Type checked; result table extraction (if AI enabled) requires confirming each row; nothing added unconfirmed. |
| D14 | Doctor / nurse | Clinician account: verification status, patients shared with them, wound case (only via a share including wounds), drafting a note. | No access without a share; classification confirmed by the clinician only; drafts must be signed. |
| D15 | TetraSol catalogue | Browse products, product detail, cart. | Only approved TetraSol products; no competitor products; checkout states it is unavailable (payments not configured) — no fake payment. |
| D16 | Subscriptions | Plans screen. | Prices from the store; purchase only via App Store / Google Play (sandbox / license tester); restore purchases works; no external payment link for digital plans. |
| D17 | Account deletion | Settings → delete account. | Password re-entry; signed out; cannot sign in again. |
| D18 | Network resilience | Airplane mode mid-session; slow network (Android network throttling). | Calm offline message; retries reads; no duplicate submissions; throttled reads recover after the server's wait. |
| D19 | Keyboard + insets | Forms on small screens (5.4"), split screen / foldables. | Fields not hidden by the keyboard; buttons reachable; predictive back (Android 14+) returns correctly. |
| D20 | Accessibility | TalkBack / VoiceOver through D5, D7, D11, D15. | Every control labelled; order logical; targets ≥ 44 pt; no information by colour alone. |
| D21 | Performance | Low-end Android: cold start, scrolling the store and timeline. | Cold start < 4 s; no visible jank on lists; no crash in 30 minutes of use. |

## 3. Acceptance checklist (fill in per device)

| Case | Android recent | Android low-end | iPhone recent | iPhone older | Evidence |
|---|---|---|---|---|---|
| D1–D4 brand, themes, RTL | ☐ | ☐ | ☐ | ☐ | |
| D5–D6 consent, wound permissions | ☐ | ☐ | ☐ | ☐ | |
| D7–D10 wound capture, picker, comparison, withdrawal (preview) | ☐ | ☐ | ☐ | ☐ | |
| D11–D12 AI chat, realtime voice | ☐ | ☐ | ☐ | ☐ | |
| D13 lab reports | ☐ | ☐ | ☐ | ☐ | |
| D14 clinician interfaces | ☐ | ☐ | ☐ | ☐ | |
| D15–D16 catalogue, subscriptions (sandbox) | ☐ | ☐ | ☐ | ☐ | |
| D17 account deletion | ☐ | ☐ | ☐ | ☐ | |
| D18–D21 resilience, insets, accessibility, performance | ☐ | ☐ | ☐ | ☐ | |

Release gate: every row passed on at least one recent and one older device per platform, no open
crash, and TalkBack + VoiceOver passes for D5, D7, D11 and D15. Record device model, OS version, build
number and tester for each run.
