import { CREDENTIAL_KINDS, REQUIRED_CREDENTIALS, type CredentialKind } from '@ghayarly/shared';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useMyProvider, useSetMyProvider } from '@/features/provider/hooks';
import { api, errorKey } from '@/lib/api';
import { isValidIsoDate, maskDate } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { Button, Header, Notice, Screen, Select, TextField } from '@/ui';

export default function AddCredential() {
  const { t } = useI18n();
  const router = useRouter();
  const mine = useMyProvider();
  const setMine = useSetMyProvider();
  const type = mine.data?.profile?.providerType ?? 'DOCTOR';
  const relevant = CREDENTIAL_KINDS.filter((k) => (type === 'DOCTOR' ? !k.startsWith('NURSING') : !['MEDICAL_LICENSE', 'MEDICAL_DEGREE', 'SPECIALTY_BOARD'].includes(k)));
  const missing = REQUIRED_CREDENTIALS[type].find((k) => !mine.data?.credentials.some((c) => c.kind === k && c.status !== 'REJECTED'));
  const [kind, setKind] = useState<CredentialKind | null>(missing ?? null);
  const [issuer, setIssuer] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => api.provider.addCredential({ kind: kind!, issuer: issuer.trim(), identifier: identifier.trim(), issuedOn: issuedOn || null, expiresOn: expiresOn || null }),
    onSuccess: async (d) => {
      await setMine(d);
      router.back();
    },
    onError: (e) => setError(t(errorKey(e))),
  });
  const submit = () => {
    if (!kind || !issuer.trim() || !identifier.trim()) return setError(t('errors.requiredField'));
    if ((issuedOn && !isValidIsoDate(issuedOn)) || (expiresOn && !isValidIsoDate(expiresOn))) return setError(t('errors.invalidDate'));
    add.mutate();
  };
  return (
    <Screen header={<Header back title={t('provider.addCredential')} />} footer={<Button testID="credential-save" label={t('common.save')} onPress={submit} loading={add.isPending} />}>
      {error ? <Notice tone="danger" body={error} /> : null}
      <Select testID="credential-kind" label={t('provider.credentialKind')} value={kind} onChange={setKind} options={relevant.map((k) => ({ value: k, label: t(`provider.cred_${k}`), description: REQUIRED_CREDENTIALS[type].includes(k) ? t('common.required') : undefined }))} />
      <TextField testID="credential-issuer" label={t('provider.credentialIssuer')} value={issuer} onChangeText={setIssuer} />
      <TextField testID="credential-identifier" label={t('provider.credentialIdentifier')} value={identifier} onChangeText={setIdentifier} autoCapitalize="characters" ltr />
      <TextField label={t('provider.issuedOn')} optional placeholder="YYYY-MM-DD" value={issuedOn} onChangeText={(v) => setIssuedOn(maskDate(v))} keyboardType="number-pad" ltr />
      <TextField label={t('provider.expiresOn')} optional placeholder="YYYY-MM-DD" value={expiresOn} onChangeText={(v) => setExpiresOn(maskDate(v))} keyboardType="number-pad" ltr />
      <Notice tone="info" icon="upload-cloud" body={t('provider.documentNotUploaded')} />
    </Screen>
  );
}
