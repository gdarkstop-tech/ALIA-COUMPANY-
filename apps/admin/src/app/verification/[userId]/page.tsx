'use client';
import { listSeparator } from '@ghayarly/i18n';
import { canTransition, decisionRequiresReason, decisionTarget, hasPermission, type VerificationDecision, type VerificationStatus } from '@ghayarly/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useI18n, useToast } from '@/components/Providers';
import { formatDateTime, Shell, StatusBadge, useMe } from '@/components/Shell';
import { api, ApiError } from '@/lib/api';

const DECISIONS: { decision: VerificationDecision; key: 'admin.startReview' | 'admin.approve' | 'admin.requestChanges' | 'admin.reject' | 'admin.suspend' | 'admin.reinstate'; cls: string }[] = [
  { decision: 'START_REVIEW', key: 'admin.startReview', cls: 'btn-secondary' },
  { decision: 'APPROVE', key: 'admin.approve', cls: 'btn-primary' },
  { decision: 'REQUEST_CHANGES', key: 'admin.requestChanges', cls: 'btn-soft' },
  { decision: 'REJECT', key: 'admin.reject', cls: 'btn-danger' },
  { decision: 'SUSPEND', key: 'admin.suspend', cls: 'btn-danger' },
  { decision: 'REINSTATE', key: 'admin.reinstate', cls: 'btn-secondary' },
];

const KNOWN_ERRORS = ['REQUIRED_CREDENTIALS_NOT_APPROVED', 'INVALID_VERIFICATION_TRANSITION', 'REASON_REQUIRED', 'SELF_REVIEW_FORBIDDEN'] as const;

/** Human-readable message for reviewers, keeping the stable error code for support/audit. */
function errorText(e: unknown, t: (k: never) => string) {
  if (e instanceof ApiError) {
    const known = (KNOWN_ERRORS as readonly string[]).includes(e.code) ? t(`admin.err_${e.code}` as never) : e.message;
    return `${known} (${e.code})`;
  }
  return t('errors.generic' as never);
}

export default function SubmissionReview() {
  const { userId } = useParams<{ userId: string }>();
  const id = decodeURIComponent(userId);
  const { t, locale } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const me = useMe();
  const sub = useQuery({ queryKey: ['submission', id], queryFn: () => api.admin.provider(id) });
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['submission', id] });
    await qc.invalidateQueries({ queryKey: ['queue'] });
    await qc.invalidateQueries({ queryKey: ['overview'] });
  };
  const decide = useMutation({
    mutationFn: (decision: VerificationDecision) => api.admin.decide(id, { decision, reason: reason.trim() || null }),
    onSuccess: async () => {
      setReason('');
      setError(null);
      toast(t('admin.decisionSaved'));
      await refresh();
    },
    onError: (e) => setError(errorText(e, t as never)),
  });
  const decideCredential = useMutation({
    mutationFn: ({ credId, status }: { credId: string; status: 'APPROVED' | 'REJECTED' }) => api.admin.decideCredential(credId, { status, note: notes[credId]?.trim() || null }),
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError: (e) => setError(errorText(e, t as never)),
  });

  const roles = me.data?.roles ?? [];
  const canDecide = hasPermission(roles, 'provider.verification.decide');
  const actor = roles.includes('ADMIN') ? 'ADMIN' : 'REVIEWER';
  const p = sub.data?.profile;

  return (
    <Shell title={p ? (locale === 'ar' ? p.displayNameAr : p.displayNameEn) : t('admin.review')} actions={<Link href="/verification" className="btn btn-sm btn-secondary">{t('admin.back')}</Link>}>
      {sub.isPending ? (
        <div className="card stack"><div className="skeleton" /><div className="skeleton" /></div>
      ) : sub.error ? (
        <div className="notice danger">{errorText(sub.error, t as never)}</div>
      ) : p ? (
        <div className="grid grid-2" data-testid="submission">
          <div className="stack">
            <div className="card stack">
              <div className="spread">
                <h2>{t('admin.profile')}</h2>
                <div className="row">
                  {p.isDemo ? <span className="badge tone-demo">{t('admin.syntheticSubmission')}</span> : null}
                  <StatusBadge status={p.verificationStatus} />
                </div>
              </div>
              <dl className="kv">
                <dt>{t('admin.type')}</dt><dd>{t(`roles.${p.providerType}`)}</dd>
                <dt>{t('provider.nameAr')}</dt><dd>{p.displayNameAr}</dd>
                <dt>{t('provider.nameEn')}</dt><dd>{p.displayNameEn}</dd>
                {p.specialty ? (<><dt>{t('provider.specialty')}</dt><dd>{t(`specialty.${p.specialty as 'GENERAL_SURGERY'}`)}{p.subspecialty ? ` · ${p.subspecialty}` : ''}</dd></>) : null}
                <dt>{t('admin.experience')}</dt><dd>{t('common.years', { count: p.yearsExperience })}</dd>
                <dt>{t('admin.location')}</dt><dd>{p.city}{listSeparator(locale)}{t(`governorate.${p.governorate as 'CAIRO'}`)}</dd>
                <dt>{t('provider.affiliation')}</dt><dd>{p.currentAffiliation ?? '—'}</dd>
                <dt>{t('admin.fee')}</dt><dd className="mono">{p.feePiasters != null ? `${(p.feePiasters / 100).toLocaleString()} EGP` : '—'}</dd>
                <dt>{t('admin.submitted')}</dt><dd>{formatDateTime(p.submittedAt, locale)}</dd>
              </dl>
            </div>

            <div className="card tight">
              <div style={{ padding: '18px 18px 6px' }} className="spread">
                <h2>{t('admin.credentials')}</h2>
              </div>
              <div className="notice info" style={{ margin: '0 18px 12px' }}>{t('admin.documentPending')}</div>
              {sub.data.credentials.map((c) => (
                <div className="cred" key={c.id} data-testid={`cred-${c.kind}`}>
                  <div className="spread">
                    <div>
                      <strong>{t(`provider.cred_${c.kind}`)}</strong>
                      <div className="subtle">{c.issuer} · <span className="mono">{c.identifier}</span>{c.expiresOn ? ` · ${t('provider.expiresOn')} ${c.expiresOn}` : ''}</div>
                    </div>
                    <span className={`badge tone-${c.status === 'APPROVED' ? 'success' : c.status === 'REJECTED' ? 'danger' : 'info'}`}>{t(`provider.credStatus_${c.status}`)}</span>
                  </div>
                  {c.reviewNote ? <div className="subtle">{t('provider.reviewerNote')}: {c.reviewNote}</div> : null}
                  {canDecide && !sub.data.isSelf && c.status === 'PENDING' ? (
                    <div className="row">
                      <button className="btn btn-sm btn-primary" disabled={decideCredential.isPending} onClick={() => decideCredential.mutate({ credId: c.id, status: 'APPROVED' })} data-testid={`approve-cred-${c.kind}`}>
                        {t('admin.approveCredential')}
                      </button>
                      <input className="input" style={{ flex: 1, minHeight: 36, padding: '6px 10px' }} placeholder={t('admin.credentialNote')} value={notes[c.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))} />
                      <button className="btn btn-sm btn-danger" disabled={decideCredential.isPending || !(notes[c.id] ?? '').trim()} onClick={() => decideCredential.mutate({ credId: c.id, status: 'REJECTED' })}>
                        {t('admin.rejectCredential')}
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="stack">
            <div className="card stack" data-testid="decision-panel">
              <h2>{t('admin.decision')}</h2>
              {sub.data.isSelf ? <div className="notice warning">{t('admin.selfReview')}</div> : null}
              {sub.data.missingApprovedCredentials.length ? (
                <div className="notice warning" data-testid="missing-credentials">
                  {t('admin.missingApproved', { list: sub.data.missingApprovedCredentials.map((k) => t(`provider.cred_${k as 'NATIONAL_ID'}`)).join(listSeparator(locale)) })}
                </div>
              ) : null}
              {error ? <div className="notice danger" role="alert" data-testid="decision-error">{error}</div> : null}
              {canDecide && !sub.data.isSelf ? (
                <>
                  <div className="field">
                    <label htmlFor="reason">{t('admin.reason')}</label>
                    <textarea id="reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="decision-reason" />
                  </div>
                  <div className="stack" style={{ gap: 8 }}>
                    {DECISIONS.filter((d) => canTransition(actor, p.verificationStatus as VerificationStatus, decisionTarget(d.decision))).map((d) => (
                      <button
                        key={d.decision}
                        className={`btn btn-block ${d.cls}`}
                        disabled={decide.isPending || (decisionRequiresReason(d.decision) && !reason.trim())}
                        onClick={() => decide.mutate(d.decision)}
                        data-testid={`decision-${d.decision}`}
                        title={decisionRequiresReason(d.decision) && !reason.trim() ? t('admin.reasonRequired') : undefined}
                      >
                        {t(d.key)}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              {p.verificationNote ? <div className="subtle">{t('provider.reviewerNote')}: {p.verificationNote}</div> : null}
            </div>
            <div className="card stack">
              <h2>{t('admin.history')}</h2>
              <ul className="timeline" data-testid="history">
                {sub.data.events.map((e) => (
                  <li key={e.id}>
                    <span className="dot" />
                    <div>
                      <div>{e.fromStatus ? `${t(`provider.status_${e.fromStatus as 'DRAFT'}`)} → ` : ''}<strong>{t(`provider.status_${e.toStatus as 'DRAFT'}`)}</strong></div>
                      <div className="subtle">{formatDateTime(e.createdAt, locale)}{e.note ? ` · ${e.note}` : ''}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </Shell>
  );
}
