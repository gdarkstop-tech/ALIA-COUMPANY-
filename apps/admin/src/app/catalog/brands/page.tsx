'use client';
import { hasPermission } from '@ghayarly/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CatalogTabs, useCatalogError } from '@/components/catalog';
import { useI18n, useToast } from '@/components/Providers';
import { Shell, useMe } from '@/components/Shell';
import { api } from '@/lib/api';

/** Company-owned brands (ADMIN, with ownership evidence) and store categories. */
export default function BrandsAndCategories() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const me = useMe();
  const errorText = useCatalogError();
  const canBrand = me.data ? hasPermission(me.data.roles, 'catalog.brands.manage') : false;
  const canEdit = me.data ? hasPermission(me.data.roles, 'catalog.tetrasol.manage') : false;
  const brands = useQuery({ queryKey: ['catalog-brands'], queryFn: () => api.catalog.brands(), enabled: canEdit || canBrand });
  const categories = useQuery({ queryKey: ['catalog-categories'], queryFn: () => api.catalog.categories() });
  const [b, setB] = useState({ name: '', ownerEntity: '', ownershipReference: '' });
  const [c, setC] = useState({ slug: '', nameEn: '', nameAr: '' });
  const ok = (key: string) => async () => {
    toast(t('catalog.saved'));
    await qc.invalidateQueries({ queryKey: [key] });
  };
  const addBrand = useMutation({ mutationFn: () => api.catalog.createBrand(b), onSuccess: async () => { setB({ name: '', ownerEntity: '', ownershipReference: '' }); await ok('catalog-brands')(); } });
  const toggleBrand = useMutation({ mutationFn: (x: { name: string; active: boolean }) => api.catalog.updateBrand(x.name, { active: !x.active }), onSuccess: ok('catalog-brands') });
  const addCategory = useMutation({ mutationFn: () => api.catalog.createCategory(c), onSuccess: async () => { setC({ slug: '', nameEn: '', nameAr: '' }); await ok('catalog-categories')(); } });
  const toggleCategory = useMutation({ mutationFn: (x: { id: string; active: boolean }) => api.catalog.updateCategory(x.id, { active: !x.active }), onSuccess: ok('catalog-categories') });
  const pending = (s: string) => /TO CONFIRM/i.test(s);

  return (
    <Shell title={t('catalog.brands')}>
      <CatalogTabs />
      <div className="grid grid-2">
        <section className="card stack">
          <h2>{t('catalog.brand')}</h2>
          <p className="muted">{t('catalog.brandRule')}</p>
          <table className="table" data-testid="brands-table">
            <thead><tr><th>{t('catalog.brandName')}</th><th>{t('catalog.ownerEntity')}</th><th>{t('catalog.ownershipReference')}</th><th /></tr></thead>
            <tbody>
              {(brands.data ?? []).map((x) => (
                <tr key={x.name}>
                  <td><strong>{x.name}</strong>{!x.active ? <div><span className="badge tone-neutral">{t('catalog.inactive')}</span></div> : null}</td>
                  <td>{pending(x.ownerEntity) ? <span className="badge tone-warning">{t('catalog.toConfirm')}</span> : x.ownerEntity}</td>
                  <td>{pending(x.ownershipReference) ? <span className="badge tone-warning">{t('catalog.toConfirm')}</span> : <span className="mono">{x.ownershipReference}</span>}</td>
                  <td>{canBrand ? <button className="btn btn-sm btn-ghost" onClick={() => toggleBrand.mutate(x)}>{x.active ? t('catalog.deactivate') : t('catalog.activate')}</button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {canBrand ? (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                addBrand.mutate();
              }}
            >
              <div className="field"><label htmlFor="br-name">{t('catalog.brandName')}</label><input id="br-name" className="input" value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} required minLength={2} /></div>
              <div className="field"><label htmlFor="br-owner">{t('catalog.ownerEntity')}</label><input id="br-owner" className="input" value={b.ownerEntity} onChange={(e) => setB({ ...b, ownerEntity: e.target.value })} required minLength={2} /></div>
              <div className="field"><label htmlFor="br-ref">{t('catalog.ownershipReference')}</label><input id="br-ref" className="input" value={b.ownershipReference} onChange={(e) => setB({ ...b, ownershipReference: e.target.value })} required minLength={3} /></div>
              {addBrand.error ? <div className="notice danger">{errorText(addBrand.error)}</div> : null}
              <div className="row"><button className="btn btn-primary" type="submit" disabled={addBrand.isPending}>{t('catalog.addBrand')}</button></div>
            </form>
          ) : null}
        </section>

        <section className="card stack">
          <h2>{t('catalog.categories')}</h2>
          <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
            {(categories.data ?? []).map((x) => (
              <li key={x.id} className="spread">
                <span>{locale === 'ar' ? x.nameAr : x.nameEn} <span className="subtle mono">{x.slug}</span></span>
                {canEdit ? <button className="btn btn-sm btn-ghost" onClick={() => toggleCategory.mutate(x)}>{x.active ? t('catalog.deactivate') : t('catalog.activate')}</button> : null}
              </li>
            ))}
          </ul>
          {canEdit ? (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                addCategory.mutate();
              }}
            >
              <div className="field"><label htmlFor="ca-slug">{t('catalog.slug')}</label><input id="ca-slug" className="input mono" value={c.slug} onChange={(e) => setC({ ...c, slug: e.target.value.toLowerCase() })} required pattern="[a-z0-9]+(-[a-z0-9]+)*" /></div>
              <div className="field"><label htmlFor="ca-en">{t('catalog.nameEn')}</label><input id="ca-en" className="input" value={c.nameEn} onChange={(e) => setC({ ...c, nameEn: e.target.value })} required /></div>
              <div className="field"><label htmlFor="ca-ar">{t('catalog.nameAr')}</label><input id="ca-ar" className="input" dir="rtl" lang="ar" value={c.nameAr} onChange={(e) => setC({ ...c, nameAr: e.target.value })} required /></div>
              {addCategory.error ? <div className="notice danger">{errorText(addCategory.error)}</div> : null}
              <div className="row"><button className="btn btn-primary" type="submit" disabled={addCategory.isPending}>{t('catalog.addCategory')}</button></div>
            </form>
          ) : null}
        </section>
      </div>
    </Shell>
  );
}
