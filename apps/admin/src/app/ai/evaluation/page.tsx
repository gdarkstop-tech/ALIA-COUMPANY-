'use client';
import { AI_EVAL_CATEGORIES, type AiEvalCase } from '@ghayarly/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { AI_KEY, AiTabs, ErrorNotice, EVAL_KEY, useCan, useUsd } from '@/components/ai';
import { useI18n } from '@/components/Providers';
import { formatDateTime, Shell } from '@/components/Shell';
import { api } from '@/lib/api';

const emptyCase = { code: '', category: 'WOUND_CARE', language: 'en', prompt: '', context: '', expectedBehavior: '', checks: '{\n  "mustIncludeAll": ["doctor|clinician"]\n}' };

function CaseEditor({ initial, onDone }: { initial?: AiEvalCase; onDone: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [f, setF] = useState(initial ? { code: initial.code, category: initial.category, language: initial.language, prompt: initial.prompt, context: initial.context ?? '', expectedBehavior: initial.expectedBehavior, checks: JSON.stringify(initial.checks, null, 2) } : emptyCase);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = { code: f.code, category: f.category, language: f.language, prompt: f.prompt, context: f.context.trim() || null, expectedBehavior: f.expectedBehavior, checks: JSON.parse(f.checks) };
      return initial ? api.aiAdmin.updateCase(initial.id, body) : api.aiAdmin.createCase(body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: EVAL_KEY });
      onDone();
    },
  });
  const submit = () => {
    try {
      JSON.parse(f.checks);
      setJsonError(null);
      save.mutate();
    } catch {
      setJsonError('JSON');
    }
  };
  return (
    <div className="card" data-testid="ai-case-editor" style={{ display: 'grid', gap: 8 }}>
      <div className="row">
        <div className="field"><label htmlFor="case-code">{t('aiAdmin.code')}</label><input id="case-code" className="input mono" value={f.code} onChange={(e) => setF((v) => ({ ...v, code: e.target.value.toUpperCase() }))} /></div>
        <div className="field"><label htmlFor="case-category">{t('aiAdmin.category')}</label><select id="case-category" className="input" value={f.category} onChange={(e) => setF((v) => ({ ...v, category: e.target.value as typeof v.category }))}>{AI_EVAL_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div className="field"><label htmlFor="case-language">{t('aiAdmin.language')}</label><select id="case-language" className="input" value={f.language} onChange={(e) => setF((v) => ({ ...v, language: e.target.value as 'ar' | 'en' }))}><option value="en">en</option><option value="ar">ar</option></select></div>
      </div>
      <div className="field"><label htmlFor="case-prompt">{t('aiAdmin.prompt')}</label><textarea id="case-prompt" className="input" rows={2} dir="auto" value={f.prompt} onChange={(e) => setF((v) => ({ ...v, prompt: e.target.value }))} /></div>
      <div className="field"><label htmlFor="case-context">{t('aiAdmin.context')}</label><textarea id="case-context" className="input" rows={2} dir="auto" value={f.context} onChange={(e) => setF((v) => ({ ...v, context: e.target.value }))} /></div>
      <div className="field"><label htmlFor="case-expected">{t('aiAdmin.expected')}</label><textarea id="case-expected" className="input" rows={2} dir="auto" value={f.expectedBehavior} onChange={(e) => setF((v) => ({ ...v, expectedBehavior: e.target.value }))} /></div>
      <div className="field"><label htmlFor="case-checks">{t('aiAdmin.checks')}</label><textarea id="case-checks" className="input mono" rows={4} dir="ltr" value={f.checks} onChange={(e) => setF((v) => ({ ...v, checks: e.target.value }))} /></div>
      {jsonError ? <div className="notice danger">{t('errors.validation')}</div> : null}
      <div className="row">
        <button className="btn btn-primary btn-sm" disabled={save.isPending} onClick={submit} data-testid="ai-case-save">{t('aiAdmin.save')}</button>
        <button className="btn btn-secondary btn-sm" onClick={onDone}>{t('common.cancel')}</button>
      </div>
      <ErrorNotice error={save.error} />
    </div>
  );
}

/** Medical AI evaluation suite: cases, runs and clinical approvals. */
export default function AiEvaluationPage() {
  const { t, locale } = useI18n();
  const can = useCan();
  const usd = useUsd();
  const qc = useQueryClient();
  const ov = useQuery({ queryKey: EVAL_KEY, queryFn: () => api.aiAdmin.evaluation(), refetchInterval: (q) => (q.state.data?.runs.some((r) => r.status === 'RUNNING') ? 2000 : false) });
  const cc = useQuery({ queryKey: AI_KEY, queryFn: () => api.aiAdmin.controlCentre(30), enabled: can('ai.eval.manage') });
  const [editing, setEditing] = useState<AiEvalCase | 'new' | null>(null);
  const [runModel, setRunModel] = useState('');
  const [revokeNote, setRevokeNote] = useState<Record<string, string>>({});
  const review = useMutation({ mutationFn: (v: { id: string; decision: 'REVIEWED' | 'RETIRED' }) => api.aiAdmin.reviewCase(v.id, v.decision), onSuccess: () => qc.invalidateQueries({ queryKey: EVAL_KEY }) });
  const start = useMutation({ mutationFn: () => api.aiAdmin.startRun(runModel), onSuccess: () => qc.invalidateQueries({ queryKey: EVAL_KEY }) });
  const revoke = useMutation({ mutationFn: (v: { id: string; note: string }) => api.aiAdmin.revokeApproval(v.id, v.note), onSuccess: () => qc.invalidateQueries({ queryKey: EVAL_KEY }) });
  const d = ov.data;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return (
    <Shell title={t('aiAdmin.nav')}>
      <AiTabs />
      <p className="muted">{t('aiAdmin.evalIntro')}</p>
      <ErrorNotice error={ov.error} />
      {d ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="notice info" data-testid="ai-eval-thresholds">
            {t('aiAdmin.thresholds', { cases: d.thresholds.minCases, pass: pct(d.thresholds.minAutomatedPassRate), acc: d.thresholds.minMeanAccuracy, hal: pct(d.thresholds.maxHallucinationRate) })}
            <span className="subtle mono" style={{ marginInlineStart: 8 }}>{t('aiAdmin.policyVersion', { version: d.currentPolicyVersion })}</span>
          </div>

          <section className="card tight" data-testid="ai-eval-runs">
            <h2 style={{ padding: '12px 16px 0' }}>{t('aiAdmin.runs')}</h2>
            {can('ai.eval.manage') && cc.data ? (
              <div className="row" style={{ padding: '0 16px' }}>
                <select className="input" aria-label={t('aiAdmin.runModel')} value={runModel} onChange={(e) => setRunModel(e.target.value)} data-testid="ai-run-model">
                  <option value="">{t('aiAdmin.runModel')}</option>
                  {cc.data.models.filter((m) => cc.data.providers.find((p) => p.code === m.provider)?.configured).map((m) => <option key={m.id} value={m.id}>{m.provider} · {m.modelId}</option>)}
                </select>
                <button className="btn btn-primary btn-sm" disabled={!runModel || start.isPending} onClick={() => start.mutate()} data-testid="ai-run-start">{t('aiAdmin.startRun')}</button>
              </div>
            ) : null}
            <ErrorNotice error={start.error} />
            <table className="table">
              <thead><tr><th>{t('aiAdmin.model')}</th><th>{t('aiAdmin.status')}</th><th>{t('aiAdmin.results')}</th><th>{t('aiAdmin.cost')}</th><th /></tr></thead>
              <tbody>
                {d.runs.map((r) => (
                  <tr key={r.id} data-testid={`ai-run-${r.modelId}`}>
                    <td><span className="mono">{r.modelId}</span> <span className="subtle">{r.provider} · {formatDateTime(r.startedAt, locale)}</span></td>
                    <td><span className={`badge tone-${r.status === 'COMPLETED' ? 'success' : r.status === 'FAILED' ? 'danger' : 'info'}`}>{t(`aiAdmin.runStatus_${r.status}`)}</span>{r.failure ? <div className="subtle">{r.failure}</div> : null}</td>
                    <td>
                      {t('aiAdmin.progress', { done: r.completedCount, total: r.caseCount, pass: r.automatedPassCount })}
                      <div className="subtle">{t('aiAdmin.summaryLine', { reviewed: r.summary.reviewed, cases: r.summary.cases, acc: r.summary.meanAccuracy ?? '—', hal: r.summary.hallucinations, unsafe: r.summary.unsafe })}</div>
                    </td>
                    <td>{usd(r.costMicros)}{r.costEstimated ? <span className="subtle"> ({t('aiAdmin.estimated')})</span> : null}</td>
                    <td><Link className="btn btn-sm btn-secondary" href={`/ai/evaluation/${r.id}`}>{t('aiAdmin.openRun')}</Link></td>
                  </tr>
                ))}
                {!d.runs.length ? <tr><td colSpan={5} className="subtle">—</td></tr> : null}
              </tbody>
            </table>
          </section>

          <section className="card tight" data-testid="ai-eval-approvals">
            <h2 style={{ padding: '12px 16px 0' }}>{t('aiAdmin.approvals')}</h2>
            <table className="table">
              <tbody>
                {d.approvals.map((a) => (
                  <tr key={a.id}>
                    <td><span className="mono">{a.modelId}</span> <span className="subtle">{a.provider}</span></td>
                    <td>{t('aiAdmin.approvedFor', { route: a.routeKey })}<div className="subtle">{formatDateTime(a.approvedAt, locale)} · {a.note}</div>{a.policyVersion !== d.currentPolicyVersion ? <div className="subtle">{t('aiAdmin.policyMismatch', { run: a.policyVersion, current: d.currentPolicyVersion })}</div> : null}</td>
                    <td>
                      {a.revokedAt ? <span className="subtle">{t('aiAdmin.revoked', { date: formatDateTime(a.revokedAt, locale), note: a.revokeNote ?? '' })}</span> : can('ai.clinical.review') || can('ai.config.manage') ? (
                        <div className="row">
                          <input className="input" aria-label={t('aiAdmin.revokeNote')} placeholder={t('aiAdmin.revokeNote')} value={revokeNote[a.id] ?? ''} onChange={(e) => setRevokeNote((m) => ({ ...m, [a.id]: e.target.value }))} />
                          <button className="btn btn-sm btn-secondary" disabled={revoke.isPending || (revokeNote[a.id] ?? '').trim().length < 3} onClick={() => revoke.mutate({ id: a.id, note: revokeNote[a.id]! })}>{t('aiAdmin.revoke')}</button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {!d.approvals.length ? <tr><td className="subtle">—</td></tr> : null}
              </tbody>
            </table>
            <ErrorNotice error={revoke.error} />
          </section>

          <section className="card tight" data-testid="ai-eval-cases">
            <div className="row" style={{ padding: '12px 16px 0', justifyContent: 'space-between' }}>
              <h2>{t('aiAdmin.cases')}</h2>
              {can('ai.eval.manage') ? <button className="btn btn-sm btn-primary" onClick={() => setEditing('new')} data-testid="ai-case-new">{t('aiAdmin.newCase')}</button> : null}
            </div>
            {editing ? <div style={{ padding: 16 }}><CaseEditor key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} /></div> : null}
            <ErrorNotice error={review.error} />
            <table className="table">
              <thead><tr><th>{t('aiAdmin.code')}</th><th>{t('aiAdmin.prompt')}</th><th>{t('aiAdmin.status')}</th><th /></tr></thead>
              <tbody>
                {d.cases.map((c) => (
                  <tr key={c.id} data-testid={`ai-case-${c.code}`}>
                    <td><div className="mono">{c.code}</div><div className="subtle">{c.category} · {c.language} · v{c.version}</div></td>
                    <td dir="auto" style={{ maxWidth: 460 }}><div>{c.prompt}</div><div className="subtle">{t('aiAdmin.expected')}: {c.expectedBehavior}</div></td>
                    <td><span className={`badge tone-${c.status === 'REVIEWED' ? 'success' : c.status === 'RETIRED' ? 'neutral' : 'warning'}`}>{t(`aiAdmin.caseStatus_${c.status}`)}</span>{c.authoredByMe ? <div className="subtle">{t('aiAdmin.authoredByYou')}</div> : null}</td>
                    <td>
                      <div className="row">
                        {can('ai.clinical.review') && c.status === 'DRAFT' && !c.authoredByMe ? <button className="btn btn-sm btn-secondary" disabled={review.isPending} onClick={() => review.mutate({ id: c.id, decision: 'REVIEWED' })} data-testid={`ai-case-review-${c.code}`}>{t('aiAdmin.markReviewed')}</button> : null}
                        {can('ai.eval.manage') && c.status !== 'RETIRED' ? <button className="btn btn-sm btn-secondary" onClick={() => setEditing(c)}>{t('aiAdmin.edit')}</button> : null}
                        {(can('ai.eval.manage') || can('ai.clinical.review')) && c.status !== 'RETIRED' ? <button className="btn btn-sm btn-secondary" disabled={review.isPending} onClick={() => review.mutate({ id: c.id, decision: 'RETIRED' })}>{t('aiAdmin.retire')}</button> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      ) : null}
    </Shell>
  );
}
