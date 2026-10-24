'use client';
import type { TranslationKey } from '@ghayarly/i18n';
import { useI18n } from './Providers';

export type ContentForm = {
  nameEn: string;
  nameAr: string;
  summaryEn: string;
  summaryAr: string;
  descriptionEn: string;
  descriptionAr: string;
  usageEn: string;
  usageAr: string;
  approvedUsesEn: string;
  approvedUsesAr: string;
  warningsEn: string;
  warningsAr: string;
  regulatoryNote: string;
};

export const emptyContent: ContentForm = {
  nameEn: '',
  nameAr: '',
  summaryEn: '',
  summaryAr: '',
  descriptionEn: '',
  descriptionAr: '',
  usageEn: '',
  usageAr: '',
  approvedUsesEn: '',
  approvedUsesAr: '',
  warningsEn: '',
  warningsAr: '',
  regulatoryNote: '',
};

// Pairs shown side by side: English (LTR) and Arabic (RTL), each typed in its own direction.
const PAIRS: { base: 'name' | 'summary' | 'description' | 'usage' | 'approvedUses' | 'warnings'; multiline: boolean; required: boolean }[] = [
  { base: 'name', multiline: false, required: true },
  { base: 'summary', multiline: false, required: true },
  { base: 'description', multiline: true, required: true },
  { base: 'usage', multiline: true, required: true },
  { base: 'approvedUses', multiline: true, required: false },
  { base: 'warnings', multiline: true, required: false },
];

export function ProductContentFields({ value, onChange, disabled }: { value: ContentForm; onChange: (v: ContentForm) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const set = (k: keyof ContentForm, v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="stack">
      <div className="notice info">{t('catalog.medicalTextNotice')}</div>
      {PAIRS.map(({ base, multiline, required }) => (
        <div key={base} className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {(['En', 'Ar'] as const).map((lang) => {
            const key = `${base}${lang}` as keyof ContentForm;
            const id = `content-${key}`;
            const props = {
              id,
              className: 'input',
              value: value[key],
              disabled,
              required,
              dir: lang === 'Ar' ? 'rtl' : 'ltr',
              lang: lang === 'Ar' ? 'ar' : 'en',
              'data-testid': id,
            } as const;
            return (
              <div className="field" key={key}>
                <label htmlFor={id}>{t(`catalog.${key}` as TranslationKey)}</label>
                {multiline ? <textarea {...props} onChange={(e) => set(key, e.target.value)} /> : <input {...props} onChange={(e) => set(key, e.target.value)} />}
              </div>
            );
          })}
        </div>
      ))}
      <div className="field">
        <label htmlFor="content-regulatoryNote">{t('catalog.regulatoryNote')}</label>
        <input id="content-regulatoryNote" className="input" value={value.regulatoryNote} disabled={disabled} onChange={(e) => set('regulatoryNote', e.target.value)} />
      </div>
    </div>
  );
}
