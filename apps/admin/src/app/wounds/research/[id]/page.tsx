'use client';
import type { WoundResearchItem } from '@ghayarly/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ErrorNotice, useCan } from '@/components/ai';
import { useI18n } from '@/components/Providers';
import { Shell } from '@/components/Shell';
import { downloadPost, MediaImg, WOUND_KEY, WoundTabs } from '@/components/wounds';
import { api } from '@/lib/api';

function Item({ item, datasetDraft, canReview }: { item: WoundResearchItem; datasetDraft: boolean; canReview: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [photos, setPhotos] = useState(false);
  const review = useMutation({ mutationFn: (decision: 'ACCEPTED' | 'REJECTED') => api.woundAdmin.reviewItem(item.id, { decision }), onSuccess: () => qc.invalidateQueries({ queryKey: WOUND_KEY }) });
  return (
    <div className="card stack" data-testid={`research-item-${item.pseudonym}`}>
      <div className="spread">
        <strong className="mono">{item.pseudonym}</strong>
        <span className={`badge tone-${item.status === 'WITHDRAWN' ? 'neutral' : item.qualityStatus === 'ACCEPTED' ? 'success' : item.qualityStatus === 'REJECTED' ? 'danger' : 'info'}`} data-testid="research-item-status">
          {item.status === 'WITHDRAWN' ? t('woundAdmin.item_WITHDRAWN') : t(`woundAdmin.quality_${item.qualityStatus}`)}
        </span>
      </div>
      <details>
        <summary>{t('woundAdmin.snapshot')}</summary>
        <pre className="mono" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }} data-testid="research-item-snapshot">{JSON.stringify(item.snapshot, null, 2)}</pre>
      </details>
      {item.images.length ? (
        photos ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
            {item.images.map((im) => (
              <div key={im.id}>
                <MediaImg id={im.id} mint={api.woundAdmin.researchImageLink} alt={`Day ${im.day}`} testId={`research-photo-${im.day}`} />
                <div className="subtle">Day {im.day}</div>
              </div>
            ))}
          </div>
        ) : (
          <div><button className="btn btn-sm btn-secondary" data-testid="research-show-photos" onClick={() => setPhotos(true)}>{t('woundAdmin.showPhotos')}</button></div>
        )
      ) : null}
      {canReview && datasetDraft && item.status === 'INCLUDED' ? (
        <div className="row">
          <button className="btn btn-sm btn-primary" data-testid="research-accept" disabled={review.isPending} onClick={() => review.mutate('ACCEPTED')}>{t('woundAdmin.accept')}</button>
          <button className="btn btn-sm btn-secondary" data-testid="research-reject" disabled={review.isPending} onClick={() => review.mutate('REJECTED')}>{t('woundAdmin.reject')}</button>
        </div>
      ) : null}
      <ErrorNotice error={review.error} />
    </div>
  );
}

export default function DatasetDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const can = useCan();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [...WOUND_KEY, 'dataset', id], queryFn: () => api.woundAdmin.dataset(id) });
  const [approval, setApproval] = useState('');
  const [retention, setRetention] = useState('');
  const [built, setBuilt] = useState<{ copied: number; failed: number } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: WOUND_KEY });
  const build = useMutation({ mutationFn: () => api.woundAdmin.build(id), onSuccess: async (r) => { setBuilt(r); await refresh(); } });
  const freeze = useMutation({ mutationFn: () => api.woundAdmin.freeze(id, { approvalReference: approval, retentionUntil: retention }), onSuccess: refresh });
  const version = useMutation({ mutationFn: () => api.woundAdmin.newVersion(id), onSuccess: (d) => router.push(`/wounds/research/${d.id}`) });
  const retire = useMutation({ mutationFn: () => api.woundAdmin.retire(id), onSuccess: refresh });
  const exp = useMutation({ mutationFn: () => downloadPost(`/v1/admin/wounds/datasets/${id}/export`, {}, 'wound-research-dataset.zip') });
  const d = q.data?.dataset;
  const researcher = can('wound.research.access');
  return (
    <Shell title={d ? `${d.name} · ${t('woundAdmin.version', { version: d.version })}` : t('woundAdmin.title')}>
      <WoundTabs />
      <ErrorNotice error={q.error} />
      {d ? (
        <div className="stack" data-testid="wound-dataset-detail">
          <section className="card stack">
            <div className="spread">
              <span className="mono">{`${d.purpose} → ${d.recipient}`}</span>
              <span className="badge tone-info" data-testid="dataset-status">{t(`woundAdmin.status_${d.status}`)}</span>
            </div>
            <div className="subtle">{t('woundAdmin.counts', { items: d.counts.items, accepted: d.counts.accepted, pending: d.counts.pending, withdrawn: d.counts.withdrawn, images: d.counts.images })}</div>
            {d.approvalReference ? <div className="mono">{`${d.approvalReference} · ${d.retentionUntil}`}</div> : null}
            <div className="notice info">{t('woundAdmin.pseudonymNote')}</div>
            {researcher && d.status === 'DRAFT' ? (
              <div className="stack">
                <div><button className="btn btn-secondary" data-testid="dataset-build" disabled={build.isPending} onClick={() => build.mutate()}>{t('woundAdmin.build')}</button></div>
                {built ? <div className="subtle" data-testid="dataset-built">{t('woundAdmin.built', built)}</div> : null}
                <div className="row">
                  <div className="field" style={{ flex: 1 }}><label>{t('woundAdmin.approvalReference')}</label><input className="input" data-testid="dataset-approval" value={approval} onChange={(e) => setApproval(e.target.value)} /></div>
                  <div className="field"><label>{t('woundAdmin.retentionUntil')}</label><input className="input mono" data-testid="dataset-retention" placeholder="YYYY-MM-DD" value={retention} onChange={(e) => setRetention(e.target.value)} /></div>
                </div>
                <div><button className="btn btn-primary" data-testid="dataset-freeze" disabled={!approval.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(retention) || freeze.isPending} onClick={() => freeze.mutate()}>{t('woundAdmin.freeze')}</button></div>
              </div>
            ) : null}
            {researcher && d.status !== 'DRAFT' ? (
              <div className="row">
                <button className="btn btn-secondary" data-testid="dataset-new-version" disabled={version.isPending} onClick={() => version.mutate()}>{t('woundAdmin.newVersion')}</button>
                {d.status === 'FROZEN' ? <button className="btn btn-secondary" data-testid="dataset-export" disabled={exp.isPending} onClick={() => exp.mutate()}>{t('woundAdmin.export')}</button> : null}
              </div>
            ) : null}
            {researcher && d.status !== 'RETIRED' ? (
              <div><button className="btn btn-sm btn-ghost" data-testid="dataset-retire" onClick={() => window.confirm(t('woundAdmin.retireConfirm')) && retire.mutate()}>{t('woundAdmin.retire')}</button></div>
            ) : null}
            <div className="subtle">{t('woundAdmin.exportDisabled')}</div>
            <ErrorNotice error={build.error ?? freeze.error ?? version.error ?? retire.error ?? exp.error} />
          </section>
          {q.data!.items.map((it) => <Item key={it.id} item={it} datasetDraft={d.status === 'DRAFT'} canReview={can('wound.research.review')} />)}
        </div>
      ) : null}
    </Shell>
  );
}
