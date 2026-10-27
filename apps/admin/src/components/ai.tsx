'use client';
import { hasPermission, type Permission } from '@ghayarly/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from './Providers';
import { useMe } from './Shell';

export const AI_KEY = ['ai-control-centre'];
export const EVAL_KEY = ['ai-evaluation'];

const TABS = [
  { href: '/ai', key: 'aiAdmin.tabOverview', any: ['ai.config.manage', 'ai.usage.read'] },
  { href: '/ai/models', key: 'aiAdmin.tabModels', any: ['ai.config.manage', 'ai.usage.read'] },
  { href: '/ai/routing', key: 'aiAdmin.tabRouting', any: ['ai.config.manage', 'ai.usage.read'] },
  { href: '/ai/evaluation', key: 'aiAdmin.tabEvaluation', any: ['ai.eval.manage', 'ai.clinical.review', 'ai.config.manage'] },
  { href: '/ai/safety', key: 'aiAdmin.tabSafety', any: ['ai.safety.review'] },
] as const satisfies readonly { href: string; key: string; any: readonly Permission[] }[];

export function AiTabs() {
  const { t } = useI18n();
  const path = usePathname();
  const roles = useMe().data?.roles ?? [];
  return (
    <nav className="tabs" aria-label={t('aiAdmin.nav')} style={{ marginBottom: 16 }}>
      {TABS.filter((tab) => tab.any.some((p) => hasPermission(roles, p))).map((tab) => {
        const active = tab.href === '/ai' ? path === '/ai' : path.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} className={`tab ${active ? 'active' : ''}`} data-testid={`ai-tab-${tab.href.split('/')[2] ?? 'overview'}`}>
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}

export function useCan() {
  const roles = useMe().data?.roles ?? [];
  return (p: Permission) => hasPermission(roles, p);
}

/** Micro-dollars ↔ dollars (prices are per 1M tokens). */
export const toUsd = (micros: number | null) => (micros === null ? '' : String(micros / 1_000_000));
export const toMicros = (usd: string) => (usd.trim() === '' ? null : Math.round(Number(usd) * 1_000_000));

export function useUsd() {
  const { locale } = useI18n();
  return (micros: number | null) => (micros === null ? '—' : new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(micros / 1_000_000));
}

export function ErrorNotice({ error }: { error: unknown }) {
  return error ? (
    <div className="notice danger" data-testid="ai-error" role="alert">
      {error instanceof Error ? error.message : String(error)}
    </div>
  ) : null;
}
