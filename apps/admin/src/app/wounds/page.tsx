'use client';
import type { WoundRegistryOverview } from '@ghayarly/shared';
import { formatNumber } from '@ghayarly/i18n';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/components/Providers';
import { Shell } from '@/components/Shell';
import { Counts, WOUND_KEY, WoundError, WoundTabs } from '@/components/wounds';
import { api } from '@/lib/api';

function Stat({ label, value, testId }: { label: string; value: string | number; testId?: string }) {
  return (
    <div className="card tight" style={{ padding: 16 }} data-testid={testId}>
      <div className="subtle">{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

/** Registry overview: counts and status only — never a photo or a person. */
export default function WoundRegistry() {
  const { t, locale } = useI18n();
  const q = useQuery({ queryKey: [...WOUND_KEY, 'overview'], queryFn: () => api.woundAdmin.overview() });
  const o: WoundRegistryOverview | undefined = q.data;
  const n = (v: number) => formatNumber(v, locale);
  return (
    <Shell title={t('woundAdmin.title')}>
      <WoundTabs />
      <div className="notice info" style={{ marginBottom: 16 }} data-testid="wound-counts-only">{t('woundAdmin.countsOnly')}</div>
      <WoundError error={q.error} />
      {o ? (
        <div className="stack" data-testid="wound-overview">
          {o.testData ? <div className="notice demo">{t('woundAdmin.testScope')}</div> : null}
          <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            <Stat label={t('woundAdmin.cases')} value={n(o.cases)} testId="wound-stat-cases" />
            <Stat label={t('woundAdmin.images')} value={n(o.images)} testId="wound-stat-images" />
            <Stat label={t('woundAdmin.profiles')} value={n(o.profiles)} />
            <Stat label={t('woundAdmin.consentScan')} value={n(o.consents.scan)} testId="wound-stat-scan" />
            <Stat label={t('woundAdmin.consentResearch')} value={n(o.consents.research)} testId="wound-stat-research" />
            <Stat label={t('woundAdmin.consentPresentation')} value={n(o.consents.presentation)} />
            <Stat label={t('woundAdmin.clinicallyReviewed')} value={n(o.clinicallyReviewed)} />
            <Stat label={t('woundAdmin.withOutcome')} value={n(o.withConfirmedOutcome)} />
            <Stat label={t('woundAdmin.presentationEligible')} value={n(o.presentationEligible)} />
            <Stat label={t('woundAdmin.followUp')} value={o.followUpCompleteness == null ? '—' : `${Math.round(o.followUpCompleteness * 100)}%`} />
            <Stat label={t('woundAdmin.exports')} value={`${n(o.researchExports)} / ${n(o.presentationExports)}`} />
            <Stat label={t('woundAdmin.purgePending')} value={n(o.storagePurgePending)} />
          </div>
          <section className="card stack">
            <div><strong>{t('woundAdmin.byReported')}</strong><Counts data={o.byReportedCategory} /></div>
            <div><strong>{t('woundAdmin.byClinical')}</strong><Counts data={o.byClinicalCategory} /></div>
            <div><strong>{t('woundAdmin.outcomes')}</strong><Counts data={o.outcomes} /></div>
            <div><strong>{t('woundAdmin.datasetsByStatus')}</strong><Counts data={o.datasets} /></div>
            <div><strong>{t('woundAdmin.presentationsByStatus')}</strong><Counts data={o.presentations} /></div>
          </section>
          <section className="card stack" data-testid="wound-flags">
            <div className="spread"><strong>{t('woundAdmin.storage')}</strong><span className={`badge tone-${o.storage === 'CONFIGURED' ? 'success' : 'warning'}`} data-testid="wound-storage">{o.storage}</span></div>
            <strong>{t('woundAdmin.flags')}</strong>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {Object.entries(o.flags).map(([k, on]) => (
                <span key={k} className={`badge tone-${on ? 'warning' : 'neutral'}`} data-testid={`wound-flag-${k}`}>{`${k}: ${on ? 'ON' : 'OFF'}`}</span>
              ))}
            </div>
            <div className="subtle">{t('woundAdmin.flagsNote')}</div>
            <strong>{t('woundAdmin.consentVersions')}</strong>
            <div className="mono">{Object.entries(o.consentVersions).map(([k, v]) => `${k}: ${v}`).join(' · ')}</div>
          </section>
        </div>
      ) : q.isPending ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : null}
    </Shell>
  );
}
