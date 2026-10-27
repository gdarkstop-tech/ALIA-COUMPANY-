'use client';
import type { AiEvalResult } from '@ghayarly/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AiTabs, ErrorNotice, EVAL_KEY, useCan, useUsd } from '@/components/ai';
import { useI18n } from '@/components/Providers';
import { Shell } from '@/components/Shell';
import { api } from '@/lib/api';

function ResultCard({ r, runId, canReview }: { r: AiEvalResult; runId: string; canReview: boolean }) {
  const { t } = useI18n();
  const usd = useUsd();
  const qc = useQueryClient();
  const [f, setF] = useState({ accuracy: String(r.review?.accuracy ?? ''), hallucination: r.review?.hallucination ?? false, unsafe: r.review?.unsafe ?? false, arabicQuality: String(r.review?.arabicQuality ?? ''), notes: r.review?.notes ?? '' });
  const save = useMutation({
    mutationFn: () => api.aiAdmin.reviewResult(r.id, { accuracy: Number(f.accuracy), hallucination: f.hallucination, unsafe: f.unsafe, arabicQuality: r.language === 'ar' ? Number(f.arabicQuality) : null, notes: f.notes }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [...EVAL_KEY, runId] }),
  });
  const valid = Number(f.accuracy) >= 1 && Number(f.accuracy) <= 5 && (r.language !== 'ar' || (Number(f.arabicQuality) >= 1 && Number(f.arabicQuality) <= 5));
  return (
    <section className="card" data-testid={`ai-result-${r.caseCode}`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><strong className="mono">{r.caseCode}</strong> <span className="subtle">v{r.caseVersion} · {r.category} · {r.language}</span></div>
        <div className="row">
          <span className={`badge tone-${r.automatedPass ? 'success' : 'danger'}`}>{r.automatedPass ? t('aiAdmin.screensPassed') : t('aiAdmin.screensFailed')}</span>
          {r.review ? <span className={`badge tone-${r.review.unsafe ? 'danger' : 'success'}`}>{t('aiAdmin.reviewedBadge')}</span> : null}
          {r.latencyMs !== null ? <span className="subtle">{t('aiAdmin.latency', { ms: r.latencyMs })} · {usd(r.costMicros)}</span> : null}
        </div>
      </div>
      {r.prompt ? <p dir="auto"><strong>{t('aiAdmin.prompt')}:</strong> {r.prompt}</p> : <p className="subtle">{t('aiAdmin.caseChanged')}</p>}
      {r.expectedBehavior ? <p dir="auto" className="subtle"><strong>{t('aiAdmin.expected')}:</strong> {r.expectedBehavior}</p> : null}
      <pre dir="auto" style={{ whiteSpace: 'pre-wrap', background: 'var(--color-surface-muted)', padding: 12, borderRadius: 12 }} data-testid={`ai-result-output-${r.caseCode}`}>{r.output || `(${r.outcome})`}</pre>
      {r.automatedChecks ? (
        <ul className="subtle">
          {r.automatedChecks.map((c, i) => <li key={i}>{c.passed ? '✓' : '✗'} {c.name}{c.detail ? ` — ${c.detail}` : ''}</li>)}
        </ul>
      ) : null}
      {canReview && r.status !== 'PENDING' ? (
        <div className="row" style={{ marginTop: 8 }}>
          <div className="field"><label htmlFor={`acc-${r.id}`}>{t('aiAdmin.accuracy')}</label><input id={`acc-${r.id}`} className="input" style={{ width: 70 }} inputMode="numeric" value={f.accuracy} onChange={(e) => setF((v) => ({ ...v, accuracy: e.target.value }))} /></div>
          {r.language === 'ar' ? <div className="field"><label htmlFor={`arq-${r.id}`}>{t('aiAdmin.arabicQuality')}</label><input id={`arq-${r.id}`} className="input" style={{ width: 70 }} inputMode="numeric" value={f.arabicQuality} onChange={(e) => setF((v) => ({ ...v, arabicQuality: e.target.value }))} /></div> : null}
          <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={f.hallucination} onChange={(e) => setF((v) => ({ ...v, hallucination: e.target.checked }))} /> {t('aiAdmin.hallucination')}</label>
          <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={f.unsafe} onChange={(e) => setF((v) => ({ ...v, unsafe: e.target.checked }))} /> {t('aiAdmin.unsafe')}</label>
          <div className="field" style={{ flex: 1 }}><label htmlFor={`notes-${r.id}`}>{t('aiAdmin.reviewNotes')}</label><input id={`notes-${r.id}`} className="input" dir="auto" value={f.notes} onChange={(e) => setF((v) => ({ ...v, notes: e.target.value }))} /></div>
          <button className="btn btn-sm btn-primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>{t('aiAdmin.saveReview')}</button>
        </div>
      ) : null}
      <ErrorNotice error={save.error} />
    </section>
  );
}

/** One evaluation run: every answer, its screens and the clinical review; approval for the route. */
export default function AiEvaluationRunPage() {
  const { t } = useI18n();
  const can = useCan();
  const usd = useUsd();
  const qc = useQueryClient();
  const { runId } = useParams<{ runId: string }>();
  const run = useQuery({ queryKey: [...EVAL_KEY, runId], queryFn: () => api.aiAdmin.run(runId), refetchInterval: (q) => (q.state.data?.status === 'RUNNING' ? 2000 : false) });
  const [note, setNote] = useState('');
  const approve = useMutation({
    mutationFn: () => api.aiAdmin.approveModel({ routeKey: run.data!.routeKey, modelId: run.data!.modelRef, runId, note }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: EVAL_KEY }),
  });
  const r = run.data;
  return (
    <Shell title={t('aiAdmin.nav')}>
      <AiTabs />
      <ErrorNotice error={run.error} />
      {r ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="card" data-testid="ai-run-summary">
            <h2><span className="mono">{r.modelId}</span> <span className="subtle">{r.provider}</span></h2>
            <div className="row">
              <span className={`badge tone-${r.status === 'COMPLETED' ? 'success' : r.status === 'FAILED' ? 'danger' : 'info'}`}>{t(`aiAdmin.runStatus_${r.status}`)}</span>
              <span>{t('aiAdmin.progress', { done: r.completedCount, total: r.caseCount, pass: r.automatedPassCount })}</span>
              <span>{t('aiAdmin.runCost', { cost: usd(r.costMicros) })}</span>
              <span className="subtle mono">{t('aiAdmin.policyVersion', { version: r.policyVersion })}</span>
            </div>
            <p className="subtle">{t('aiAdmin.summaryLine', { reviewed: r.summary.reviewed, cases: r.summary.cases, acc: r.summary.meanAccuracy ?? '—', hal: r.summary.hallucinations, unsafe: r.summary.unsafe })}</p>
            {can('ai.clinical.review') && r.status === 'COMPLETED' ? (
              <div className="row">
                <input className="input" style={{ flex: 1 }} aria-label={t('aiAdmin.approvalNote')} placeholder={t('aiAdmin.approvalNote')} value={note} onChange={(e) => setNote(e.target.value)} />
                <button className="btn btn-primary btn-sm" disabled={approve.isPending || note.trim().length < 3} onClick={() => approve.mutate()} data-testid="ai-run-approve">{t('aiAdmin.approveForRoute', { route: r.routeKey })}</button>
              </div>
            ) : null}
            {approve.isSuccess ? <div className="notice success">{t('aiAdmin.saved')}</div> : null}
            <ErrorNotice error={approve.error} />
          </section>
          {r.results.map((x) => <ResultCard key={`${x.id}:${x.review?.reviewedAt ?? ''}`} r={x} runId={runId} canReview={can('ai.clinical.review')} />)}
        </div>
      ) : null}
    </Shell>
  );
}
