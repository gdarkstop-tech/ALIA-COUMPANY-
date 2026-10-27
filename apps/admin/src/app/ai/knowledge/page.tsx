'use client';
import type { KnowledgeArticleAdmin } from '@ghayarly/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AiTabs, ErrorNotice, useCan } from '@/components/ai';
import { useI18n } from '@/components/Providers';
import { formatDateTime, Shell } from '@/components/Shell';
import { api } from '@/lib/api';

const KEY = ['knowledge-articles'];
const empty = { slug: '', locale: 'en' as 'en' | 'ar', title: '', summary: '', body: '', topics: '', sourcePublisher: '', sourceTitle: '', sourceUrl: '', sourceDate: '' };

function Editor({ initial, onDone }: { initial?: KnowledgeArticleAdmin; onDone: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [f, setF] = useState(
    initial
      ? { slug: initial.slug, locale: initial.locale, title: initial.title, summary: initial.summary, body: initial.body, topics: initial.topics.join(', '), sourcePublisher: initial.sourcePublisher, sourceTitle: initial.sourceTitle, sourceUrl: initial.sourceUrl ?? '', sourceDate: initial.sourceDate ?? '' }
      : empty,
  );
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, topics: f.topics.split(',').map((x) => x.trim()).filter(Boolean), sourceUrl: f.sourceUrl.trim() || null, sourceDate: f.sourceDate.trim() || null };
      return initial ? api.knowledge.updateArticle(initial.id, body) : api.knowledge.createArticle(body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      onDone();
    },
  });
  const input = (k: keyof typeof f, label: string, opts: { area?: number; ltr?: boolean } = {}) => (
    <div className="field">
      <label htmlFor={`k-${k}`}>{label}</label>
      {opts.area ? (
        <textarea id={`k-${k}`} className="input" rows={opts.area} dir="auto" value={f[k]} onChange={(e) => setF((v) => ({ ...v, [k]: e.target.value }))} />
      ) : (
        <input id={`k-${k}`} className="input" dir={opts.ltr ? 'ltr' : 'auto'} value={f[k]} onChange={(e) => setF((v) => ({ ...v, [k]: e.target.value }))} />
      )}
    </div>
  );
  return (
    <section className="card" data-testid="knowledge-editor" style={{ display: 'grid', gap: 8 }}>
      <div className="row">
        {input('slug', t('aiAdmin.slug'), { ltr: true })}
        <div className="field"><label htmlFor="k-locale">{t('aiAdmin.language')}</label><select id="k-locale" className="input" value={f.locale} onChange={(e) => setF((v) => ({ ...v, locale: e.target.value as 'ar' | 'en' }))}><option value="en">en</option><option value="ar">ar</option></select></div>
      </div>
      {input('title', t('aiAdmin.title'))}
      {input('summary', t('aiAdmin.summary'))}
      {input('body', t('aiAdmin.body'), { area: 10 })}
      {input('topics', t('aiAdmin.topics'))}
      <div className="row">
        {input('sourcePublisher', t('aiAdmin.sourcePublisher'))}
        {input('sourceTitle', t('aiAdmin.sourceTitle'))}
        {input('sourceUrl', t('aiAdmin.sourceUrl'), { ltr: true })}
        {input('sourceDate', t('aiAdmin.sourceDate'), { ltr: true })}
      </div>
      <div className="row">
        <button className="btn btn-primary btn-sm" disabled={save.isPending} onClick={() => save.mutate()} data-testid="knowledge-save">{t('aiAdmin.save')}</button>
        <button className="btn btn-secondary btn-sm" onClick={onDone}>{t('common.cancel')}</button>
      </div>
      <ErrorNotice error={save.error} />
    </section>
  );
}

function ArticleCard({ a, onEdit }: { a: KnowledgeArticleAdmin; onEdit: () => void }) {
  const { t, locale } = useI18n();
  const can = useCan();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const done = () => {
    setNote('');
    void qc.invalidateQueries({ queryKey: KEY });
  };
  const submit = useMutation({ mutationFn: () => api.knowledge.submit(a.id), onSuccess: done });
  const approve = useMutation({ mutationFn: () => api.knowledge.approve(a.id, note), onSuccess: done });
  const retire = useMutation({ mutationFn: () => api.knowledge.retire(a.id, note), onSuccess: done });
  return (
    <section className="card" data-testid={`knowledge-${a.slug}-${a.locale}`} style={{ display: 'grid', gap: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><strong dir="auto">{a.title}</strong> <span className="subtle mono">{a.slug} · {a.locale}</span></div>
        <div className="row">
          <span className={`badge tone-${a.status === 'APPROVED' ? 'success' : a.status === 'RETIRED' ? 'neutral' : 'warning'}`}>{t(`aiAdmin.kStatus_${a.status}`)}</span>
          <span className="badge tone-neutral">{a.live ? t('aiAdmin.liveVersion', { version: a.live.version, date: formatDateTime(a.live.approvedAt, locale) }) : t('aiAdmin.notLive')}</span>
        </div>
      </div>
      <div className="subtle" dir="auto">{a.sourcePublisher} — {a.sourceTitle}{a.sourceDate ? ` (${a.sourceDate})` : ''}</div>
      {a.editedByMe && a.status === 'IN_REVIEW' ? <div className="subtle">{t('aiAdmin.editedByYou')}</div> : null}
      {a.status !== 'RETIRED' ? (
        <div className="row">
          {can('knowledge.manage') ? <button className="btn btn-sm btn-secondary" onClick={onEdit}>{t('aiAdmin.edit')}</button> : null}
          {can('knowledge.manage') && a.status === 'DRAFT' ? <button className="btn btn-sm btn-secondary" disabled={submit.isPending} onClick={() => submit.mutate()} data-testid="knowledge-submit">{t('aiAdmin.submitReview')}</button> : null}
          <input className="input" style={{ flex: 1 }} aria-label={t('aiAdmin.approvalNote')} placeholder={t('aiAdmin.approvalNote')} value={note} onChange={(e) => setNote(e.target.value)} />
          {can('ai.clinical.review') && a.status === 'IN_REVIEW' && !a.editedByMe ? <button className="btn btn-sm btn-primary" disabled={approve.isPending || note.trim().length < 3} onClick={() => approve.mutate()} data-testid="knowledge-approve">{t('aiAdmin.approveArticle')}</button> : null}
          <button className="btn btn-sm btn-secondary" disabled={retire.isPending || note.trim().length < 3} onClick={() => retire.mutate()}>{t('aiAdmin.retireArticle')}</button>
        </div>
      ) : null}
      <ErrorNotice error={submit.error ?? approve.error ?? retire.error} />
      {a.versions.length ? (
        <ul className="subtle">
          {a.versions.map((v) => <li key={v.version}>{t('aiAdmin.versionLine', { version: v.version, date: formatDateTime(v.approvedAt, locale), superseded: v.supersededAt ? t('aiAdmin.superseded') : '', note: v.note })}</li>)}
        </ul>
      ) : null}
    </section>
  );
}

/** Curated medical knowledge the assistant may cite (editors write, clinical reviewers approve). */
export default function KnowledgePage() {
  const { t } = useI18n();
  const can = useCan();
  const list = useQuery({ queryKey: KEY, queryFn: () => api.knowledge.articles('ALL') });
  const [editing, setEditing] = useState<KnowledgeArticleAdmin | 'new' | null>(null);
  return (
    <Shell title={t('aiAdmin.nav')}>
      <AiTabs />
      <p className="muted">{t('aiAdmin.knowledgeIntro')}</p>
      {can('knowledge.manage') && !editing ? <button className="btn btn-primary btn-sm" style={{ marginBottom: 16 }} onClick={() => setEditing('new')} data-testid="knowledge-new">{t('aiAdmin.newArticle')}</button> : null}
      {editing ? <Editor key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} /> : null}
      <ErrorNotice error={list.error} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
        {(list.data ?? []).map((a) => <ArticleCard key={`${a.id}:${a.updatedAt}:${a.status}`} a={a} onEdit={() => setEditing(a)} />)}
      </div>
    </Shell>
  );
}
