'use client';
import type { TranslationKey } from '@ghayarly/i18n';
import { PAYMENT_STATUSES, type PaymentStatus } from '@ghayarly/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNotice, useCan } from '@/components/ai';
import { Empty, Filter, OpsPage, PAY_TONE, useEgp } from '@/components/ops';
import { useI18n } from '@/components/Providers';
import { formatDateTime } from '@/components/Shell';
import { api } from '@/lib/api';

/**
 * Payments (payments.read) and the refund queue. States come only from verified Paymob callbacks and
 * transaction inquiries; reconciliation (administrators) re-checks open and unsettled payments.
 */
export default function OpsPayments() {
  const { t, locale } = useI18n();
  const can = useCan();
  const egp = useEgp();
  const qc = useQueryClient();
  const [status, setStatus] = useState<PaymentStatus | ''>('');
  const q = useQuery({ queryKey: ['ops-payments', status], queryFn: () => api.ops.payments({ status: status || undefined, limit: 200 }) });
  const refunds = useQuery({ queryKey: ['ops-refunds', 'OPEN'], queryFn: () => api.ops.refunds({ status: 'OPEN' }) });
  const reconcile = useMutation({
    mutationFn: () => api.ops.reconcilePayments(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['ops-payments'] });
      await qc.invalidateQueries({ queryKey: ['ops-refunds'] });
    },
  });
  const g = q.data?.gateway;
  const rows = q.data?.payments ?? [];
  return (
    <OpsPage href="/ops/payments">
      <div className="notice info">{t('opsAdmin.paymentsHint')}</div>
      <ErrorNotice error={q.error ?? refunds.error} />
      <section className="card stack" data-testid="ops-gateway">
        <div className="spread" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h2>{t('opsAdmin.gateway')}</h2>
          {can('payments.refund') ? (
            <button className="btn btn-sm btn-secondary" disabled={reconcile.isPending || g?.status !== 'CONFIGURED'} onClick={() => reconcile.mutate()} data-testid="ops-reconcile">
              {t('opsAdmin.reconcile')}
            </button>
          ) : null}
        </div>
        <dl className="kv">
          <dt>Paymob</dt>
          <dd><span className={`badge tone-${g?.status === 'CONFIGURED' ? 'success' : 'warning'}`} data-testid="ops-gateway-status">{t(`status.${(g?.status ?? 'NOT_CONFIGURED') as 'CONFIGURED'}`)}</span></dd>
          <dt>{t('opsAdmin.gatewayMode')}</dt>
          <dd>{g?.mode ? t(`opsAdmin.mode_${g.mode as 'TEST'}`) : '—'}</dd>
          <dt>{t('opsAdmin.inquiry')}</dt>
          <dd>{t(`status.${(g?.inquiry === 'AVAILABLE' ? 'CONFIGURED' : 'NOT_CONFIGURED') as 'CONFIGURED'}`)}</dd>
        </dl>
        {g?.reason ? <div className="notice warning" data-testid="ops-gateway-reason">{t(`opsAdmin.reason_${g.reason}` as TranslationKey)}</div> : null}
        {can('payments.refund') ? <p className="subtle">{t('opsAdmin.reconcileHint')}</p> : null}
        <ErrorNotice error={reconcile.error} />
        {reconcile.data ? <div className="notice info" role="status" data-testid="ops-reconcile-result">{t('opsAdmin.reconcileResult', { ...reconcile.data })}</div> : null}
      </section>

      <section className="card stack" data-testid="ops-refund-queue">
        <h2>{t('opsAdmin.refundQueue')}</h2>
        {refunds.data && !refunds.data.length ? <Empty /> : null}
        {refunds.data?.length ? (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('opsAdmin.colOrder')}</th>
                <th scope="col">{t('opsAdmin.colAmount')}</th>
                <th scope="col">{t('opsAdmin.colStatus')}</th>
                <th scope="col">{t('opsAdmin.colReason')}</th>
                <th scope="col">{t('opsAdmin.colCreated')}</th>
              </tr>
            </thead>
            <tbody>
              {refunds.data.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.orderReference}</td>
                  <td className="mono">{egp(r.amountPiasters)}</td>
                  <td>
                    <span className={`badge tone-${r.status === 'FAILED' ? 'danger' : 'info'}`}>{t(`opsAdmin.rf_${r.status}`)}</span>
                    {r.failureCode ? <div className="subtle mono">{r.failureCode}</div> : null}
                  </td>
                  <td>{r.reason}</td>
                  <td>{formatDateTime(r.createdAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Filter label={t('opsAdmin.filterStatus')} value={status} onChange={setStatus} options={PAYMENT_STATUSES.map((s) => ({ value: s, label: t(`orders.pay_${s}`) }))} testId="ops-payments-status" />
      </div>
      <div className="card tight" style={{ overflowX: 'auto' }} data-testid="ops-payments">
        {q.isPending ? <div className="skeleton" style={{ height: 160 }} /> : null}
        {q.data && !rows.length ? <Empty /> : null}
        {rows.length ? (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('opsAdmin.colOrder')}</th>
                <th scope="col">{t('opsAdmin.colStatus')}</th>
                <th scope="col">{t('opsAdmin.colMode')}</th>
                <th scope="col">{t('opsAdmin.colAmount')}</th>
                <th scope="col">{t('opsAdmin.colTransaction')}</th>
                <th scope="col">{t('opsAdmin.colVerified')}</th>
                <th scope="col">{t('opsAdmin.colSettled')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.orderReference}</td>
                  <td><span className={`badge tone-${PAY_TONE[p.status]}`}>{t(`orders.pay_${p.status}`)}</span></td>
                  <td>{t(`opsAdmin.mode_${p.mode}`)}</td>
                  <td className="mono">
                    {egp(p.amountPiasters)}
                    {p.refundedPiasters ? <div className="subtle">− {egp(p.refundedPiasters)}</div> : null}
                  </td>
                  <td className="mono">{p.transactionId ?? '—'}</td>
                  <td>{formatDateTime(p.lastVerifiedAt, locale)}</td>
                  <td>{formatDateTime(p.settledAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </OpsPage>
  );
}
