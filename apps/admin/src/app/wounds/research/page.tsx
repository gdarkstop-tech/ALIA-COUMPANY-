'use client';
import { WOUND_CATEGORIES, WOUND_RESEARCH_PURPOSES, WOUND_RESEARCH_RECIPIENTS } from '@ghayarly/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ErrorNotice, useCan } from '@/components/ai';
import { useI18n } from '@/components/Providers';
import { formatDateTime, Shell } from '@/components/Shell';
import { WOUND_KEY, WoundTabs } from '@/components/wounds';
import { api } from '@/lib/api';

/** Consented, de-identified research datasets (researchers build; clinical reviewers check quality). */
export default function ResearchDatasets() {
  const { t, locale } = useI18n();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [...WOUND_KEY, 'datasets'], queryFn: () => api.woundAdmin.datasets() });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [purpose, setPurpose] = useState<string>(WOUND_RESEARCH_PURPOSES[0]);
  const [recipient, setRecipient] = useState<string>(WOUND_RESEARCH_RECIPIENTS[0]);
  const [categories, setCategories] = useState<string[]>([]);
  const [minImages, setMinImages] = useState(1);
  const create = useMutation({
    mutationFn: () => api.woundAdmin.createDataset({ name, description: description || undefined, purpose, recipient, criteria: { ...(categories.length ? { categories } : {}), minImages } }),
    onSuccess: async () => {
      setName('');
      setDescription('');
      await qc.invalidateQueries({ queryKey: WOUND_KEY });
    },
  });
  return (
    <Shell title={t('woundAdmin.title')}>
      <WoundTabs />
      <div className="notice info" style={{ marginBottom: 16 }}>{t('woundAdmin.pseudonymNote')}</div>
      <ErrorNotice error={q.error} />
      <section className="card tight" data-testid="wound-datasets">
        <h2 style={{ padding: '12px 16px 0' }}>{t('woundAdmin.datasets')}</h2>
        <table className="table">
          <thead><tr><th>{t('woundAdmin.name')}</th><th>{t('woundAdmin.purpose')}</th><th>{t('woundAdmin.recipient')}</th><th /><th /></tr></thead>
          <tbody>
            {(q.data ?? []).map((d) => (
              <tr key={d.id} data-testid={`wound-dataset-${d.name}`}>
                <td>
                  <Link href={`/wounds/research/${d.id}`}><strong>{d.name}</strong></Link> <span className="subtle">{t('woundAdmin.version', { version: d.version })}</span>
                  <div className="subtle">{t('woundAdmin.counts', { items: d.counts.items, accepted: d.counts.accepted, pending: d.counts.pending, withdrawn: d.counts.withdrawn, images: d.counts.images })}</div>
                </td>
                <td className="mono">{d.purpose}</td>
                <td className="mono">{d.recipient}</td>
                <td><span className={`badge tone-${d.status === 'FROZEN' ? 'success' : d.status === 'RETIRED' ? 'neutral' : 'info'}`}>{t(`woundAdmin.status_${d.status}`)}</span></td>
                <td className="subtle">{formatDateTime(d.createdAt, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {can('wound.research.access') ? (
        <section className="card stack" style={{ marginTop: 16 }} data-testid="wound-dataset-new">
          <h2>{t('woundAdmin.newDataset')}</h2>
          <div className="field"><label>{t('woundAdmin.name')}</label><input className="input" data-testid="dataset-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field"><label>{t('woundAdmin.description')}</label><textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="field">
            <label>{t('woundAdmin.purpose')}</label>
            <select className="input" data-testid="dataset-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)}>{WOUND_RESEARCH_PURPOSES.map((p) => <option key={p} value={p}>{p}</option>)}</select>
          </div>
          <div className="field">
            <label>{t('woundAdmin.recipient')}</label>
            <select className="input" data-testid="dataset-recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)}>{WOUND_RESEARCH_RECIPIENTS.map((p) => <option key={p} value={p}>{p}</option>)}</select>
          </div>
          <div className="field">
            <label>{t('woundAdmin.categories')}</label>
            <div className="row">
              {WOUND_CATEGORIES.map((c) => (
                <label key={c} className="row" style={{ gap: 6 }}>
                  <input type="checkbox" checked={categories.includes(c)} onChange={() => setCategories((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]))} />
                  <span className="mono">{c}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="field"><label>{t('woundAdmin.minImages')}</label><input className="input" type="number" min={1} max={30} value={minImages} onChange={(e) => setMinImages(Number(e.target.value) || 1)} /></div>
          <ErrorNotice error={create.error} />
          <div><button className="btn btn-primary" data-testid="dataset-create" disabled={name.trim().length < 3 || create.isPending} onClick={() => create.mutate()}>{t('woundAdmin.create')}</button></div>
        </section>
      ) : null}
    </Shell>
  );
}
