'use client';
import { hasPermission, type Permission, type WoundMediaLink } from '@ghayarly/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from './Providers';
import { useMe } from './Shell';

export const WOUND_KEY = ['wound-registry'];

const TABS = [
  { href: '/wounds', key: 'woundAdmin.tabOverview', any: ['wound.registry.read'] },
  { href: '/wounds/research', key: 'woundAdmin.tabResearch', any: ['wound.research.access', 'wound.research.review'] },
  { href: '/wounds/presentations', key: 'woundAdmin.tabPresentations', any: ['wound.presentation.manage'] },
  { href: '/wounds/outcomes', key: 'woundAdmin.tabOutcomes', any: ['wound.research.access'] },
] as const satisfies readonly { href: string; key: string; any: readonly Permission[] }[];

export function WoundTabs() {
  const { t } = useI18n();
  const path = usePathname();
  const roles = useMe().data?.roles ?? [];
  return (
    <nav className="tabs" aria-label={t('woundAdmin.nav')} style={{ marginBottom: 16 }}>
      {TABS.filter((tab) => tab.any.some((p) => hasPermission(roles, p))).map((tab) => {
        const active = tab.href === '/wounds' ? path === '/wounds' : path.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} className={`tab ${active ? 'active' : ''}`} data-testid={`wound-tab-${tab.href.split('/')[2] ?? 'overview'}`}>
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * A photo through a short-lived signed link minted for this viewer (each one audited). The link is
 * loaded through the console's own origin and kept in memory only.
 */
export function MediaImg({ id, mint, alt, testId }: { id: string; mint: (id: string) => Promise<WoundMediaLink>; alt: string; testId?: string }) {
  const link = useQuery({ queryKey: ['wound-media', id], queryFn: () => mint(id), staleTime: 90_000, gcTime: 100_000 });
  if (!link.data) return <div className="skeleton" style={{ width: '100%', aspectRatio: '4 / 3' }} />;
  const u = new URL(link.data.url);
  return <img src={`${u.pathname}${u.search}`} alt={alt} data-testid={testId} style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 10, background: 'var(--color-surface-muted)' }} />;
}

/** Downloads a file the API returns from a POST (exports), keeping the session cookie first-party. */
export async function downloadPost(path: string, body: unknown, filename: string): Promise<void> {
  const res = await fetch(path, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', accept: '*/*' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new Error(j?.error?.code ?? `HTTP_${res.status}`);
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export function Counts({ data }: { data: Record<string, number> }) {
  const { t } = useI18n();
  const entries = Object.entries(data);
  if (!entries.length) return <span className="subtle">{t('woundAdmin.none')}</span>;
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      {entries.map(([k, n]) => (
        <span key={k} className="badge tone-neutral" data-testid={`wound-count-${k}`}>{`${k} · ${n}`}</span>
      ))}
    </div>
  );
}
