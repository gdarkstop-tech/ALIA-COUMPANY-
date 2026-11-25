'use client';
import type { DeliveryZone } from '@ghayarly/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNotice } from '@/components/ai';
import { OpsPage } from '@/components/ops';
import { useI18n, useToast } from '@/components/Providers';
import { api } from '@/lib/api';

type Draft = { active: boolean; fee: string; freeOver: string; etaMin: string; etaMax: string };
const toDraft = (z: DeliveryZone): Draft => ({
  active: z.active,
  fee: z.feePiasters === null ? '' : String(z.feePiasters / 100),
  freeOver: z.freeOverPiasters === null ? '' : String(z.freeOverPiasters / 100),
  etaMin: z.etaMinDays === null ? '' : String(z.etaMinDays),
  etaMax: z.etaMaxDays === null ? '' : String(z.etaMaxDays),
});
const piasters = (v: string) => (v.trim() === '' ? null : Math.round(Number(v) * 100));
const intOrNull = (v: string) => (v.trim() === '' ? null : Math.round(Number(v)));

/** Delivery fees per governorate (orders.manage). An order can be placed only to an active zone with a fee. */
export default function OpsDelivery() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ops-zones'], queryFn: () => api.ops.deliveryZones() });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const save = useMutation({
    mutationFn: ({ g, d }: { g: string; d: Draft }) =>
      api.ops.setDeliveryZone(g, { active: d.active, feePiasters: piasters(d.fee), freeOverPiasters: piasters(d.freeOver), etaMinDays: intOrNull(d.etaMin), etaMaxDays: intOrNull(d.etaMax) }),
    onSuccess: async (_r, { g }) => {
      toast(t('opsAdmin.saved'));
      setDrafts(({ [g]: _done, ...rest }) => rest);
      await qc.invalidateQueries({ queryKey: ['ops-zones'] });
    },
  });
  return (
    <OpsPage href="/ops/delivery">
      <div className="notice info">{t('opsAdmin.deliveryHint')}</div>
      <ErrorNotice error={q.error ?? save.error} />
      <div className="card tight" style={{ overflowX: 'auto' }} tabIndex={0} role="region" aria-label={t('opsAdmin.tab_delivery')} data-testid="ops-zones">
        {q.isPending ? <div className="skeleton" style={{ height: 160 }} /> : null}
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t('opsAdmin.colArea')}</th>
              <th scope="col">{t('opsAdmin.zoneActive')}</th>
              <th scope="col">{t('opsAdmin.fee')}</th>
              <th scope="col">{t('opsAdmin.freeOver')}</th>
              <th scope="col">{t('opsAdmin.etaMin')}</th>
              <th scope="col">{t('opsAdmin.etaMax')}</th>
              <th scope="col">{t('opsAdmin.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((z) => {
              const d = drafts[z.governorate] ?? toDraft(z);
              const set = (patch: Partial<Draft>) => setDrafts({ ...drafts, [z.governorate]: { ...d, ...patch } });
              const name = t(`governorate.${z.governorate as 'CAIRO'}`);
              return (
                <tr key={z.governorate} data-testid={`ops-zone-${z.governorate}`}>
                  <td>{name}</td>
                  <td><input type="checkbox" aria-label={`${t('opsAdmin.zoneActive')} — ${name}`} checked={d.active} onChange={(e) => set({ active: e.target.checked })} data-testid={`ops-zone-active-${z.governorate}`} /></td>
                  <td><input className="input mono" style={{ maxWidth: 110 }} inputMode="decimal" aria-label={`${t('opsAdmin.fee')} — ${name}`} value={d.fee} onChange={(e) => set({ fee: e.target.value.replace(/[^0-9.]/g, '') })} data-testid={`ops-zone-fee-${z.governorate}`} /></td>
                  <td><input className="input mono" style={{ maxWidth: 110 }} inputMode="decimal" aria-label={`${t('opsAdmin.freeOver')} — ${name}`} value={d.freeOver} onChange={(e) => set({ freeOver: e.target.value.replace(/[^0-9.]/g, '') })} /></td>
                  <td><input className="input mono" style={{ maxWidth: 70 }} inputMode="numeric" aria-label={`${t('opsAdmin.etaMin')} — ${name}`} value={d.etaMin} onChange={(e) => set({ etaMin: e.target.value.replace(/[^0-9]/g, '') })} /></td>
                  <td><input className="input mono" style={{ maxWidth: 70 }} inputMode="numeric" aria-label={`${t('opsAdmin.etaMax')} — ${name}`} value={d.etaMax} onChange={(e) => set({ etaMax: e.target.value.replace(/[^0-9]/g, '') })} /></td>
                  <td>
                    <button className="btn btn-sm btn-secondary" disabled={!drafts[z.governorate] || save.isPending} onClick={() => save.mutate({ g: z.governorate, d })} data-testid={`ops-zone-save-${z.governorate}`}>
                      {t('opsAdmin.save')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </OpsPage>
  );
}
