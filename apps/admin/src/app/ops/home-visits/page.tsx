'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNotice, useCan } from '@/components/ai';
import { AppointmentsTable } from '@/components/ops-appointments';
import { OpsPage } from '@/components/ops';
import { useI18n, useToast } from '@/components/Providers';
import { api } from '@/lib/api';

/**
 * Home nursing requests and the areas where they can be requested. Nurses are never assigned by
 * the platform: a request waits for the nurse's answer and expires if unanswered (ADR 0021,
 * docs/operations/HOME_VISIT_ESCALATION.md).
 */
export default function OpsHomeVisits() {
  const { t } = useI18n();
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const regions = useQuery({ queryKey: ['ops-regions'], queryFn: () => api.ops.homeCareRegions() });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: ({ governorate, active, note }: { governorate: string; active: boolean; note: string | null }) => api.ops.setHomeCareRegion(governorate, active, note),
    onSuccess: async () => {
      toast(t('opsAdmin.saved'));
      await qc.invalidateQueries({ queryKey: ['ops-regions'] });
    },
  });
  return (
    <OpsPage href="/ops/home-visits">
      <div className="notice info">{t('opsAdmin.homeVisitsHint')}</div>
      <div className="notice warning" data-testid="ops-not-emergency">{t('opsAdmin.notEmergency')}</div>
      <AppointmentsTable fixedKind="NURSE_HOME_VISIT" testId="ops-home-visits" />
      <section className="card stack" data-testid="ops-regions">
        <h2>{t('opsAdmin.regions')}</h2>
        <p className="subtle">{t('opsAdmin.regionsHint')}</p>
        <ErrorNotice error={regions.error ?? save.error} />
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t('opsAdmin.colArea')}</th>
              <th scope="col">{t('opsAdmin.colStatus')}</th>
              <th scope="col">{t('opsAdmin.regionNote')}</th>
              <th scope="col">{t('opsAdmin.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {(regions.data ?? []).map((r) => {
              const note = notes[r.governorate] ?? r.note ?? '';
              return (
                <tr key={r.governorate} data-testid={`ops-region-${r.governorate}`}>
                  <td>{t(`governorate.${r.governorate as 'CAIRO'}`)}</td>
                  <td><span className={`badge tone-${r.active ? 'success' : 'neutral'}`}>{r.active ? t('opsAdmin.regionOpen') : t('opsAdmin.regionClosed')}</span></td>
                  <td>
                    <input className="input" aria-label={`${t('opsAdmin.regionNote')} — ${t(`governorate.${r.governorate as 'CAIRO'}`)}`} value={note} maxLength={300} disabled={!can('ops.manage')} onChange={(e) => setNotes({ ...notes, [r.governorate]: e.target.value })} />
                  </td>
                  <td>
                    {can('ops.manage') ? (
                      <button className="btn btn-sm btn-secondary" disabled={save.isPending} onClick={() => save.mutate({ governorate: r.governorate, active: !r.active, note: note.trim() || null })} data-testid={`ops-region-toggle-${r.governorate}`}>
                        {r.active ? t('opsAdmin.regionClosed') : t('opsAdmin.regionOpen')}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </OpsPage>
  );
}
