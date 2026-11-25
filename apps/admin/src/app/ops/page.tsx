'use client';
import type { TranslationKey } from '@ghayarly/i18n';
import { formatNumber } from '@ghayarly/i18n';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ErrorNotice, useCan } from '@/components/ai';
import { OpsPage, SEVERITY_TONE, Stat, StatGrid, useEgp } from '@/components/ops';
import { useI18n } from '@/components/Providers';
import { formatDateTime } from '@/components/Shell';
import { api } from '@/lib/api';

/** One screen for what needs attention now. Each block appears only for roles that cover it. */
export default function OpsOverview() {
  const { t, locale } = useI18n();
  const can = useCan();
  const egp = useEgp();
  const num = (n: number) => formatNumber(n, locale);
  const care = can('ops.read');
  const commerce = can('orders.manage');
  const money = can('payments.read');
  const incidents = useQuery({ queryKey: ['ops-incidents', 'UNRESOLVED', ''], queryFn: () => api.ops.incidents({ status: 'UNRESOLVED' }), enabled: care || commerce });
  const appts = useQuery({ queryKey: ['ops-appointments', '', ''], queryFn: () => api.ops.appointments({ limit: 1 }), enabled: care });
  const orders = useQuery({ queryKey: ['ops-orders', ''], queryFn: () => api.ops.orders({ limit: 1 }), enabled: commerce });
  const pays = useQuery({ queryKey: ['ops-payments', ''], queryFn: () => api.ops.payments({ limit: 1 }), enabled: money });
  const msgs = useQuery({ queryKey: ['ops-notifications', ''], queryFn: () => api.ops.notifications({ limit: 1 }), enabled: care });
  const sum = (r?: Record<string, number>) => Object.values(r ?? {}).reduce((a, b) => a + b, 0);
  const open = incidents.data ?? [];

  return (
    <OpsPage href="/ops">
      <div className="notice info" data-testid="ops-note">{t('opsAdmin.note')}</div>
      <ErrorNotice error={incidents.error ?? appts.error ?? orders.error ?? pays.error ?? msgs.error} />

      {care || commerce ? (
        <section className="card stack" data-testid="ops-overview-incidents">
          <div className="spread">
            <h2>{t('opsAdmin.openIncidents')}</h2>
            <Link href="/ops/incidents" className="btn btn-sm btn-secondary">{t('opsAdmin.tab_incidents')}</Link>
          </div>
          <StatGrid>
            {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((s) => (
              <Stat key={s} label={t(`opsAdmin.sev_${s}`)} value={num(open.filter((i) => i.severity === s).length)} tone={s === 'CRITICAL' || s === 'HIGH' ? (open.some((i) => i.severity === s) ? 'danger' : undefined) : undefined} testId={`ops-incidents-${s}`} />
            ))}
          </StatGrid>
          {open.slice(0, 5).map((i) => (
            <div key={i.id} className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span className={`badge tone-${SEVERITY_TONE[i.severity]}`}>{t(`opsAdmin.sev_${i.severity}`)}</span>
              <span className="badge tone-neutral">{t(`opsAdmin.domain_${i.domain}`)}</span>
              <span>{t(`opsAdmin.ik_${i.kind}`)}</span>
              <span className="subtle">{formatDateTime(i.createdAt, locale)}</span>
            </div>
          ))}
        </section>
      ) : null}

      {care ? (
        <section className="card stack" data-testid="ops-overview-care">
          <div className="spread">
            <h2>{t('opsAdmin.appointments30')}</h2>
            <span className="subtle">{num(sum(appts.data?.last30Days))}</span>
          </div>
          <StatGrid>
            {(['REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_SHOW', 'VISIT_FAILED'] as const).map((s) => (
              <Stat key={s} label={t(`booking.status_${s}`)} value={num(appts.data?.last30Days[s] ?? 0)} tone={(s === 'NO_SHOW' || s === 'VISIT_FAILED') && (appts.data?.last30Days[s] ?? 0) > 0 ? 'warning' : undefined} />
            ))}
          </StatGrid>
          <div className="spread">
            <h2>{t('opsAdmin.messages7')}</h2>
            <span className="row" style={{ gap: 6 }}>
              <span className="badge tone-neutral">{`${t('status.email')}: ${t(`status.${(msgs.data?.delivery.email ?? 'NOT_CONFIGURED') as 'CONFIGURED'}`)}`}</span>
              <span className="badge tone-neutral">{`${t('status.sms')}: ${t(`status.${(msgs.data?.delivery.sms ?? 'NOT_CONFIGURED') as 'CONFIGURED'}`)}`}</span>
            </span>
          </div>
          <StatGrid>
            {(['DELIVERED', 'SENT', 'QUEUED', 'FAILED', 'UNDELIVERABLE'] as const).map((s) => (
              <Stat key={s} label={t(`opsAdmin.ns_${s}`)} value={num(msgs.data?.last7Days[s] ?? 0)} tone={(s === 'FAILED' || s === 'UNDELIVERABLE') && (msgs.data?.last7Days[s] ?? 0) > 0 ? 'warning' : undefined} />
            ))}
          </StatGrid>
        </section>
      ) : null}

      {commerce ? (
        <section className="card stack" data-testid="ops-overview-orders">
          <div className="spread">
            <h2>{t('opsAdmin.orders30')}</h2>
            <span className="subtle">{num(sum(orders.data?.last30Days))}</span>
          </div>
          <StatGrid>
            {(['PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'EXPIRED'] as const).map((s) => (
              <Stat key={s} label={t(`orders.status_${s}`)} value={num(orders.data?.last30Days[s] ?? 0)} />
            ))}
          </StatGrid>
        </section>
      ) : null}

      {money ? (
        <section className="card stack" data-testid="ops-overview-payments">
          <div className="spread">
            <h2>{t('opsAdmin.payments30')}</h2>
            <span className={`badge tone-${pays.data?.gateway.status === 'CONFIGURED' ? 'success' : 'warning'}`} data-testid="ops-gateway-status">
              {`Paymob · ${t(`status.${(pays.data?.gateway.status ?? 'NOT_CONFIGURED') as 'CONFIGURED'}`)}${pays.data?.gateway.mode ? ` · ${t(`opsAdmin.mode_${pays.data.gateway.mode as 'TEST'}`)}` : ''}`}
            </span>
          </div>
          {pays.data?.gateway.reason ? <div className="notice warning">{t(`opsAdmin.reason_${pays.data.gateway.reason}` as TranslationKey)}</div> : null}
          <StatGrid>
            {(pays.data?.last30Days ?? []).map((r) => (
              <Stat key={r.status} label={t(`orders.pay_${r.status as 'PAID'}`)} value={`${num(r.n)} · ${egp(r.amount)}`} />
            ))}
          </StatGrid>
          {pays.data && !pays.data.last30Days.length ? <div className="empty">{t('opsAdmin.none')}</div> : null}
        </section>
      ) : null}
    </OpsPage>
  );
}
