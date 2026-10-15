import type { ConfigContext, ExpoConfig } from 'expo/config';
import { withInfoPlist, type ConfigPlugin } from 'expo/config-plugins';

/**
 * Native app configuration for Dress My Wound | غير لي (iOS + Android).
 *
 * Variants (select with APP_VARIANT — set per EAS build profile in eas.json):
 *   development → dev client, internal distribution, local/staging API
 *   preview     → staging build for internal testers (TestFlight / Play internal testing)
 *   production  → store build
 * Each variant has its own bundle identifier / application ID and URL scheme so all three can be
 * installed side by side without sharing data or deep links.
 *
 * Identifiers: APP_ID_BASE defaults to `com.aliagroup.dressmywound`. This is a PROPOSED reverse-DNS
 * ID. Before the first store upload confirm that (a) the company controls the matching domain and
 * (b) the ID is free in App Store Connect and Google Play Console — both are permanent once used.
 * Override without code changes: APP_ID_BASE=com.example.app.
 *
 * Secrets never live here. Only EXPO_PUBLIC_* values reach the JavaScript bundle and they are public
 * by definition (API base URL). Signing credentials are managed by EAS / the stores.
 */

type Variant = 'development' | 'preview' | 'production';

const VARIANT: Variant = (() => {
  const v = process.env.APP_VARIANT ?? 'development';
  if (v !== 'development' && v !== 'preview' && v !== 'production') throw new Error(`APP_VARIANT must be development | preview | production (got "${v}")`);
  return v;
})();

const APP_ID_BASE = process.env.APP_ID_BASE ?? 'com.aliagroup.dressmywound';
if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(APP_ID_BASE)) throw new Error(`APP_ID_BASE "${APP_ID_BASE}" is not a valid lower-case reverse-DNS identifier`);

const VARIANTS: Record<Variant, { idSuffix: string; nameEn: string; nameAr: string; scheme: string }> = {
  development: { idSuffix: '.dev', nameEn: 'Dress My Wound Dev', nameAr: 'غير لي تطوير', scheme: 'dressmywound-dev' },
  preview: { idSuffix: '.staging', nameEn: 'Dress My Wound Beta', nameAr: 'غير لي تجريبي', scheme: 'dressmywound-staging' },
  production: { idSuffix: '', nameEn: 'Dress My Wound', nameAr: 'غير لي', scheme: 'dressmywound' },
};
const v = VARIANTS[VARIANT];
const appId = `${APP_ID_BASE}${v.idSuffix}`;

/** Release builds must talk to an HTTPS API — refuse to build otherwise (env validation). */
const API_URL = process.env.EXPO_PUBLIC_API_URL;
if (VARIANT !== 'development') {
  if (!API_URL) throw new Error(`EXPO_PUBLIC_API_URL is required for ${VARIANT} builds`);
  const u = new URL(API_URL);
  if (u.protocol !== 'https:' || ['localhost', '127.0.0.1', '10.0.2.2'].includes(u.hostname)) throw new Error(`EXPO_PUBLIC_API_URL must be a public https:// URL for ${VARIANT} builds (got ${API_URL})`);
}

/** Verified-domain links (Universal Links / Android App Links). Only enabled when a domain is configured. */
const LINK_DOMAIN = process.env.APP_LINK_DOMAIN;

/**
 * Store builds (preview / production) must not declare development-only capabilities that the
 * dev launcher adds: local-network access, Bonjour discovery and the ATS local-networking
 * exception. Development builds keep them so the dev client can reach Metro.
 */
const withReleaseHardening: ConfigPlugin = (cfg) =>
  withInfoPlist(cfg, (c) => {
    if (VARIANT === 'development') return c;
    delete c.modResults.NSLocalNetworkUsageDescription;
    delete c.modResults.NSBonjourServices;
    c.modResults.NSAppTransportSecurity = { NSAllowsArbitraryLoads: false };
    return c;
  });

const BRAND = { navy: '#0A1F3D', stone: '#FAF7F2', night: '#07152A' } as const;

// withReleaseHardening wraps the whole config: its mod is registered before the `plugins` below,
// so it executes after them (Expo runs mods in reverse registration order) and has the last word.
export default ({ config }: ConfigContext): ExpoConfig => withReleaseHardening({
  ...config,
  name: v.nameEn,
  slug: 'dress-my-wound',
  ...(process.env.EXPO_OWNER ? { owner: process.env.EXPO_OWNER } : {}),
  /** Marketing version (CFBundleShortVersionString / versionName). Build numbers are managed remotely by EAS (eas.json appVersionSource=remote). */
  version: '1.0.0',
  orientation: 'portrait',
  scheme: v.scheme,
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  // Localised home-screen name: English "Dress My Wound", Arabic "غير لي".
  locales: {
    ar: { ios: { CFBundleDisplayName: v.nameAr, CFBundleName: v.nameAr }, android: { app_name: v.nameAr } },
    en: { ios: { CFBundleDisplayName: v.nameEn, CFBundleName: v.nameEn }, android: { app_name: v.nameEn } },
  },
  ios: {
    bundleIdentifier: appId,
    // iPhone only until iPad layouts are designed and tested.
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      CFBundleAllowMixedLocalizations: true,
      CFBundleLocalizations: ['ar', 'en'],
    },
    ...(LINK_DOMAIN ? { associatedDomains: [`applinks:${LINK_DOMAIN}`] } : {}),
    /**
     * App-level privacy manifest (PrivacyInfo.xcprivacy). Required-reason API declarations cover
     * React Native / Expo core usage; collected data types mirror docs/release/PRIVACY_AND_DATA_DISCLOSURES.md.
     * Third-party SDKs ship their own manifests, which Xcode aggregates.
     */
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace', NSPrivacyAccessedAPITypeReasons: ['E174.1'] },
      ],
      NSPrivacyCollectedDataTypes: [
        ['NSPrivacyCollectedDataTypeName'],
        ['NSPrivacyCollectedDataTypeEmailAddress'],
        ['NSPrivacyCollectedDataTypePhoneNumber'],
        ['NSPrivacyCollectedDataTypeHealth'],
        ['NSPrivacyCollectedDataTypeUserID'],
        ['NSPrivacyCollectedDataTypeOtherUserContent'],
        ['NSPrivacyCollectedDataTypeCrashData'],
      ].map(([type]) => ({
        NSPrivacyCollectedDataType: type!,
        NSPrivacyCollectedDataTypeLinked: type !== 'NSPrivacyCollectedDataTypeCrashData',
        NSPrivacyCollectedDataTypeTracking: false,
        NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
      })),
    },
  },
  android: {
    package: appId,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      monochromeImage: './assets/adaptive-icon-monochrome.png',
      backgroundColor: BRAND.navy,
    },
    // Medical data must not leave the device through Android cloud backup.
    allowBackup: false,
    // Only what the shipped features need. Camera / photos / location / notifications are added
    // together with the feature that uses them (see docs/release/PRIVACY_AND_DATA_DISCLOSURES.md).
    permissions: [],
    blockedPermissions: [
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.CAMERA',
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.MANAGE_EXTERNAL_STORAGE',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.READ_MEDIA_AUDIO',
      'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
      'android.permission.SYSTEM_ALERT_WINDOW',
      // Pulled in by expo-secure-store for its optional biometric mode, which this app does not use.
      'android.permission.USE_BIOMETRIC',
      'android.permission.USE_FINGERPRINT',
      'android.permission.READ_CONTACTS',
      'android.permission.READ_PHONE_STATE',
      'com.google.android.gms.permission.AD_ID',
    ],
    predictiveBackGestureEnabled: true,
    softwareKeyboardLayoutMode: 'resize',
    ...(LINK_DOMAIN
      ? {
          intentFilters: [
            {
              action: 'VIEW',
              autoVerify: true,
              data: [{ scheme: 'https', host: LINK_DOMAIN, pathPrefix: '/app' }],
              category: ['BROWSABLE', 'DEFAULT'],
            },
          ],
        }
      : {}),
  },
  web: {
    // Development/E2E harness only — the product ships as native iOS and Android apps.
    output: 'single',
    bundler: 'metro',
    favicon: './assets/favicon.png',
    name: 'Dress My Wound | غير لي',
  },
  plugins: [
    'expo-router',
    // No auto-generated exp+<slug> scheme: the variant scheme is the only deep-link entry point.
    ['expo-dev-client', { addGeneratedScheme: false }],
    // Digital subscriptions: StoreKit 2 / Google Play Billing (OpenIAP). Pinned to Google Play — no
    // alternative-billing or external-purchase programmes are used (none apply in Egypt).
    ['expo-iap', { android: { store: 'play' } }],
    ['expo-secure-store', { faceIDPermission: false }],
    'expo-font',
    'expo-localization',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 132,
        resizeMode: 'contain',
        backgroundColor: BRAND.stone,
        dark: { image: './assets/splash-icon.png', backgroundColor: BRAND.night },
      },
    ],
  ],
  extra: {
    supportsRTL: true,
    appVariant: VARIANT,
    ...(process.env.EAS_PROJECT_ID ? { eas: { projectId: process.env.EAS_PROJECT_ID } } : {}),
  },
  experiments: { typedRoutes: false },
});
