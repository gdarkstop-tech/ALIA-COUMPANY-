'use client';
import { formatNumber } from '@ghayarly/i18n';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { CatalogTabs, useMoney } from '@/components/catalog';
import { useI18n } from '@/components/Providers';
import { Shell } from '@/components/Shell';
import { api } from '@/lib/api';

const PERIODS = [7, 30, 90] as const;

/** Real figures only: funnel events counted without user identifiers; paid orders once checkout exists. */
export default function Analytics() {
  const { t, locale } = useI18n();
  const money = useMoney();
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const a = useQuery({ queryKey: ['catalog-analytics', days], queryFn: () => api.catalog.analytics(days) });
  const n = (v: number) => formatNumber(v, locale);
  return (
    <Shell title={t('catalog.analytics')}>
      <CatalogTabs />
      <div className="tabs" role="tablist" aria-label={t('catalog.days')} style={{ marginBottom: 16 }}>
        {PERIODS.map((d) => (
          <button key={d} role="tab" aria-selected={days === d} className={`tab ${days === d ? 'active' : ''}`} onClick={() => setDays(d)}>{t('catalog.lastDays', { days: d })}</button>
        ))}
      </div>
      {a.data && !a.data.checkoutEnabled ? <div className="notice info" data-testid="analytics-no-checkout" style={{ marginBottom: 16 }}>{t('catalog.checkoutDisabled')}</div> : null}
      {a.data ? (
        <>
          <div className="grid grid-4" data-testid="analytics-stats">
            <div className="card stat"><span className="subtle">{t('catalog.paidOrders')}</span><strong>{n(a.data.paidOrders)}</strong></div>
            <div className="card stat"><span className="subtle">{t('catalog.revenue')}</span><strong>{money(a.data.revenuePiasters)}</strong></div>
            <div className="card stat"><span className="subtle">{t('catalog.views')}</span><strong>{n(a.data.funnel.productViews)}</strong></div>
            <div className="card stat"><span className="subtle">{t('catalog.addToCart')}</span><strong>{n(a.data.funnel.addToCart)}</strong><span className="subtle">{t('catalog.checkoutPreviews')}: {n(a.data.funnel.checkoutPreviews)}</span></div>
          </div>
          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <section className="card tight">
              <h2 style={{ padding: '12px 16px 0' }}>{t('catalog.perProduct')}</h2>
              <table className="table">
                <thead><tr><th>{t('catalog.products')}</th><th>{t('catalog.views')}</th><th>{t('catalog.addToCart')}</th><th>{t('catalog.paidOrders')}</th></tr></thead>
                <tbody>
                  {a.data.products.map((p) => (
                    <tr key={p.productId}><td>{locale === 'ar' ? p.nameAr : p.nameEn}</td><td>{n(p.views)}</td><td>{n(p.addToCart)}</td><td>{n(p.paidUnits)}</td></tr>
                  ))}
                  {!a.data.products.length ? <tr><td colSpan={4} className="subtle">—</td></tr> : null}
                </tbody>
              </table>
            </section>
            <section className="card tight">
              <h2 style={{ padding: '12px 16px 0' }}>{t('catalog.lowStockList')}</h2>
              <table className="table">
                <thead><tr><th>{t('catalog.sku')}</th><th>{t('catalog.products')}</th><th>{t('catalog.stock')}</th></tr></thead>
                <tbody>
                  {a.data.lowStock.map((v) => (
                    <tr key={v.variantId}><td className="mono">{v.sku}</td><td>{locale === 'ar' ? v.productNameAr : v.productNameEn}</td><td>{n(v.quantity)} / {n(v.threshold)}</td></tr>
                  ))}
                  {!a.data.lowStock.length ? <tr><td colSpan={3} className="subtle">—</td></tr> : null}
                </tbody>
              </table>
            </section>
          </div>
        </>
      ) : <div className="skeleton" style={{ height: 120 }} />}
    </Shell>
  );
}
