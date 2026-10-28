'use client';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BrandLoader } from '@/components/brand';
import { useI18n } from '@/components/Providers';
import { formatDateTime, Shell, StatusBadge } from '@/components/Shell';
import { api } from '@/lib/api';

const FILTERS = [
  ['OPEN', 'admin.filterOpen'],
  ['CHANGES_REQUESTED', 'admin.filterChanges'],
  ['APPROVED', 'admin.filterApproved'],
  ['REJECTED', 'admin.filterRejected'],
  ['ALL', 'admin.filterAll'],
] as const;

export default function VerificationQueue() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>('OPEN');
  const queue = useQuery({ queryKey: ['queue', filter], queryFn: () => api.admin.queue(filter) });
  return (
    <Shell title={t('admin.queue')}>
      <div className="stack">
        <div className="tabs" role="tablist">
          {FILTERS.map(([value, key]) => (
            <button key={value} role="tab" aria-selected={filter === value} className={`tab ${filter === value ? 'active' : ''}`} onClick={() => setFilter(value)} data-testid={`filter-${value}`}>
              {t(key)}
            </button>
          ))}
        </div>
        <div className="card tight">
          {queue.isPending ? (
            <BrandLoader />
          ) : queue.error ? (
            <div className="notice danger" style={{ margin: 16 }}>{String(queue.error.message)}</div>
          ) : queue.data.length === 0 ? (
            <div className="empty">{t('admin.queueEmpty')}</div>
          ) : (
            <table className="table" data-testid="queue-table">
              <thead>
                <tr>
                  <th>{t('admin.profile')}</th>
                  <th>{t('admin.type')}</th>
                  <th>{t('admin.location')}</th>
                  <th>{t('admin.credentials')}</th>
                  <th>{t('admin.submitted')}</th>
                  <th>{t('provider.verificationTitle')}</th>
                </tr>
              </thead>
              <tbody>
                {queue.data.map((q) => (
                  <tr key={q.userId} className="clickable" onClick={() => router.push(`/verification/${encodeURIComponent(q.userId)}`)} data-testid={`queue-row-${q.userId}`}>
                    <td>
                      <strong>{locale === 'ar' ? q.displayNameAr : q.displayNameEn}</strong>
                      <div className="subtle">{q.specialty ? t(`specialty.${q.specialty as 'GENERAL_SURGERY'}`) : ''} {q.isDemo ? <span className="badge tone-demo">{t('app.demoBadge')}</span> : null}</div>
                    </td>
                    <td>{t(`roles.${q.providerType}`)}</td>
                    <td>{t(`governorate.${q.governorate as 'CAIRO'}`)}</td>
                    <td>
                      <span className="mono">{q.credentialCount}</span>{' '}
                      {q.pendingCredentialCount ? <span className="badge tone-info">{t('admin.pendingCount', { count: q.pendingCredentialCount })}</span> : null}
                    </td>
                    <td className="subtle">{formatDateTime(q.submittedAt, locale)}</td>
                    <td><StatusBadge status={q.verificationStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Shell>
  );
}
