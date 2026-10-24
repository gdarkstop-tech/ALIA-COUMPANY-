'use client';
import { hasPermission } from '@ghayarly/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { AccountBadges } from '@/components/accounts';
import { useI18n } from '@/components/Providers';
import { formatDateTime, Shell, useMe } from '@/components/Shell';
import { api } from '@/lib/api';

const ROLE_FILTERS = ['ANY', 'PATIENT', 'DOCTOR', 'NURSE', 'STAFF'] as const;
const STATUS_FILTERS = ['ANY', 'ACTIVE', 'SUSPENDED', 'BLOCKED', 'BOOKINGS_RESTRICTED'] as const;

/** User management: search and filter accounts (no medical records are shown here). */
export default function Users() {
  const { t, locale } = useI18n();
  const me = useMe();
  const [q, setQ] = useState('');
  const [role, setRole] = useState<(typeof ROLE_FILTERS)[number]>('ANY');
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>('ANY');
  const users = useQuery({ queryKey: ['users', q, role, status], queryFn: () => api.admin.users({ ...(q.trim() ? { q: q.trim() } : {}), role, status }) });
  const canAppeals = me.data ? hasPermission(me.data.roles, 'users.appeals.decide') : false;
  return (
    <Shell title={t('admin.users')} actions={canAppeals ? <Link href="/users/appeals" className="btn btn-secondary" data-testid="open-appeals">{t('accounts.openAppeals')}</Link> : null}>
      <p className="muted">{t('accounts.usersIntro')}</p>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', margin: '12px 0' }}>
        <input className="input" style={{ maxWidth: 340 }} aria-label={t('accounts.search')} placeholder={t('accounts.search')} value={q} onChange={(e) => setQ(e.target.value)} data-testid="users-search" />
        <select className="input" style={{ maxWidth: 200 }} aria-label={t('admin.roles')} value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
          {ROLE_FILTERS.map((r) => <option key={r} value={r}>{t(`accounts.role_${r}`)}</option>)}
        </select>
        <select className="input" style={{ maxWidth: 220 }} aria-label={t('accounts.action')} value={status} onChange={(e) => setStatus(e.target.value as typeof status)} data-testid="users-status-filter">
          {STATUS_FILTERS.map((s) => <option key={s} value={s}>{t(`accounts.filter_${s}`)}</option>)}
        </select>
      </div>
      <div className="card tight">
        {users.error ? <div className="notice danger" style={{ margin: 16 }}>{String(users.error.message)}</div> : null}
        {users.data && !users.data.length ? <div className="empty">{t('accounts.none')}</div> : null}
        {users.data?.length ? (
          <table className="table" data-testid="users-table">
            <thead><tr><th>{t('auth.fullName')}</th><th>{t('admin.email')}</th><th>{t('admin.roles')}</th><th>{t('accounts.action')}</th><th>{t('admin.mfa')}</th><th>{t('accounts.lastSeen')}</th><th /></tr></thead>
            <tbody>
              {users.data.map((u) => (
                <tr key={u.id} data-testid={`user-row-${u.email}`}>
                  <td>
                    {u.name}
                    {u.deleted ? <div><span className="badge tone-neutral">{t('accounts.deleted')}</span></div> : null}
                    {u.isDemo ? <div><span className="badge tone-demo">{t('app.demoData')}</span></div> : null}
                  </td>
                  <td className="mono">{u.email}{u.phoneNumber ? <div className="subtle">{u.phoneNumber}</div> : null}</td>
                  <td><div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>{u.roles.map((r) => <span key={r} className="badge tone-primary">{t(`roles.${r}`)}</span>)}</div></td>
                  <td><AccountBadges account={u.account} /></td>
                  <td><span className={`badge tone-${u.twoFactorEnabled ? 'success' : 'warning'}`}>{u.twoFactorEnabled ? t('me.twoFactorOn') : t('me.twoFactorOff')}</span></td>
                  <td className="subtle">{formatDateTime(u.lastSeenAt, locale)}</td>
                  <td><Link className="btn btn-sm btn-secondary" href={`/users/${encodeURIComponent(u.id)}`} data-testid={`open-user-${u.email}`}>{t('accounts.open')}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </Shell>
  );
}
