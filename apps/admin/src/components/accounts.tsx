'use client';
import type { TranslationKey } from '@ghayarly/i18n';
import type { AccountStatusInfo } from '@ghayarly/shared';
import { ApiError } from '@/lib/api';
import { useI18n } from './Providers';

export function AccountBadges({ account }: { account: AccountStatusInfo }) {
  const { t } = useI18n();
  return (
    <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
      <span className={`badge tone-${account.status === 'ACTIVE' ? 'success' : account.status === 'BLOCKED' ? 'danger' : 'warning'}`} data-testid="account-status">{t(`accounts.status_${account.status}`)}</span>
      {account.bookingsRestricted ? <span className="badge tone-warning">{t('accounts.bookingsRestricted')}</span> : null}
    </div>
  );
}

const KNOWN = [
  'SELF_ACTION_FORBIDDEN',
  'STAFF_TARGET_REQUIRES_ADMIN',
  'CARE_CONTINUITY_NOTE_REQUIRED',
  'PUBLIC_MESSAGE_REQUIRED',
  'STAFF_NOTE_REQUIRED',
  'NOT_A_CLINICIAN',
  'ALREADY_ACTIVE',
  'NOT_RESTRICTED',
  'APPEAL_REVIEWER_MUST_DIFFER',
  'APPEAL_ALREADY_DECIDED',
  'INVALID_SUSPENSION_END',
  'ACCOUNT_DELETED',
] as const;

export function useAccountError() {
  const { t } = useI18n();
  return (e: unknown): string => {
    if (e instanceof ApiError) {
      const text = (KNOWN as readonly string[]).includes(e.code) ? t(`accounts.err_${e.code}` as TranslationKey) : e.message;
      return `${text} (${e.code})`;
    }
    return t('errors.generic');
  };
}
