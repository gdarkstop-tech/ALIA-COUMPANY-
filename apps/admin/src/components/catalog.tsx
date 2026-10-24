'use client';
import type { TranslationKey } from '@ghayarly/i18n';
import { formatEgp, type PublicationStatus } from '@ghayarly/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { useI18n } from './Providers';

const TABS = [
  { href: '/catalog', key: 'catalog.products' },
  { href: '/catalog/discounts', key: 'catalog.discounts' },
  { href: '/catalog/bundles', key: 'catalog.bundles' },
  { href: '/catalog/analytics', key: 'catalog.analytics' },
  { href: '/catalog/brands', key: 'catalog.brands' },
] as const;

export function CatalogTabs() {
  const { t } = useI18n();
  const path = usePathname();
  return (
    <nav className="tabs" aria-label={t('catalog.nav')} style={{ marginBottom: 16 }}>
      {TABS.map((tab) => {
        const active = tab.href === '/catalog' ? path === '/catalog' || /^\/catalog\/[0-9a-f-]{36}$/.test(path) : path.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} className={`tab ${active ? 'active' : ''}`} data-testid={`catalog-tab-${tab.href.split('/')[2] ?? 'products'}`}>
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}

const KNOWN = [
  'APPROVER_MUST_DIFFER_FROM_EDITOR',
  'APPROVAL_REQUIRED',
  'APPROVAL_REFERENCE_REQUIRED',
  'RESTORE_ARCHIVED_AS_UNPUBLISHED',
  'ONLY_UNPUBLISHED_DRAFTS_CAN_BE_DELETED',
  'INSUFFICIENT_STOCK',
  'UNSUPPORTED_IMAGE',
  'IMAGE_TOO_LARGE',
  'BUNDLE_ITEMS_NOT_ON_SALE',
  'UNPUBLISH_BUNDLE_FIRST',
  'ALREADY_EXISTS',
  'INVALID_REFERENCE',
  'PERMISSION_REQUIRED',
] as const;

/** Staff-readable message plus the stable server code (kept for support and the audit trail). */
export function useCatalogError() {
  const { t } = useI18n();
  return (e: unknown): string => {
    if (e instanceof ApiError) {
      const text = (KNOWN as readonly string[]).includes(e.code) ? t(`catalog.err_${e.code}` as TranslationKey) : e.message;
      return `${text} (${e.code})`;
    }
    return t('errors.generic');
  };
}

export function PublicationBadge({ status }: { status: PublicationStatus }) {
  const { t } = useI18n();
  const tone = status === 'PUBLISHED' ? 'success' : status === 'ARCHIVED' ? 'neutral' : status === 'UNPUBLISHED' ? 'warning' : 'info';
  return <span className={`badge tone-${tone}`}>{t(`catalog.pub_${status}`)}</span>;
}

export function ContentBadge({ status }: { status: 'PENDING_APPROVAL' | 'APPROVED' | 'RETIRED' }) {
  const { t } = useI18n();
  return <span className={`badge tone-${status === 'APPROVED' ? 'success' : status === 'RETIRED' ? 'neutral' : 'warning'}`}>{t(`catalog.content_${status}`)}</span>;
}

export function useMoney() {
  const { locale } = useI18n();
  return (piasters: number | null | undefined) => (piasters == null ? '—' : formatEgp(piasters, locale));
}

/** EGP typed by staff → piasters (integers only; never floating-point money). */
export function egpToPiasters(value: string): number | null {
  const v = value.trim().replace(',', '.');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(v)) return null;
  const [whole, frac = ''] = v.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

export const imageUrl = (id: string) => `/v1/store/images/${id}`;

/** Reads a File as base64 (without the data: prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
