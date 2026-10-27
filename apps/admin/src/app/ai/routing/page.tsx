'use client';
import { AI_CANDIDATE_LANGUAGES, AI_COMPLEXITIES, AI_EFFORTS, AI_MODEL_TIERS, type AiControlCentre, type AiModelAdmin, type AiRouteAdmin } from '@ghayarly/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AI_KEY, AiTabs, ErrorNotice, useCan } from '@/components/ai';
import { useI18n } from '@/components/Providers';
import { Shell } from '@/components/Shell';
import { api } from '@/lib/api';

function RouteCard({ r, models, canManage }: { r: AiRouteAdmin; models: AiModelAdmin[]; canManage: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const set = (next: AiControlCentre) => qc.setQueryData(AI_KEY, next);
  const [settings, setSettings] = useState({ maxTokens: String(r.maxOutputTokens), simpleMaxChars: String(r.simpleMaxChars), maxConcurrent: String(r.maxConcurrentPerUser), complexityRouting: r.complexityRouting });
  const [add, setAdd] = useState({ tier: 'BASIC', modelId: models.find((m) => m.provider !== 'SIMULATED')?.id ?? '', complexity: 'ANY', language: 'ANY', priority: '100', effort: 'medium' });
  const save = useMutation({ mutationFn: (body: Record<string, unknown>) => api.aiAdmin.updateRoute(r.key, body), onSuccess: set });
  const addCandidate = useMutation({ mutationFn: () => api.aiAdmin.addCandidate(r.key, { ...add, priority: Number(add.priority) }), onSuccess: set });
  const updateCandidate = useMutation({ mutationFn: (v: { id: string; body: Record<string, unknown> }) => api.aiAdmin.updateCandidate(v.id, v.body), onSuccess: set });
  const removeCandidate = useMutation({ mutationFn: (id: string) => api.aiAdmin.removeCandidate(id), onSuccess: set });
  const model = (id: string) => models.find((m) => m.id === id);
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
      <div className="row" style={{ marginTop: 8 }}>
        {r.carriesPatientData ? <span className="badge tone-warning">{t('aiAdmin.carriesPatientData')}</span> : null}
        {r.requireClinicalApproval ? <span className="badge tone-warning">{t('aiAdmin.requiresClinicalApproval')}</span> : null}
        <span className="badge tone-neutral">{r.requiredCapability}</span>
      </div>
      <p className="subtle">{t('aiAdmin.internalOnly')}</p>

      <h4>{t('aiAdmin.routeSettings')}</h4>
      <div className="row">
        <div className="field"><label htmlFor={`ai-max-${r.key}`}>{t('aiAdmin.maxTokens')}</label><input id={`ai-max-${r.key}`} className="input" style={{ width: 110 }} inputMode="numeric" disabled={!canManage} value={settings.maxTokens} onChange={(e) => setSettings((s) => ({ ...s, maxTokens: e.target.value }))} /></div>
        <div className="field"><label htmlFor={`ai-conc-${r.key}`}>{t('aiAdmin.maxConcurrent')}</label><input id={`ai-conc-${r.key}`} className="input" style={{ width: 80 }} inputMode="numeric" disabled={!canManage} value={settings.maxConcurrent} onChange={(e) => setSettings((s) => ({ ...s, maxConcurrent: e.target.value }))} /></div>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" disabled={!canManage} checked={settings.complexityRouting} onChange={(e) => setSettings((s) => ({ ...s, complexityRouting: e.target.checked }))} /> {t('aiAdmin.complexityRouting')}</label>
        <div className="field"><label htmlFor={`ai-simple-${r.key}`}>{t('aiAdmin.simpleMaxChars')}</label><input id={`ai-simple-${r.key}`} className="input" style={{ width: 90 }} inputMode="numeric" disabled={!canManage || !settings.complexityRouting} value={settings.simpleMaxChars} onChange={(e) => setSettings((s) => ({ ...s, simpleMaxChars: e.target.value }))} /></div>
        {canManage ? (
          <button className="btn btn-primary btn-sm" disabled={save.isPending} onClick={() => save.mutate({ maxOutputTokens: Number(settings.maxTokens), maxConcurrentPerUser: Number(settings.maxConcurrent), complexityRouting: settings.complexityRouting, simpleMaxChars: Number(settings.simpleMaxChars) })}>{t('aiAdmin.save')}</button>
        ) : null}
      </div>
      <ErrorNotice error={save.error} />

      <h4 style={{ marginTop: 16 }}>{t('aiAdmin.candidates')}</h4>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" data-testid={`ai-candidates-${r.key}`}>
          <thead><tr><th>{t('aiAdmin.tier')}</th><th>{t('aiAdmin.priority')}</th><th>{t('aiAdmin.model')}</th><th>{t('aiAdmin.complexity')}</th><th>{t('aiAdmin.language')}</th><th>{t('aiAdmin.effort')}</th><th>{t('aiAdmin.status')}</th><th /></tr></thead>
          <tbody>
            {r.candidates.map((c) => {
              const m = model(c.modelId);
              return (
                <tr key={c.id} data-testid={`ai-candidate-${c.tier}-${m?.modelId ?? c.modelId}`}>
                  <td>{c.tier}</td>
                  <td>{c.priority}</td>
                  <td><span className="mono">{m?.modelId}</span> <span className="subtle">{m?.provider}</span></td>
                  <td>{c.complexity}</td>
                  <td>{c.language}</td>
                  <td>{c.effort}</td>
                  <td>
                    {c.blockers.length ? c.blockers.map((b) => <span key={b} className="badge tone-warning" style={{ marginInlineEnd: 4 }}>{t(`aiAdmin.blocker_${b}`)}</span>) : <span className="badge tone-success">{t('aiAdmin.eligible')}</span>}
                  </td>
                  <td>
                    {canManage ? (
                      <div className="row">
                        <button className="btn btn-sm btn-secondary" disabled={updateCandidate.isPending} onClick={() => updateCandidate.mutate({ id: c.id, body: { enabled: !c.enabled } })}>{c.enabled ? t('aiAdmin.deactivate') : t('aiAdmin.activate')}</button>
                        <button className="btn btn-sm btn-secondary" disabled={removeCandidate.isPending} onClick={() => removeCandidate.mutate(c.id)}>{t('aiAdmin.remove')}</button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {!r.candidates.length ? <tr><td colSpan={8} className="subtle">—</td></tr> : null}
          </tbody>
        </table>
      </div>
      {canManage ? (
        <div className="row" style={{ marginTop: 8 }} data-testid={`ai-add-candidate-${r.key}`}>
          <select className="input" aria-label={t('aiAdmin.tier')} value={add.tier} onChange={(e) => setAdd((a) => ({ ...a, tier: e.target.value }))}>{AI_MODEL_TIERS.map((x) => <option key={x}>{x}</option>)}</select>
          <select className="input" aria-label={t('aiAdmin.model')} value={add.modelId} onChange={(e) => setAdd((a) => ({ ...a, modelId: e.target.value }))}>
            {models.map((m) => <option key={m.id} value={m.id}>{m.provider} · {m.modelId}{m.active ? '' : ` (${t('aiAdmin.inactive')})`}</option>)}
          </select>
          <select className="input" aria-label={t('aiAdmin.complexity')} value={add.complexity} onChange={(e) => setAdd((a) => ({ ...a, complexity: e.target.value }))}>{AI_COMPLEXITIES.map((x) => <option key={x}>{x}</option>)}</select>
          <select className="input" aria-label={t('aiAdmin.language')} value={add.language} onChange={(e) => setAdd((a) => ({ ...a, language: e.target.value }))}>{AI_CANDIDATE_LANGUAGES.map((x) => <option key={x}>{x}</option>)}</select>
          <select className="input" aria-label={t('aiAdmin.effort')} value={add.effort} onChange={(e) => setAdd((a) => ({ ...a, effort: e.target.value }))}>{AI_EFFORTS.map((x) => <option key={x}>{x}</option>)}</select>
          <input className="input" style={{ width: 80 }} aria-label={t('aiAdmin.priority')} inputMode="numeric" value={add.priority} onChange={(e) => setAdd((a) => ({ ...a, priority: e.target.value }))} />
          <button className="btn btn-primary btn-sm" disabled={addCandidate.isPending || !add.modelId} onClick={() => addCandidate.mutate()}>{t('aiAdmin.addCandidate')}</button>
        </div>
      ) : null}
      <ErrorNotice error={addCandidate.error ?? updateCandidate.error ?? removeCandidate.error} />
    </section>
  );
}

/** Routing: which models may serve each route and plan tier, in order, with the reasons a candidate is skipped. */
export default function AiRoutingPage() {
  const { t } = useI18n();
  const can = useCan();
  const cc = useQuery({ queryKey: AI_KEY, queryFn: () => api.aiAdmin.controlCentre(30) });
  return (
    <Shell title={t('aiAdmin.nav')}>
      <AiTabs />
      <p className="muted">{t('aiAdmin.routesBody')}</p>
      <ErrorNotice error={cc.error} />
      {cc.data?.routes.map((r) => <RouteCard key={`${r.key}:${r.maxOutputTokens}:${r.complexityRouting}:${r.simpleMaxChars}:${r.maxConcurrentPerUser}`} r={r} models={cc.data.models} canManage={can('ai.config.manage')} />)}
    </Shell>
  );
}
