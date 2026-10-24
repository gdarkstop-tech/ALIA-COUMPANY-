'use client';
import type { Appeal } from '@ghayarly/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useAccountError } from '@/components/accounts';
import { useI18n, useToast } from '@/components/Providers';
import { formatDateTime, Shell } from '@/components/Shell';
import { api } from '@/lib/api';

/** Open appeals; each is decided by someone other than the person who imposed the restriction. */
export default function Appeals() {
  const { t } = useI18n();
  const appeals = useQuery({ queryKey: ['appeals'], queryFn: () => api.admin.appeals('OPEN') });
  return (
    <Shell title={t('accounts.openAppeals')}>
      <Link href="/users" className="btn btn-sm btn-ghost" style={{ marginBottom: 12 }}>← {t('admin.users')}</Link>
      <p className="muted">{t('accounts.appealRule')}</p>
      <div className="stack" data-testid="appeals-list">
        {appeals.data && !appeals.data.length ? <div className="card empty">{t('accounts.noAppeals')}</div> : null}
        {(appeals.data ?? []).map((a) => <AppealCard key={a.id} appeal={a} />)}
      </div>
    </Shell>
  );
}

function AppealCard({ appeal }: { appeal: Appeal }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const errorText = useAccountError();
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: (decision: 'GRANTED' | 'DENIED') => api.admin.decideAppeal(appeal.id, { decision, note: note.trim() }),
    onSuccess: async () => {
      toast(t('catalog.saved'));
      await qc.invalidateQueries({ queryKey: ['appeals'] });
    },
  });
  return (
    <section className="card stack" data-testid={`appeal-${appeal.id}`}>
      <div className="spread">
        <strong>{t('accounts.appealFrom', { name: appeal.userName ?? appeal.userId })}</strong>
        <span className="subtle">{formatDateTime(appeal.createdAt, locale)}</span>
      </div>
      <p>{appeal.message}</p>
      <Link href={`/users/${encodeURIComponent(appeal.userId)}`} className="subtle">{t('accounts.open')} →</Link>
      <div className="field">
        <label htmlFor={`note-${appeal.id}`}>{t('accounts.decisionNote')}</label>
        <textarea id={`note-${appeal.id}`} className="input" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {decide.error ? <div className="notice danger" role="alert">{errorText(decide.error)}</div> : null}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-primary" disabled={note.trim().length < 10 || decide.isPending} onClick={() => decide.mutate('GRANTED')}>{t('accounts.grant')}</button>
        <button className="btn btn-secondary" disabled={note.trim().length < 10 || decide.isPending} onClick={() => decide.mutate('DENIED')}>{t('accounts.deny')}</button>
      </div>
    </section>
  );
}
