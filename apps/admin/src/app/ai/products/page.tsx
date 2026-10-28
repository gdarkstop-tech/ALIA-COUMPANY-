'use client';
import { PRODUCT_KEYWORD_VARIANTS, PRODUCT_KNOWLEDGE_KINDS, PRODUCT_TOPIC_SUGGESTIONS, type ProductKeywordAdmin, type ProductKnowledgeAdmin, type ProductKnowledgeKind } from '@ghayarly/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { AiTabs, ErrorNotice, useCan } from '@/components/ai';
import { useI18n } from '@/components/Providers';
import { formatDateTime, Shell } from '@/components/Shell';
import { api } from '@/lib/api';

const LIST_KEY = ['product-knowledge'];
const overviewKey = (id: string) => ['product-knowledge', id];
const emptyEntry = { kind: 'INDICATION' as ProductKnowledgeKind, topic: '', titleAr: '', titleEn: '', bodyAr: '', bodyEn: '', evidenceReference: '' };

function EntryEditor({ productId, initial, onDone }: { productId: string; initial?: ProductKnowledgeAdmin; onDone: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [f, setF] = useState(initial ? { kind: initial.kind, topic: initial.topic ?? '', titleAr: initial.titleAr, titleEn: initial.titleEn, bodyAr: initial.bodyAr, bodyEn: initial.bodyEn, evidenceReference: initial.evidenceReference } : emptyEntry);
  const save = useMutation({
    mutationFn: () => {
      const { kind, ...rest } = f;
      const fields = { ...rest, topic: kind === 'INDICATION' ? rest.topic.trim() || null : null };
      return initial ? api.productKnowledge.updateEntry(initial.id, fields) : api.productKnowledge.createEntry({ productId, kind, ...fields });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LIST_KEY });
      onDone();
    },
  });
  const field = (k: Exclude<keyof typeof f, 'kind'>, label: string, opts: { area?: number; dir?: 'rtl' | 'ltr' | 'auto'; list?: string } = {}) => (
    <div className="field" style={{ flex: 1 }}>
      <label htmlFor={`pk-${k}`}>{label}</label>
      {opts.area ? (
        <textarea id={`pk-${k}`} className="input" rows={opts.area} dir={opts.dir ?? 'auto'} value={f[k]} onChange={(e) => setF((v) => ({ ...v, [k]: e.target.value }))} />
      ) : (
        <input id={`pk-${k}`} className="input" dir={opts.dir ?? 'auto'} list={opts.list} value={f[k]} onChange={(e) => setF((v) => ({ ...v, [k]: e.target.value }))} />
      )}
    </div>
  );
  return (
    <section className="card" data-testid="pk-entry-editor" style={{ display: 'grid', gap: 8 }}>
      <div className="row">
        <div className="field">
          <label htmlFor="pk-kind">{t('aiAdmin.kind')}</label>
          <select id="pk-kind" className="input" disabled={!!initial} value={f.kind} onChange={(e) => setF((v) => ({ ...v, kind: e.target.value as ProductKnowledgeKind }))}>
            {PRODUCT_KNOWLEDGE_KINDS.map((k) => <option key={k} value={k}>{t(`aiAdmin.kind_${k}`)}</option>)}
          </select>
        </div>
        {f.kind === 'INDICATION' ? field('topic', t('aiAdmin.topic'), { dir: 'ltr', list: 'pk-topics' }) : null}
        <datalist id="pk-topics">{PRODUCT_TOPIC_SUGGESTIONS.map((x) => <option key={x} value={x} />)}</datalist>
      </div>
      <div className="row">
        {field('titleEn', t('aiAdmin.titleEn'), { dir: 'ltr' })}
        {field('titleAr', t('aiAdmin.titleAr'), { dir: 'rtl' })}
      </div>
      <div className="row">
        {field('bodyEn', t('aiAdmin.bodyEn'), { area: 4, dir: 'ltr' })}
        {field('bodyAr', t('aiAdmin.bodyAr'), { area: 4, dir: 'rtl' })}
      </div>
      {field('evidenceReference', t('aiAdmin.evidence'))}
      <div className="row">
        <button className="btn btn-primary btn-sm" disabled={save.isPending} onClick={() => save.mutate()} data-testid="pk-entry-save">{t('aiAdmin.save')}</button>
        <button className="btn btn-secondary btn-sm" onClick={onDone}>{t('common.cancel')}</button>
      </div>
      <ErrorNotice error={save.error} />
    </section>
  );
}

function EntryCard({ e, onEdit }: { e: ProductKnowledgeAdmin; onEdit: () => void }) {
  const { t, locale } = useI18n();
  const can = useCan();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const done = () => {
    setNote('');
    void qc.invalidateQueries({ queryKey: LIST_KEY });
  };
  const submit = useMutation({ mutationFn: () => api.productKnowledge.submit(e.id), onSuccess: done });
  const approve = useMutation({ mutationFn: () => api.productKnowledge.approve(e.id, note), onSuccess: done });
  const retire = useMutation({ mutationFn: () => api.productKnowledge.retire(e.id, note), onSuccess: done });
  return (
    <section className="card" data-testid={`pk-entry-${e.kind}-${e.status}`} style={{ display: 'grid', gap: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <span className="badge tone-accent">{t(`aiAdmin.kind_${e.kind}`)}</span> <strong dir="auto">{e.titleEn}</strong>
          {e.topic ? <span className="subtle mono"> · {e.topic}</span> : null}
        </div>
        <div className="row">
          <span className={`badge tone-${e.status === 'APPROVED' ? 'success' : e.status === 'RETIRED' ? 'neutral' : 'warning'}`}>{t(`aiAdmin.kStatus_${e.status}`)}</span>
          <span className="badge tone-neutral">{e.live ? t('aiAdmin.liveVersion', { version: e.live.version, date: formatDateTime(e.live.approvedAt, locale) }) : t('aiAdmin.notLive')}</span>
        </div>
      </div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <p style={{ flex: 1, margin: 0 }} dir="ltr">{e.bodyEn}</p>
        <p style={{ flex: 1, margin: 0 }} dir="rtl"><strong>{e.titleAr}</strong> — {e.bodyAr}</p>
      </div>
      <div className="subtle" dir="auto">{t('aiAdmin.evidence')}: {e.evidenceReference}</div>
      {e.editedByMe && e.status === 'IN_REVIEW' ? <div className="subtle">{t('aiAdmin.editedByYou')}</div> : null}
      {e.status !== 'RETIRED' ? (
        <div className="row">
          {can('catalog.tetrasol.manage') ? <button className="btn btn-sm btn-secondary" onClick={onEdit}>{t('aiAdmin.edit')}</button> : null}
          {can('catalog.tetrasol.manage') && e.status === 'DRAFT' ? <button className="btn btn-sm btn-secondary" disabled={submit.isPending} onClick={() => submit.mutate()} data-testid="pk-entry-submit">{t('aiAdmin.submitReview')}</button> : null}
          <input className="input" style={{ flex: 1 }} aria-label={t('aiAdmin.approvalNote')} placeholder={t('aiAdmin.approvalNote')} value={note} onChange={(ev) => setNote(ev.target.value)} data-testid="pk-entry-note" />
          {can('ai.clinical.review') && e.status === 'IN_REVIEW' && !e.editedByMe ? <button className="btn btn-sm btn-primary" disabled={approve.isPending || note.trim().length < 3} onClick={() => approve.mutate()} data-testid="pk-entry-approve">{t('aiAdmin.approveArticle')}</button> : null}
          <button className="btn btn-sm btn-secondary" disabled={retire.isPending || note.trim().length < 3} onClick={() => retire.mutate()}>{t('aiAdmin.retireArticle')}</button>
        </div>
      ) : null}
      <ErrorNotice error={submit.error ?? approve.error ?? retire.error} />
      {e.versions.length ? (
        <ul className="subtle">
          {e.versions.map((v) => <li key={v.version}>{t('aiAdmin.versionLine', { version: v.version, date: formatDateTime(v.approvedAt, locale), superseded: v.supersededAt ? t('aiAdmin.superseded') : '', note: v.note })}</li>)}
        </ul>
      ) : null}
    </section>
  );
}

function Keywords({ productId, entries, keywords }: { productId: string; entries: ProductKnowledgeAdmin[]; keywords: ProductKeywordAdmin[] }) {
  const { t } = useI18n();
  const can = useCan();
  const qc = useQueryClient();
  const [f, setF] = useState({ term: '', locale: 'en' as 'ar' | 'en', variant: 'KEYWORD' as (typeof PRODUCT_KEYWORD_VARIANTS)[number], indicationId: '' });
  const done = () => void qc.invalidateQueries({ queryKey: LIST_KEY });
  const add = useMutation({
    mutationFn: () => api.productKnowledge.createKeyword({ productId, term: f.term, locale: f.locale, variant: f.variant, indicationId: f.indicationId || null }),
    onSuccess: () => {
      setF((v) => ({ ...v, term: '' }));
      done();
    },
  });
  const approve = useMutation({ mutationFn: (id: string) => api.productKnowledge.approveKeyword(id), onSuccess: done });
  const retire = useMutation({ mutationFn: (id: string) => api.productKnowledge.retireKeyword(id), onSuccess: done });
  const indications = entries.filter((e) => e.kind === 'INDICATION' && e.status !== 'RETIRED');
  return (
    <section className="card" data-testid="pk-keywords" style={{ display: 'grid', gap: 8 }}>
      <h2 style={{ margin: 0 }}>{t('aiAdmin.keywords')}</h2>
      <p className="muted" style={{ margin: 0 }}>{t('aiAdmin.keywordsIntro')}</p>
      {keywords.length ? (
        <table className="table">
          <thead>
            <tr><th>{t('aiAdmin.term')}</th><th>{t('aiAdmin.variant')}</th><th>{t('aiAdmin.target')}</th><th>{t('aiAdmin.status')}</th><th /></tr>
          </thead>
          <tbody>
            {keywords.map((k) => (
              <tr key={k.id} data-testid={`pk-keyword-${k.term}`}>
                <td dir="auto"><strong>{k.term}</strong> <span className="subtle mono">{k.locale}</span></td>
                <td>{t(`aiAdmin.variant_${k.variant}`)}</td>
                <td dir="auto">{k.indicationTitle ?? t('aiAdmin.targetProduct')}</td>
                <td>
                  <span className={`badge tone-${k.status === 'APPROVED' ? 'success' : k.status === 'RETIRED' ? 'neutral' : 'warning'}`}>{t(`aiAdmin.kwStatus_${k.status}`)}</span>{' '}
                  <span className={`badge tone-${k.active ? 'success' : 'neutral'}`}>{t(k.active ? 'aiAdmin.kwActive' : 'aiAdmin.kwInactive')}</span>
                  {k.createdByMe && k.status === 'PENDING' ? <div className="subtle">{t('aiAdmin.proposedByYou')}</div> : null}
                </td>
                <td className="row">
                  {can('ai.clinical.review') && k.status === 'PENDING' && !k.createdByMe ? <button className="btn btn-sm btn-primary" disabled={approve.isPending} onClick={() => approve.mutate(k.id)} data-testid={`pk-keyword-approve-${k.term}`}>{t('aiAdmin.approveArticle')}</button> : null}
                  {k.status !== 'RETIRED' ? <button className="btn btn-sm btn-secondary" disabled={retire.isPending} onClick={() => retire.mutate(k.id)}>{t('aiAdmin.retireArticle')}</button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="subtle">{t('aiAdmin.noKeywords')}</p>
      )}
      <ErrorNotice error={approve.error ?? retire.error} />
      {can('catalog.tetrasol.manage') ? (
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1 }}><label htmlFor="pk-term">{t('aiAdmin.term')}</label><input id="pk-term" className="input" dir="auto" value={f.term} onChange={(e) => setF((v) => ({ ...v, term: e.target.value }))} /></div>
          <div className="field"><label htmlFor="pk-locale">{t('aiAdmin.language')}</label><select id="pk-locale" className="input" value={f.locale} onChange={(e) => setF((v) => ({ ...v, locale: e.target.value as 'ar' | 'en' }))}><option value="en">en</option><option value="ar">ar</option></select></div>
          <div className="field"><label htmlFor="pk-variant">{t('aiAdmin.variant')}</label><select id="pk-variant" className="input" value={f.variant} onChange={(e) => setF((v) => ({ ...v, variant: e.target.value as typeof f.variant }))}>{PRODUCT_KEYWORD_VARIANTS.map((x) => <option key={x} value={x}>{t(`aiAdmin.variant_${x}`)}</option>)}</select></div>
          <div className="field"><label htmlFor="pk-target">{t('aiAdmin.target')}</label><select id="pk-target" className="input" value={f.indicationId} onChange={(e) => setF((v) => ({ ...v, indicationId: e.target.value }))}><option value="">{t('aiAdmin.targetProduct')}</option>{indications.map((i) => <option key={i.id} value={i.id}>{i.titleEn}</option>)}</select></div>
          <button className="btn btn-primary btn-sm" disabled={add.isPending || f.term.trim().length < 2} onClick={() => add.mutate()} data-testid="pk-keyword-add">{t('aiAdmin.addKeyword')}</button>
        </div>
      ) : null}
      <ErrorNotice error={add.error} />
    </section>
  );
}

function EngineTest() {
  const { t, locale } = useI18n();
  const [q, setQ] = useState('');
  const run = useMutation({ mutationFn: () => api.productKnowledge.preview(q) });
  return (
    <section className="card" data-testid="pk-engine" style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
      <h2 style={{ margin: 0 }}>{t('aiAdmin.engineTest')}</h2>
      <p className="muted" style={{ margin: 0 }}>{t('aiAdmin.engineHint')}</p>
      <div className="row">
        <input className="input" style={{ flex: 1 }} dir="auto" aria-label={t('aiAdmin.engineTest')} value={q} onChange={(e) => setQ(e.target.value)} data-testid="pk-engine-input" />
        <button className="btn btn-secondary btn-sm" disabled={run.isPending || q.trim().length < 2} onClick={() => run.mutate()} data-testid="pk-engine-run">{t('aiAdmin.engineRun')}</button>
      </div>
      <ErrorNotice error={run.error} />
      {run.data ? (
        <ul data-testid="pk-engine-results">
          {run.data.length ? (
            run.data.map((m) => (
              <li key={m.productId} dir="auto">
                {t('aiAdmin.engineMatch', { name: locale === 'ar' ? m.nameAr : m.nameEn, term: m.term })} —{' '}
                {m.indication ? t('aiAdmin.engineIndication', { title: locale === 'ar' ? m.indication.titleAr : m.indication.titleEn, version: m.indication.version }) : t('aiAdmin.engineName')}
              </li>
            ))
          ) : (
            <li className="subtle">{t('aiAdmin.engineNone')}</li>
          )}
        </ul>
      ) : null}
    </section>
  );
}

function ProductKnowledge() {
  const { t, locale } = useI18n();
  const can = useCan();
  const params = useSearchParams();
  const products = useQuery({ queryKey: LIST_KEY, queryFn: () => api.productKnowledge.products() });
  const [productId, setProductId] = useState<string>(params.get('product') ?? '');
  useEffect(() => {
    if (!productId && products.data?.length) setProductId((products.data.find((p) => !p.isDemo) ?? products.data[0]!).id);
  }, [productId, products.data]);
  const overview = useQuery({ queryKey: overviewKey(productId), queryFn: () => api.productKnowledge.overview(productId), enabled: !!productId });
  const [editing, setEditing] = useState<ProductKnowledgeAdmin | 'new' | null>(null);
  const o = overview.data;
  const onSale = o && o.product.contentStatus === 'APPROVED' && o.product.publicationStatus === 'PUBLISHED';
  return (
    <>
      <p className="muted">{t('aiAdmin.productsIntro')}</p>
      <p className="subtle" data-testid="pk-flag-note">{t('aiAdmin.flagNote')}</p>
      <EngineTest />
      <div className="field" style={{ maxWidth: 420, marginBottom: 12 }}>
        <label htmlFor="pk-product">{t('aiAdmin.product')}</label>
        <select id="pk-product" className="input" value={productId} onChange={(e) => { setEditing(null); setProductId(e.target.value); }} data-testid="pk-product">
          {(products.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>{locale === 'ar' ? p.nameAr : p.nameEn} · {p.approved}✓{p.inReview ? ` · ${p.inReview}…` : ''}</option>
          ))}
        </select>
      </div>
      <ErrorNotice error={products.error ?? overview.error} />
      {o ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {o.product.isDemo ? <div className="notice warning">{t('aiAdmin.demoProduct')}</div> : !onSale ? <div className="notice warning" data-testid="pk-not-on-sale">{t('aiAdmin.notOnSale')}</div> : null}
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>{t('aiAdmin.statements')}</h2>
            {can('catalog.tetrasol.manage') && !editing && !o.product.isDemo ? <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')} data-testid="pk-entry-new">{t('aiAdmin.newStatement')}</button> : null}
          </div>
          {editing ? <EntryEditor key={editing === 'new' ? 'new' : editing.id} productId={o.product.id} initial={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} /> : null}
          {o.entries.length ? o.entries.map((e) => <EntryCard key={`${e.id}:${e.updatedAt}:${e.status}`} e={e} onEdit={() => setEditing(e)} />) : <p className="subtle">{t('aiAdmin.noStatements')}</p>}
          <Keywords productId={o.product.id} entries={o.entries} keywords={o.keywords} />
        </div>
      ) : null}
    </>
  );
}

/** Company-product knowledge and the product keyword engine (catalogue staff propose, clinical reviewers approve). */
export default function ProductKnowledgePage() {
  const { t } = useI18n();
  return (
    <Shell title={t('aiAdmin.nav')}>
      <AiTabs />
      <Suspense>
        <ProductKnowledge />
      </Suspense>
    </Shell>
  );
}
