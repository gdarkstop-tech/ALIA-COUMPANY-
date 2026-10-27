'use client';
import { AI_REPORT_RESOLUTIONS, type AiReportListItem } from '@ghayarly/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AiTabs, ErrorNotice } from '@/components/ai';
import { useI18n } from '@/components/Providers';
import { formatDateTime, Shell } from '@/components/Shell';
import { api } from '@/lib/api';

const KEY = ['ai-reports'];

function ReportDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  // Opening the detail is what reads the content (audited server-side).
  const d = useQuery({ queryKey: [...KEY, id], queryFn: () => api.aiAdmin.report(id) });
  const [resolution, setResolution] = useState<string>('NO_ISSUE');
  const [note, setNote] = useState('');
  const move = useMutation({
    mutationFn: (status: string) => api.aiAdmin.transitionReport(id, { status, ...(status === 'RESOLVED' || status === 'DISMISSED' ? { resolution } : {}), ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: () => {
      setNote('');
      void qc.invalidateQueries({ queryKey: KEY });
      onChanged();
    },
  });
  if (!d.data) return <ErrorNotice error={d.error} />;
  const r = d.data;
  const closed = r.status === 'RESOLVED' || r.status === 'DISMISSED';
  return (
    <section className="card" data-testid="ai-report-detail" style={{ display: 'grid', gap: 12 }}>
      <div className="row">
        <span className="badge tone-warning">{t(`assistant.reason_${r.reason}`)}</span>
        <span className="badge tone-neutral">{t(`aiAdmin.reportStatus_${r.status}`)}</span>
        {r.resolution ? <span className="badge tone-info">{t(`aiAdmin.resolution_${r.resolution}`)}</span> : null}
        <span className="subtle mono">{r.provider} · {r.modelId} · {r.messageKind} · {r.locale}</span>
      </div>
      {r.redacted ? <div className="notice info">{t('aiAdmin.redactedReport')}</div> : (
        <>
          <div><strong>{t('aiAdmin.reportedAnswer')}</strong><pre dir="auto" style={{ whiteSpace: 'pre-wrap', background: 'var(--color-surface-muted)', padding: 12, borderRadius: 12 }} data-testid="ai-report-answer">{r.answer}</pre></div>
          <div><strong>{t('aiAdmin.reportedQuestion')}</strong>{r.question ? <pre dir="auto" style={{ whiteSpace: 'pre-wrap', background: 'var(--color-surface-muted)', padding: 12, borderRadius: 12 }}>{r.question}</pre> : <p className="subtle">{t('aiAdmin.questionNotShared')}</p>}</div>
          {r.note ? <div><strong>{t('aiAdmin.reporterNote')}</strong><p dir="auto">{r.note}</p></div> : null}
        </>
      )}
      <div className="row">
        {!closed ? (
          <div className="field">
            <label htmlFor="report-resolution">{t('aiAdmin.resolutionLabel')}</label>
            <select id="report-resolution" className="input" value={resolution} onChange={(e) => setResolution(e.target.value)}>
              {AI_REPORT_RESOLUTIONS.map((x) => <option key={x} value={x}>{t(`aiAdmin.resolution_${x}`)}</option>)}
            </select>
          </div>
        ) : null}
        <div className="field" style={{ flex: 1 }}><label htmlFor="report-note">{t('aiAdmin.reviewNote')}</label><input id="report-note" className="input" dir="auto" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
      <div className="row">
        {r.status === 'OPEN' ? <button className="btn btn-sm btn-secondary" disabled={move.isPending} onClick={() => move.mutate('IN_REVIEW')} data-testid="ai-report-start">{t('aiAdmin.startReview')}</button> : null}
        {!closed ? (
          <>
            <button className="btn btn-sm btn-primary" disabled={move.isPending || note.trim().length < 3} onClick={() => move.mutate('RESOLVED')} data-testid="ai-report-resolve">{t('aiAdmin.resolve')}</button>
            <button className="btn btn-sm btn-secondary" disabled={move.isPending || note.trim().length < 3} onClick={() => move.mutate('DISMISSED')}>{t('aiAdmin.dismiss')}</button>
          </>
        ) : null}
        <button className="btn btn-sm btn-secondary" disabled={move.isPending || note.trim().length < 3} onClick={() => move.mutate('NOTE')}>{t('aiAdmin.addNote')}</button>
      </div>
      <ErrorNotice error={move.error} />
      <div>
        <strong>{t('aiAdmin.history')}</strong>
        <ul>
          {r.events.map((e, i) => <li key={i}><span className="mono">{e.event}</span> · {formatDateTime(e.createdAt, locale)}{e.note ? ` — ${e.note}` : ''}</li>)}
        </ul>
      </div>
    </section>
  );
}

/** Queue of AI answers reported from the app (ai.safety.review). */
export default function AiSafetyPage() {
  const { t, locale } = useI18n();
  const [filter, setFilter] = useState<'ACTIVE' | 'ALL'>('ACTIVE');
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({ queryKey: [...KEY, filter], queryFn: () => api.aiAdmin.reports(filter) });
  return (
    <Shell title={t('aiAdmin.nav')}>
      <AiTabs />
      <p className="muted">{t('aiAdmin.safetyIntro')}</p>
      <div className="tabs" role="tablist" style={{ marginBottom: 16 }}>
        {(['ACTIVE', 'ALL'] as const).map((f) => <button key={f} role="tab" aria-selected={filter === f} className={`tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{t(`aiAdmin.reportFilter_${f}`)}</button>)}
      </div>
      <ErrorNotice error={list.error} />
      <div className="grid grid-2">
        <section className="card tight" data-testid="ai-reports">
          <table className="table">
            <thead><tr><th>{t('aiAdmin.reportReason')}</th><th>{t('aiAdmin.model')}</th><th>{t('aiAdmin.status')}</th><th /></tr></thead>
            <tbody>
              {(list.data ?? []).map((r: AiReportListItem) => (
                <tr key={r.id} data-testid={`ai-report-${r.reason}`}>
                  <td>{t(`assistant.reason_${r.reason}`)}<div className="subtle">{formatDateTime(r.createdAt, locale)}</div></td>
                  <td className="mono">{r.modelId ?? '—'}</td>
                  <td>{t(`aiAdmin.reportStatus_${r.status}`)}</td>
                  <td><button className="btn btn-sm btn-secondary" onClick={() => setOpen(r.id)}>{t('aiAdmin.open')}</button></td>
                </tr>
              ))}
              {list.data && !list.data.length ? <tr><td colSpan={4} className="subtle">{t('aiAdmin.noReports')}</td></tr> : null}
            </tbody>
          </table>
        </section>
        {open ? <ReportDetail key={open} id={open} onChanged={() => void list.refetch()} /> : <div />}
      </div>
    </Shell>
  );
}
