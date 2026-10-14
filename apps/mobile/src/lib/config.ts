import Constants from 'expo-constants';

/** API base URL. Configure with EXPO_PUBLIC_API_URL (see apps/mobile/.env.example). */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
export const APP_SCHEME = 'ghayarly';
export const APP_VERSION = Constants.expoConfig?.version ?? '0.1.0';
/** Version of the family-consent statement shown in the Add Family Member flow (stored with each grant). */
export const FAMILY_CONSENT_VERSION = 'family-consent-v1';
