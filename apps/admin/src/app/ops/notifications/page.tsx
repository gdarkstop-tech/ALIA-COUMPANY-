'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNotice, useCan } from '@/components/ai';
import { Empty, Filter, OpsPage } from '@/components/ops';
import { useI18n, useToast } from '@/components/Providers';
import { formatDateTime } from '@/components/Shell';
import { api } from '@/lib/api';

const STATUSES = ['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'UNDELIVERABLE', 'EXPIRED', 'CANCELLED'] as const;
type NStatus = (typeof STATUSES)[number];

/** E-mail / SMS deliveries (ops.read). Recipients arrive masked from the API; message bodies and codes are never sent here. */
export default function OpsNotifications() {
  const { t, locale } = useI18n();
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState<NStatus | ''>('FAILED');
  const q = useQuery({ queryKey: ['ops-notifications', status], queryFn: () => api.ops.notifications({ status: status || undefined, limit: 200 }) });
  const retry = useMutation({
    mutationFn: (id: string) => api.ops.retryNotification(id),
    onSuccess: async () => {
      toast(t('opsAdmin.retried'));
      await qc.invalidateQueries({ queryKey: ['ops-notifications'] });
    },
  });
  const rows = q.data?.messages ?? [];
  return (
    <OpsPage href="/ops/notifications">
      <div className="notice info">{t('opsAdmin.notificationsHint')}</div>
      <section className="card stack">
        <h2>{t('opsAdmin.deliveryProviders')}</h2>
        <dl className="kv" data-testid="ops-delivery-providers">
          <dt>{t('status.email')}</dt>
          <dd>{t(`status.${(q.data?.delivery.email ?? 'NOT_CONFIGURED') as 'CONFIGURED'}`)}</dd>
          <dt>{t('status.sms')}</dt>
          <dd>{t(`status.${(q.data?.delivery.sms ?? 'NOT_CONFIGURED') as 'CONFIGURED'}`)}</dd>
        </dl>
      </section>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Filter label={t('opsAdmin.filterStatus')} value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: t(`opsAdmin.ns_${s}`) }))} testId="ops-notifications-status" />
      </div>
      <ErrorNotice error={q.error ?? retry.error} />
      <div className="card tight" style={{ overflowX: 'auto' }} tabIndex={0} role="region" aria-label={t('opsAdmin.tab_notifications')} data-testid="ops-notifications">
        {q.isPending ? <div className="skeleton" style={{ height: 160 }} /> : null}
        {q.data && !rows.length ? <Empty /> : null}
        {rows.length ? (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('opsAdmin.colCreated')}</th>
                <th scope="col">{t('opsAdmin.colChannel')}</th>
                <th scope="col">{t('opsAdmin.colPurpose')}</th>
                <th scope="col">{t('opsAdmin.colRecipient')}</th>
                <th scope="col">{t('opsAdmin.colStatus')}</th>
                <th scope="col">{t('opsAdmin.colAttempts')}</th>
                <th scope="col">{t('opsAdmin.colError')}</th>
                <th scope="col">{t('opsAdmin.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>{formatDateTime(m.createdAt, locale)}</td>
                  <td>{m.channel === 'SMS' ? t('status.sms') : t('status.email')}</td>
                  <td className="mono">{m.purpose}</td>
                  <td className="mono" dir="ltr">{m.recipient}</td>
                  <td><span className={`badge tone-${m.status === 'FAILED' || m.status === 'UNDELIVERABLE' ? 'danger' : m.status === 'DELIVERED' || m.status === 'SENT' ? 'success' : 'neutral'}`}>{t(`opsAdmin.ns_${m.status as NStatus}`)}</span></td>
                  <td className="mono">{m.attempts}</td>
                  <td className="subtle">{m.last_error ?? '—'}</td>
                  <td>
                    {can('ops.manage') && (m.status === 'FAILED' || m.status === 'UNDELIVERABLE') ? (
                      <button className="btn btn-sm btn-secondary" disabled={retry.isPending} onClick={() => retry.mutate(m.id)} data-testid={`ops-retry-${m.id}`}>
                        {t('opsAdmin.retry')}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </OpsPage>
  );
}
