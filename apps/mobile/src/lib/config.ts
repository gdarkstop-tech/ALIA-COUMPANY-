import Constants from 'expo-constants';

/** API base URL. Configure with EXPO_PUBLIC_API_URL (see apps/mobile/.env.example). */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
/** URL scheme of this build variant (dressmywound / dressmywound-staging / dressmywound-dev), from app.config.ts. */
const scheme = Constants.expoConfig?.scheme;
export const APP_SCHEME = (Array.isArray(scheme) ? scheme[0] : scheme) ?? 'dressmywound';
export const APP_VARIANT = (Constants.expoConfig?.extra?.appVariant as string | undefined) ?? 'development';
export const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';
/** Version of the family-consent statement shown in the Add Family Member flow (stored with each grant). */
export const FAMILY_CONSENT_VERSION = 'family-consent-v1';
