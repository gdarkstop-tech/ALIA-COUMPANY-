'use client';
import { formatNumber } from '@ghayarly/i18n';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNotice } from '@/components/ai';
import { Empty, OpsPage, useEgp } from '@/components/ops';
import { useI18n } from '@/components/Providers';
import { api } from '@/lib/api';

/** Read-only view of each approved provider's bookable setup and load. Slots come only from published hours. */
export default function OpsSchedules() {
  const { t, locale } = useI18n();
  const egp = useEgp();
  const num = (n: number) => formatNumber(n, locale);
  const [type, setType] = useState<'DOCTOR' | 'NURSE' | ''>('');
  const [blockedOnly, setBlockedOnly] = useState(false);
  const q = useQuery({ queryKey: ['ops-schedules', type, blockedOnly], queryFn: () => api.ops.schedules({ type: type || undefined, blockedOnly: blockedOnly || undefined }) });
  const rows = q.data ?? [];
  return (
    <OpsPage href="/ops/schedules">
      <div className="notice info">{t('opsAdmin.schedulesHint')}</div>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="tabs" role="group" aria-label={t('opsAdmin.filterType')}>
          {(['', 'DOCTOR', 'NURSE'] as const).map((v) => (
            <button key={v || 'all'} className={`tab ${type === v ? 'active' : ''}`} aria-pressed={type === v} onClick={() => setType(v)} data-testid={`ops-schedules-type-${v || 'all'}`}>
              {v === '' ? t('opsAdmin.all') : v === 'DOCTOR' ? t('opsAdmin.doctors') : t('opsAdmin.nurses')}
            </button>
          ))}
        </div>
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={blockedOnly} onChange={(e) => setBlockedOnly(e.target.checked)} data-testid="ops-schedules-blocked" />
          {t('opsAdmin.blockedOnly')}
        </label>
      </div>
      <ErrorNotice error={q.error} />
      <div className="card tight" style={{ overflowX: 'auto' }} data-testid="ops-schedules">
        {q.isPending ? <div className="skeleton" style={{ height: 160 }} /> : null}
        {q.data && !rows.length ? <Empty /> : null}
        {rows.length ? (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('opsAdmin.colProvider')}</th>
                <th scope="col">{t('opsAdmin.colArea')}</th>
                <th scope="col">{t('opsAdmin.colStatus')}</th>
                <th scope="col">{t('opsAdmin.colWeekly')}</th>
                <th scope="col">{t('opsAdmin.colDays')}</th>
                <th scope="col">{t('opsAdmin.colOfferings')}</th>
                <th scope="col">{t('opsAdmin.colCoverage')}</th>
                <th scope="col">{t('opsAdmin.colTimeOff')}</th>
                <th scope="col">{t('opsAdmin.colAwaiting')}</th>
                <th scope="col">{t('opsAdmin.colBooked7')}</th>
                <th scope="col">{t('opsAdmin.colCap')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId} data-testid="ops-schedule-row">
                  <td>
                    <div>{locale === 'ar' ? r.nameAr : r.nameEn}</div>
                    <div className="subtle">{r.providerType === 'DOCTOR' ? t('opsAdmin.doctors') : t('opsAdmin.nurses')}</div>
                  </td>
                  <td>{[r.governorate ? t(`governorate.${r.governorate as 'CAIRO'}`) : null, r.city].filter(Boolean).join(' · ') || '—'}</td>
                  <td>
                    {r.bookingBlock ? <span className="badge tone-warning">{t(`booking.block_${r.bookingBlock}`)}</span> : <span className="badge tone-success">{t('opsAdmin.bookable')}</span>}
                    <div className="subtle">{t(`availability.${r.availabilityStatus as 'AWAY'}`)}</div>
                  </td>
                  <td className="mono">{num(Math.round((r.weeklyMinutes / 60) * 10) / 10)}</td>
                  <td className="mono">{num(r.workingDays)}</td>
                  <td>
                    {r.providerType === 'DOCTOR'
                      ? r.offerings.length
                        ? r.offerings.map((o) => (
                            <div key={o.kind} className={o.active ? undefined : 'subtle'}>{`${t(`booking.kind_${o.kind}`)} · ${o.durationMinutes}′ · ${egp(o.pricePiasters)}`}</div>
                          ))
                        : '—'
                      : `${t('opsAdmin.colServices')}: ${num(r.nursingServices)}`}
                  </td>
                  <td className="mono">{num(r.coverageAreas)}</td>
                  <td className="mono">{num(r.timeOffNext14Days)}</td>
                  <td className="mono">{num(r.requestedOpen)}</td>
                  <td className="mono">{num(r.bookedNext7Days)}</td>
                  <td className="mono">{r.maxDailyAppointments === null ? '—' : num(r.maxDailyAppointments)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </OpsPage>
  );
}
