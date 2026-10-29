'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCan } from '@/components/ai';
import { useI18n } from '@/components/Providers';
import { formatDateTime, Shell } from '@/components/Shell';
import { WOUND_KEY, WoundError, WoundTabs, presentationTone } from '@/components/wounds';
import { api } from '@/lib/api';

/**
 * Presentation case library: cases whose people allowed company presentations (C), each one used
 * only after the person approves the exact version and a second approver checks it. No photo here.
 */
export default function PresentationLibrary() {
  const { t, locale } = useI18n();
  const can = useCan();
  const router = useRouter();
  const qc = useQueryClient();
  const manager = can('wound.presentation.manage');
  const candidates = useQuery({ queryKey: [...WOUND_KEY, 'candidates'], queryFn: () => api.woundAdmin.candidates(), enabled: manager });
  const list = useQuery({ queryKey: [...WOUND_KEY, 'presentations'], queryFn: () => api.woundAdmin.presentations(), enabled: manager });
  const nominate = useMutation({
    mutationFn: (caseId: string) => api.woundAdmin.nominate(caseId),
    onSuccess: async (p) => {
      await qc.invalidateQueries({ queryKey: WOUND_KEY });
      router.push(`/wounds/presentations/${p.id}`);
    },
  });
  return (
    <Shell title={t('woundAdmin.title')}>
      <WoundTabs />
      {!manager ? (
        <div className="notice info" data-testid="wound-no-permission">{t('woundAdmin.noPermission')}</div>
      ) : (
        <div className="stack">
          <div className="notice info" data-testid="presentations-note">{t('woundAdmin.presentationsNote')}</div>
          <WoundError error={candidates.error ?? list.error ?? nominate.error} />
          <section className="card tight" data-testid="presentation-candidates">
            <h2 style={{ padding: '12px 16px 0' }}>{t('woundAdmin.candidates')}</h2>
            <p className="subtle" style={{ padding: '0 16px' }}>{t('woundAdmin.candidatesNote')}</p>
            <table className="table">
              <tbody>
                {(candidates.data ?? []).map((c) => (
                  <tr key={c.caseId} data-testid="presentation-candidate">
                    <td>
                      <div>{t('woundAdmin.candidateRow', { category: c.category, region: c.region, photos: c.photoCount, days: c.spanDays, outcome: c.outcome })}</div>
                      <div className="subtle">{t('woundAdmin.allowedFor', { audiences: c.audiences.join(', '), organizations: c.organizations.join(', ') })}</div>
                    </td>
                    <td style={{ textAlign: 'end' }}>
                      <button className="btn btn-sm btn-primary" data-testid="presentation-nominate" disabled={nominate.isPending} onClick={() => nominate.mutate(c.caseId)}>
                        {t('woundAdmin.nominate')}
                      </button>
                    </td>
                  </tr>
                ))}
                {candidates.data && !candidates.data.length ? (
                  <tr><td className="subtle" data-testid="presentation-no-candidates">{t('woundAdmin.noCandidates')}</td></tr>
                ) : null}
              </tbody>
            </table>
          </section>
          <section className="card tight" data-testid="presentation-list">
            <h2 style={{ padding: '12px 16px 0' }}>{t('woundAdmin.presentations')}</h2>
            <table className="table">
              <thead>
                <tr><th>{t('woundAdmin.caseTitle')}</th><th>{t('woundAdmin.audience')}</th><th>{t('woundAdmin.validUntil')}</th><th /><th /></tr>
              </thead>
              <tbody>
                {(list.data ?? []).map((p) => (
                  <tr key={p.id} data-testid="presentation-row">
                    <td>
                      <Link href={`/wounds/presentations/${p.id}`}><strong>{p.title ?? t('woundAdmin.untitled')}</strong></Link>
                      <div className="subtle mono">{[p.category, p.outcome].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="mono">{p.audience ? `${p.audience} · ${p.organization}` : '—'}</td>
                    <td className="mono">{p.validUntil ?? '—'}</td>
                    <td><span className={`badge tone-${presentationTone(p.status)}`} data-testid="presentation-status">{t(`woundAdmin.pres_${p.status}`)}</span></td>
                    <td className="subtle">{p.exports?.length ? formatDateTime(p.exports[0]!.exportedAt, locale) : ''}</td>
                  </tr>
                ))}
                {list.data && !list.data.length ? (
                  <tr><td colSpan={5} className="subtle">{t('woundAdmin.noPresentations')}</td></tr>
                ) : null}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </Shell>
  );
}
