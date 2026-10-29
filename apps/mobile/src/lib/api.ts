import { ApiError, createApiClient, throttleDelayMs } from '@ghayarly/api-client';
import { Platform } from 'react-native';
import { authClient } from './auth-client';
import { API_URL } from './config';

const isWeb = Platform.OS === 'web';

export const api = createApiClient({
  baseUrl: API_URL,
  // Browsers send the HttpOnly session cookie; native attaches the securely stored cookie.
  credentials: isWeb ? 'include' : 'omit',
  getHeaders: async (): Promise<Record<string, string>> => {
    if (isWeb) return {};
    const cookie = await authClient.getCookie();
    return cookie ? { cookie } : {};
  },
});

export { ApiError, throttleDelayMs };

export function errorKey(err: unknown):
  | 'errors.network'
  | 'errors.unauthorized'
  | 'errors.forbidden'
  | 'errors.notFound'
  | 'errors.validation'
  | 'errors.rateLimited'
  | 'errors.healthConsentRequired'
  | 'errors.generic' {
  if (err instanceof ApiError) {
    if (err.isNetwork) return 'errors.network';
    if (err.code === 'HEALTH_DATA_CONSENT_REQUIRED') return 'errors.healthConsentRequired';
    if (err.status === 401) return 'errors.unauthorized';
    if (err.status === 403) return 'errors.forbidden';
    if (err.status === 404) return 'errors.notFound';
    if (err.status === 400 || err.status === 422) return 'errors.validation';
    if (err.status === 429) return 'errors.rateLimited';
  }
  return 'errors.generic';
}
