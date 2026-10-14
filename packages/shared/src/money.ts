/** Money is always stored and transported as integer piasters (1 EGP = 100 piasters). */
export function piastersToEgp(piasters: number): number {
  return piasters / 100;
}

export function formatEgp(piasters: number, locale: 'ar' | 'en' = 'en'): string {
  const egp = piastersToEgp(piasters);
  const formatted = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', {
    minimumFractionDigits: egp % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(egp);
  return locale === 'ar' ? `${formatted} ج.م` : `${formatted} EGP`;
}
