'use client';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/components/Providers';
import { formatDateTime, Shell } from '@/components/Shell';
import { api } from '@/lib/api';

export default function Audit() {
  const { t, locale } = useI18n();
  const log = useQuery({ queryKey: ['audit'], queryFn: () => api.admin.auditLog(150) });
  return (
    <Shell title={t('admin.audit')}>
      <div className="card tight">
        {log.error ? <div className="notice danger" style={{ margin: 16 }}>{String(log.error.message)}</div> : null}
        <table className="table" data-testid="audit-table">
          <thead><tr><th>{t('admin.when')}</th><th>{t('admin.actor')}</th><th>{t('admin.action')}</th><th>{t('admin.entity')}</th></tr></thead>
          <tbody>
            {(log.data ?? []).map((a) => (
              <tr key={a.id}>
                <td className="subtle">{formatDateTime(a.createdAt, locale)}</td>
                <td>{a.actorName ?? a.actorUserId ?? '—'}</td>
                <td><code>{a.action}</code></td>
                <td className="subtle">{a.entityType}{a.entityId ? ` · ${a.entityId.slice(0, 12)}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
