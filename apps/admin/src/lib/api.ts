'use client';
import { ApiError, createApiClient, throttleDelayMs } from '@ghayarly/api-client';

export const api = createApiClient({
  baseUrl: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001',
  credentials: 'include',
});

export { ApiError, throttleDelayMs };
