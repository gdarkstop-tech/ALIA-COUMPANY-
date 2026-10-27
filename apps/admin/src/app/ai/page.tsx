'use client';
import { AI_EFFORTS, AI_METRICS, hasPermission, type AiControlCentre, type AiMetric, type AiModelAdmin, type AiRouteAdmin } from '@ghayarly/shared';
import { formatNumber } from '@ghayarly/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useI18n } from '@/components/Providers';
import { formatDateTime, Shell, useMe } from '@/components/Shell';
import { api } from '@/lib/api';

const KEY = ['ai-control-centre'];
/** Micro-dollars ↔ dollars (prices are per 1M tokens). */
const toUsd = (micros: number | null) => (micros === null ? '' : String(micros / 1_000_000));
const toMicros = (usd: string) => (usd.trim() === '' ? null : Math.round(Number(usd) * 1_000_000));

function useUsd() {
  const { locale } = useI18n();
  return (micros: number | null) => (micros === null ? '—' : new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(micros / 1_000_000));
}

function ErrorNotice({ error }: { error: unknown }) {
  return error ? <div className="notice danger" data-testid="ai-error">{error instanceof Error ? error.message : String(error)}</div> : null;
}

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
                </td>
                <td className="mono">{p.envVar ?? '—'}</td>
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

function Budget({ cc, canManage }: { cc: AiControlCentre; canManage: boolean }) {
  const { t } = useI18n();
  const usd = useUsd();
  const qc = useQueryClient();
  const [value, setValue] = useState(toUsd(cc.usage.monthLimitMicros));
  const save = useMutation({ mutationFn: (micros: number | null) => api.aiAdmin.setBudget(micros), onSuccess: (next) => qc.setQueryData(KEY, next) });
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
    </section>
  );
}

function ModelRow({ m, canManage }: { m: AiModelAdmin; canManage: boolean }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [prices, setPrices] = useState({ input: toUsd(m.inputPriceMicros), output: toUsd(m.outputPriceMicros), cache: toUsd(m.cacheReadPriceMicros), source: m.priceSource ?? '' });
  const patch = useMutation({ mutationFn: (body: Record<string, unknown>) => api.aiAdmin.updateModel(m.id, body), onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) });
  const dirty = prices.input !== toUsd(m.inputPriceMicros) || prices.output !== toUsd(m.outputPriceMicros) || prices.cache !== toUsd(m.cacheReadPriceMicros) || prices.source !== (m.priceSource ?? '');
  const priceInput = (k: 'input' | 'output' | 'cache', label: string) => (
    <input className="input" style={{ width: 90 }} aria-label={`${label} ${m.modelId}`} inputMode="decimal" disabled={!canManage || m.provider === 'SIMULATED'} value={prices[k]} onChange={(e) => setPrices((p) => ({ ...p, [k]: e.target.value }))} />
  );
  return (
    <tr data-testid={`ai-model-${m.modelId}`}>
      <td><div className="mono">{m.modelId}</div><div className="subtle">{m.provider} · {m.displayName}</div></td>
      <td>{priceInput('input', t('aiAdmin.inputPrice'))}</td>
      <td>{priceInput('output', t('aiAdmin.outputPrice'))}</td>
      <td>{priceInput('cache', t('aiAdmin.cachePrice'))}</td>
      <td>
        <input className="input" aria-label={`${t('aiAdmin.priceSource')} ${m.modelId}`} disabled={!canManage || m.provider === 'SIMULATED'} value={prices.source} onChange={(e) => setPrices((p) => ({ ...p, source: e.target.value }))} />
        <div className="subtle">{m.priceVerifiedAt ? t('aiAdmin.verified', { date: formatDateTime(m.priceVerifiedAt, locale) }) : t('aiAdmin.unverified')}</div>
      </td>
      <td><span className={`badge tone-${m.active ? 'success' : 'neutral'}`}>{m.active ? t('aiAdmin.active') : t('aiAdmin.inactive')}</span></td>
      <td>
        {canManage && m.provider !== 'SIMULATED' ? (
          <div className="row">
            {dirty ? (
              <button className="btn btn-sm btn-primary" disabled={patch.isPending} onClick={() => patch.mutate({ inputPriceMicros: toMicros(prices.input), outputPriceMicros: toMicros(prices.output), cacheReadPriceMicros: toMicros(prices.cache), priceSource: prices.source })}>{t('aiAdmin.save')}</button>
            ) : !m.priceVerifiedAt ? (
              <button className="btn btn-sm btn-secondary" disabled={patch.isPending} onClick={() => patch.mutate({ verifyPrice: true })} data-testid={`ai-verify-${m.modelId}`}>{t('aiAdmin.verifyPrice')}</button>
            ) : null}
            {!dirty ? (
              <button className={`btn btn-sm ${m.active ? 'btn-secondary' : 'btn-primary'}`} disabled={patch.isPending} onClick={() => patch.mutate({ active: !m.active })} data-testid={`ai-activate-${m.modelId}`}>{m.active ? t('aiAdmin.deactivate') : t('aiAdmin.activate')}</button>
            ) : null}
          </div>
        ) : null}
        <ErrorNotice error={patch.error} />
      </td>
    </tr>
  );
}

function AddModel() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [f, setF] = useState({ provider: 'ANTHROPIC', modelId: '', displayName: '', input: '', output: '', cache: '', source: '' });
  const create = useMutation({
    mutationFn: () => api.aiAdmin.createModel({ provider: f.provider, modelId: f.modelId, displayName: f.displayName, inputPriceMicros: toMicros(f.input), outputPriceMicros: toMicros(f.output), cacheReadPriceMicros: toMicros(f.cache), priceSource: f.source }),
    onSuccess: () => {
      setF({ provider: f.provider, modelId: '', displayName: '', input: '', output: '', cache: '', source: '' });
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
  const field = (k: keyof typeof f, label: string, width?: number) => (
    <div className="field"><label htmlFor={`ai-new-${k}`}>{label}</label><input id={`ai-new-${k}`} className="input" style={width ? { width } : undefined} value={f[k]} onChange={(e) => setF((v) => ({ ...v, [k]: e.target.value }))} /></div>
  );
  return (
    <div style={{ padding: 16 }} data-testid="ai-add-model">
      <h3>{t('aiAdmin.addModel')}</h3>
      <div className="row">
        <div className="field">
          <label htmlFor="ai-new-provider">{t('aiAdmin.provider')}</label>
          <select id="ai-new-provider" className="input" value={f.provider} onChange={(e) => setF((v) => ({ ...v, provider: e.target.value }))}>
            {['ANTHROPIC', 'OPENAI', 'GEMINI'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        {field('modelId', t('aiAdmin.modelId'))}
        {field('displayName', t('aiAdmin.displayName'))}
        {field('input', t('aiAdmin.inputPrice'), 90)}
        {field('output', t('aiAdmin.outputPrice'), 90)}
        {field('cache', t('aiAdmin.cachePrice'), 90)}
        {field('source', t('aiAdmin.priceSource'))}
        <button className="btn btn-primary btn-sm" disabled={create.isPending || !f.modelId || !f.displayName || f.source.length < 3} onClick={() => create.mutate()}>{t('aiAdmin.addModel')}</button>
      </div>
      <ErrorNotice error={create.error} />
    </div>
  );
}

function RouteCard({ r, models, canManage }: { r: AiRouteAdmin; models: AiModelAdmin[]; canManage: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [tiers, setTiers] = useState(r.tiers);
  const [maxTokens, setMaxTokens] = useState(String(r.maxOutputTokens));
  const save = useMutation({ mutationFn: (body: Record<string, unknown>) => api.aiAdmin.updateRoute(r.key, body), onSuccess: (next) => qc.setQueryData(KEY, next) });
  const label = (id: string | null) => models.find((m) => m.id === id);
  return (
    <section className="card" data-testid={`ai-route-${r.key}`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><h3 className="mono">{r.key}</h3><div className="subtle">{r.description}</div></div>
        <div className="row">
          <span className={`badge tone-${r.featureEnabled ? 'success' : 'neutral'}`}>{t('aiAdmin.feature')}: <span className="mono">{r.featureFlag}</span></span>
          <span className={`badge tone-${r.enabled ? 'success' : 'neutral'}`}>{t('aiAdmin.routeEnabled')}: {r.enabled ? t('aiAdmin.active') : t('aiAdmin.inactive')}</span>
          {canManage ? <button className="btn btn-sm btn-secondary" disabled={save.isPending} onClick={() => save.mutate({ enabled: !r.enabled })}>{r.enabled ? t('aiAdmin.deactivate') : t('aiAdmin.activate')}</button> : null}
        </div>
      </div>
      <table className="table" style={{ marginTop: 12 }}>
        <thead><tr><th>{t('aiAdmin.tier')}</th><th>{t('aiAdmin.model')}</th><th>{t('aiAdmin.fallback')}</th><th>{t('aiAdmin.effort')}</th></tr></thead>
        <tbody>
          {tiers.map((tier, i) => {
            const set = (patch: Partial<typeof tier>) => setTiers((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <tr key={tier.tier}>
                <td>{tier.tier}</td>
                <td>
                  <select className="input" aria-label={`${t('aiAdmin.model')} ${tier.tier}`} disabled={!canManage} value={tier.modelId} onChange={(e) => set({ modelId: e.target.value })}>
                    {models.map((m) => <option key={m.id} value={m.id}>{m.modelId}{m.active ? '' : ` (${t('aiAdmin.inactive')})`}</option>)}
                  </select>
                  {!label(tier.modelId)?.active ? <div className="subtle">{t('aiAdmin.inactive')}</div> : null}
                </td>
                <td>
                  <select className="input" aria-label={`${t('aiAdmin.fallback')} ${tier.tier}`} disabled={!canManage} value={tier.fallbackModelId ?? ''} onChange={(e) => set({ fallbackModelId: e.target.value || null })}>
                    <option value="">{t('aiAdmin.none')}</option>
                    {models.filter((m) => m.id !== tier.modelId).map((m) => <option key={m.id} value={m.id}>{m.modelId}</option>)}
                  </select>
                </td>
                <td>
                  <select className="input" aria-label={`${t('aiAdmin.effort')} ${tier.tier}`} disabled={!canManage} value={tier.effort} onChange={(e) => set({ effort: e.target.value as (typeof AI_EFFORTS)[number] })}>
                    {AI_EFFORTS.map((e) => <option key={e} value={e}>{e}</option>)}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {canManage ? (
        <div className="row" style={{ marginTop: 12 }}>
          <div className="field"><label htmlFor={`ai-max-${r.key}`}>{t('aiAdmin.maxTokens')}</label><input id={`ai-max-${r.key}`} className="input" style={{ width: 110 }} inputMode="numeric" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} /></div>
          <button className="btn btn-primary btn-sm" disabled={save.isPending} onClick={() => save.mutate({ tiers, maxOutputTokens: Number(maxTokens) })}>{t('aiAdmin.save')}</button>
        </div>
      ) : null}
      <ErrorNotice error={save.error} />
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
  const save = useMutation({ mutationFn: (body: { plan?: string; role?: string; metric: string; weeklyLimit: number }) => api.aiAdmin.updateQuota(body), onSuccess: (next) => qc.setQueryData(KEY, next) });
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

/** AI control centre. Configuration only: provider keys stay in the backend secret manager. */
export default function AiControlCentrePage() {
  const { t } = useI18n();
  const me = useMe();
  const cc = useQuery({ queryKey: KEY, queryFn: () => api.aiAdmin.controlCentre(30) });
  const canManage = hasPermission(me.data?.roles ?? [], 'ai.config.manage');
  return (
    <Shell title={t('aiAdmin.nav')}>
      <p className="muted">{t('aiAdmin.intro')}</p>
      <ErrorNotice error={cc.error} />
      {cc.data ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Providers cc={cc.data} canManage={canManage} />
          <Budget key={String(cc.data.usage.monthLimitMicros)} cc={cc.data} canManage={canManage} />
          <section className="card tight" data-testid="ai-models">
            <h2 style={{ padding: '12px 16px 0' }}>{t('aiAdmin.models')}</h2>
            <p className="muted" style={{ padding: '0 16px' }}>{t('aiAdmin.modelsBody')}</p>
            <table className="table">
              <thead><tr><th>{t('aiAdmin.model')}</th><th>{t('aiAdmin.inputPrice')}</th><th>{t('aiAdmin.outputPrice')}</th><th>{t('aiAdmin.cachePrice')}</th><th>{t('aiAdmin.priceSource')}</th><th>{t('aiAdmin.status')}</th><th /></tr></thead>
              <tbody>
                {cc.data.models.map((m) => <ModelRow key={`${m.id}:${m.priceVerifiedAt}:${m.active}:${m.inputPriceMicros}:${m.outputPriceMicros}`} m={m} canManage={canManage} />)}
              </tbody>
            </table>
            {canManage ? <AddModel /> : null}
          </section>
          <p className="muted">{t('aiAdmin.routesBody')}</p>
          {cc.data.routes.map((r) => <RouteCard key={`${r.key}:${JSON.stringify(r.tiers)}:${r.maxOutputTokens}`} r={r} models={cc.data.models} canManage={canManage} />)}
          <Quotas key={JSON.stringify(cc.data.quotas)} cc={cc.data} canManage={canManage} />
          <Usage cc={cc.data} />
        </div>
      ) : null}
    </Shell>
  );
}
