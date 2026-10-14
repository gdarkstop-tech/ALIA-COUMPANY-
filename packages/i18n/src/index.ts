import { ar } from './ar';
import { en, type Dictionary } from './en';

export type Locale = 'ar' | 'en';
export const DEFAULT_LOCALE: Locale = 'ar';
export const dictionaries: Record<Locale, Dictionary> = { ar, en };
export type { Dictionary };

type Join<K extends string, P extends string> = `${K}.${P}`;
type Leaves<T> = { [K in keyof T & string]: T[K] extends string ? K : Join<K, Leaves<T[K]>> }[keyof T & string];
/** Every valid translation key, e.g. `home.greetingMorning`. */
export type TranslationKey = Leaves<Dictionary>;
export type TranslationParams = Record<string, string | number>;

export function isRTL(locale: Locale): boolean {
  return locale === 'ar';
}

export function direction(locale: Locale): 'rtl' | 'ltr' {
  return isRTL(locale) ? 'rtl' : 'ltr';
}

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

/** Formats numbers with the locale's digits (Arabic-Indic for ar). */
export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG').format(value);
}

function localizeDigits(value: string | number, locale: Locale): string {
  const s = String(value);
  if (locale !== 'ar' || typeof value !== 'number') return s;
  return s.replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)] ?? d);
}

function lookup(dict: Dictionary, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) node = (node as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof node === 'string' ? node : undefined;
}

export function translate(locale: Locale, key: TranslationKey | string, params?: TranslationParams): string {
  const template = lookup(dictionaries[locale], key) ?? lookup(dictionaries.en, key) ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (name in params ? localizeDigits(params[name]!, locale) : `{${name}}`));
}

export function createTranslator(locale: Locale) {
  return (key: TranslationKey, params?: TranslationParams) => translate(locale, key, params);
}

/** Pick the localized variant of a bilingual DB field pair. */
export function pick<T extends Record<string, unknown>>(obj: T, base: string, locale: Locale): string {
  const suffix = locale === 'ar' ? 'Ar' : 'En';
  const value = obj[`${base}${suffix}`] ?? obj[`${base}${locale === 'ar' ? 'En' : 'Ar'}`];
  return typeof value === 'string' ? value : '';
}

/** Locale-appropriate list separator ("، " in Arabic, ", " in English). */
export function listSeparator(locale: Locale): string {
  return locale === 'ar' ? '، ' : ', ';
}
