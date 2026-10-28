import type { Locale } from '@ghayarly/i18n';
import { formatEgp, normalizeDigits } from '@ghayarly/shared';

export function money(piasters: number | null | undefined, locale: Locale): string {
  if (piasters === null || piasters === undefined) return '—';
  return formatEgp(piasters, locale);
}

export function minutesToTime(minutes: number, locale: Locale): string {
  const d = new Date(Date.UTC(2000, 0, 1, Math.floor(minutes / 60), minutes % 60));
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(d);
}

export function formatDate(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', { day: 'numeric', month: 'long', year: 'numeric', timeZone: iso.length === 10 ? 'UTC' : undefined }).format(d);
}

export function formatNumber(n: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG').format(n);
}

export function initials(name: string): string {
  const parts = name
    .replace(/^(د\.|Dr\.)\s*/i, '')
    .replace(/[^\p{L}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '');
}

/** Wraps left-to-right tokens (blood types, phone numbers, codes) so they render correctly inside RTL text. */
export function ltr(value: string): string {
  return `\u2066${value}\u2069`;
}

export function greetingKey(date = new Date()): 'home.greetingMorning' | 'home.greetingAfternoon' | 'home.greetingEvening' {
  const h = date.getHours();
  if (h < 12) return 'home.greetingMorning';
  if (h < 17) return 'home.greetingAfternoon';
  return 'home.greetingEvening';
}

/** Auto-formats typed digits as YYYY-MM-DD. */
export function maskDate(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** A number typed on any keyboard: Arabic-Indic digits and a decimal comma become "12.5". */
export function normalizeNumberInput(value: string): string {
  return normalizeDigits(value).replace(/,/g, '.').replace(/\s/g, '');
}
