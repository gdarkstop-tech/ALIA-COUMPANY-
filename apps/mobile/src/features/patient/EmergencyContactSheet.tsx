import type { PatientSummary } from '@ghayarly/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { EG_PHONE_RE, normalizeEgyptPhone } from '@/features/auth/authErrors';
import { api, errorKey } from '@/lib/api';
import { useI18n } from '@/providers/i18n';
import { Button, Notice, Sheet, TextField, useToast } from '@/ui';

export function EmergencyContactSheet({ patient, visible, onClose }: { patient: PatientSummary; visible: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(patient.emergencyContactName ?? '');
  const [phone, setPhone] = useState(patient.emergencyContactPhone ?? '');
  const [relation, setRelation] = useState(patient.emergencyContactRelation ?? '');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setName(patient.emergencyContactName ?? '');
    setPhone(patient.emergencyContactPhone ?? '');
    setRelation(patient.emergencyContactRelation ?? '');
    setError(null);
  }, [patient, visible]);
  const save = useMutation({
    mutationFn: () =>
      api.patients.update(patient.id, {
        emergencyContactName: name.trim() || null,
        emergencyContactPhone: phone ? normalizeEgyptPhone(phone) : null,
        emergencyContactRelation: relation.trim() || null,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['patients'] });
      toast(t('common.saved'));
      onClose();
    },
    onError: (e) => setError(t(errorKey(e))),
  });
  return (
    <Sheet visible={visible} onClose={onClose} title={t('health.emergencyContact')}>
      {error ? <Notice tone="danger" body={error} /> : null}
      <TextField label={t('onboarding.emergencyName')} value={name} onChangeText={setName} />
      <TextField label={t('onboarding.emergencyPhone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" ltr />
      <TextField label={t('onboarding.emergencyRelation')} optional value={relation} onChangeText={setRelation} />
      <Button
        label={t('common.save')}
        loading={save.isPending}
        onPress={() => {
          if (phone && !EG_PHONE_RE.test(normalizeEgyptPhone(phone))) return setError(t('errors.invalidPhone'));
          save.mutate();
        }}
      />
    </Sheet>
  );
}
