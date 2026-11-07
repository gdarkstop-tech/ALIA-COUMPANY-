import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';

/**
 * Phone numbers are stored and sent in E.164. Any valid international number is accepted as input,
 * but SMS (codes, reminders) goes only to countries on SMS_ALLOWED_COUNTRIES — sending codes to
 * arbitrary destinations is how SMS-pumping (toll) fraud drains an account.
 */
export type PhoneCheck =
  | { ok: true; e164: string; country: CountryCode | undefined; mobile: boolean }
  | { ok: false; reason: 'INVALID' | 'NOT_MOBILE' | 'COUNTRY_NOT_ALLOWED' };

export function normalizePhone(input: string, opts: { allowedCountries: readonly string[]; defaultCountry?: CountryCode; requireMobile?: boolean }): PhoneCheck {
  const parsed = parsePhoneNumberFromString(input.trim(), opts.defaultCountry ?? 'EG');
  if (!parsed || !parsed.isValid()) return { ok: false, reason: 'INVALID' };
  const type = parsed.getType();
  const mobile = type === 'MOBILE' || type === 'FIXED_LINE_OR_MOBILE';
  if (opts.requireMobile !== false && !mobile) return { ok: false, reason: 'NOT_MOBILE' };
  if (!parsed.country || !opts.allowedCountries.includes(parsed.country)) return { ok: false, reason: 'COUNTRY_NOT_ALLOWED' };
  return { ok: true, e164: parsed.number, country: parsed.country, mobile };
}

/** For logs and operator screens: country code and last 3 digits only. */
export function maskRecipient(recipient: string): string {
  if (recipient.includes('@')) {
    const [local, domain] = recipient.split('@');
    return `${local!.slice(0, 1)}•••@${domain}`;
  }
  return `${recipient.slice(0, 3)}•••••${recipient.slice(-3)}`;
}
