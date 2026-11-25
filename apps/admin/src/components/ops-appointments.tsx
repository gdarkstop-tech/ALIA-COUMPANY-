'use client';
import { APPOINTMENT_KINDS, APPOINTMENT_STATUSES, type AppointmentKind, type AppointmentStatus } from '@ghayarly/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { api } from '@/lib/api';
import { ErrorNotice, useCan } from './ai';
import { APPT_TONE, Empty, Filter, ReasonForm, useEgp } from './ops';
import { useI18n, useToast } from './Providers';

/** Bookings are shown in Cairo time, where every provider works. */
export function cairoDateTime(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

/**
 * Appointment oversight table (no notes, no clinical details — the API never sends them here).
 * `fixedKind` pins the list to one booking type (home-visit requests page).
 */
export function AppointmentsTable({ fixedKind, testId }: { fixedKind?: AppointmentKind; testId: string }) {
  const { t, locale } = useI18n();
  const can = useCan();
  const egp = useEgp();
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState<AppointmentStatus | ''>('');
  const [kind, setKind] = useState<AppointmentKind | ''>(fixedKind ?? '');
  const [cancelling, setCancelling] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['ops-appointments', status, kind], queryFn: () => api.ops.appointments({ status: status || undefined, kind: kind || undefined, limit: 200 }) });
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.ops.cancelAppointment(id, reason),
    onSuccess: async () => {
      setCancelling(null);
      toast(t('opsAdmin.saved'));
      await qc.invalidateQueries({ queryKey: ['ops-appointments'] });
    },
  });
  const rows = q.data?.appointments ?? [];
  return (
    <div className="stack" data-testid={testId}>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Filter label={t('opsAdmin.filterStatus')} value={status} onChange={setStatus} options={APPOINTMENT_STATUSES.map((s) => ({ value: s, label: t(`booking.status_${s}`) }))} testId={`${testId}-status`} />
        {fixedKind ? null : <Filter label={t('opsAdmin.filterKind')} value={kind} onChange={setKind} options={APPOINTMENT_KINDS.map((k) => ({ value: k, label: t(`booking.kind_${k}`) }))} testId={`${testId}-kind`} />}
      </div>
      <ErrorNotice error={q.error} />
      <div className="card tight" style={{ overflowX: 'auto' }} tabIndex={0} role="region" aria-label={fixedKind ? t('opsAdmin.tab_homeVisits') : t('opsAdmin.tab_appointments')}>
        {q.isPending ? <div className="skeleton" style={{ height: 160 }} /> : null}
        {q.data && !rows.length ? <Empty /> : null}
        {rows.length ? (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('opsAdmin.colReference')}</th>
                <th scope="col">{t('opsAdmin.colWhen')}</th>
                {fixedKind ? null : <th scope="col">{t('opsAdmin.colKind')}</th>}
                <th scope="col">{t('opsAdmin.colProvider')}</th>
                <th scope="col">{t('opsAdmin.colPatient')}</th>
                <th scope="col">{t('opsAdmin.colArea')}</th>
                <th scope="col">{t('opsAdmin.colPrice')}</th>
                <th scope="col">{t('opsAdmin.colStatus')}</th>
                <th scope="col">{t('opsAdmin.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <Fragment key={a.id}>
                  <tr data-testid={`${testId}-row`}>
                    <td className="mono">{a.reference}</td>
                    <td>{cairoDateTime(a.startsAt, locale)}</td>
                    {fixedKind ? null : <td>{t(`booking.kind_${a.kind}`)}</td>}
                    <td>{a.providerName}</td>
                    <td>{a.patientDisplayName}</td>
                    <td>{a.governorate ? t(`governorate.${a.governorate as 'CAIRO'}`) : '—'}</td>
                    <td className="mono">{egp(a.pricePiasters)}</td>
                    <td>
                      <span className={`badge tone-${APPT_TONE[a.status]}`}>{t(`booking.status_${a.status}`)}</span>
                      {a.failureCategory ? <div className="subtle">{t(`booking.fail_${a.failureCategory}`)}</div> : null}
                    </td>
                    <td>
                      {can('ops.manage') && (a.status === 'REQUESTED' || a.status === 'CONFIRMED') ? (
                        <button className="btn btn-sm btn-secondary" onClick={() => setCancelling(a.id)} data-testid={`${testId}-cancel-${a.reference}`}>
                          {t('opsAdmin.cancelBooking')}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  {cancelling === a.id ? (
                    <tr>
                      <td colSpan={fixedKind ? 8 : 9}>
                        <ReasonForm
                          title={`${t('opsAdmin.cancelBooking')} · ${a.reference}`}
                          hint={t('opsAdmin.cancelBookingHint')}
                          label={t('opsAdmin.reasonLabel')}
                          pending={cancel.isPending}
                          error={cancel.error}
                          onClose={() => setCancelling(null)}
                          onSubmit={(reason) => cancel.mutate({ id: a.id, reason })}
                          testId="ops-cancel-booking"
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
