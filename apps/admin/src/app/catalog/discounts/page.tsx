'use client';
import { DISCOUNT_KINDS, DISCOUNT_SCOPES, type Discount } from '@ghayarly/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CatalogTabs, egpToPiasters, useCatalogError, useMoney } from '@/components/catalog';
import { useI18n, useToast } from '@/components/Providers';
import { formatDateTime, Shell } from '@/components/Shell';
import { api } from '@/lib/api';

/** Discounts: automatic or code-based; the server applies at most one (the best for the customer). */
export default function Discounts() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const money = useMoney();
  const errorText = useCatalogError();
  const list = useQuery({ queryKey: ['catalog-discounts'], queryFn: () => api.catalog.discounts() });
  const products = useQuery({ queryKey: ['catalog-products', 'ALL', ''], queryFn: () => api.catalog.products({ status: 'ALL' }) });
  const categories = useQuery({ queryKey: ['catalog-categories'], queryFn: () => api.catalog.categories() });
  const bundles = useQuery({ queryKey: ['catalog-bundles'], queryFn: () => api.catalog.bundles() });
  const [f, setF] = useState({ nameEn: '', nameAr: '', code: '', kind: 'PERCENT' as Discount['kind'], value: '', scope: 'ALL' as Discount['scope'], targetId: '', minSubtotal: '0', endsAt: '' });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const value = f.kind === 'PERCENT' ? (/^\d{1,2}$/.test(f.value) ? Number(f.value) : null) : egpToPiasters(f.value);
  const create = useMutation({
    mutationFn: () =>
      api.catalog.createDiscount({
        nameEn: f.nameEn,
        nameAr: f.nameAr,
        code: f.code.trim() ? f.code.trim().toUpperCase() : null,
        kind: f.kind,
        value,
        scope: f.scope,
        targetId: f.scope === 'ALL' ? null : f.targetId || null,
        minSubtotalPiasters: egpToPiasters(f.minSubtotal) ?? 0,
        endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null,
        active: false,
      }),
    onSuccess: async () => {
      toast(t('catalog.saved'));
      await qc.invalidateQueries({ queryKey: ['catalog-discounts'] });
    },
  });
  const toggle = useMutation({ mutationFn: (d: Discount) => api.catalog.updateDiscount(d.id, { active: !d.active }), onSuccess: () => qc.invalidateQueries({ queryKey: ['catalog-discounts'] }) });
  const targets: { id: string; label: string }[] =
    f.scope === 'PRODUCT'
      ? (products.data ?? []).map((p) => ({ id: p.id, label: locale === 'ar' ? p.nameAr : p.nameEn }))
      : f.scope === 'CATEGORY'
        ? (categories.data ?? []).map((c) => ({ id: c.id, label: locale === 'ar' ? c.nameAr : c.nameEn }))
        : f.scope === 'BUNDLE'
          ? (bundles.data ?? []).map((b) => ({ id: b.id, label: locale === 'ar' ? b.nameAr : b.nameEn }))
          : [];

  return (
    <Shell title={t('catalog.discounts')}>
      <CatalogTabs />
      <p className="muted">{t('catalog.discountRule')}</p>
      <form
        className="card stack"
        data-testid="discount-form"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="grid grid-4">
          <div className="field"><label htmlFor="d-en">{t('catalog.discountName')} (EN)</label><input id="d-en" className="input" value={f.nameEn} onChange={(e) => set('nameEn', e.target.value)} required /></div>
          <div className="field"><label htmlFor="d-ar">{t('catalog.discountName')} (AR)</label><input id="d-ar" className="input" dir="rtl" lang="ar" value={f.nameAr} onChange={(e) => set('nameAr', e.target.value)} required /></div>
          <div className="field"><label htmlFor="d-code">{t('catalog.code')}</label><input id="d-code" className="input mono" value={f.code} onChange={(e) => set('code', e.target.value.toUpperCase())} pattern="[A-Z0-9-]{4,24}" /></div>
          <div className="field">
            <label htmlFor="d-kind">{t('catalog.kind')}</label>
            <select id="d-kind" className="input" value={f.kind} onChange={(e) => set('kind', e.target.value)}>
              {DISCOUNT_KINDS.map((k) => <option key={k} value={k}>{t(`catalog.kind_${k}`)}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="d-value">{t('catalog.value')}{f.kind === 'PERCENT' ? ' (%)' : ''}</label><input id="d-value" className="input" inputMode="decimal" value={f.value} onChange={(e) => set('value', e.target.value)} required /></div>
          <div className="field">
            <label htmlFor="d-scope">{t('catalog.scope')}</label>
            <select id="d-scope" className="input" value={f.scope} onChange={(e) => setF((x) => ({ ...x, scope: e.target.value as Discount['scope'], targetId: '' }))}>
              {DISCOUNT_SCOPES.filter((s) => s !== 'VARIANT').map((s) => <option key={s} value={s}>{t(`catalog.scope_${s}`)}</option>)}
            </select>
          </div>
          {f.scope !== 'ALL' ? (
            <div className="field">
              <label htmlFor="d-target">{t('catalog.target')}</label>
              <select id="d-target" className="input" value={f.targetId} onChange={(e) => set('targetId', e.target.value)} required>
                <option value="" />
                {targets.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </div>
          ) : null}
          <div className="field"><label htmlFor="d-min">{t('catalog.minSubtotal')}</label><input id="d-min" className="input" inputMode="decimal" value={f.minSubtotal} onChange={(e) => set('minSubtotal', e.target.value)} /></div>
          <div className="field"><label htmlFor="d-ends">{t('catalog.ends')}</label><input id="d-ends" type="datetime-local" className="input" value={f.endsAt} onChange={(e) => set('endsAt', e.target.value)} /></div>
        </div>
        {create.error ? <div className="notice danger">{errorText(create.error)}</div> : null}
        <div className="row"><button className="btn btn-primary" type="submit" disabled={create.isPending || value === null || (f.kind === 'PERCENT' && (value ?? 0) > 90)} data-testid="discount-create">{t('catalog.createDiscount')}</button></div>
      </form>

      <div className="card tight" style={{ marginTop: 16 }}>
        <table className="table" data-testid="discounts-table">
          <thead><tr><th>{t('catalog.discountName')}</th><th>{t('catalog.code')}</th><th>{t('catalog.value')}</th><th>{t('catalog.scope')}</th><th>{t('catalog.ends')}</th><th /></tr></thead>
          <tbody>
            {(list.data ?? []).map((d) => (
              <tr key={d.id}>
                <td>{locale === 'ar' ? d.nameAr : d.nameEn}</td>
                <td className="mono">{d.code ?? '—'}</td>
                <td>{d.kind === 'PERCENT' ? `${d.value}%` : money(d.value)}{d.minSubtotalPiasters ? <div className="subtle">≥ {money(d.minSubtotalPiasters)}</div> : null}</td>
                <td>{t(`catalog.scope_${d.scope}`)}</td>
                <td className="subtle">{formatDateTime(d.endsAt, locale)}</td>
                <td><button className={`btn btn-sm ${d.active ? 'btn-secondary' : 'btn-primary'}`} onClick={() => toggle.mutate(d)}>{d.active ? t('catalog.deactivate') : t('catalog.activate')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
