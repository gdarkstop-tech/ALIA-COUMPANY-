'use client';
import type { TranslationKey } from '@ghayarly/i18n';
import { ORDER_STATUSES, type Order, type OrderStatus } from '@ghayarly/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNotice, useCan } from '@/components/ai';
import { Empty, Filter, OpsPage, ORDER_TONE, PAY_TONE, ReasonForm, useEgp } from '@/components/ops';
import { useI18n, useToast } from '@/components/Providers';
import { formatDateTime } from '@/components/Shell';
import { api } from '@/lib/api';

const NEXT_STEP: Partial<Record<OrderStatus, 'PROCESS' | 'SHIP' | 'DELIVER'>> = { CONFIRMED: 'PROCESS', PROCESSING: 'SHIP', SHIPPED: 'DELIVER' };
const CANCELLABLE: OrderStatus[] = ['PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING'];
const KNOWN_EVENTS = new Set(['PLACED', 'PAYMENT_STARTED', 'PAID', 'PAID_AFTER_CLOSE', 'AUTHORIZED', 'SETTLED', 'VOIDED', 'PAYMENT_FAILED', 'EXPIRED', 'CANCELLED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'REFUND_REQUESTED', 'REFUND_FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED']);

/**
 * Orders and fulfilment (orders.manage). Stock, prices and payment states come from the server; this
 * page only moves an order along its documented states. Refunds need payments.refund (administrators).
 */
export default function OpsOrders() {
  const { t, locale } = useI18n();
  const egp = useEgp();
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [selected, setSelected] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['ops-orders', status], queryFn: () => api.ops.orders({ status: status || undefined, limit: 200 }) });
  const rows = q.data?.orders ?? [];
  return (
    <OpsPage href="/ops/orders">
      <div className="notice info">{t('opsAdmin.ordersHint')}</div>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Filter label={t('opsAdmin.filterStatus')} value={status} onChange={setStatus} options={ORDER_STATUSES.map((s) => ({ value: s, label: t(`orders.status_${s}`) }))} testId="ops-orders-status" />
      </div>
      <ErrorNotice error={q.error} />
      <div className="grid" style={{ gridTemplateColumns: selected ? 'minmax(0, 1.1fr) minmax(0, 1fr)' : '1fr', gap: 16, alignItems: 'start' }}>
        <div className="card tight" style={{ overflowX: 'auto' }} data-testid="ops-orders">
          {q.isPending ? <div className="skeleton" style={{ height: 160 }} /> : null}
          {q.data && !rows.length ? <Empty /> : null}
          {rows.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('opsAdmin.colReference')}</th>
                  <th scope="col">{t('opsAdmin.colCreated')}</th>
                  <th scope="col">{t('opsAdmin.colArea')}</th>
                  <th scope="col">{t('opsAdmin.colItems')}</th>
                  <th scope="col">{t('opsAdmin.colTotal')}</th>
                  <th scope="col">{t('opsAdmin.colStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} aria-selected={selected === o.id} style={selected === o.id ? { background: 'var(--color-primary-soft)' } : undefined}>
                    <td>
                      <button className="btn btn-sm btn-ghost mono" onClick={() => setSelected(o.id)} data-testid={`ops-order-${o.reference}`}>
                        {o.reference}
                      </button>
                      {o.isDemo ? <span className="badge tone-demo">{t('app.demoBadge')}</span> : null}
                    </td>
                    <td>{formatDateTime(o.createdAt, locale)}</td>
                    <td>{t(`governorate.${o.governorate as 'CAIRO'}`)}</td>
                    <td className="mono">{o.itemCount}</td>
                    <td className="mono">
                      {egp(o.totalPiasters)}
                      {o.refundedPiasters ? <div className="subtle">− {egp(o.refundedPiasters)}</div> : null}
                    </td>
                    <td>
                      <span className={`badge tone-${ORDER_TONE[o.status]}`}>{t(`orders.status_${o.status}`)}</span>{' '}
                      <span className={`badge tone-${PAY_TONE[o.paymentStatus]}`}>{t(`orders.pay_${o.paymentStatus}`)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
        {selected ? <OrderPanel id={selected} onClose={() => setSelected(null)} /> : null}
      </div>
    </OpsPage>
  );
}

function OrderPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const can = useCan();
  const egp = useEgp();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<'cancel' | 'refund' | null>(null);
  const [tracking, setTracking] = useState('');
  const [amount, setAmount] = useState('');
  const [restock, setRestock] = useState(false);
  const q = useQuery({ queryKey: ['ops-order', id], queryFn: () => api.ops.order(id) });
  const done = async (o: Order) => {
    qc.setQueryData(['ops-order', id], o);
    setForm(null);
    toast(t('opsAdmin.saved'));
    await qc.invalidateQueries({ queryKey: ['ops-orders'] });
  };
  const fulfil = useMutation({ mutationFn: (action: 'PROCESS' | 'SHIP' | 'DELIVER') => api.ops.fulfilOrder(id, action, tracking.trim() || undefined), onSuccess: done });
  const cancel = useMutation({ mutationFn: (reason: string) => api.ops.cancelOrder(id, reason), onSuccess: done });
  const refund = useMutation({ mutationFn: (reason: string) => api.ops.refundOrder(id, { amountPiasters: Math.round(Number(amount) * 100), reason, restock }), onSuccess: done });
  const o = q.data;
  if (!o) return <div className="card">{q.error ? <ErrorNotice error={q.error} /> : <div className="skeleton" style={{ height: 240 }} />}</div>;
  const next = NEXT_STEP[o.status];
  const inFlight = (o.refunds ?? []).filter((r) => r.status === 'REQUESTED' || r.status === 'PROCESSING').reduce((n, r) => n + r.amountPiasters, 0);
  const refundable = o.paid ? Math.max(0, o.totalPiasters - o.refundedPiasters - inFlight) : 0;

  return (
    <section className="card stack" data-testid="ops-order-panel" aria-label={`${t('opsAdmin.orderDetail')} ${o.reference}`}>
      <div className="spread">
        <h2 className="mono">{o.reference}</h2>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>{t('opsAdmin.cancel')}</button>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className={`badge tone-${ORDER_TONE[o.status]}`} data-testid="ops-order-status">{t(`orders.status_${o.status}`)}</span>
        <span className={`badge tone-${PAY_TONE[o.paymentStatus]}`} data-testid="ops-order-payment">{t(`orders.pay_${o.paymentStatus}`)}</span>
        <span className={`badge tone-${o.paid ? 'success' : 'neutral'}`}>{o.paid ? t('opsAdmin.paidVerified') : t('opsAdmin.notPaid')}</span>
      </div>

      <table className="table">
        <tbody>
          {o.lines.map((l) => (
            <tr key={l.id}>
              <td>
                {locale === 'ar' ? l.nameAr : l.nameEn}
                <div className="subtle">{`${locale === 'ar' ? l.labelAr : l.labelEn}${l.sku ? ` · ${l.sku}` : ''}`}</div>
              </td>
              <td className="mono">× {l.quantity}</td>
              <td className="mono">{egp(l.lineTotalPiasters)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="kv">
        <dt>{t('store.subtotal')}</dt><dd className="mono">{egp(o.subtotalPiasters)}</dd>
        {o.discountPiasters ? <><dt>{t('store.discount')}</dt><dd className="mono">− {egp(o.discountPiasters)}{o.discount?.code ? ` (${o.discount.code})` : ''}</dd></> : null}
        <dt>{t('store.delivery')}</dt><dd className="mono">{egp(o.deliveryFeePiasters)}</dd>
        <dt>{t('opsAdmin.colTotal')}</dt><dd className="mono"><strong>{egp(o.totalPiasters)}</strong></dd>
        {o.refundedPiasters ? <><dt>{t('orders.refunded')}</dt><dd className="mono">{egp(o.refundedPiasters)}</dd></> : null}
      </dl>

      <h3>{t('opsAdmin.delivery')}</h3>
      <dl className="kv">
        <dt>{t('orders.recipient')}</dt><dd>{o.delivery.recipientName}</dd>
        <dt>{t('orders.phone')}</dt><dd className="mono" dir="ltr">{o.delivery.phone}</dd>
        <dt>{t('opsAdmin.colArea')}</dt><dd>{[t(`governorate.${o.delivery.governorate as 'CAIRO'}`), o.delivery.city, o.delivery.district].filter(Boolean).join(' · ')}</dd>
        <dt>{t('orders.address')}</dt><dd>{o.delivery.address}</dd>
        {o.delivery.notes ? <><dt>{t('orders.notes')}</dt><dd>{o.delivery.notes}</dd></> : null}
        {o.trackingReference ? <><dt>{t('orders.tracking')}</dt><dd className="mono">{o.trackingReference}</dd></> : null}
      </dl>

      {can('orders.manage') && (next || CANCELLABLE.includes(o.status)) ? (
        <div className="stack" style={{ gap: 8 }}>
          {next === 'SHIP' ? (
            <label className="field">
              <span>{t('opsAdmin.trackingLabel')}</span>
              <input className="input mono" value={tracking} maxLength={80} onChange={(e) => setTracking(e.target.value)} data-testid="ops-order-tracking" />
            </label>
          ) : null}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {next ? (
              <button className="btn btn-sm btn-primary" disabled={fulfil.isPending} onClick={() => fulfil.mutate(next)} data-testid={`ops-order-${next}`}>
                {t(`opsAdmin.fulfil_${next}`)}
              </button>
            ) : null}
            {CANCELLABLE.includes(o.status) ? (
              <button className="btn btn-sm btn-secondary" onClick={() => setForm('cancel')} data-testid="ops-order-cancel">{t('opsAdmin.cancelOrder')}</button>
            ) : null}
            {can('payments.refund') && refundable > 0 ? (
              <button className="btn btn-sm btn-secondary" onClick={() => { setAmount(String(refundable / 100)); setForm('refund'); }} data-testid="ops-order-refund">{t('opsAdmin.refund')}</button>
            ) : null}
          </div>
          <ErrorNotice error={fulfil.error} />
        </div>
      ) : can('payments.refund') && refundable > 0 ? (
        <button className="btn btn-sm btn-secondary" onClick={() => { setAmount(String(refundable / 100)); setForm('refund'); }} data-testid="ops-order-refund">{t('opsAdmin.refund')}</button>
      ) : null}

      {form === 'cancel' ? (
        <ReasonForm title={t('opsAdmin.cancelOrder')} hint={t('opsAdmin.cancelOrderHint')} label={t('opsAdmin.reasonLabel')} pending={cancel.isPending} error={cancel.error} onClose={() => setForm(null)} onSubmit={(r) => cancel.mutate(r)} testId="ops-order-cancel-form" />
      ) : null}
      {form === 'refund' ? (
        <ReasonForm title={t('opsAdmin.refund')} hint={t('opsAdmin.refundHint')} label={t('opsAdmin.colReason')} pending={refund.isPending} error={refund.error} onClose={() => setForm(null)} onSubmit={(r) => refund.mutate(r)} testId="ops-order-refund-form">
          <div className="subtle">{t('opsAdmin.refundable', { amount: egp(refundable) })}</div>
          <label className="field">
            <span>{t('opsAdmin.refundAmount')}</span>
            <input className="input mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} data-testid="ops-order-refund-amount" />
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
            {t('opsAdmin.restock')}
          </label>
        </ReasonForm>
      ) : null}

      {o.payments?.length ? (
        <>
          <h3>{t('opsAdmin.payments')}</h3>
          <table className="table">
            <tbody>
              {o.payments.map((p) => (
                <tr key={p.id}>
                  <td><span className={`badge tone-${PAY_TONE[p.status]}`}>{t(`orders.pay_${p.status}`)}</span> <span className="badge tone-neutral">{t(`opsAdmin.mode_${p.mode}`)}</span></td>
                  <td className="mono">{egp(p.amountPiasters)}</td>
                  <td className="mono">{p.transactionId ?? '—'}</td>
                  <td className="subtle">{formatDateTime(p.createdAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {o.refunds?.length ? (
        <>
          <h3>{t('opsAdmin.refunds')}</h3>
          <table className="table">
            <tbody>
              {o.refunds.map((r) => (
                <tr key={r.id}>
                  <td><span className={`badge tone-${r.status === 'SUCCEEDED' ? 'success' : r.status === 'FAILED' ? 'danger' : 'info'}`}>{t(`opsAdmin.rf_${r.status}`)}</span></td>
                  <td className="mono">{egp(r.amountPiasters)}</td>
                  <td>{r.reason}{r.failureCode ? <div className="subtle mono">{r.failureCode}</div> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {o.events?.length ? (
        <>
          <h3>{t('opsAdmin.history')}</h3>
          <ul className="timeline">
            {o.events.map((e, i) => (
              <li key={i}>
                <span className="dot" aria-hidden />
                <div>
                  <div>{KNOWN_EVENTS.has(e.event) ? t(`orders.ev_${e.event}` as TranslationKey) : e.event}<span className="subtle">{` · ${e.actorRole}`}</span></div>
                  {e.note ? <div className="subtle">{e.note}</div> : null}
                  <div className="subtle">{formatDateTime(e.at, locale)}</div>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
