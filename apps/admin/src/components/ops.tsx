'use client';
import type { TranslationKey } from '@ghayarly/i18n';
import { formatEgp, type Permission } from '@ghayarly/shared';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { ErrorNotice, useCan } from './ai';
import { useI18n } from './Providers';
import { Shell } from './Shell';

/** Operations Center sections. Care sections need ops.read; commerce sections need orders.manage / payments.read. */
export const OPS_TABS: { href: string; key: TranslationKey; any: Permission[] }[] = [
  { href: '/ops', key: 'opsAdmin.tab_overview', any: ['ops.read', 'orders.manage', 'payments.read'] },
  { href: '/ops/appointments', key: 'opsAdmin.tab_appointments', any: ['ops.read'] },
  { href: '/ops/schedules', key: 'opsAdmin.tab_schedules', any: ['ops.read'] },
  { href: '/ops/home-visits', key: 'opsAdmin.tab_homeVisits', any: ['ops.read'] },
  { href: '/ops/orders', key: 'opsAdmin.tab_orders', any: ['orders.manage'] },
  { href: '/ops/delivery', key: 'opsAdmin.tab_delivery', any: ['orders.manage'] },
  { href: '/ops/payments', key: 'opsAdmin.tab_payments', any: ['payments.read'] },
  { href: '/ops/notifications', key: 'opsAdmin.tab_notifications', any: ['ops.read'] },
  { href: '/ops/incidents', key: 'opsAdmin.tab_incidents', any: ['ops.read', 'orders.manage'] },
];

/**
 * Frame for every Operations Center page: section tabs filtered by the viewer's permissions, and a
 * permission notice instead of the page when the role does not cover it. The API and the database
 * enforce the same permissions (and RLS keeps care data away from commerce staff).
 */
export function OpsPage({ href, children, actions }: { href: string; children: ReactNode; actions?: ReactNode }) {
  const { t } = useI18n();
  const can = useCan();
  const tab = OPS_TABS.find((x) => x.href === href)!;
  const allowed = tab.any.some((p) => can(p));
  return (
    <Shell title={t('opsAdmin.title')} actions={actions}>
      <div className="stack">
        <nav aria-label={t('opsAdmin.title')}>
          <div className="tabs">
            {OPS_TABS.filter((x) => x.any.some((p) => can(p))).map((x) => (
              <Link key={x.href} href={x.href} className={`tab ${x.href === href ? 'active' : ''}`} aria-current={x.href === href ? 'page' : undefined} data-testid={`ops-tab-${x.href.split('/')[2] ?? 'overview'}`}>
                {t(x.key)}
              </Link>
            ))}
          </div>
        </nav>
        {allowed ? children : <div className="notice info" data-testid="ops-no-permission">{t('opsAdmin.noPermission')}</div>}
      </div>
    </Shell>
  );
}

export function Stat({ label, value, testId, tone }: { label: string; value: ReactNode; testId?: string; tone?: 'danger' | 'warning' }) {
  return (
    <div className="card tight stat" style={{ padding: 16 }} data-testid={testId}>
      <span className="subtle">{label}</span>
      <strong style={tone ? { color: `var(--color-${tone})` } : undefined}>{value}</strong>
    </div>
  );
}

export function StatGrid({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }} data-testid={testId}>
      {children}
    </div>
  );
}

export function useEgp() {
  const { locale } = useI18n();
  return (piasters: number | null | undefined) => (piasters === null || piasters === undefined ? '—' : formatEgp(piasters, locale));
}

export function Filter<T extends string>({ label, value, options, onChange, testId }: { label: string; value: T | ''; options: { value: T; label: string }[]; onChange: (v: T | '') => void; testId?: string }) {
  const { t } = useI18n();
  return (
    <label className="field" style={{ minWidth: 180 }}>
      <span>{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value as T | '')} data-testid={testId}>
        <option value="">{t('opsAdmin.all')}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Inline "reason + confirm" form for an audited action. Opens under the row that triggered it, so
 * keyboard and screen-reader users stay in context (no modal focus trap needed).
 */
export function ReasonForm({ title, hint, label, minLength = 5, onSubmit, onClose, pending, error, testId, children }: {
  title: string;
  hint?: string;
  label: string;
  minLength?: number;
  onSubmit: (reason: string) => void;
  onClose: () => void;
  pending?: boolean;
  error?: unknown;
  testId?: string;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [tooShort, setTooShort] = useState(false);
  return (
    <form
      className="card stack"
      style={{ borderInlineStart: '3px solid var(--color-primary)' }}
      data-testid={testId}
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim().length < minLength) return setTooShort(true);
        setTooShort(false);
        onSubmit(reason.trim());
      }}
    >
      <h3>{title}</h3>
      {hint ? <p className="subtle">{hint}</p> : null}
      {children}
      <label className="field">
        <span>{label}</span>
        <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} aria-invalid={tooShort} data-testid={testId ? `${testId}-reason` : undefined} autoFocus />
      </label>
      {tooShort ? <div className="notice warning" role="alert">{t('opsAdmin.reasonTooShort')}</div> : null}
      <ErrorNotice error={error} />
      <div className="row" style={{ gap: 8 }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending} data-testid={testId ? `${testId}-confirm` : undefined}>
          {t('opsAdmin.confirm')}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
          {t('opsAdmin.cancel')}
        </button>
      </div>
    </form>
  );
}

export function Empty() {
  const { t } = useI18n();
  return <div className="empty">{t('opsAdmin.none')}</div>;
}

export const SEVERITY_TONE: Record<string, string> = { LOW: 'neutral', MEDIUM: 'info', HIGH: 'warning', CRITICAL: 'danger' };
export const ORDER_TONE: Record<string, string> = { PENDING_PAYMENT: 'warning', CONFIRMED: 'primary', PROCESSING: 'primary', SHIPPED: 'info', DELIVERED: 'success', CANCELLED: 'neutral', EXPIRED: 'neutral' };
export const PAY_TONE: Record<string, string> = { UNPAID: 'neutral', PENDING: 'info', AUTHORIZED: 'info', PAID: 'success', SETTLED: 'success', FAILED: 'danger', PARTIALLY_REFUNDED: 'warning', REFUNDED: 'neutral', VOIDED: 'neutral' };
export const APPT_TONE: Record<string, string> = { REQUESTED: 'warning', CONFIRMED: 'primary', IN_PROGRESS: 'info', COMPLETED: 'success', DECLINED: 'neutral', CANCELLED: 'neutral', EXPIRED: 'neutral', NO_SHOW: 'danger', VISIT_FAILED: 'danger' };
