'use client';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/components/Providers';
import { formatDateTime, Shell } from '@/components/Shell';
import { api } from '@/lib/api';

export default function Users() {
  const { t, locale } = useI18n();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.admin.users() });
  return (
    <Shell title={t('admin.users')}>
      <div className="card tight">
        {users.error ? <div className="notice danger" style={{ margin: 16 }}>{String(users.error.message)}</div> : null}
        <table className="table">
          <thead><tr><th>{t('auth.fullName')}</th><th>{t('admin.email')}</th><th>{t('admin.roles')}</th><th>{t('admin.mfa')}</th><th>{t('admin.created')}</th></tr></thead>
          <tbody>
            {(users.data ?? []).map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td className="mono">{u.email}</td>
                <td><div className="row" style={{ gap: 4 }}>{u.roles.map((r) => <span key={r} className="badge tone-primary">{t(`roles.${r}`)}</span>)}</div></td>
                <td><span className={`badge tone-${u.twoFactorEnabled ? 'success' : 'warning'}`}>{u.twoFactorEnabled ? t('me.twoFactorOn') : t('me.twoFactorOff')}</span></td>
                <td className="subtle">{formatDateTime(u.createdAt, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
