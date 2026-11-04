'use client';
import { formatEgp, type AiFinanceOverview, type BudgetState } from '@ghayarly/shared';
import { formatNumber } from '@ghayarly/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNotice, useCan, useUsd } from '@/components/ai';
import { useI18n } from '@/components/Providers';
import { Shell } from '@/components/Shell';
import { api } from '@/lib/api';

const FINANCE_KEY = ['finance-overview'];
const PERIODS = [7, 30, 90] as const;
const INVOICE_PROVIDERS = ['ANTHROPIC', 'OPENAI', 'GEMINI', 'QWEN', 'GROK', 'KIMI', 'MEDGEMMA'] as const;

const budgetTone = (s: BudgetState) => (s === 'EXCEEDED' ? 'danger' : s === 'PROJECTED_OVER' || s === 'WARNING' ? 'warning' : s === 'OK' ? 'success' : 'neutral');

function Stat({ label, value, testId, hint }: { label: string; value: string; testId?: string; hint?: string }) {
  return (
    <div className="card tight" style={{ padding: 16 }} data-testid={testId}>
      <div className="subtle">{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      {hint ? <div className="subtle" style={{ fontSize: 13 }}>{hint}</div> : null}
    </div>
  );
}

/**
 * AI Finance Center (ADR 0018): metered AI costs, budgets and reconciliation, and the revenue the
 * platform can verify. Read-only apart from recording provider invoices; nothing moves money.
 */
export default function FinanceCenter() {
  const { t, locale } = useI18n();
  const can = useCan();
  const usd = useUsd();
  const egp = (p: number) => formatEgp(p, locale);
  const num = (v: number) => formatNumber(v, locale);
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const allowed = can('finance.read');
  const q = useQuery({ queryKey: [...FINANCE_KEY, days], queryFn: () => api.finance.overview(days), enabled: allowed });
  if (!allowed) {
    return (
      <Shell title={t('finance.title')}>
        <div className="notice info" data-testid="finance-no-permission">{t('finance.noPermission')}</div>
      </Shell>
    );
  }
  const o = q.data;
  return (
    <Shell title={t('finance.title')}>
      <div className="stack">
        <div className="notice info" data-testid="finance-note">{t('finance.note')}</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }} role="group" aria-label={t('finance.period')}>
          {PERIODS.map((p) => (
            <button key={p} className={`btn btn-sm ${p === days ? 'btn-primary' : ''}`} aria-pressed={p === days} data-testid={`finance-period-${p}`} onClick={() => setDays(p)}>
              {t('finance.lastDays', { n: p })}
            </button>
          ))}
        </div>
        <ErrorNotice error={q.error} />
        {o ? <Overview o={o} usd={usd} egp={egp} num={num} canManage={can('finance.manage')} /> : <div className="skeleton" style={{ height: 240 }} />}
      </div>
    </Shell>
  );
}

function Overview({ o, usd, egp, num, canManage }: { o: AiFinanceOverview; usd: (m: number | null) => string; egp: (p: number) => string; num: (v: number) => string; canManage: boolean }) {
  const { t } = useI18n();
  const b = o.budget;
  const maxDaily = Math.max(1, ...o.daily.map((d) => d.costMicros));
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }} data-testid="finance-spend">
        <Stat label={t('finance.today')} value={usd(o.spend.todayMicros)} testId="finance-today" />
        <Stat label={t('finance.week')} value={usd(o.spend.weekMicros)} testId="finance-week" />
        <Stat label={t('finance.month')} value={usd(o.spend.monthMicros)} testId="finance-month" />
        <Stat label={`${t('finance.periodTotal')} (${t('finance.lastDays', { n: o.days })})`} value={usd(o.spend.periodMicros)} testId="finance-period" hint={`${t('finance.estimated')}: ${usd(o.spend.periodEstimatedMicros)}`} />
        <Stat label={t('finance.voice')} value={t('finance.voiceValue', { minutes: num(o.voice.minutes), cost: usd(o.voice.costMicros) })} testId="finance-voice" />
        <Stat label={t('finance.documents')} value={t('finance.documentsValue', { n: num(o.documents.requests), cost: usd(o.documents.costMicros) })} testId="finance-documents" />
        <Stat label={t('finance.unsettled')} value={num(o.spend.unsettledRequests)} />
        <Stat label={t('finance.simulated')} value={num(o.spend.simulatedRequests)} testId="finance-simulated" />
      </div>

      <section className="card stack" data-testid="finance-budget">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <h2>{t('finance.budgetTitle')}</h2>
          <span className={`badge tone-${budgetTone(b.state)}`} data-testid="finance-budget-state" data-state={b.state}>{t(`finance.state_${b.state}`)}</span>
        </div>
        {b.monthLimitMicros === null ? (
          <p className="subtle" data-testid="finance-budget-unset">{t('finance.budgetUnset')}</p>
        ) : (
          <div
            role="progressbar"
            aria-label={t('finance.budgetTitle')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, Math.round(b.usedPct ?? 0))}
            aria-valuetext={t('finance.budgetUsed', { pct: String(b.usedPct ?? 0) })}
            style={{ height: 10, borderRadius: 6, background: 'var(--color-surface-muted)', overflow: 'hidden' }}
          >
            <div style={{ width: `${Math.min(100, b.usedPct ?? 0)}%`, height: '100%', background: b.state === 'EXCEEDED' ? 'var(--color-danger)' : 'var(--color-primary)' }} />
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
          <Stat label={t('finance.budgetLimit')} value={b.monthLimitMicros === null ? t('finance.none') : usd(b.monthLimitMicros)} />
          <Stat label={t('finance.budgetSpend')} value={usd(b.monthSpendMicros)} hint={b.usedPct === null ? undefined : t('finance.budgetUsed', { pct: String(b.usedPct) })} />
          <Stat label={t('finance.budgetProjected')} value={usd(b.projectedMonthMicros)} hint={t('finance.budgetDay', { d: b.daysElapsed, n: b.daysInMonth })} />
        </div>
        <h3>{t('finance.planBudgets')}</h3>
        <table className="table">
          <thead><tr><th scope="col">{t('finance.plan')}</th><th scope="col">{t('finance.userLimit')}</th><th scope="col">{t('finance.planLimit')}</th><th scope="col">{t('finance.planSpend')}</th></tr></thead>
          <tbody>
            {o.planBudgets.map((p) => (
              <tr key={p.plan}><td>{p.plan}</td><td className="mono">{p.userMonthlyLimitMicros === null ? t('finance.none') : usd(p.userMonthlyLimitMicros)}</td><td className="mono">{p.planMonthlyLimitMicros === null ? t('finance.none') : usd(p.planMonthlyLimitMicros)}</td><td className="mono">{usd(p.planMonthSpendMicros)}</td></tr>
            ))}
          </tbody>
        </table>
        <h3>{t('finance.alerts')}</h3>
        {o.alerts.length ? (
          <ul data-testid="finance-alerts">
            {o.alerts.map((a, i) => (
              <li key={i}>{t('finance.alertRow', { scope: a.scope, plan: a.plan ?? '', pct: a.thresholdPct, spend: usd(a.spendMicros), limit: usd(a.limitMicros) })}</li>
            ))}
          </ul>
        ) : (
          <p className="subtle">{t('finance.noAlerts')}</p>
        )}
      </section>

      <section className="card tight" data-testid="finance-by-model">
        <h2 style={{ padding: '12px 16px 0' }}>{t('finance.byModel')}</h2>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr><th scope="col">{t('finance.provider')}</th><th scope="col">{t('finance.model')}</th><th scope="col">{t('finance.requests')}</th><th scope="col">{t('finance.answered')}</th><th scope="col">{t('finance.failed')}</th><th scope="col">{t('finance.cost')}</th><th scope="col">{t('finance.estimatedCol')}</th><th scope="col">{t('finance.wasted')}</th><th scope="col">{t('finance.perAnswer')}</th><th scope="col">{t('finance.per1k')}</th></tr>
            </thead>
            <tbody>
              {o.byModel.map((m) => (
                <tr key={`${m.provider}/${m.modelId}`}>
                  <td>{m.provider}</td><td className="mono">{m.modelId}</td><td>{num(m.requests)}</td><td>{num(m.answered)}</td><td>{num(m.failed)}</td>
                  <td className="mono">{usd(m.costMicros)}</td><td className="mono">{usd(m.estimatedMicros)}</td><td className="mono">{usd(m.wastedMicros)}</td>
                  <td className="mono">{usd(m.costPerAnsweredMicros)}</td><td className="mono">{usd(m.costPer1kOutputTokensMicros)}</td>
                </tr>
              ))}
              {!o.byModel.length ? <tr><td colSpan={10} className="subtle">{t('finance.none')}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <section className="card tight" data-testid="finance-by-provider">
          <h2 style={{ padding: '12px 16px 0' }}>{t('finance.byProvider')}</h2>
          <table className="table">
            <thead><tr><th scope="col">{t('finance.provider')}</th><th scope="col">{t('finance.requests')}</th><th scope="col">{t('finance.cost')}</th><th scope="col">{t('finance.estimatedCol')}</th></tr></thead>
            <tbody>
              {o.byProvider.map((p) => <tr key={p.provider}><td>{p.provider}</td><td>{num(p.requests)}</td><td className="mono">{usd(p.costMicros)}</td><td className="mono">{usd(p.estimatedMicros)}</td></tr>)}
              {!o.byProvider.length ? <tr><td colSpan={4} className="subtle">{t('finance.none')}</td></tr> : null}
            </tbody>
          </table>
        </section>
        <section className="card tight" data-testid="finance-by-plan">
          <h2 style={{ padding: '12px 16px 0' }}>{t('finance.byPlan')}</h2>
          <table className="table">
            <thead><tr><th scope="col">{t('finance.plan')}</th><th scope="col">{t('finance.users')}</th><th scope="col">{t('finance.requests')}</th><th scope="col">{t('finance.cost')}</th></tr></thead>
            <tbody>
              {o.byPlan.map((p) => <tr key={p.plan}><td>{p.plan === 'NONE' ? t('finance.plan_NONE') : p.plan}</td><td>{num(p.users)}</td><td>{num(p.requests)}</td><td className="mono">{usd(p.costMicros)}</td></tr>)}
              {!o.byPlan.length ? <tr><td colSpan={4} className="subtle">{t('finance.none')}</td></tr> : null}
            </tbody>
          </table>
        </section>
      </div>

      <section className="card tight" data-testid="finance-by-feature">
        <h2 style={{ padding: '12px 16px 0' }}>{t('finance.byFeature')}</h2>
        <table className="table">
          <thead><tr><th scope="col">{t('finance.feature')}</th><th scope="col">{t('finance.requests')}</th><th scope="col">{t('finance.units')}</th><th scope="col">{t('finance.cost')}</th></tr></thead>
          <tbody>
            {o.byFeature.map((f) => (
              <tr key={f.feature}><td><strong className="mono">{f.feature}</strong><div className="subtle">{f.description}</div></td><td>{num(f.requests)}</td><td>{`${num(f.units)} ${f.metric}`}</td><td className="mono">{usd(f.costMicros)}</td></tr>
            ))}
            {!o.byFeature.length ? <tr><td colSpan={4} className="subtle">{t('finance.none')}</td></tr> : null}
          </tbody>
        </table>
      </section>

      <section className="card tight" data-testid="finance-top-users">
        <h2 style={{ padding: '12px 16px 0' }}>{t('finance.topUsers')}</h2>
        <p className="subtle" style={{ padding: '0 16px' }}>{t('finance.topUsersNote')}</p>
        <table className="table">
          <thead><tr><th scope="col">{t('finance.account')}</th><th scope="col">{t('finance.accountKind')}</th><th scope="col">{t('finance.plan')}</th><th scope="col">{t('finance.requests')}</th><th scope="col">{t('finance.cost')}</th><th scope="col">{t('finance.share')}</th></tr></thead>
          <tbody>
            {o.topUsers.map((u) => <tr key={u.userRef}><td className="mono">{u.userRef}</td><td>{u.accountKind}</td><td>{u.plan ?? t('finance.none')}</td><td>{num(u.requests)}</td><td className="mono">{usd(u.costMicros)}</td><td>{`${u.sharePct}%`}</td></tr>)}
            {!o.topUsers.length ? <tr><td colSpan={6} className="subtle">{t('finance.none')}</td></tr> : null}
          </tbody>
        </table>
      </section>

      <section className="card tight" data-testid="finance-daily">
        <h2 style={{ padding: '12px 16px 0' }}>{t('finance.daily')}</h2>
        <table className="table">
          <thead><tr><th scope="col">{t('finance.date')}</th><th scope="col">{t('finance.requests')}</th><th scope="col">{t('finance.cost')}</th></tr></thead>
          <tbody>
            {o.daily.map((d) => (
              <tr key={d.date}>
                <td className="mono">{d.date}</td><td>{num(d.requests)}</td>
                <td>
                  <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <span aria-hidden="true" style={{ display: 'inline-block', height: 8, borderRadius: 4, width: `${Math.max(2, Math.round((d.costMicros / maxDaily) * 120))}px`, background: 'var(--color-primary)' }} />
                    <span className="mono">{usd(d.costMicros)}</span>
                  </div>
                </td>
              </tr>
            ))}
            {!o.daily.length ? <tr><td colSpan={3} className="subtle">{t('finance.none')}</td></tr> : null}
          </tbody>
        </table>
      </section>

      <Reconciliation o={o} usd={usd} canManage={canManage} />
      <Revenue o={o} usd={usd} egp={egp} num={num} />
    </>
  );
}

function Reconciliation({ o, usd, canManage }: { o: AiFinanceOverview; usd: (m: number | null) => string; canManage: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [form, setForm] = useState({ provider: 'ANTHROPIC' as (typeof INVOICE_PROVIDERS)[number], month: '', amountUsd: '', reference: '', note: '' });
  const [saved, setSaved] = useState(false);
  const record = useMutation({
    mutationFn: () => api.finance.recordInvoice({ provider: form.provider, month: form.month, amountUsd: Number(form.amountUsd), reference: form.reference, ...(form.note ? { note: form.note } : {}) }),
    onSuccess: async () => {
      setSaved(true);
      setForm((f) => ({ ...f, amountUsd: '', reference: '', note: '' }));
      await qc.invalidateQueries({ queryKey: FINANCE_KEY });
    },
  });
  return (
    <section className="card stack" data-testid="finance-reconciliation">
      <h2>{t('finance.reconciliation')}</h2>
      <p className="subtle">{t('finance.reconciliationNote')}</p>
      <table className="table">
        <thead><tr><th scope="col">{t('finance.month_')}</th><th scope="col">{t('finance.provider')}</th><th scope="col">{t('finance.metered')}</th><th scope="col">{t('finance.invoiced')}</th><th scope="col">{t('finance.variance')}</th><th scope="col">{t('finance.reference')}</th></tr></thead>
        <tbody>
          {o.reconciliation.map((r) => (
            <tr key={`${r.month}/${r.provider}`} data-testid="finance-reconciliation-row">
              <td className="mono">{r.month.slice(0, 7)}</td><td>{r.provider}</td><td className="mono">{usd(r.meteredMicros)}</td>
              <td className="mono">{r.invoicedMicros === null ? t('finance.notInvoiced') : usd(r.invoicedMicros)}</td>
              <td className="mono">{r.varianceMicros === null ? t('finance.none') : usd(r.varianceMicros)}</td><td className="mono">{r.reference ?? t('finance.none')}</td>
            </tr>
          ))}
          {!o.reconciliation.length ? <tr><td colSpan={6} className="subtle">{t('finance.none')}</td></tr> : null}
        </tbody>
      </table>
      {canManage ? (
        <form
          className="stack"
          data-testid="finance-invoice-form"
          onSubmit={(e) => {
            e.preventDefault();
            setSaved(false);
            record.mutate();
          }}
        >
          <h3>{t('finance.recordInvoice')}</h3>
          <p className="subtle">{t('finance.invoiceHint')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            <div className="field">
              <label htmlFor="inv-provider">{t('finance.provider')}</label>
              <select id="inv-provider" className="input" value={form.provider} data-testid="finance-invoice-provider" onChange={(e) => setForm({ ...form, provider: e.target.value as (typeof INVOICE_PROVIDERS)[number] })}>
                {INVOICE_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="inv-month">{t('finance.monthField')}</label><input id="inv-month" className="input mono" required pattern="\d{4}-(0[1-9]|1[0-2])" placeholder="2026-10" value={form.month} data-testid="finance-invoice-month" onChange={(e) => setForm({ ...form, month: e.target.value })} /></div>
            <div className="field"><label htmlFor="inv-amount">{t('finance.amountUsd')}</label><input id="inv-amount" className="input mono" required type="number" min="0" step="0.0001" inputMode="decimal" value={form.amountUsd} data-testid="finance-invoice-amount" onChange={(e) => setForm({ ...form, amountUsd: e.target.value })} /></div>
            <div className="field"><label htmlFor="inv-ref">{t('finance.invoiceRef')}</label><input id="inv-ref" className="input mono" required minLength={3} maxLength={120} value={form.reference} data-testid="finance-invoice-reference" onChange={(e) => setForm({ ...form, reference: e.target.value })} /></div>
            <div className="field"><label htmlFor="inv-note">{t('finance.noteField')}</label><input id="inv-note" className="input" maxLength={500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
          </div>
          <ErrorNotice error={record.error} />
          {saved ? <div className="notice success" role="status" data-testid="finance-invoice-saved">{t('finance.saved')}</div> : null}
          <div><button className="btn btn-primary" type="submit" disabled={record.isPending} data-testid="finance-invoice-submit">{t('finance.save')}</button></div>
        </form>
      ) : null}
    </section>
  );
}

function Revenue({ o, usd, egp, num }: { o: AiFinanceOverview; usd: (m: number | null) => string; egp: (p: number) => string; num: (v: number) => string }) {
  const { t } = useI18n();
  const r = o.revenue;
  return (
    <>
      <section className="card stack" data-testid="finance-revenue">
        <h2>{t('finance.revenueTitle')}</h2>
        <p className="subtle">{t('finance.revenueNote')}</p>
        <Stat label={t('finance.revenueRecorded')} value={egp(r.recordedPiasters)} testId="finance-revenue-recorded" />
        <table className="table">
          <thead><tr><th scope="col">{t('finance.source')}</th><th scope="col">{t('finance.status')}</th><th scope="col">{t('finance.recorded')}</th></tr></thead>
          <tbody>
            {r.sources.map((s) => (
              <tr key={s.source} data-testid={`finance-source-${s.source}`}>
                <td>{t(`finance.source_${s.source}`)}</td>
                <td><span className={`badge tone-${s.state === 'CONFIGURED' ? 'success' : 'neutral'}`} data-state={s.state}>{t(`finance.state_${s.state}`)}</span></td>
                <td className="mono">{s.recordedPiasters === null ? t('finance.notRecorded') : egp(s.recordedPiasters)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>{t('finance.subscriptions')}</h3>
        {r.subscriptions.length ? (
          <table className="table">
            <thead><tr><th scope="col">{t('finance.plan')}</th><th scope="col">{t('finance.source')}</th><th scope="col">{t('finance.status')}</th><th scope="col">{t('finance.accounts')}</th></tr></thead>
            <tbody>{r.subscriptions.map((s, i) => <tr key={i}><td>{s.plan}</td><td>{s.source}</td><td>{s.status}</td><td>{num(s.accounts)}</td></tr>)}</tbody>
          </table>
        ) : (
          <p className="subtle">{t('finance.noSubscriptions')}</p>
        )}
        <h3>{t('finance.ledger')}</h3>
        {r.ledger.length ? (
          <table className="table">
            <thead><tr><th scope="col">{t('finance.source')}</th><th scope="col">{t('finance.status')}</th><th scope="col">{t('finance.requests')}</th><th scope="col">{t('finance.cost')}</th></tr></thead>
            <tbody>
              {r.ledger.map((l, i) => (
                <tr key={i}><td>{l.entryType}<div className="subtle">{l.isDemo ? t('finance.demoExcluded') : t('finance.real')}</div></td><td>{l.status}</td><td>{num(l.entries)}</td><td className="mono">{egp(l.amountPiasters)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="subtle">{t('finance.noLedger')}</p>
        )}
      </section>

      <section className="card stack" data-testid="finance-vs">
        <h2>{t('finance.vsTitle')}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          <Stat label={t('finance.revenueRecorded')} value={egp(r.recordedPiasters)} />
          <Stat label={t('finance.vsAiCost')} value={usd(o.spend.monthMicros)} />
          <Stat label={t('finance.vsNet')} value={t('finance.none')} hint={t('finance.vsNetUnavailable')} testId="finance-net" />
        </div>
        <h3>{t('finance.limits')}</h3>
        <ul data-testid="finance-limitations">
          {o.limitations.map((l) => <li key={l} data-code={l}>{t(`finance.limit_${l}`)}</li>)}
        </ul>
      </section>
    </>
  );
}
