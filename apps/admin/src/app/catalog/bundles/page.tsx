'use client';
import type { Bundle } from '@ghayarly/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CatalogTabs, egpToPiasters, PublicationBadge, useCatalogError, useMoney } from '@/components/catalog';
import { useI18n, useToast } from '@/components/Providers';
import { Shell } from '@/components/Shell';
import { api } from '@/lib/api';

/** Bundles: a fixed price for several product options; publishable only while every item is on sale. */
export default function Bundles() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const errorText = useCatalogError();
  const list = useQuery({ queryKey: ['catalog-bundles'], queryFn: () => api.catalog.bundles() });
  const [f, setF] = useState({ slug: '', nameEn: '', nameAr: '', price: '' });
  const create = useMutation({
    mutationFn: () => api.catalog.createBundle({ slug: f.slug, nameEn: f.nameEn, nameAr: f.nameAr, pricePiasters: egpToPiasters(f.price) }),
    onSuccess: async () => {
      setF({ slug: '', nameEn: '', nameAr: '', price: '' });
      toast(t('catalog.saved'));
      await qc.invalidateQueries({ queryKey: ['catalog-bundles'] });
    },
  });
  return (
    <Shell title={t('catalog.bundles')}>
      <CatalogTabs />
      <p className="muted">{t('catalog.bundleRule')}</p>
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="grid grid-4">
          <div className="field"><label htmlFor="b-slug">{t('catalog.slug')}</label><input id="b-slug" className="input mono" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} required pattern="[a-z0-9]+(-[a-z0-9]+)*" /></div>
          <div className="field"><label htmlFor="b-en">{t('catalog.bundleName')} (EN)</label><input id="b-en" className="input" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} required /></div>
          <div className="field"><label htmlFor="b-ar">{t('catalog.bundleName')} (AR)</label><input id="b-ar" className="input" dir="rtl" lang="ar" value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} required /></div>
          <div className="field"><label htmlFor="b-price">{t('catalog.bundlePrice')}</label><input id="b-price" className="input" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} required /></div>
        </div>
        {create.error ? <div className="notice danger">{errorText(create.error)}</div> : null}
        <div className="row"><button className="btn btn-primary" type="submit" disabled={create.isPending || egpToPiasters(f.price) === null}>{t('catalog.createBundle')}</button></div>
      </form>
      <div className="stack" style={{ marginTop: 16 }}>
        {(list.data ?? []).map((b) => <BundleCard key={b.id} bundle={b} />)}
      </div>
    </Shell>
  );
}

function BundleCard({ bundle }: { bundle: Bundle }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const money = useMoney();
  const errorText = useCatalogError();
  const [items, setItems] = useState(bundle.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity, label: `${locale === 'ar' ? i.productNameAr : i.productNameEn} · ${locale === 'ar' ? i.variantLabelAr : i.variantLabelEn}` })));
  const [productId, setProductId] = useState('');
  const [variantId, setVariantId] = useState('');
  const products = useQuery({ queryKey: ['catalog-products', 'ALL', ''], queryFn: () => api.catalog.products({ status: 'ALL' }) });
  const product = useQuery({ queryKey: ['catalog-product', productId], queryFn: () => api.catalog.product(productId), enabled: Boolean(productId) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['catalog-bundles'] });
  const save = useMutation({ mutationFn: () => api.catalog.setBundleItems(bundle.id, items.map(({ variantId: v, quantity }) => ({ variantId: v, quantity }))), onSuccess: refresh });
  const publication = useMutation({ mutationFn: (s: 'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED') => api.catalog.setBundlePublication(bundle.id, s), onSuccess: refresh });
  const locked = bundle.publicationStatus === 'PUBLISHED';
  const err = save.error ?? publication.error;
  return (
    <section className="card stack" data-testid={`bundle-${bundle.slug}`}>
      <div className="spread">
        <h2>{locale === 'ar' ? bundle.nameAr : bundle.nameEn}</h2>
        <PublicationBadge status={bundle.publicationStatus} />
      </div>
      <p>
        <strong>{money(bundle.pricePiasters)}</strong> · <span className="subtle">{t('catalog.itemsValue')}: {money(bundle.itemsValuePiasters)}</span>
      </p>
      <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
        {items.map((i, idx) => (
          <li key={i.variantId} className="row" style={{ gap: 8 }}>
            <span style={{ flex: 1 }}>{i.label}</span>
            <input className="input" style={{ width: 80 }} aria-label={t('catalog.quantity')} inputMode="numeric" disabled={locked} value={i.quantity} onChange={(e) => setItems(items.map((x, j) => (j === idx ? { ...x, quantity: Math.max(1, Math.min(10, Number(e.target.value) || 1)) } : x)))} />
            {!locked ? <button className="btn btn-sm btn-ghost" onClick={() => setItems(items.filter((_, j) => j !== idx))}>{t('catalog.remove')}</button> : null}
          </li>
        ))}
      </ul>
      {!locked ? (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field">
            <label htmlFor={`bp-${bundle.id}`}>{t('catalog.products')}</label>
            <select id={`bp-${bundle.id}`} className="input" value={productId} onChange={(e) => { setProductId(e.target.value); setVariantId(''); }}>
              <option value="" />
              {(products.data ?? []).map((p) => <option key={p.id} value={p.id}>{locale === 'ar' ? p.nameAr : p.nameEn}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`bv-${bundle.id}`}>{t('catalog.variants')}</label>
            <select id={`bv-${bundle.id}`} className="input" value={variantId} onChange={(e) => setVariantId(e.target.value)} disabled={!product.data}>
              <option value="" />
              {(product.data?.variants ?? []).map((v) => <option key={v.id} value={v.id}>{v.sku} · {locale === 'ar' ? v.labelAr : v.labelEn}</option>)}
            </select>
          </div>
          <button
            className="btn btn-sm btn-secondary"
            disabled={!variantId || items.some((i) => i.variantId === variantId)}
            onClick={() => {
              const v = product.data!.variants.find((x) => x.id === variantId)!;
              setItems([...items, { variantId, quantity: 1, label: `${locale === 'ar' ? product.data!.nameAr : product.data!.nameEn} · ${locale === 'ar' ? v.labelAr : v.labelEn}` }]);
              setVariantId('');
            }}
          >
            {t('catalog.addItem')}
          </button>
          <button className="btn btn-sm btn-primary" disabled={!items.length || save.isPending} onClick={() => save.mutate()}>{t('catalog.saveItems')}</button>
        </div>
      ) : null}
      {err ? <div className="notice danger">{errorText(err)}</div> : null}
      <div className="row" style={{ gap: 8 }}>
        {bundle.publicationStatus !== 'PUBLISHED' ? <button className="btn btn-primary" onClick={() => publication.mutate('PUBLISHED')}>{t('catalog.publish')}</button> : <button className="btn btn-secondary" onClick={() => publication.mutate('UNPUBLISHED')}>{t('catalog.unpublish')}</button>}
        {bundle.publicationStatus !== 'ARCHIVED' ? <button className="btn btn-soft" onClick={() => publication.mutate('ARCHIVED')}>{t('catalog.archive')}</button> : null}
      </div>
    </section>
  );
}
