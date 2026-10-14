'use client';
import { VERIFICATION_STATUSES } from '@ghayarly/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useI18n } from '@/components/Providers';
import { Shell, StatusBadge } from '@/components/Shell';
import { api } from '@/lib/api';

export default function Overview() {
  const { t } = useI18n();
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api.admin.overview() });
  const status = useQuery({ queryKey: ['status'], queryFn: () => api.system.status() });
  const count = (s: string, type?: string) => (overview.data?.providersByStatus ?? []).filter((r) => r.status === s && (!type || r.type === type)).reduce((a, r) => a + r.n, 0);
  const open = count('SUBMITTED') + count('UNDER_REVIEW');
  return (
    <Shell title={t('admin.overview')}>
      <div className="stack">
        <div className="grid grid-4">
          <Link href="/verification" className="card stat" style={{ textDecoration: 'none', color: 'inherit' }} data-testid="stat-open">
            <span className="subtle">{t('admin.queue')}</span>
            <strong>{overview.isPending ? '…' : open}</strong>
            <span className="badge tone-info" style={{ alignSelf: 'flex-start' }}>{t('admin.filterOpen')}</span>
          </Link>
          <div className="card stat">
            <span className="subtle">{t('roles.DOCTOR')}</span>
            <strong>{count('APPROVED', 'DOCTOR')}</strong>
            <span className="badge tone-success" style={{ alignSelf: 'flex-start' }}>{t('provider.status_APPROVED')}</span>
          </div>
          <div className="card stat">
            <span className="subtle">{t('roles.NURSE')}</span>
            <strong>{count('APPROVED', 'NURSE')}</strong>
            <span className="badge tone-success" style={{ alignSelf: 'flex-start' }}>{t('provider.status_APPROVED')}</span>
          </div>
          <div className="card stat">
            <span className="subtle">{t('admin.mfaEnforcement')}</span>
            <strong style={{ fontSize: 20 }}>{overview.data?.mfaEnforcement === 'required' ? t('common.required') : 'warn (dev)'}</strong>
            <span className="subtle">{t('admin.environment')}: {status.data?.environment ?? '…'}</span>
          </div>
        </div>
        <div className="grid grid-2">
          <div className="card stack">
            <h2>{t('admin.providersByStatus')}</h2>
            <table className="table">
              <tbody>
                {VERIFICATION_STATUSES.map((s) => (
                  <tr key={s}>
                    <td><StatusBadge status={s} /></td>
                    <td className="mono">{count(s, 'DOCTOR')} · {t('roles.DOCTOR')}</td>
                    <td className="mono">{count(s, 'NURSE')} · {t('roles.NURSE')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card stack">
            <h2>{t('me.systemStatus')}</h2>
            {status.data
              ? (Object.entries(status.data.integrations) as [string, string][]).map(([k, v]) => (
                  <div key={k} className="spread">
                    <span>{t(`status.${k as 'payments'}`)}</span>
                    <span className={`badge tone-${v === 'CONFIGURED' ? 'success' : v === 'DEV_ADAPTER' ? 'demo' : 'warning'}`}>{t(`status.${v as 'CONFIGURED'}`)}</span>
                  </div>
                ))
              : null}
          </div>
        </div>
      </div>
    </Shell>
  );
}
