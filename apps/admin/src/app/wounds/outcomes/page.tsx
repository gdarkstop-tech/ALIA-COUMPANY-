'use client';
import { WOUND_OUTCOMES, type WoundResearchDataset } from '@ghayarly/shared';
import { formatNumber } from '@ghayarly/i18n';
import { useQuery } from '@tanstack/react-query';
import { useCan } from '@/components/ai';
import { useI18n } from '@/components/Providers';
import { Shell } from '@/components/Shell';
import { Counts, WOUND_KEY, WoundError, WoundTabs } from '@/components/wounds';
import { api, ApiError } from '@/lib/api';

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

function tally(rows: WoundResearchDataset[], key: 'purpose' | 'recipient' | 'status'): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d[key]]: (acc[d[key]] ?? 0) + 1 }), {});
}

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="card tight" style={{ padding: 16 }} data-testid={testId}>
      <div className="subtle">{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

/**
 * Research analytics and descriptive product outcomes. Aggregates only: no photo, no pseudonym,
 * no person; product groups under the minimum cell size are suppressed by the database.
 */
export default function WoundOutcomes() {
  const { t, locale } = useI18n();
  const can = useCan();
  const researcher = can('wound.research.access');
  const n = (v: number) => formatNumber(v, locale);
  const overview = useQuery({ queryKey: [...WOUND_KEY, 'overview'], queryFn: () => api.woundAdmin.overview(), enabled: can('wound.registry.read') });
  const datasets = useQuery({ queryKey: [...WOUND_KEY, 'datasets'], queryFn: () => api.woundAdmin.datasets(), enabled: researcher });
  const outcomes = useQuery({ queryKey: [...WOUND_KEY, 'product-outcomes'], queryFn: () => api.woundAdmin.productOutcomes(), enabled: researcher, retry: false });
  const researchOff = outcomes.error instanceof ApiError && outcomes.error.code === 'FEATURE_DISABLED';
  const o = overview.data;
  const ds = datasets.data ?? [];
  const sum = (k: keyof WoundResearchDataset['counts']) => ds.reduce((a, d) => a + d.counts[k], 0);
  if (!researcher) {
    return (
      <Shell title={t('woundAdmin.title')}>
        <WoundTabs />
        <div className="notice info" data-testid="wound-no-permission">{t('woundAdmin.noPermission')}</div>
      </Shell>
    );
  }
  return (
    <Shell title={t('woundAdmin.title')}>
      <WoundTabs />
      <div className="stack">
        <section className="card stack" data-testid="research-analytics">
          <h2>{t('woundAdmin.analyticsTitle')}</h2>
          <p className="subtle">{t('woundAdmin.analyticsNote')}</p>
          <WoundError error={overview.error ?? datasets.error} />
          {o ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
              <Stat label={t('woundAdmin.optInResearch')} value={`${pct(o.consents.research, o.consents.scan)} (${n(o.consents.research)} / ${n(o.consents.scan)})`} testId="analytics-optin-research" />
              <Stat label={t('woundAdmin.optInPresentation')} value={`${pct(o.consents.presentation, o.consents.scan)} (${n(o.consents.presentation)} / ${n(o.consents.scan)})`} testId="analytics-optin-presentation" />
              <Stat label={t('woundAdmin.clinicallyReviewed')} value={`${pct(o.clinicallyReviewed, o.cases)} (${n(o.clinicallyReviewed)})`} />
              <Stat label={t('woundAdmin.withOutcome')} value={`${pct(o.withConfirmedOutcome, o.cases)} (${n(o.withConfirmedOutcome)})`} />
              <Stat label={t('woundAdmin.followUp')} value={o.followUpCompleteness == null ? '—' : `${Math.round(o.followUpCompleteness * 100)}%`} />
              <Stat label={t('woundAdmin.itemsTotal')} value={n(sum('items'))} testId="analytics-items" />
              <Stat label={t('woundAdmin.itemsAccepted')} value={n(sum('accepted'))} />
              <Stat label={t('woundAdmin.itemsPending')} value={n(sum('pending'))} />
              <Stat label={t('woundAdmin.itemsRejected')} value={n(sum('rejected'))} />
              <Stat label={t('woundAdmin.itemsWithdrawn')} value={n(sum('withdrawn'))} testId="analytics-withdrawn" />
              <Stat label={t('woundAdmin.researchImages')} value={n(sum('images'))} />
              <Stat label={t('woundAdmin.exports')} value={`${n(o.researchExports)} / ${n(o.presentationExports)}`} />
            </div>
          ) : null}
          {o ? <div><strong>{t('woundAdmin.outcomes')}</strong><Counts data={o.outcomes} /></div> : null}
          <div><strong>{t('woundAdmin.datasetsByPurpose')}</strong><Counts data={tally(ds, 'purpose')} /></div>
          <div><strong>{t('woundAdmin.datasetsByRecipient')}</strong><Counts data={tally(ds, 'recipient')} /></div>
        </section>

        <section className="card tight" data-testid="product-outcomes">
          <h2 style={{ padding: '12px 16px 0' }}>{t('woundAdmin.outcomesTitle')}</h2>
          <div className="notice warning" style={{ margin: '8px 16px' }} data-testid="outcomes-note">{t('woundAdmin.outcomesNote', { n: outcomes.data?.minimumCellSize ?? 5 })}</div>
          {researchOff ? (
            <div className="notice info" style={{ margin: '8px 16px' }} data-testid="outcomes-research-off">{t('woundAdmin.researchOff')}</div>
          ) : (
            <WoundError error={outcomes.error} />
          )}
          {outcomes.data ? (
            <table className="table">
              <thead>
                <tr>
                  <th>{t('woundAdmin.product')}</th><th>{t('woundAdmin.casesCol')}</th><th>{t('woundAdmin.outcomeCol')}</th><th>{t('woundAdmin.medianDays')}</th>
                  <th>{t('woundAdmin.otherTreatments')}</th><th>{t('woundAdmin.completeness')}</th><th>{t('woundAdmin.missing')}</th>
                </tr>
              </thead>
              <tbody>
                {outcomes.data.rows.map((r) => (
                  <tr key={`${r.category}-${r.product}`} data-testid="outcome-row">
                    <td><strong>{r.productName}</strong><div className="subtle mono">{r.category}</div></td>
                    {r.suppressed ? (
                      <td colSpan={6} className="subtle" data-testid="outcome-suppressed">{t('woundAdmin.suppressed', { n: outcomes.data!.minimumCellSize })}</td>
                    ) : (
                      <>
                        <td className="mono">{n(r.cases ?? 0)}</td>
                        <td className="mono">{WOUND_OUTCOMES.filter((k) => r.outcomes?.[k]).map((k) => `${k} ${r.outcomes![k]}`).join(' · ') || '—'}</td>
                        <td className="mono">{r.medianDaysToConfirmedHealed ?? '—'}</td>
                        <td className="mono">{n(r.withOtherTreatments ?? 0)}</td>
                        <td className="mono">{r.followUpCompleteness == null ? '—' : `${Math.round(r.followUpCompleteness * 100)}%`}</td>
                        <td className="subtle">{r.missing ? t('woundAdmin.missingRow', { outcome: r.missing.outcome, photos: r.missing.photos, start: r.missing.productStart }) : '—'}</td>
                      </>
                    )}
                  </tr>
                ))}
                {!outcomes.data.rows.length ? <tr><td colSpan={7} className="subtle">{t('woundAdmin.noRows')}</td></tr> : null}
              </tbody>
            </table>
          ) : null}
        </section>
      </div>
    </Shell>
  );
}
