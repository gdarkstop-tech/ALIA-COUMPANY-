import type { TranslationKey } from '@ghayarly/i18n';

type BetterAuthError = { status?: number; code?: string; message?: string } | null | undefined;

export function authErrorKey(error: BetterAuthError): TranslationKey {
  if (!error) return 'errors.generic';
  if (error.status === 429) return 'errors.rateLimited';
  const code = error.code ?? '';
  if (code.includes('INVALID_EMAIL_OR_PASSWORD') || error.status === 401) return 'errors.invalidCredentials';
  if (code.includes('USER_ALREADY_EXISTS')) return 'errors.emailTaken';
  if (code.includes('PASSWORD_TOO_SHORT') || code.includes('PASSWORD_TOO_LONG')) return 'errors.weakPassword';
  if (code.includes('INVALID_EMAIL')) return 'errors.invalidEmail';
  if (code.includes('OTP') || code.includes('INVALID_CODE') || code.includes('TOO_MANY_ATTEMPTS')) return 'errors.invalidOtp';
  if (code.includes('PHONE')) return 'errors.invalidPhone';
  if (error.status === 0 || !error.status) return 'errors.network';
  return 'errors.generic';
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EG_PHONE_RE = /^\+201[0125]\d{8}$/;

/** Normalises local Egyptian formats (01xxxxxxxxx) to E.164. */
export function normalizeEgyptPhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+20')) return digits;
  if (digits.startsWith('0020')) return `+${digits.slice(2)}`;
  if (digits.startsWith('01')) return `+2${digits}`;
  if (digits.startsWith('20')) return `+${digits}`;
  return digits;
}
