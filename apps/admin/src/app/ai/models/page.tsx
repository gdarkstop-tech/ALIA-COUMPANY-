'use client';
import { AI_CAPABILITIES, AI_REAL_PROVIDERS, type AiModelAdmin } from '@ghayarly/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AI_KEY, AiTabs, ErrorNotice, toMicros, toUsd, useCan } from '@/components/ai';
import { useI18n } from '@/components/Providers';
import { formatDateTime, Shell } from '@/components/Shell';
import { api } from '@/lib/api';

function ModelRow({ m, canManage, canApproveData }: { m: AiModelAdmin; canManage: boolean; canApproveData: boolean }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [prices, setPrices] = useState({ input: toUsd(m.inputPriceMicros), output: toUsd(m.outputPriceMicros), cache: toUsd(m.cacheReadPriceMicros), source: m.priceSource ?? '' });
  const [dpa, setDpa] = useState('');
  const patch = useMutation({ mutationFn: (body: Record<string, unknown>) => api.aiAdmin.updateModel(m.id, body), onSuccess: () => qc.invalidateQueries({ queryKey: AI_KEY }) });
  const dirty = prices.input !== toUsd(m.inputPriceMicros) || prices.output !== toUsd(m.outputPriceMicros) || prices.cache !== toUsd(m.cacheReadPriceMicros) || prices.source !== (m.priceSource ?? '');
  const editable = canManage && m.provider !== 'SIMULATED';
  const priceInput = (k: 'input' | 'output' | 'cache', label: string) => (
    <input className="input" style={{ width: 90 }} aria-label={`${label} ${m.modelId}`} inputMode="decimal" disabled={!editable} value={prices[k]} onChange={(e) => setPrices((p) => ({ ...p, [k]: e.target.value }))} />
  );
  return (
    <tr data-testid={`ai-model-${m.modelId}`}>
      <td>
        <div className="mono">{m.modelId}</div>
        <div className="subtle">{m.provider} · {m.displayName} · {m.hosting}{m.dataRegion ? ` · ${m.dataRegion}` : ''}</div>
        <div className="row" style={{ gap: 4, marginTop: 4 }}>
          {m.capabilities.map((c) => <span key={c} className="badge tone-neutral">{c}</span>)}
          {m.medicalSpecialized ? <span className="badge tone-info" title={t('aiAdmin.medicalNote')}>{t('aiAdmin.medicalSpecialized')}</span> : null}
        </div>
        {m.notes ? <div className="subtle" style={{ maxWidth: 360 }}>{t('aiAdmin.notes')}: {m.notes}</div> : null}
      </td>
      <td>{priceInput('input', t('aiAdmin.inputPrice'))}</td>
      <td>{priceInput('output', t('aiAdmin.outputPrice'))}</td>
      <td>{priceInput('cache', t('aiAdmin.cachePrice'))}</td>
      <td>
        <input className="input" aria-label={`${t('aiAdmin.priceSource')} ${m.modelId}`} disabled={!editable} value={prices.source} onChange={(e) => setPrices((p) => ({ ...p, source: e.target.value }))} />
        <div className="subtle">{m.priceVerifiedAt ? t('aiAdmin.verified', { date: formatDateTime(m.priceVerifiedAt, locale) }) : t('aiAdmin.unverified')}</div>
      </td>
      <td data-testid={`ai-model-data-${m.modelId}`}>
        {m.provider === 'SIMULATED' ? <span className="subtle">—</span> : m.patientDataApprovedAt ? (
          <>
            <span className="badge tone-success">{t('aiAdmin.dataApproved', { date: formatDateTime(m.patientDataApprovedAt, locale), ref: m.patientDataApprovalRef ?? '' })}</span>
            {canApproveData ? <div><button className="btn btn-sm btn-secondary" disabled={patch.isPending} onClick={() => patch.mutate({ patientDataApprovalRef: null })}>{t('aiAdmin.withdrawData')}</button></div> : null}
          </>
        ) : (
          <>
            <span className="badge tone-warning">{t('aiAdmin.dataNotApproved')}</span>
            {canApproveData ? (
              <div className="row" style={{ marginTop: 4 }}>
                <input className="input" style={{ width: 150 }} aria-label={`${t('aiAdmin.dataApprovalRef')} ${m.modelId}`} placeholder={t('aiAdmin.dataApprovalRef')} value={dpa} onChange={(e) => setDpa(e.target.value)} />
                <button className="btn btn-sm btn-secondary" disabled={patch.isPending || dpa.trim().length < 3} onClick={() => patch.mutate({ patientDataApprovalRef: dpa.trim() })}>{t('aiAdmin.approveData')}</button>
              </div>
            ) : null}
          </>
        )}
        <div className="subtle">{m.clinicalApprovals.length ? m.clinicalApprovals.map((a) => t('aiAdmin.approvedFor', { route: a.routeKey })).join(' · ') : t('aiAdmin.noClinicalApproval')}</div>
      </td>
      <td><span className={`badge tone-${m.active ? 'success' : 'neutral'}`}>{m.active ? t('aiAdmin.active') : t('aiAdmin.inactive')}</span></td>
      <td>
        {editable ? (
          <div className="row">
            {dirty ? (
              <button className="btn btn-sm btn-primary" disabled={patch.isPending} onClick={() => patch.mutate({ inputPriceMicros: toMicros(prices.input), outputPriceMicros: toMicros(prices.output), cacheReadPriceMicros: toMicros(prices.cache), priceSource: prices.source })}>{t('aiAdmin.save')}</button>
            ) : !m.priceVerifiedAt ? (
              <button className="btn btn-sm btn-secondary" disabled={patch.isPending || m.inputPriceMicros === null || m.outputPriceMicros === null} onClick={() => patch.mutate({ verifyPrice: true })} data-testid={`ai-verify-${m.modelId}`}>{t('aiAdmin.verifyPrice')}</button>
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
  const empty = { provider: 'ANTHROPIC', modelId: '', displayName: '', input: '', output: '', cache: '', source: '', hosting: 'PROVIDER_API', dataRegion: '', notes: '', medical: false, capabilities: ['CHAT'] as string[] };
  const [f, setF] = useState(empty);
  const create = useMutation({
    mutationFn: () =>
      api.aiAdmin.createModel({
        provider: f.provider,
        modelId: f.modelId,
        displayName: f.displayName,
        inputPriceMicros: toMicros(f.input),
        outputPriceMicros: toMicros(f.output),
        cacheReadPriceMicros: toMicros(f.cache),
        priceSource: f.source,
        capabilities: f.capabilities,
        medicalSpecialized: f.medical,
        hosting: f.hosting,
        dataRegion: f.dataRegion.trim() || null,
        notes: f.notes.trim() || null,
      }),
    onSuccess: () => {
      setF({ ...empty, provider: f.provider });
      void qc.invalidateQueries({ queryKey: AI_KEY });
    },
  });
  const field = (k: 'modelId' | 'displayName' | 'input' | 'output' | 'cache' | 'source' | 'dataRegion' | 'notes', label: string, width?: number) => (
    <div className="field"><label htmlFor={`ai-new-${k}`}>{label}</label><input id={`ai-new-${k}`} className="input" style={width ? { width } : undefined} value={f[k]} onChange={(e) => setF((v) => ({ ...v, [k]: e.target.value }))} /></div>
  );
  return (
    <div style={{ padding: 16 }} data-testid="ai-add-model">
      <h3>{t('aiAdmin.addModel')}</h3>
      <div className="row">
        <div className="field">
          <label htmlFor="ai-new-provider">{t('aiAdmin.provider')}</label>
          <select id="ai-new-provider" className="input" value={f.provider} onChange={(e) => setF((v) => ({ ...v, provider: e.target.value }))}>
            {AI_REAL_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        {field('modelId', t('aiAdmin.modelId'))}
        {field('displayName', t('aiAdmin.displayName'))}
        {field('input', t('aiAdmin.inputPrice'), 90)}
        {field('output', t('aiAdmin.outputPrice'), 90)}
        {field('cache', t('aiAdmin.cachePrice'), 90)}
        {field('source', t('aiAdmin.priceSource'))}
        <div className="field">
          <label htmlFor="ai-new-hosting">{t('aiAdmin.hosting')}</label>
          <select id="ai-new-hosting" className="input" value={f.hosting} onChange={(e) => setF((v) => ({ ...v, hosting: e.target.value }))}>
            {['PROVIDER_API', 'MANAGED_ENDPOINT', 'SELF_HOSTED'].map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </div>
        {field('dataRegion', t('aiAdmin.dataRegion'), 120)}
      </div>
      <fieldset className="row" style={{ border: 0, padding: 0, marginTop: 8 }}>
        <legend className="subtle">{t('aiAdmin.capabilities')}</legend>
        {AI_CAPABILITIES.map((c) => (
          <label key={c} className="row" style={{ gap: 4 }}>
            <input type="checkbox" checked={f.capabilities.includes(c)} onChange={(e) => setF((v) => ({ ...v, capabilities: e.target.checked ? [...v.capabilities, c] : v.capabilities.filter((x) => x !== c) }))} /> {c}
          </label>
        ))}
        <label className="row" style={{ gap: 4 }}>
          <input type="checkbox" checked={f.medical} onChange={(e) => setF((v) => ({ ...v, medical: e.target.checked }))} /> {t('aiAdmin.medicalSpecialized')}
        </label>
      </fieldset>
      <div className="row" style={{ marginTop: 8 }}>
        {field('notes', t('aiAdmin.notes'))}
        <button className="btn btn-primary btn-sm" disabled={create.isPending || !f.modelId || !f.displayName || f.source.length < 3 || !f.capabilities.length} onClick={() => create.mutate()}>{t('aiAdmin.addModel')}</button>
      </div>
      <ErrorNotice error={create.error} />
    </div>
  );
}

/** Model registry: prices (verified before activation), capabilities, data-processing approval. */
export default function AiModelsPage() {
  const { t } = useI18n();
  const can = useCan();
  const cc = useQuery({ queryKey: AI_KEY, queryFn: () => api.aiAdmin.controlCentre(30) });
  const canManage = can('ai.config.manage');
  return (
    <Shell title={t('aiAdmin.nav')}>
      <AiTabs />
      <ErrorNotice error={cc.error} />
      {cc.data ? (
        <section className="card tight" data-testid="ai-models">
          <h2 style={{ padding: '12px 16px 0' }}>{t('aiAdmin.models')}</h2>
          <p className="muted" style={{ padding: '0 16px' }}>{t('aiAdmin.modelsBody')}</p>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>{t('aiAdmin.model')}</th><th>{t('aiAdmin.inputPrice')}</th><th>{t('aiAdmin.outputPrice')}</th><th>{t('aiAdmin.cachePrice')}</th><th>{t('aiAdmin.priceSource')}</th><th>{t('aiAdmin.dataApproval')}</th><th>{t('aiAdmin.status')}</th><th /></tr></thead>
              <tbody>
                {cc.data.models.map((m) => (
                  <ModelRow key={`${m.id}:${m.priceVerifiedAt}:${m.active}:${m.inputPriceMicros}:${m.outputPriceMicros}:${m.patientDataApprovedAt}`} m={m} canManage={canManage} canApproveData={can('ai.data.approve')} />
                ))}
              </tbody>
            </table>
          </div>
          {canManage ? <AddModel /> : null}
        </section>
      ) : null}
    </Shell>
  );
}
