'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useI18n } from '@/components/Providers';
import { formatDateTime, Shell } from '@/components/Shell';
import { api } from '@/lib/api';

/** Server-side feature flags (ADMIN only; changes are audited by the database). */
export default function Features() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const flags = useQuery({ queryKey: ['features'], queryFn: () => api.admin.features() });
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const toggle = useMutation({
    mutationFn: (v: { key: string; enabled: boolean }) => api.admin.setFeature(v.key, { enabled: v.enabled, ...(evidence[v.key] ? { evidenceRef: evidence[v.key] } : {}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['features'] }),
  });
  return (
    <Shell title={t('admin.features')}>
      <p className="muted">{t('admin.featuresBody')}</p>
      {toggle.error ? <div className="notice danger" data-testid="feature-error">{String(toggle.error.message)}</div> : null}
      <div className="card tight">
        <table className="table" data-testid="features-table">
          <thead><tr><th>Key</th><th>{t('admin.risk')}</th><th>{t('admin.evidenceRef')}</th><th /><th /></tr></thead>
          <tbody>
            {(flags.data ?? []).map((f) => (
              <tr key={f.key} data-testid={`feature-${f.key}`}>
                <td><div className="mono">{f.key}</div><div className="subtle">{f.description}</div><div className="subtle">{formatDateTime(f.updatedAt, locale)}</div></td>
                <td><span className={`badge tone-${f.risk === 'HIGH' ? 'danger' : f.risk === 'MEDIUM' ? 'warning' : 'neutral'}`}>{f.risk}</span>{f.requiresRegulatoryEvidence ? <div className="subtle">{t('admin.evidenceRequired')}</div> : null}</td>
                <td>
                  {f.requiresRegulatoryEvidence ? (
                    <input className="input" aria-label={`${t('admin.evidenceRef')} ${f.key}`} defaultValue={f.evidenceRef ?? ''} onChange={(e) => setEvidence((m) => ({ ...m, [f.key]: e.target.value }))} />
                  ) : <span className="subtle">—</span>}
                </td>
                <td><span className={`badge tone-${f.enabled ? 'success' : 'neutral'}`}>{f.enabled ? t('admin.enabled') : t('admin.disabled')}</span></td>
                <td>
                  <button className={`btn btn-sm ${f.enabled ? 'btn-secondary' : 'btn-primary'}`} disabled={toggle.isPending} onClick={() => toggle.mutate({ key: f.key, enabled: !f.enabled })}>
                    {f.enabled ? t('admin.disable') : t('admin.enable')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
