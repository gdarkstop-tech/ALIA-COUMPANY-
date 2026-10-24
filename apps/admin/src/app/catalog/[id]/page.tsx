'use client';
import { hasPermission, PRODUCT_IMAGE_MAX_BYTES, STOCK_REASONS, type AdminProduct, type AdminVariant } from '@ghayarly/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CatalogTabs, ContentBadge, egpToPiasters, fileToBase64, imageUrl, PublicationBadge, useCatalogError, useMoney } from '@/components/catalog';
import { ProductContentFields, type ContentForm } from '@/components/ProductContentFields';
import { useI18n, useToast } from '@/components/Providers';
import { formatDateTime, Shell, useMe } from '@/components/Shell';
import { api } from '@/lib/api';

function toForm(p: AdminProduct): ContentForm {
  return {
    nameEn: p.nameEn,
    nameAr: p.nameAr,
    summaryEn: p.summaryEn,
    summaryAr: p.summaryAr,
    descriptionEn: p.descriptionEn,
    descriptionAr: p.descriptionAr,
    usageEn: p.usageEn,
    usageAr: p.usageAr,
    approvedUsesEn: p.approvedUsesEn,
    approvedUsesAr: p.approvedUsesAr,
    warningsEn: p.warningsEn,
    warningsAr: p.warningsAr,
    regulatoryNote: p.regulatoryNote ?? '',
  };
}

export default function ProductEditor() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const errorText = useCatalogError();
  const product = useQuery({ queryKey: ['catalog-product', id], queryFn: () => api.catalog.product(id) });
  const categories = useQuery({ queryKey: ['catalog-categories'], queryFn: () => api.catalog.categories() });
  const [form, setForm] = useState<ContentForm | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const roles = me.data?.roles ?? [];
  const canEdit = hasPermission(roles, 'catalog.tetrasol.manage');
  const canApprove = hasPermission(roles, 'catalog.content.approve');

  useEffect(() => {
    if (product.data) {
      setForm(toForm(product.data));
      setCategoryId(product.data.categoryId ?? '');
    }
  }, [product.data]);

  const done = (p: AdminProduct) => {
    qc.setQueryData(['catalog-product', id], p);
    void qc.invalidateQueries({ queryKey: ['catalog-products'] });
    setError(null);
    toast(t('catalog.saved'));
  };
  const onError = (e: unknown) => setError(errorText(e));
  const save = useMutation({ mutationFn: () => api.catalog.updateProduct(id, { ...form!, regulatoryNote: form!.regulatoryNote.trim() || null, categoryId: categoryId || null }), onSuccess: done, onError });
  const approve = useMutation({ mutationFn: () => api.catalog.approve(id, reference.trim()), onSuccess: (p) => { setReference(''); done(p); }, onError });
  const withdraw = useMutation({ mutationFn: () => api.catalog.withdrawApproval(id), onSuccess: done, onError });
  const publication = useMutation({ mutationFn: (s: 'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED') => api.catalog.setPublication(id, s), onSuccess: done, onError });
  const remove = useMutation({
    mutationFn: () => api.catalog.deleteProduct(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['catalog-products'] });
      router.push('/catalog');
    },
    onError,
  });

  const p = product.data;
  if (!p || !form) {
    return (
      <Shell title={t('catalog.products')}>
        <CatalogTabs />
        {product.error ? <div className="notice danger">{errorText(product.error)}</div> : <div className="skeleton" style={{ height: 120 }} />}
      </Shell>
    );
  }
  const name = locale === 'ar' ? p.nameAr : p.nameEn;

  return (
    <Shell title={name}>
      <CatalogTabs />
      <div className="row" style={{ gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <Link href="/catalog" className="btn btn-sm btn-ghost">← {t('catalog.products')}</Link>
        <span className="mono subtle">{p.slug}</span>
        <span className="badge tone-neutral">{p.brand}</span>
        <ContentBadge status={p.contentStatus} />
        <PublicationBadge status={p.publicationStatus} />
        {p.isDemo ? <span className="badge tone-demo">{t('catalog.demoItem')}</span> : null}
      </div>
      {error ? <div className="notice danger" data-testid="product-error" role="alert" style={{ marginBottom: 16 }}>{error}</div> : null}

      <div className="grid grid-2">
        <div className="stack">
          <form
            className="card stack"
            data-testid="product-content-form"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div className="field" style={{ maxWidth: 320 }}>
              <label htmlFor="category">{t('catalog.category')}</label>
              <select id="category" className="input" value={categoryId} disabled={!canEdit && !canApprove} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">{t('catalog.noCategory')}</option>
                {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{locale === 'ar' ? c.nameAr : c.nameEn}</option>)}
              </select>
            </div>
            <ProductContentFields value={form} onChange={setForm} disabled={(!canEdit && !canApprove) || p.isDemo} />
            {(canEdit || canApprove) && !p.isDemo ? (
              <div className="row">
                <button className="btn btn-primary" type="submit" disabled={save.isPending} data-testid="product-save">{t('catalog.save')}</button>
              </div>
            ) : null}
          </form>
          <Variants product={p} canEdit={canEdit} onSaved={done} onError={onError} />
          <Images product={p} canEdit={canEdit} onSaved={done} onError={onError} />
        </div>

        <div className="stack">
          <section className="card stack" data-testid="approval-card">
            <h2>{t('catalog.approval')}</h2>
            <ContentBadge status={p.contentStatus} />
            {p.approvedAt ? <p className="subtle">{t('catalog.approvedBy', { name: p.approvedByName ?? '—', date: formatDateTime(p.approvedAt, locale) })}</p> : null}
            {p.approvalReference ? <p className="mono">{p.approvalReference}</p> : null}
            {p.lastEditedByName ? <p className="subtle">{t('catalog.lastEditedBy', { name: p.lastEditedByName })}</p> : null}
            {!canApprove ? <p className="subtle">{t('catalog.noApprovePermission')}</p> : null}
            {canApprove && p.contentStatus !== 'APPROVED' && !p.isDemo ? (
              p.editedByMe ? (
                <div className="notice warning" data-testid="edited-by-you">{t('catalog.editedByYou')}</div>
              ) : (
                <form
                  className="stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    approve.mutate();
                  }}
                >
                  <div className="field">
                    <label htmlFor="approval-ref">{t('catalog.approvalReference')}</label>
                    <input id="approval-ref" className="input mono" value={reference} onChange={(e) => setReference(e.target.value)} required minLength={3} maxLength={200} data-testid="approval-reference" />
                  </div>
                  <button className="btn btn-primary" type="submit" disabled={approve.isPending || reference.trim().length < 3} data-testid="approve-content">{t('catalog.approveContent')}</button>
                </form>
              )
            ) : null}
            {canApprove && p.contentStatus === 'APPROVED' ? (
              <button className="btn btn-secondary" onClick={() => withdraw.mutate()} disabled={withdraw.isPending} data-testid="withdraw-approval">{t('catalog.withdrawApproval')}</button>
            ) : null}
          </section>

          {canEdit ? (
            <section className="card stack" data-testid="publication-card">
              <h2>{t('catalog.publication')}</h2>
              <PublicationBadge status={p.publicationStatus} />
              {p.publishedAt ? <p className="subtle">{formatDateTime(p.publishedAt, locale)}</p> : null}
              {p.publicationStatus === 'DRAFT' || p.publicationStatus === 'UNPUBLISHED' ? (
                <>
                  <button className="btn btn-primary" disabled={publication.isPending || (p.contentStatus !== 'APPROVED' && !p.isDemo)} onClick={() => publication.mutate('PUBLISHED')} data-testid="publish">{t('catalog.publish')}</button>
                  {p.contentStatus !== 'APPROVED' && !p.isDemo ? <p className="subtle">{t('catalog.publishNeedsApproval')}</p> : null}
                </>
              ) : null}
              {p.publicationStatus === 'PUBLISHED' ? <button className="btn btn-secondary" onClick={() => publication.mutate('UNPUBLISHED')} data-testid="unpublish">{t('catalog.unpublish')}</button> : null}
              {p.publicationStatus === 'ARCHIVED' ? (
                <button className="btn btn-secondary" onClick={() => publication.mutate('UNPUBLISHED')} data-testid="restore">{t('catalog.restore')}</button>
              ) : (
                <button className="btn btn-soft" onClick={() => publication.mutate('ARCHIVED')} data-testid="archive">{t('catalog.archive')}</button>
              )}
              {p.deletable ? (
                <button className="btn btn-danger" data-testid="delete-draft" onClick={() => window.confirm(t('catalog.deleteConfirm')) && remove.mutate()}>{t('catalog.deleteDraft')}</button>
              ) : null}
            </section>
          ) : null}

          <section className="card stack">
            <h2>{t('catalog.movements')}</h2>
            {p.stockMovements.length ? (
              <ul className="timeline" data-testid="stock-movements">
                {p.stockMovements.map((m) => (
                  <li key={m.id}>
                    <strong className="mono">{m.delta > 0 ? `+${m.delta}` : m.delta}</strong> → {m.quantityAfter} · {t(`catalog.reason_${m.reason}`)}
                    {m.note ? <> · {m.note}</> : null}
                    <div className="subtle">{m.actorName ?? '—'} · {formatDateTime(m.createdAt, locale)}</div>
                  </li>
                ))}
              </ul>
            ) : <p className="subtle">—</p>}
          </section>
        </div>
      </div>
    </Shell>
  );
}

function Variants({ product, canEdit, onSaved, onError }: { product: AdminProduct; canEdit: boolean; onSaved: (p: AdminProduct) => void; onError: (e: unknown) => void }) {
  const { t } = useI18n();
  const [sku, setSku] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [labelAr, setLabelAr] = useState('');
  const [price, setPrice] = useState('');
  const add = useMutation({
    mutationFn: () => api.catalog.addVariant(product.id, { sku: sku.trim().toUpperCase(), labelEn, labelAr, pricePiasters: egpToPiasters(price) }),
    onSuccess: (p) => {
      setSku('');
      setLabelEn('');
      setLabelAr('');
      setPrice('');
      onSaved(p);
    },
    onError,
  });
  return (
    <section className="card stack" data-testid="variants-card">
      <h2>{t('catalog.variants')}</h2>
      {product.variants.map((v) => <VariantRow key={v.id} v={v} canEdit={canEdit} onSaved={onSaved} onError={onError} />)}
      {!product.variants.length ? <p className="subtle">—</p> : null}
      {canEdit ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <h3>{t('catalog.addVariant')}</h3>
          <div className="grid grid-4">
            <div className="field"><label htmlFor="v-sku">{t('catalog.sku')}</label><input id="v-sku" className="input mono" value={sku} onChange={(e) => setSku(e.target.value)} required pattern="[A-Za-z0-9][A-Za-z0-9-]{1,39}" /></div>
            <div className="field"><label htmlFor="v-en">{t('catalog.labelEn')}</label><input id="v-en" className="input" value={labelEn} onChange={(e) => setLabelEn(e.target.value)} required /></div>
            <div className="field"><label htmlFor="v-ar">{t('catalog.labelAr')}</label><input id="v-ar" className="input" dir="rtl" lang="ar" value={labelAr} onChange={(e) => setLabelAr(e.target.value)} required /></div>
            <div className="field"><label htmlFor="v-price">{t('catalog.price')}</label><input id="v-price" className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required /></div>
          </div>
          <div className="row"><button className="btn btn-secondary" type="submit" disabled={add.isPending || egpToPiasters(price) === null} data-testid="add-variant">{t('catalog.addVariant')}</button></div>
        </form>
      ) : null}
    </section>
  );
}

function VariantRow({ v, canEdit, onSaved, onError }: { v: AdminVariant; canEdit: boolean; onSaved: (p: AdminProduct) => void; onError: (e: unknown) => void }) {
  const { t } = useI18n();
  const money = useMoney();
  const [price, setPrice] = useState((v.pricePiasters / 100).toString());
  const [threshold, setThreshold] = useState(String(v.lowStockThreshold));
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState<(typeof STOCK_REASONS)[number]>('RESTOCK');
  const [note, setNote] = useState('');
  const update = useMutation({ mutationFn: (body: Record<string, unknown>) => api.catalog.updateVariant(v.id, body), onSuccess: onSaved, onError });
  const adjust = useMutation({
    mutationFn: () => api.catalog.adjustStock(v.id, { delta: Number(delta), reason, ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: (p) => {
      setDelta('');
      setNote('');
      onSaved(p);
    },
    onError,
  });
  const deltaValid = /^[+-]?\d{1,6}$/.test(delta.trim()) && Number(delta) !== 0;
  return (
    <div className="card tight stack" data-testid={`variant-${v.sku}`} style={{ background: 'var(--color-surface-sunken)' }}>
      <div className="spread">
        <div>
          <strong className="mono">{v.sku}</strong> · {v.labelEn} / <span dir="rtl" lang="ar">{v.labelAr}</span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="badge tone-neutral">{money(v.pricePiasters)}</span>
          <span className={`badge tone-${v.stockStatus === 'IN_STOCK' ? 'success' : v.stockStatus === 'UNKNOWN' ? 'neutral' : 'warning'}`}>{v.stockQuantity === null ? t('catalog.untracked') : `${t('catalog.stock')}: ${v.stockQuantity}`}</span>
          <span className={`badge tone-${v.active ? 'success' : 'neutral'}`}>{v.active ? t('catalog.active') : t('catalog.inactive')}</span>
        </div>
      </div>
      {canEdit ? (
        <>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field"><label htmlFor={`p-${v.id}`}>{t('catalog.price')}</label><input id={`p-${v.id}`} className="input" style={{ width: 130 }} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
            <div className="field"><label htmlFor={`t-${v.id}`}>{t('catalog.threshold')}</label><input id={`t-${v.id}`} className="input" style={{ width: 110 }} inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} /></div>
            <button className="btn btn-sm btn-secondary" disabled={update.isPending || egpToPiasters(price) === null || !/^\d+$/.test(threshold)} onClick={() => update.mutate({ pricePiasters: egpToPiasters(price), lowStockThreshold: Number(threshold) })} data-testid={`save-variant-${v.sku}`}>{t('catalog.save')}</button>
            <button className="btn btn-sm btn-ghost" onClick={() => update.mutate({ active: !v.active })}>{v.active ? t('catalog.inactive') : t('catalog.active')}</button>
          </div>
          <form
            className="row"
            style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
            onSubmit={(e) => {
              e.preventDefault();
              adjust.mutate();
            }}
          >
            <div className="field"><label htmlFor={`d-${v.id}`}>{t('catalog.delta')}</label><input id={`d-${v.id}`} className="input" style={{ width: 110 }} value={delta} onChange={(e) => setDelta(e.target.value)} data-testid={`stock-delta-${v.sku}`} /></div>
            <div className="field">
              <label htmlFor={`r-${v.id}`}>{t('catalog.reason')}</label>
              <select id={`r-${v.id}`} className="input" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
                {STOCK_REASONS.map((r) => <option key={r} value={r}>{t(`catalog.reason_${r}`)}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}><label htmlFor={`n-${v.id}`}>{t('catalog.note')}</label><input id={`n-${v.id}`} className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></div>
            <button className="btn btn-sm btn-secondary" type="submit" disabled={!deltaValid || adjust.isPending} data-testid={`stock-adjust-${v.sku}`}>{t('catalog.adjustStock')}</button>
          </form>
        </>
      ) : null}
    </div>
  );
}

function Images({ product, canEdit, onSaved, onError }: { product: AdminProduct; canEdit: boolean; onSaved: (p: AdminProduct) => void; onError: (e: unknown) => void }) {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [altEn, setAltEn] = useState('');
  const [altAr, setAltAr] = useState('');
  const upload = useMutation({
    mutationFn: async () => api.catalog.uploadImage(product.id, { contentType: file!.type, dataBase64: await fileToBase64(file!), altEn, altAr }),
    onSuccess: (p) => {
      setFile(null);
      setAltEn('');
      setAltAr('');
      onSaved(p);
    },
    onError,
  });
  const remove = useMutation({ mutationFn: (imageId: string) => api.catalog.deleteImage(imageId), onSuccess: onSaved, onError });
  const tooBig = Boolean(file && file.size > PRODUCT_IMAGE_MAX_BYTES);
  return (
    <section className="card stack" data-testid="images-card">
      <h2>{t('catalog.images')}</h2>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        {product.images.map((img) => (
          <figure key={img.id} style={{ margin: 0, width: 140 }}>
            <img src={imageUrl(img.id)} alt={img.altEn} width={140} height={140} style={{ objectFit: 'cover', borderRadius: 12, background: 'var(--color-surface-sunken)' }} />
            <figcaption className="subtle">{img.width}×{img.height} · {Math.round(img.bytes / 1024)} KB</figcaption>
            {canEdit ? <button className="btn btn-sm btn-ghost" onClick={() => remove.mutate(img.id)}>{t('catalog.remove')}</button> : null}
          </figure>
        ))}
        {!product.images.length ? <p className="subtle">—</p> : null}
      </div>
      {canEdit ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            upload.mutate();
          }}
        >
          <p className="subtle">{t('catalog.imageRules')}</p>
          <input type="file" accept="image/jpeg,image/png,image/webp" aria-label={t('catalog.upload')} onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="image-file" />
          {tooBig ? <div className="notice warning">{t('catalog.err_IMAGE_TOO_LARGE')}</div> : null}
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <div className="field"><label htmlFor="alt-en">{t('catalog.altEn')}</label><input id="alt-en" className="input" value={altEn} maxLength={200} onChange={(e) => setAltEn(e.target.value)} /></div>
            <div className="field"><label htmlFor="alt-ar">{t('catalog.altAr')}</label><input id="alt-ar" className="input" dir="rtl" lang="ar" value={altAr} maxLength={200} onChange={(e) => setAltAr(e.target.value)} /></div>
          </div>
          <div className="row"><button className="btn btn-secondary" type="submit" disabled={!file || tooBig || upload.isPending} data-testid="image-upload">{t('catalog.upload')}</button></div>
        </form>
      ) : null}
    </section>
  );
}
