'use client';
import { hasPermission, isStaff, type Permission } from '@ghayarly/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { DmwWordmark } from './brand';
import { useI18n } from './Providers';

type NavKey = 'admin.overview' | 'admin.verification' | 'admin.users' | 'admin.audit' | 'admin.features' | 'admin.security' | 'catalog.nav' | 'aiAdmin.nav';
// `permissions`: shown when the account holds ANY of them (the API and the database enforce each action).
const NAV: { href: string; key: NavKey; icon: string; permissions?: Permission[] }[] = [
  { href: '/', key: 'admin.overview', icon: '◎', permissions: ['provider.verification.review'] },
  { href: '/verification', key: 'admin.verification', icon: '✓', permissions: ['provider.verification.review'] },
  { href: '/catalog', key: 'catalog.nav', icon: '▦', permissions: ['catalog.tetrasol.manage', 'catalog.content.approve'] },
  { href: '/users', key: 'admin.users', icon: '◍', permissions: ['users.read'] },
  { href: '/audit', key: 'admin.audit', icon: '≡', permissions: ['audit.read'] },
  { href: '/ai', key: 'aiAdmin.nav', icon: '✦', permissions: ['ai.config.manage', 'ai.usage.read', 'ai.eval.manage', 'ai.clinical.review', 'ai.safety.review', 'knowledge.manage', 'catalog.tetrasol.manage'] },
  // ADMIN-only (the API and the database both enforce the ADMIN role).
  { href: '/features', key: 'admin.features', icon: '⚑', permissions: ['users.roles.grant'] },
  { href: '/security', key: 'admin.security', icon: '⚿' },
];

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api.me.get() });
}

export function Shell({ children, title, actions }: { children: ReactNode; title: string; actions?: ReactNode }) {
  const { t, locale, setLocale } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const me = useMe();
  const status = useQuery({ queryKey: ['status'], queryFn: () => api.system.status() });
  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;

  useEffect(() => {
    if (unauthenticated) router.replace('/login');
  }, [unauthenticated, router]);

  if (me.isPending || unauthenticated) {
    return (
      <div className="login-wrap">
        <div className="skeleton" style={{ width: 220 }} />
      </div>
    );
  }
  if (me.error) return <div className="login-wrap"><div className="notice danger">{String(me.error.message)}</div></div>;
  const roles = me.data.roles;
  if (!isStaff(roles)) {
    return (
      <div className="login-wrap">
        <div className="card login-card stack" data-testid="no-access">
          <h2>{t('admin.noAccessTitle')}</h2>
          <p className="muted">{t('admin.noPermission')}</p>
          <button className="btn btn-secondary" onClick={async () => { await authClient.signOut(); router.replace('/login'); }}>{t('common.signOut')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <DmwWordmark width={212} onInverse subtitle testId="admin-brand" />
        </div>
        {NAV.filter((n) => !n.permissions || n.permissions.some((p) => hasPermission(roles, p))).map((n) => (
          <Link key={n.href} href={n.href} className={`nav-item ${(n.href === '/' ? pathname === '/' : pathname.startsWith(n.href)) ? 'active' : ''}`} data-testid={`nav-${n.href.replace('/', '') || 'overview'}`}>
            <span aria-hidden>{n.icon}</span>
            {t(n.key)}
          </Link>
        ))}
        <div className="sidebar-foot">
          <div>{me.data.profile.displayName}</div>
          <div className="row" style={{ gap: 6 }}>
            {roles.map((r) => (
              <span key={r} className="badge tone-primary">{t(`roles.${r}`)}</span>
            ))}
          </div>
          <div className="row">
            <button className="btn btn-sm btn-secondary" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')} data-testid="admin-locale">
              {locale === 'ar' ? 'English' : 'العربية'}
            </button>
            <button className="btn btn-sm btn-ghost" style={{ color: 'inherit' }} onClick={async () => { await authClient.signOut(); router.replace('/login'); }} data-testid="admin-sign-out">
              {t('common.signOut')}
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        {status.data?.demoMode ? <div className="notice demo" style={{ marginBottom: 16 }} data-testid="admin-demo-banner">{t('app.demoModeBanner')}</div> : null}
        {!me.data.user.twoFactorEnabled ? (
          <div className="notice warning spread" style={{ marginBottom: 16 }} data-testid="mfa-warning">
            <span>{t('admin.mfaNotEnrolled')}</span>
            <Link href="/security" className="btn btn-sm btn-secondary">{t('admin.enableMfa')}</Link>
          </div>
        ) : null}
        <div className="topbar">
          <h1>{title}</h1>
          {actions}
        </div>
        {children}
      </main>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const tone = status === 'APPROVED' ? 'success' : status === 'REJECTED' || status === 'SUSPENDED' ? 'danger' : status === 'CHANGES_REQUESTED' ? 'warning' : status === 'DRAFT' ? 'neutral' : 'info';
  return <span className={`badge tone-${tone}`} data-testid="status-badge">{t(`provider.status_${status as 'DRAFT'}`)}</span>;
}

export function formatDateTime(iso: string | null | undefined, locale: string) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}
