import type { LabResult } from '@ghayarly/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { isValidIsoDate, maskDate } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { Button, Notice, Sheet, TextField, useToast } from '@/ui';
import { documentErrorKey, useInvalidateDocuments } from './hooks';

export type LabResultSheetMode = { kind: 'correct'; result: LabResult } | { kind: 'manual'; patientId: string; documentId?: string | null };

/** Correct an AI-read row (then confirm it) or add a result by hand — typed exactly as printed. */
export function LabResultSheet({ mode, onClose }: { mode: LabResultSheetMode | null; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const invalidate = useInvalidateDocuments();
  const [f, setF] = useState({ testName: '', valueText: '', unit: '', referenceText: '', observedOn: '' });
  useEffect(() => {
    const r = mode?.kind === 'correct' ? mode.result : null;
    setF({ testName: r?.testName ?? '', valueText: r?.valueText ?? '', unit: r?.unit ?? '', referenceText: r?.referenceText ?? '', observedOn: r?.observedOn ?? '' });
  }, [mode]);
  const save = useMutation({
    mutationFn: async () => {
      const common = { testName: f.testName.trim(), valueText: f.valueText.trim(), unit: f.unit.trim() || null, referenceText: f.referenceText.trim() || null };
      if (mode!.kind === 'correct') return api.labResults.review(mode!.result.id, { decision: 'CONFIRM', ...common, observedOn: f.observedOn || null });
      return api.labResults.add({ patientId: mode!.patientId, documentId: mode!.documentId ?? null, ...common, observedOn: f.observedOn });
    },
    onSuccess: async () => {
      await invalidate();
      toast(t('common.saved'));
      onClose();
    },
  });
  const manual = mode?.kind === 'manual';
  const dateOk = f.observedOn ? isValidIsoDate(f.observedOn) : !manual;
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Sheet visible={Boolean(mode)} onClose={onClose} title={manual ? t('documents.manualTitle') : t('documents.correctTitle')} testID="lab-result-sheet">
      <Notice tone="info" body={manual ? t('documents.manualHint') : t('documents.correctHint')} />
      {save.error ? <Notice tone="danger" body={t(documentErrorKey(save.error))} /> : null}
      <TextField testID="lab-test-name" label={t('documents.testName')} value={f.testName} onChangeText={set('testName')} maxLength={120} />
      <TextField testID="lab-value" label={t('documents.value')} value={f.valueText} onChangeText={set('valueText')} maxLength={40} ltr />
      <TextField testID="lab-unit" label={t('documents.unit')} optional value={f.unit} onChangeText={set('unit')} maxLength={30} ltr />
      <TextField testID="lab-range" label={t('documents.referenceRange')} optional value={f.referenceText} onChangeText={set('referenceText')} maxLength={60} ltr />
      <TextField testID="lab-date" label={t('documents.observedOn')} optional={!manual} placeholder="YYYY-MM-DD" value={f.observedOn} onChangeText={(v) => set('observedOn')(maskDate(v))} keyboardType="number-pad" ltr />
      <Button testID="lab-save" label={manual ? t('common.save') : t('documents.saveCorrection')} onPress={() => save.mutate()} loading={save.isPending} disabled={!f.testName.trim() || !f.valueText.trim() || !dateOk} />
    </Sheet>
  );
}
