import type { HealthEntryKind } from '@ghayarly/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, errorKey } from '@/lib/api';
import { useI18n } from '@/providers/i18n';
import { Button, Notice, Sheet, TextField, useToast } from '@/ui';

const TITLES: Record<HealthEntryKind, 'health.allergies' | 'health.conditions' | 'health.medications' | 'health.surgeries'> = {
  ALLERGY: 'health.allergies',
  CONDITION: 'health.conditions',
  MEDICATION: 'health.medications',
  SURGERY: 'health.surgeries',
};

export function AddEntrySheet({ patientId, kind, onClose }: { patientId: string; kind: HealthEntryKind | null; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    setTitle('');
    setNote('');
  }, [kind]);
  const add = useMutation({
    mutationFn: () => api.patients.addHealthEntry(patientId, { kind: kind!, title: title.trim(), note: note.trim() || null }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['health-entries', patientId] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast(t('common.saved'));
      onClose();
    },
  });
  return (
    <Sheet visible={Boolean(kind)} onClose={onClose} title={kind ? t(TITLES[kind]) : ''} testID="add-entry-sheet">
      {add.error ? <Notice tone="danger" body={t(errorKey(add.error))} /> : null}
      <TextField testID="entry-title" label={t('health.entryTitle')} value={title} onChangeText={setTitle} autoFocus />
      <TextField label={t('health.entryNote')} optional value={note} onChangeText={setNote} />
      <Notice tone="info" body={t('health.reportedNotice')} />
      <Button testID="entry-save" label={t('common.save')} onPress={() => add.mutate()} loading={add.isPending} disabled={!title.trim()} />
    </Sheet>
  );
}
