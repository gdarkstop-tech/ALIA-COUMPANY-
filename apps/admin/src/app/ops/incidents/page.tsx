'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { ErrorNotice, useCan } from '@/components/ai';
import { Empty, Filter, OpsPage, ReasonForm, SEVERITY_TONE } from '@/components/ops';
import { useI18n, useToast } from '@/components/Providers';
import { formatDateTime } from '@/components/Shell';
import { api } from '@/lib/api';

type IStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'UNRESOLVED';
type Domain = 'CARE' | 'COMMERCE' | 'PLATFORM';

/**
 * Incidents raised by bookings, home visits, payments and message delivery. Care staff see care
 * incidents; commerce staff see commerce incidents only (row-level security in the database).
 */
export default function OpsIncidents() {
  const { t, locale } = useI18n();
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState<IStatus>('UNRESOLVED');
  const [domain, setDomain] = useState<Domain | ''>('');
  const [resolving, setResolving] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['ops-incidents', status, domain], queryFn: () => api.ops.incidents({ status, domain: domain || undefined }) });
  const refresh = async () => {
    toast(t('opsAdmin.saved'));
    await qc.invalidateQueries({ queryKey: ['ops-incidents'] });
  };
  const ack = useMutation({ mutationFn: (id: string) => api.ops.acknowledgeIncident(id), onSuccess: refresh });
  const resolve = useMutation({
    mutationFn: ({ id, resolution }: { id: string; resolution: string }) => api.ops.resolveIncident(id, resolution),
    onSuccess: async () => {
      setResolving(null);
      await refresh();
    },
  });
  const rows = q.data ?? [];
  const domains: Domain[] = can('ops.read') ? ['CARE', 'COMMERCE', 'PLATFORM'] : ['COMMERCE'];
  return (
    <OpsPage href="/ops/incidents">
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="field" style={{ minWidth: 180 }}>
          <span>{t('opsAdmin.filterStatus')}</span>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as IStatus)} data-testid="ops-incidents-status">
            {(['UNRESOLVED', 'OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const).map((s) => (
              <option key={s} value={s}>{t(`opsAdmin.inc_${s}`)}</option>
            ))}
          </select>
        </label>
        <Filter label={t('opsAdmin.filterDomain')} value={domain} onChange={setDomain} options={domains.map((d) => ({ value: d, label: t(`opsAdmin.domain_${d}`) }))} testId="ops-incidents-domain" />
      </div>
      <ErrorNotice error={q.error ?? ack.error} />
      <div className="card tight" style={{ overflowX: 'auto' }} data-testid="ops-incidents">
        {q.isPending ? <div className="skeleton" style={{ height: 160 }} /> : null}
        {q.data && !rows.length ? <Empty /> : null}
        {rows.length ? (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('opsAdmin.colCreated')}</th>
                <th scope="col">{t('opsAdmin.colKind')}</th>
                <th scope="col">{t('opsAdmin.filterDomain')}</th>
                <th scope="col">{t('opsAdmin.colStatus')}</th>
                <th scope="col">{t('opsAdmin.colReason')}</th>
                <th scope="col">{t('opsAdmin.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <Fragment key={i.id}>
                  <tr data-testid="ops-incident-row">
                    <td>{formatDateTime(i.createdAt, locale)}</td>
                    <td>
                      <span className={`badge tone-${SEVERITY_TONE[i.severity]}`}>{t(`opsAdmin.sev_${i.severity}`)}</span> {t(`opsAdmin.ik_${i.kind}`)}
                    </td>
                    <td>{t(`opsAdmin.domain_${i.domain}`)}</td>
                    <td>{t(`opsAdmin.inc_${i.status}`)}</td>
                    <td>
                      <div>{i.title}</div>
                      {i.detail ? <div className="subtle">{i.detail}</div> : null}
                      {i.resolution ? <div className="subtle">{`${t('opsAdmin.resolution')}: ${i.resolution}`}</div> : null}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        {i.status === 'OPEN' ? (
                          <button className="btn btn-sm btn-secondary" disabled={ack.isPending} onClick={() => ack.mutate(i.id)} data-testid={`ops-incident-ack-${i.id}`}>{t('opsAdmin.acknowledge')}</button>
                        ) : null}
                        {i.status !== 'RESOLVED' ? (
                          <button className="btn btn-sm btn-secondary" onClick={() => setResolving(i.id)} data-testid={`ops-incident-resolve-${i.id}`}>{t('opsAdmin.resolve')}</button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {resolving === i.id ? (
                    <tr>
                      <td colSpan={6}>
                        <ReasonForm title={t('opsAdmin.resolve')} hint={t('opsAdmin.resolutionHint')} label={t('opsAdmin.resolution')} pending={resolve.isPending} error={resolve.error} onClose={() => setResolving(null)} onSubmit={(resolution) => resolve.mutate({ id: i.id, resolution })} testId="ops-incident-resolve-form" />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </OpsPage>
  );
}
