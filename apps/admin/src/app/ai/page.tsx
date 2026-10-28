'use client';
import { AI_METRICS, type AiControlCentre, type AiMetric } from '@ghayarly/shared';
import { formatNumber } from '@ghayarly/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AI_KEY, AiTabs, ErrorNotice, toMicros, toUsd, useCan, useUsd } from '@/components/ai';
import { useI18n } from '@/components/Providers';
import { formatDateTime, Shell, useMe } from '@/components/Shell';
import { api } from '@/lib/api';

function Providers({ cc, canManage }: { cc: AiControlCentre; canManage: boolean }) {
  const { t } = useI18n();
  const [result, setResult] = useState<Record<string, string>>({});
  const check = useMutation({
    mutationFn: (v: { code: string; modelId: string }) => api.aiAdmin.healthCheck(v.code, v.modelId),
    onSuccess: (r) => setResult((m) => ({ ...m, [r.provider]: r.ok ? t('aiAdmin.healthOk') : t('aiAdmin.healthFailed', { detail: r.detail }) })),
  });
  return (
    <section className="card tight" data-testid="ai-providers">
      <h2 style={{ padding: '12px 16px 0' }}>{t('aiAdmin.providers')}</h2>
      <table className="table">
        <thead><tr><th>{t('aiAdmin.provider')}</th><th>{t('aiAdmin.status')}</th><th>{t('aiAdmin.envVar')}</th><th /></tr></thead>
        <tbody>
          {cc.providers.map((p) => {
            const model = cc.models.find((m) => m.provider === p.code);
            return (
              <tr key={p.code} data-testid={`ai-provider-${p.code}`}>
                <td className="mono">{p.code}</td>
                <td>
                  <span className={`badge tone-${p.configured ? 'success' : 'warning'}`}>{p.configured ? t('aiAdmin.configured') : t('aiAdmin.notConfigured')}</span>
                  {!p.productionAllowed ? <div className="subtle">{t('aiAdmin.devOnly')}</div> : null}
                  <div className="subtle" data-testid={`ai-provider-realtime-${p.code}`}>
                    {t('aiAdmin.realtime')}: {p.realtimeAdapter ? (p.realtimeConfigured ? t('aiAdmin.configured') : t('aiAdmin.notConfigured')) : t('aiAdmin.realtimeNoAdapter')}
                  </div>
                </td>
                <td className="mono">{p.envVars.length ? p.envVars.join(' + ') : '—'}</td>
                <td>
                  {canManage && p.configured && model ? (
                    <button className="btn btn-sm btn-secondary" disabled={check.isPending} onClick={() => check.mutate({ code: p.code, modelId: model.modelId })}>{t('aiAdmin.healthCheck')}</button>
                  ) : null}
                  {result[p.code] ? <div className="subtle" data-testid={`ai-health-${p.code}`}>{result[p.code]}</div> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="notice info" style={{ margin: 16 }} data-testid="ai-setup-instructions">
        <div><strong>{t('aiAdmin.setupTitle')}</strong><div>{t('aiAdmin.setupBody')}</div><div className="subtle">{t('aiAdmin.healthNote')}</div></div>
      </div>
      <ErrorNotice error={check.error} />
    </section>
  );
}

function Budgets({ cc, canManage }: { cc: AiControlCentre; canManage: boolean }) {
  const { t, locale } = useI18n();
  const usd = useUsd();
  const qc = useQueryClient();
  const [value, setValue] = useState(toUsd(cc.usage.monthLimitMicros));
  const save = useMutation({ mutationFn: (micros: number | null) => api.aiAdmin.setBudget(micros), onSuccess: (next) => qc.setQueryData(AI_KEY, next) });
  const savePlan = useMutation({ mutationFn: (b: { plan: string; userMonthlyLimitMicros: number | null; planMonthlyLimitMicros: number | null }) => api.aiAdmin.setPlanBudget(b), onSuccess: (next) => qc.setQueryData(AI_KEY, next) });
  const [plans, setPlans] = useState(Object.fromEntries(cc.planBudgets.map((p) => [p.plan, { user: toUsd(p.userMonthlyLimitMicros), plan: toUsd(p.planMonthlyLimitMicros) }])));
  return (
    <section className="card" data-testid="ai-budget">
      <h2>{t('aiAdmin.budget')}</h2>
      <p className="muted">{t('aiAdmin.budgetBody')}</p>
      <div className="row">
        <div className="stat"><span className="subtle">{t('aiAdmin.monthSpend')}</span><strong data-testid="ai-month-spend">{usd(cc.usage.monthSpendMicros)}</strong></div>
        <div className="stat"><span className="subtle">{t('aiAdmin.budget')}</span><strong data-testid="ai-month-limit">{cc.usage.monthLimitMicros === null ? t('aiAdmin.budgetUnset') : usd(cc.usage.monthLimitMicros)}</strong></div>
      </div>
      {canManage ? (
        <div className="row" style={{ marginTop: 12 }}>
          <div className="field"><label htmlFor="ai-budget-usd">{t('aiAdmin.budgetUsd')}</label><input id="ai-budget-usd" className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></div>
          <button className="btn btn-primary btn-sm" disabled={save.isPending || !(Number(value) >= 0) || value.trim() === ''} onClick={() => save.mutate(toMicros(value))}>{t('aiAdmin.save')}</button>
          {cc.usage.monthLimitMicros !== null ? <button className="btn btn-secondary btn-sm" disabled={save.isPending} onClick={() => { setValue(''); save.mutate(null); }}>{t('aiAdmin.clearBudget')}</button> : null}
        </div>
      ) : null}
      <ErrorNotice error={save.error} />

      <h3 style={{ marginTop: 20 }}>{t('aiAdmin.planBudgets')}</h3>
      <table className="table" data-testid="ai-plan-budgets">
        <thead><tr><th>{t('aiAdmin.plan')}</th><th>{t('aiAdmin.userCap')}</th><th>{t('aiAdmin.planCap')}</th><th>{t('aiAdmin.planSpend')}</th><th /></tr></thead>
        <tbody>
          {cc.planBudgets.map((p) => (
            <tr key={p.plan}>
              <td>{p.plan}</td>
              <td><input className="input" style={{ width: 110 }} aria-label={`${p.plan} ${t('aiAdmin.userCap')}`} placeholder={t('aiAdmin.noCap')} disabled={!canManage} value={plans[p.plan]?.user ?? ''} onChange={(e) => setPlans((v) => ({ ...v, [p.plan]: { ...v[p.plan]!, user: e.target.value } }))} /></td>
              <td><input className="input" style={{ width: 110 }} aria-label={`${p.plan} ${t('aiAdmin.planCap')}`} placeholder={t('aiAdmin.noCap')} disabled={!canManage} value={plans[p.plan]?.plan ?? ''} onChange={(e) => setPlans((v) => ({ ...v, [p.plan]: { ...v[p.plan]!, plan: e.target.value } }))} /></td>
              <td>{usd(p.planMonthSpendMicros)}</td>
              <td>{canManage ? <button className="btn btn-sm btn-secondary" disabled={savePlan.isPending} onClick={() => savePlan.mutate({ plan: p.plan, userMonthlyLimitMicros: toMicros(plans[p.plan]?.user ?? ''), planMonthlyLimitMicros: toMicros(plans[p.plan]?.plan ?? '') })}>{t('aiAdmin.save')}</button> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ErrorNotice error={savePlan.error} />

      <h3 style={{ marginTop: 20 }}>{t('aiAdmin.alerts')}</h3>
      {cc.alerts.length ? (
        <ul data-testid="ai-alerts">
          {cc.alerts.map((a) => (
            <li key={`${a.scope}${a.plan}${a.month}${a.thresholdPct}`}>
              {t('aiAdmin.alertLine', { scope: a.scope, plan: a.plan ?? '', pct: a.thresholdPct, spend: usd(a.spendMicros), limit: usd(a.limitMicros) })} <span className="subtle">{formatDateTime(a.createdAt, locale)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="subtle">{t('aiAdmin.noAlerts')}</p>}
    </section>
  );
}

function QuotaInput({ value, label, onSave, disabled }: { value: number; label: string; onSave: (n: number) => void; disabled: boolean }) {
  const [v, setV] = useState(String(value));
  return (
    <input
      className="input"
      style={{ width: 90 }}
      aria-label={label}
      inputMode="numeric"
      disabled={disabled}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const n = Number(v);
        if (Number.isInteger(n) && n >= 0 && n !== value) onSave(n);
        else setV(String(value));
      }}
    />
  );
}

function Quotas({ cc, canManage }: { cc: AiControlCentre; canManage: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const save = useMutation({ mutationFn: (body: { plan?: string; role?: string; metric: string; weeklyLimit: number }) => api.aiAdmin.updateQuota(body), onSuccess: (next) => qc.setQueryData(AI_KEY, next) });
  const metricLabel = (m: AiMetric) => t(`aiAdmin.metric_${m}`);
  return (
    <section className="card tight" data-testid="ai-quotas">
      <h2 style={{ padding: '12px 16px 0' }}>{t('aiAdmin.quotas')}</h2>
      <p className="muted" style={{ padding: '0 16px' }}>{t('aiAdmin.quotasBody')}</p>
      <table className="table">
        <thead><tr><th>{t('aiAdmin.plan')}</th><th>{t('aiAdmin.tier')}</th>{AI_METRICS.map((m) => <th key={m}>{metricLabel(m)}</th>)}</tr></thead>
        <tbody>
          {cc.quotas.plans.map((p) => (
            <tr key={p.plan} data-testid={`ai-quota-${p.plan}`}>
              <td>{p.plan}</td>
              <td>{p.tier}</td>
              {AI_METRICS.map((m) => (
                <td key={m}><QuotaInput value={p.limits[m] ?? 0} label={`${p.plan} ${metricLabel(m)}`} disabled={!canManage || save.isPending} onSave={(n) => save.mutate({ plan: p.plan, metric: m, weeklyLimit: n })} /></td>
              ))}
            </tr>
          ))}
          {cc.quotas.clinicians.map((c) => (
            <tr key={c.role}>
              <td>{t('aiAdmin.clinicians')}: {c.role}</td>
              <td>—</td>
              {AI_METRICS.map((m) => (
                <td key={m}>{c.limits[m] === undefined ? '—' : <QuotaInput value={c.limits[m]!} label={`${c.role} ${metricLabel(m)}`} disabled={!canManage || save.isPending} onSave={(n) => save.mutate({ role: c.role, metric: m, weeklyLimit: n })} />}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ErrorNotice error={save.error} />
    </section>
  );
}

function Usage({ cc }: { cc: AiControlCentre }) {
  const { t, locale } = useI18n();
  const usd = useUsd();
  const n = (v: number) => formatNumber(v, locale);
  return (
    <section className="card tight" data-testid="ai-usage">
      <h2 style={{ padding: '12px 16px 0' }}>{t('aiAdmin.usage', { days: cc.usage.days })}</h2>
      <div className="row" style={{ padding: '0 16px' }}><span className="subtle">{t('aiAdmin.activeUsers')}:</span> <strong>{n(cc.usage.activeUsers)}</strong></div>
      <table className="table">
        <thead><tr><th>{t('aiAdmin.model')}</th><th>{t('aiAdmin.requests')}</th><th>{t('aiAdmin.tokensIn')}</th><th>{t('aiAdmin.tokensOut')}</th><th>{t('aiAdmin.cost')}</th></tr></thead>
        <tbody>
          {cc.usage.byModel.map((u) => (
            <tr key={`${u.provider}:${u.modelId}`}>
              <td><span className="mono">{u.modelId}</span> <span className="subtle">{u.provider}</span></td>
              <td>{n(u.requests)}</td><td>{n(u.inputTokens)}</td><td>{n(u.outputTokens)}</td>
              <td>{usd(u.costMicros)}{u.estimated ? <span className="subtle"> ({t('aiAdmin.estimated')})</span> : null}</td>
            </tr>
          ))}
          {!cc.usage.byModel.length ? <tr><td colSpan={5} className="subtle">—</td></tr> : null}
        </tbody>
      </table>
      <div className="row" style={{ padding: 16 }}>
        <span className="subtle">{t('aiAdmin.outcomes')}:</span>
        {cc.usage.byOutcome.map((o) => <span key={o.outcome} className="badge tone-neutral">{o.outcome}: {n(o.requests)}</span>)}
      </div>
    </section>
  );
}

/** AI control centre — overview. Configuration only: provider keys stay in the backend secret manager. */
export default function AiOverviewPage() {
  const { t } = useI18n();
  const can = useCan();
  const me = useMe();
  const router = useRouter();
  // Clinical reviewers see the evaluation suite, not the configuration.
  const canRead = can('ai.config.manage') || can('ai.usage.read');
  useEffect(() => {
    if (me.data && !canRead) router.replace(can('ai.eval.manage') || can('ai.clinical.review') ? '/ai/evaluation' : '/ai/safety');
  }, [me.data, canRead, router, can]);
  const cc = useQuery({ queryKey: AI_KEY, queryFn: () => api.aiAdmin.controlCentre(30), enabled: canRead });
  const canManage = can('ai.config.manage');
  return (
    <Shell title={t('aiAdmin.nav')}>
      <AiTabs />
      <p className="muted">{t('aiAdmin.intro')}</p>
      <ErrorNotice error={cc.error} />
      {cc.data ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Providers cc={cc.data} canManage={canManage} />
          <Budgets key={JSON.stringify([cc.data.usage.monthLimitMicros, cc.data.planBudgets])} cc={cc.data} canManage={canManage} />
          <Quotas key={JSON.stringify(cc.data.quotas)} cc={cc.data} canManage={canManage} />
          <Usage cc={cc.data} />
        </div>
      ) : null}
    </Shell>
  );
}
