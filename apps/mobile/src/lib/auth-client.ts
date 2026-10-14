import { expoClient } from '@better-auth/expo/client';
import { phoneNumberClient, twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import * as SecureStore from 'expo-secure-store';
import { API_URL, APP_SCHEME } from './config';

/**
 * Official Better Auth Expo integration: on iOS/Android the session cookie is kept in the
 * platform keychain/keystore via expo-secure-store; on web the browser's HttpOnly cookie is used.
 */
export const authClient = createAuthClient({
  baseURL: API_URL,
  basePath: '/api/auth',
  fetchOptions: { credentials: 'include' },
  plugins: [
    expoClient({ scheme: APP_SCHEME, storagePrefix: 'ghayarly', cookiePrefix: 'ghayarly', storage: SecureStore }),
    phoneNumberClient(),
    twoFactorClient(),
  ],
});

export type AuthSession = typeof authClient.$Infer.Session;
