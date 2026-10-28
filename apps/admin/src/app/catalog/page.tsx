'use client';
import { hasPermission } from '@ghayarly/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BrandLoader, BrandName, TetraSolLogo } from '@/components/brand';
import { CatalogTabs, ContentBadge, imageUrl, PublicationBadge, useCatalogError, useMoney } from '@/components/catalog';
import { ProductContentFields, emptyContent, type ContentForm } from '@/components/ProductContentFields';
import { useI18n } from '@/components/Providers';
import { formatDateTime, Shell, useMe } from '@/components/Shell';
import { api } from '@/lib/api';

const FILTERS = ['ALL', 'PENDING_REVIEW', 'DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'] as const;

/** Catalogue: every product the company sells, with its review and publication state. */
export default function Catalog() {
  const { t, locale, pickName } = useLocalized();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const money = useMoney();
  const errorText = useCatalogError();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('ALL');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [slug, setSlug] = useState('');
  const [brand, setBrand] = useState('TetraSol');
  const [categoryId, setCategoryId] = useState('');
  const [form, setForm] = useState<ContentForm>(emptyContent);
  const canEdit = me.data ? hasPermission(me.data.roles, 'catalog.tetrasol.manage') : false;

  const list = useQuery({ queryKey: ['catalog-products', filter, q], queryFn: () => api.catalog.products({ status: filter, ...(q.trim() ? { q: q.trim() } : {}) }) });
  const brands = useQuery({ queryKey: ['catalog-brands'], queryFn: () => api.catalog.brands(), enabled: canEdit });
  const categories = useQuery({ queryKey: ['catalog-categories'], queryFn: () => api.catalog.categories() });
  const create = useMutation({
    mutationFn: () => api.catalog.createProduct({ slug: slug.trim(), brand, categoryId: categoryId || null, ...form, regulatoryNote: form.regulatoryNote.trim() || null }),
    onSuccess: async (p) => {
      await qc.invalidateQueries({ queryKey: ['catalog-products'] });
      router.push(`/catalog/${p.id}`);
    },
  });

  return (
    <Shell title={t('catalog.nav')} actions={canEdit ? <button className="btn btn-primary" data-testid="catalog-new" onClick={() => setCreating((v) => !v)}>{t('catalog.newProduct')}</button> : null}>
      <div style={{ marginBottom: 16 }}><TetraSolLogo variant="full" height={56} testId="catalog-tetrasol-logo" /></div>
      <CatalogTabs />
      <p className="muted">{t('catalog.intro')}</p>

      {creating ? (
        <form
          className="card stack"
          data-testid="catalog-create-form"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <h2>{t('catalog.newProduct')}</h2>
          <div className="grid grid-4">
            <div className="field">
              <label htmlFor="slug">{t('catalog.slug')}</label>
              <input id="slug" className="input mono" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} required pattern="[a-z0-9]+(-[a-z0-9]+)*" />
            </div>
            <div className="field">
              <label htmlFor="brand">{t('catalog.brand')}</label>
              <select id="brand" className="input" value={brand} onChange={(e) => setBrand(e.target.value)}>
                {(brands.data ?? [{ name: 'TetraSol', active: true }]).filter((b) => b.active).map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="category">{t('catalog.category')}</label>
              <select id="category" className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">{t('catalog.noCategory')}</option>
                {(categories.data ?? []).filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{locale === 'ar' ? c.nameAr : c.nameEn}</option>)}
              </select>
            </div>
          </div>
          <ProductContentFields value={form} onChange={setForm} />
          {create.error ? <div className="notice danger" data-testid="catalog-create-error">{errorText(create.error)}</div> : null}
          <div className="row">
            <button className="btn btn-primary" type="submit" disabled={create.isPending} data-testid="catalog-create">{t('catalog.create')}</button>
          </div>
        </form>
      ) : null}

      <div className="spread" style={{ margin: '16px 0', gap: 12, flexWrap: 'wrap' }}>
        <div className="tabs" role="tablist">
          {FILTERS.map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={`tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)} data-testid={`catalog-filter-${f}`}>
              {t(`catalog.filter_${f}`)}
            </button>
          ))}
        </div>
        <input className="input" style={{ maxWidth: 320 }} aria-label={t('catalog.search')} placeholder={t('catalog.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="card tight">
        {list.isPending ? <BrandLoader /> : null}
        {list.data && !list.data.length ? <div className="empty">{t('catalog.empty')}</div> : null}
        {list.data?.length ? (
          <table className="table" data-testid="catalog-table">
            <thead>
              <tr><th /><th>{t('catalog.nameEn')}</th><th>{t('catalog.brand')}</th><th>{t('catalog.approval')}</th><th>{t('catalog.publication')}</th><th>{t('catalog.fromPrice')}</th><th>{t('admin.when')}</th></tr>
            </thead>
            <tbody>
              {list.data.map((p) => (
                <tr key={p.id} data-testid={`catalog-row-${p.slug}`}>
                  <td style={{ width: 56 }}>{p.imageId ? <img src={imageUrl(p.imageId)} alt="" width={44} height={44} style={{ objectFit: 'cover', borderRadius: 8 }} /> : <span className="subtle">—</span>}</td>
                  <td>
                    <Link href={`/catalog/${p.id}`} className="clickable"><strong>{pickName(p)}</strong></Link>
                    <div className="subtle mono">{p.slug}</div>
                    {p.isDemo ? <span className="badge tone-demo">{t('catalog.demoItem')}</span> : null}
                    {p.lowStock ? <span className="badge tone-warning">{t('catalog.lowStock')}</span> : null}
                  </td>
                  <td><BrandName brand={p.brand} /></td>
                  <td><ContentBadge status={p.contentStatus} /></td>
                  <td><PublicationBadge status={p.publicationStatus} /></td>
                  <td>{money(p.fromPricePiasters)}</td>
                  <td className="subtle">{formatDateTime(p.updatedAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </Shell>
  );
}

function useLocalized() {
  const i18n = useI18n();
  return { ...i18n, pickName: (p: { nameAr: string; nameEn: string }) => (i18n.locale === 'ar' ? p.nameAr : p.nameEn) };
}
