'use client';
import { hasPermission, RESTRICTION_REASONS, type AdminUserDetail, type StatusAction, type StatusReason } from '@ghayarly/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AccountBadges, useAccountError } from '@/components/accounts';
import { useI18n, useToast } from '@/components/Providers';
import { formatDateTime, Shell, useMe } from '@/components/Shell';
import { api } from '@/lib/api';

const STAFF_ROLES = ['ADMIN', 'CLINICAL_REVIEWER', 'SUPPORT', 'TRUST_AND_SAFETY', 'COMMERCE_MANAGER'];

/** Actions that make sense from the account's current state. */
function availableActions(u: AdminUserDetail): Exclude<StatusAction, 'APPEAL_GRANTED'>[] {
  const out: Exclude<StatusAction, 'APPEAL_GRANTED'>[] = [];
  if (u.account.status === 'ACTIVE') out.push('SUSPEND', 'BLOCK');
  else out.push('REACTIVATE', ...(u.account.status === 'SUSPENDED' ? (['BLOCK'] as const) : (['SUSPEND'] as const)));
  const clinician = u.roles.includes('DOCTOR') || u.roles.includes('NURSE');
  if (clinician) out.push(u.account.bookingsRestricted ? 'LIFT_BOOKING_RESTRICTION' : 'RESTRICT_BOOKINGS');
  return out;
}

export default function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const userId = decodeURIComponent(id);
  const { t, locale } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const me = useMe();
  const errorText = useAccountError();
  const user = useQuery({ queryKey: ['user', userId], queryFn: () => api.admin.user(userId) });
  const [action, setAction] = useState<Exclude<StatusAction, 'APPEAL_GRANTED'> | ''>('');
  const [reason, setReason] = useState<StatusReason>('TERMS_VIOLATION');
  const [publicMessage, setPublicMessage] = useState('');
  const [staffNote, setStaffNote] = useState('');
  const [care, setCare] = useState('');
  const [until, setUntil] = useState('');
  const apply = useMutation({
    mutationFn: () =>
      api.admin.setAccountStatus(userId, {
        action: action as Exclude<StatusAction, 'APPEAL_GRANTED'>,
        reason: action === 'REACTIVATE' || action === 'LIFT_BOOKING_RESTRICTION' ? 'RESOLVED' : reason,
        ...(publicMessage.trim() ? { publicMessage: publicMessage.trim() } : {}),
        staffNote: staffNote.trim(),
        ...(action === 'SUSPEND' && until ? { suspendedUntil: new Date(until).toISOString() } : {}),
        ...(care.trim() ? { careContinuityNote: care.trim() } : {}),
      }),
    onSuccess: async () => {
      setAction('');
      setPublicMessage('');
      setStaffNote('');
      setCare('');
      setUntil('');
      toast(t('catalog.saved'));
      await qc.invalidateQueries({ queryKey: ['user', userId] });
      await qc.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const u = user.data;
  if (!u) return <Shell title={t('admin.users')}>{user.error ? <div className="notice danger">{errorText(user.error)}</div> : <div className="skeleton" style={{ height: 120 }} />}</Shell>;
  const roles = me.data?.roles ?? [];
  const canManage = hasPermission(roles, 'users.status.manage');
  const isStaffTarget = u.roles.some((r) => STAFF_ROLES.includes(r));
  const blockedForMe = u.isSelf || (isStaffTarget && !roles.includes('ADMIN')) || u.deleted;
  const clinician = u.roles.includes('DOCTOR') || u.roles.includes('NURSE');
  const restricting = action === 'SUSPEND' || action === 'BLOCK' || action === 'RESTRICT_BOOKINGS';
  const needsPublic = action === 'SUSPEND' || action === 'BLOCK';
  const needsCare = clinician && restricting;
  const valid = Boolean(action) && staffNote.trim().length >= 10 && (!needsPublic || publicMessage.trim().length > 0) && (!needsCare || care.trim().length >= 10);

  return (
    <Shell title={u.name}>
      <div className="row" style={{ gap: 8, marginBottom: 16 }}>
        <Link href="/users" className="btn btn-sm btn-ghost">← {t('admin.users')}</Link>
        <AccountBadges account={u.account} />
      </div>
      <div className="grid grid-2">
        <div className="stack">
          <section className="card stack" data-testid="user-summary">
            <dl className="kv">
              <dt>{t('admin.email')}</dt><dd className="mono">{u.email} {u.emailVerified ? <span className="subtle">({t('accounts.verified')})</span> : null}</dd>
              <dt>{t('accounts.contact')}</dt><dd className="mono">{u.phoneNumber ?? '—'} {u.phoneNumberVerified ? <span className="subtle">({t('accounts.verified')})</span> : null}</dd>
              <dt>{t('admin.roles')}</dt><dd>{u.roles.map((r) => <span key={r} className="badge tone-primary" style={{ marginInlineEnd: 4 }}>{t(`roles.${r}`)}</span>)}</dd>
              <dt>{t('admin.mfa')}</dt><dd>{u.twoFactorEnabled ? t('me.twoFactorOn') : t('me.twoFactorOff')}</dd>
              <dt>{t('admin.created')}</dt><dd>{formatDateTime(u.createdAt, locale)}</dd>
              <dt>{t('accounts.lastSeen')}</dt><dd>{formatDateTime(u.lastSeenAt, locale)}</dd>
              <dt>{t('accounts.patientProfiles')}</dt><dd>{u.patientProfiles}</dd>
              {u.providerVerification ? <><dt>{t('accounts.providerVerification')}</dt><dd>{t(`provider.status_${u.providerVerification as 'DRAFT'}`)}</dd></> : null}
            </dl>
            {u.account.publicMessage ? <div className="notice warning">{u.account.publicMessage}{u.account.suspendedUntil ? ` · ${t('accounts.until', { date: formatDateTime(u.account.suspendedUntil, locale) })}` : ''}</div> : null}
          </section>

          <section className="card stack" data-testid="status-history">
            <h2>{t('accounts.history')}</h2>
            {u.events.length ? (
              <ul className="timeline">
                {u.events.map((e) => (
                  <li key={e.id}>
                    <strong>{t(`accounts.action_${e.action}`)}</strong> · {t(`accounts.reason_${e.reason}`)} · {t(`accounts.status_${e.toStatus}`)}
                    <div className="subtle">{formatDateTime(e.createdAt, locale)}{e.actorName ? ` · ${t('accounts.by', { name: e.actorName })}` : ''}</div>
                    <div>{e.staffNote}</div>
                    {e.publicMessage ? <div className="subtle">“{e.publicMessage}”</div> : null}
                    {e.careContinuityNote ? <div className="subtle">{t('accounts.careContinuityNote')}: {e.careContinuityNote}</div> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="subtle">—</p>}
          </section>

          <section className="card stack">
            <h2>{t('accounts.appeals')}</h2>
            {u.appeals.length ? u.appeals.map((a) => (
              <div key={a.id} className="card tight stack" style={{ background: 'var(--color-surface-sunken)' }}>
                <span className="badge tone-neutral">{t(`accounts.appeal_${a.status}`)}</span>
                <p>{a.message}</p>
                {a.decisionNote ? <p className="subtle">{a.decisionNote}</p> : null}
                <span className="subtle">{formatDateTime(a.createdAt, locale)}</span>
              </div>
            )) : <p className="subtle">{t('accounts.noAppeals')}</p>}
          </section>
        </div>

        <section className="card stack" data-testid="status-actions">
          <h2>{t('accounts.actions')}</h2>
          {u.isSelf ? <div className="notice info">{t('accounts.selfNotice')}</div> : null}
          {isStaffTarget && !roles.includes('ADMIN') ? <div className="notice info">{t('accounts.staffNotice')}</div> : null}
          {canManage && !blockedForMe ? (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                apply.mutate();
              }}
            >
              <p className="subtle">{t('accounts.signedOutNotice')}</p>
              <div className="field">
                <label htmlFor="action">{t('accounts.action')}</label>
                <select id="action" className="input" value={action} onChange={(e) => setAction(e.target.value as typeof action)} data-testid="status-action">
                  <option value="" />
                  {availableActions(u).map((a) => <option key={a} value={a}>{t(`accounts.action_${a}`)}</option>)}
                </select>
              </div>
              {restricting ? (
                <div className="field">
                  <label htmlFor="reason">{t('accounts.reason')}</label>
                  <select id="reason" className="input" value={reason} onChange={(e) => setReason(e.target.value as StatusReason)}>
                    {RESTRICTION_REASONS.map((r) => <option key={r} value={r}>{t(`accounts.reason_${r}`)}</option>)}
                  </select>
                </div>
              ) : null}
              {restricting ? (
                <div className="field">
                  <label htmlFor="public">{t('accounts.publicMessage')}</label>
                  <textarea id="public" className="input" maxLength={500} value={publicMessage} onChange={(e) => setPublicMessage(e.target.value)} data-testid="status-public" />
                  <span className="subtle">{t('accounts.publicMessageHelp')}</span>
                </div>
              ) : null}
              {action === 'SUSPEND' ? (
                <div className="field">
                  <label htmlFor="until">{t('accounts.suspendedUntil')}</label>
                  <input id="until" type="datetime-local" className="input" value={until} onChange={(e) => setUntil(e.target.value)} />
                </div>
              ) : null}
              {needsCare ? (
                <div className="field">
                  <label htmlFor="care">{t('accounts.careContinuityNote')}</label>
                  <textarea id="care" className="input" maxLength={2000} value={care} onChange={(e) => setCare(e.target.value)} data-testid="status-care" />
                  <span className="subtle">{t('accounts.careContinuityHelp')}</span>
                </div>
              ) : null}
              <div className="field">
                <label htmlFor="note">{t('accounts.staffNote')}</label>
                <textarea id="note" className="input" maxLength={2000} value={staffNote} onChange={(e) => setStaffNote(e.target.value)} data-testid="status-note" />
              </div>
              {apply.error ? <div className="notice danger" role="alert" data-testid="status-error">{errorText(apply.error)}</div> : null}
              <button className={`btn ${restricting ? 'btn-danger' : 'btn-primary'}`} type="submit" disabled={!valid || apply.isPending} data-testid="status-apply">{t('accounts.apply')}</button>
            </form>
          ) : null}
        </section>
      </div>
    </Shell>
  );
}
