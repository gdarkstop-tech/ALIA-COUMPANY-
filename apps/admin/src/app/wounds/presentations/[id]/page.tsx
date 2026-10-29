'use client';
import { WOUND_DEIDENTIFICATION_CHECKS, WOUND_PRESENTATION_AUDIENCES, WOUND_PRESENTATION_ORGANIZATIONS, type WoundPresentationView } from '@ghayarly/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useCan } from '@/components/ai';
import { useI18n } from '@/components/Providers';
import { formatDateTime, Shell } from '@/components/Shell';
import { MediaImg, WOUND_KEY, WoundError, WoundTabs, downloadPost, presentationTone } from '@/components/wounds';
import { api } from '@/lib/api';

type Caption = { include: boolean; captionEn: string; captionAr: string };
const EMPTY_CAPTION: Caption = { include: false, captionEn: '', captionAr: '' };
const OPEN = ['NOMINATED', 'AWAITING_PATIENT', 'PATIENT_APPROVED', 'APPROVED'];
const isoInDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** Exact photos, bilingual captions and summary. Sending it (again) always goes back to the person. */
function PrepareForm({ p }: { p: WoundPresentationView }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const images = useQuery({ queryKey: [...WOUND_KEY, 'case-images', p.caseId], queryFn: () => api.woundAdmin.caseImages(p.caseId) });
  const audiences = p.permitted?.audiences.length ? p.permitted.audiences : [...WOUND_PRESENTATION_AUDIENCES];
  const organizations = p.permitted?.organizations.length ? p.permitted.organizations : [...WOUND_PRESENTATION_ORGANIZATIONS];
  const [title, setTitle] = useState(p.title ?? '');
  const [summaryEn, setSummaryEn] = useState(p.summaryEn ?? '');
  const [summaryAr, setSummaryAr] = useState(p.summaryAr ?? '');
  const [audience, setAudience] = useState<string>(p.audience ?? audiences[0]!);
  const [organization, setOrganization] = useState<string>(p.organization ?? organizations[0]!);
  const [scopeNote, setScopeNote] = useState(p.scopeNote ?? '');
  const [validUntil, setValidUntil] = useState(p.validUntil ?? isoInDays(365));
  const [captions, setCaptions] = useState<Record<string, Caption>>(() =>
    Object.fromEntries(p.images.map((i) => [i.imageId, { include: true, captionEn: i.captionEn, captionAr: i.captionAr }])),
  );
  const set = (imageId: string, patch: Partial<Caption>) => setCaptions((c) => ({ ...c, [imageId]: { ...EMPTY_CAPTION, ...c[imageId], ...patch } }));
  const chosen = (images.data ?? []).filter((im) => captions[im.imageId]?.include);
  const ready =
    title.trim().length >= 3 && summaryEn.trim().length >= 10 && summaryAr.trim().length >= 10 && scopeNote.trim().length >= 10 && /^\d{4}-\d{2}-\d{2}$/.test(validUntil) &&
    chosen.length >= 1 && chosen.length <= 6 && chosen.every((im) => captions[im.imageId]!.captionEn.trim() && captions[im.imageId]!.captionAr.trim());
  const prepare = useMutation({
    mutationFn: () =>
      api.woundAdmin.prepare(p.id, {
        title, summaryEn, summaryAr, audience, organization, scopeNote, validUntil,
        images: chosen.map((im) => ({ imageId: im.imageId, captionEn: captions[im.imageId]!.captionEn, captionAr: captions[im.imageId]!.captionAr })),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: WOUND_KEY }),
  });
  return (
    <section className="card stack" data-testid="presentation-prepare">
      <h2>{t('woundAdmin.prepare')}</h2>
      <p className="subtle">{t('woundAdmin.prepareNote')}</p>
      <div className="field"><label htmlFor="p-title">{t('woundAdmin.caseTitle')}</label><input id="p-title" className="input" data-testid="prepare-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></div>
      <div className="field"><label htmlFor="p-sum-en">{t('woundAdmin.summaryEn')}</label><textarea id="p-sum-en" className="input" dir="ltr" data-testid="prepare-summary-en" value={summaryEn} onChange={(e) => setSummaryEn(e.target.value)} maxLength={2000} /></div>
      <div className="field"><label htmlFor="p-sum-ar">{t('woundAdmin.summaryAr')}</label><textarea id="p-sum-ar" className="input" dir="rtl" lang="ar" data-testid="prepare-summary-ar" value={summaryAr} onChange={(e) => setSummaryAr(e.target.value)} maxLength={2000} /></div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="p-aud">{t('woundAdmin.audience')}</label>
          <select id="p-aud" className="input" data-testid="prepare-audience" value={audience} onChange={(e) => setAudience(e.target.value)}>{audiences.map((a) => <option key={a} value={a}>{a}</option>)}</select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="p-org">{t('woundAdmin.organization')}</label>
          <select id="p-org" className="input" data-testid="prepare-organization" value={organization} onChange={(e) => setOrganization(e.target.value)}>{organizations.map((o) => <option key={o} value={o}>{o}</option>)}</select>
        </div>
        <div className="field">
          <label htmlFor="p-valid">{t('woundAdmin.validUntil')}</label>
          <input id="p-valid" className="input mono" data-testid="prepare-valid-until" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </div>
      </div>
      <div className="field"><label htmlFor="p-scope">{t('woundAdmin.scopeNote')}</label><input id="p-scope" className="input" data-testid="prepare-scope" value={scopeNote} onChange={(e) => setScopeNote(e.target.value)} maxLength={300} /></div>
      <strong>{t('woundAdmin.casePhotos')}</strong>
      <WoundError error={images.error} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
        {(images.data ?? []).map((im) => {
          const c = captions[im.imageId];
          return (
            <div key={im.imageId} className="card tight stack" style={{ padding: 10 }} data-testid="prepare-photo">
              <MediaImg id={im.imageId} mint={api.woundAdmin.presentationImageLink} alt={t('woundAdmin.day', { day: im.day })} />
              <label className="row" style={{ gap: 6 }}>
                <input type="checkbox" data-testid="prepare-include" checked={!!c?.include} onChange={(e) => set(im.imageId, { include: e.target.checked })} />
                <span>{`${t('woundAdmin.include')} · ${t('woundAdmin.day', { day: im.day })}`}</span>
              </label>
              {c?.include ? (
                <>
                  <input className="input" dir="ltr" aria-label={t('woundAdmin.captionEn')} placeholder={t('woundAdmin.captionEn')} data-testid="prepare-caption-en" value={c.captionEn} onChange={(e) => set(im.imageId, { captionEn: e.target.value })} maxLength={300} />
                  <input className="input" dir="rtl" lang="ar" aria-label={t('woundAdmin.captionAr')} placeholder={t('woundAdmin.captionAr')} data-testid="prepare-caption-ar" value={c.captionAr} onChange={(e) => set(im.imageId, { captionAr: e.target.value })} maxLength={300} />
                </>
              ) : null}
            </div>
          );
        })}
      </div>
      <WoundError error={prepare.error} />
      <div>
        <button className="btn btn-primary" data-testid="prepare-send" disabled={!ready || prepare.isPending} onClick={() => prepare.mutate()}>
          {p.status === 'AWAITING_PATIENT' ? t('woundAdmin.resend') : t('woundAdmin.send')}
        </button>
      </div>
    </section>
  );
}

/** What the person saw and approved — the only version that can ever be approved or exported. */
function PreparedVersion({ p }: { p: WoundPresentationView }) {
  const { t } = useI18n();
  return (
    <section className="card stack" data-testid="presentation-version">
      <h2>{t('woundAdmin.preparedVersion')}</h2>
      <strong data-testid="version-title">{p.title}</strong>
      <p dir="ltr">{p.summaryEn}</p>
      <p dir="rtl" lang="ar">{p.summaryAr}</p>
      <div className="mono">{`${p.audience} · ${p.organization} · ${p.validUntil}`}</div>
      <div className="subtle">{p.scopeNote}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        {p.images.map((im) => (
          <figure key={im.imageId} style={{ margin: 0 }} data-testid="version-photo">
            <MediaImg id={im.imageId} mint={api.woundAdmin.presentationImageLink} alt={im.captionEn} />
            <figcaption className="subtle">
              <div>{`${t('woundAdmin.day', { day: im.day })} · ${im.captionEn}`}</div>
              <div dir="rtl" lang="ar">{im.captionAr}</div>
            </figcaption>
          </figure>
        ))}
      </div>
      {p.requestHash ? <div className="subtle mono" data-testid="version-fingerprint">{`${t('woundAdmin.fingerprint')}: ${p.requestHash.slice(0, 16)}…`}</div> : null}
    </section>
  );
}

function SecondApproval({ p }: { p: WoundPresentationView }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const complete = WOUND_DEIDENTIFICATION_CHECKS.every((k) => checks[k]);
  const approve = useMutation({
    mutationFn: () => api.woundAdmin.approve(p.id, Object.fromEntries(WOUND_DEIDENTIFICATION_CHECKS.map((k) => [k, true as const]))),
    onSuccess: () => qc.invalidateQueries({ queryKey: WOUND_KEY }),
  });
  return (
    <section className="card stack" data-testid="presentation-approve">
      <h2>{t('woundAdmin.approveTitle')}</h2>
      <p className="subtle">{t('woundAdmin.approveNote')}</p>
      {p.preparedByMe ? <div className="notice warning" data-testid="approve-same-person">{t('woundAdmin.preparedByYou')}</div> : null}
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }} disabled={p.preparedByMe}>
        <legend className="subtle">{t('woundAdmin.approveTitle')}</legend>
        {WOUND_DEIDENTIFICATION_CHECKS.map((k) => (
          <label key={k} className="row" style={{ gap: 8 }}>
            <input type="checkbox" data-testid={`check-${k}`} checked={!!checks[k]} onChange={(e) => setChecks((c) => ({ ...c, [k]: e.target.checked }))} />
            <span>{t(`woundAdmin.check_${k}`)}</span>
          </label>
        ))}
      </fieldset>
      <WoundError error={approve.error} />
      <div><button className="btn btn-primary" data-testid="approve-submit" disabled={!complete || p.preparedByMe || approve.isPending} onClick={() => approve.mutate()}>{t('woundAdmin.approve')}</button></div>
    </section>
  );
}

function Exports({ p, available, testOnly }: { p: WoundPresentationView; available: boolean; testOnly: boolean }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const exp = useMutation({
    mutationFn: (format: 'PDF' | 'IMAGE_PACKAGE') => downloadPost(`/v1/admin/wounds/presentations/${p.id}/export`, { format }, format === 'PDF' ? 'wound-case.pdf' : 'wound-case.zip'),
    onSuccess: () => qc.invalidateQueries({ queryKey: WOUND_KEY }),
  });
  return (
    <section className="card stack" data-testid="presentation-export">
      <div className={`notice ${available ? 'info' : 'warning'}`} data-testid="presentation-export-state">{t('woundAdmin.exportPresentationDisabled')}</div>
      {testOnly ? <div className="notice demo">{t('woundAdmin.exportTestOnly')}</div> : null}
      {available ? (
        <div className="row">
          <button className="btn btn-secondary" data-testid="export-pdf" disabled={exp.isPending} onClick={() => exp.mutate('PDF')}>{t('woundAdmin.exportPdf')}</button>
          <button className="btn btn-secondary" data-testid="export-zip" disabled={exp.isPending} onClick={() => exp.mutate('IMAGE_PACKAGE')}>{t('woundAdmin.exportPackage')}</button>
        </div>
      ) : null}
      <WoundError error={exp.error} />
      <strong>{t('woundAdmin.exportHistory')}</strong>
      {p.exports?.length ? (
        <ul data-testid="export-history">
          {p.exports.map((e) => <li key={e.id} className="mono">{t('woundAdmin.exported', { format: e.format, date: formatDateTime(e.exportedAt, locale) })}</li>)}
        </ul>
      ) : (
        <span className="subtle">{t('woundAdmin.none')}</span>
      )}
    </section>
  );
}

export default function PresentationCase() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const can = useCan();
  const qc = useQueryClient();
  const manager = can('wound.presentation.manage');
  const q = useQuery({ queryKey: [...WOUND_KEY, 'presentation', id], queryFn: () => api.woundAdmin.presentation(id), enabled: manager });
  const overview = useQuery({ queryKey: [...WOUND_KEY, 'overview'], queryFn: () => api.woundAdmin.overview(), enabled: can('wound.registry.read') });
  const [reason, setReason] = useState('');
  const reject = useMutation({ mutationFn: () => api.woundAdmin.reject(id, reason), onSuccess: () => qc.invalidateQueries({ queryKey: WOUND_KEY }) });
  const p = q.data;
  const testOnly = !!overview.data?.testData && !overview.data.flags['wound.presentation_export'];
  const exportAvailable = !!overview.data && (overview.data.flags['wound.presentation_export'] === true || overview.data.testData);
  return (
    <Shell title={p?.title ?? t('woundAdmin.tabPresentations')}>
      <WoundTabs />
      {!manager ? <div className="notice info">{t('woundAdmin.noPermission')}</div> : null}
      <WoundError error={q.error} />
      {p ? (
        <div className="stack" data-testid="presentation-detail">
          <section className="card stack">
            <div className="spread">
              <span className="mono">{t('woundAdmin.categoryOutcome', { category: p.category ?? '—', outcome: p.outcome ?? '—' })}</span>
              <span className={`badge tone-${presentationTone(p.status)}`} data-testid="presentation-status">{t(`woundAdmin.pres_${p.status}`)}</span>
            </div>
            {p.permitted ? (
              <div className="subtle" data-testid="presentation-permitted">{t('woundAdmin.permittedScope', { audiences: p.permitted.audiences.join(', '), organizations: p.permitted.organizations.join(', ') })}</div>
            ) : OPEN.includes(p.status) ? (
              <div className="notice warning" data-testid="presentation-permission-gone">{t('woundAdmin.permissionGone')}</div>
            ) : null}
            {p.status === 'AWAITING_PATIENT' ? <div className="notice info" data-testid="presentation-awaiting">{t('woundAdmin.awaitingPerson')}</div> : null}
            {p.patientDecidedAt && (p.status === 'PATIENT_APPROVED' || p.status === 'APPROVED') ? (
              <div className="subtle" data-testid="presentation-person-decided">{t('woundAdmin.personDecided', { date: formatDateTime(p.patientDecidedAt, locale) })}</div>
            ) : null}
            {p.closedReason ? <div className="subtle" data-testid="presentation-closed">{t('woundAdmin.closedReason', { reason: p.closedReason })}</div> : null}
          </section>
          {(p.status === 'NOMINATED' || p.status === 'AWAITING_PATIENT') && p.permitted ? <PrepareForm key={p.requestHash ?? 'new'} p={p} /> : null}
          {p.images.length && p.status !== 'NOMINATED' ? <PreparedVersion p={p} /> : null}
          {p.status === 'PATIENT_APPROVED' && p.permitted ? <SecondApproval p={p} /> : null}
          {p.status === 'APPROVED' ? <Exports p={p} available={exportAvailable && !!p.permitted} testOnly={testOnly} /> : null}
          {OPEN.includes(p.status) ? (
            <section className="card stack" data-testid="presentation-reject">
              <div className="field"><label htmlFor="p-reason">{t('woundAdmin.rejectReason')}</label><input id="p-reason" className="input" data-testid="reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></div>
              <WoundError error={reject.error} />
              <div><button className="btn btn-sm btn-secondary" data-testid="reject-submit" disabled={reason.trim().length < 3 || reject.isPending} onClick={() => reject.mutate()}>{t('woundAdmin.rejectCase')}</button></div>
            </section>
          ) : null}
        </div>
      ) : null}
    </Shell>
  );
}
