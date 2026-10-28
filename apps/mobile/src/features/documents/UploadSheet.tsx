import { DOCUMENT_KINDS } from '@ghayarly/shared';
import { useMutation } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { isValidIsoDate, maskDate } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { Button, Notice, Segmented, Sheet, Text, TextField, useToast } from '@/ui';
import { documentErrorKey, useInvalidateDocuments } from './hooks';
import { pickDocument, type PickedDocument } from './pick';

/** Choose a report, name it, and store it with the profile (then open it to read or check results). */
export function UploadSheet({ patientId, visible, onClose }: { patientId: string; visible: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const invalidate = useInvalidateDocuments();
  const [file, setFile] = useState<PickedDocument | null>(null);
  const [pickError, setPickError] = useState<'tooLarge' | 'unsupported' | 'readFailed' | null>(null);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<(typeof DOCUMENT_KINDS)[number]>('LAB_REPORT');
  const [date, setDate] = useState('');
  useEffect(() => {
    if (!visible) return;
    setFile(null);
    setPickError(null);
    setTitle('');
    setKind('LAB_REPORT');
    setDate('');
  }, [visible]);
  const choose = async () => {
    const r = await pickDocument();
    if (!r) return;
    if (!r.ok) {
      setPickError(r.reason);
      return;
    }
    setPickError(null);
    setFile(r.file);
    setTitle((v) => v || r.file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 120));
  };
  const upload = useMutation({
    mutationFn: () => api.documents.upload({ patientId, title: title.trim(), kind, contentType: file!.contentType, dataBase64: file!.base64, documentDate: date || null }),
    onSuccess: async (doc) => {
      await invalidate();
      toast(t('common.saved'));
      onClose();
      router.push(`/patient/documents/${doc.id}` as Href);
    },
  });
  const dateOk = !date || isValidIsoDate(date);
  return (
    <Sheet visible={visible} onClose={onClose} title={t('documents.uploadTitle')} testID="document-upload-sheet">
      <Notice tone="info" icon="mci:shield-lock-outline" body={t('documents.uploadHint')} />
      <Button testID="document-choose" label={t('documents.chooseFile')} icon="mci:paperclip" variant="secondary" onPress={() => void choose()} />
      {file ? <Text variant="footnote" color="textSecondary" testID="document-chosen">{t('documents.chosen', { name: file.name })}</Text> : null}
      {pickError ? <Notice tone="danger" body={t(`documents.${pickError}`)} /> : null}
      <TextField testID="document-title" label={t('documents.docTitle')} value={title} onChangeText={setTitle} maxLength={120} />
      <Text variant="footnote" weight="semibold" color="textSecondary">{t('documents.kind')}</Text>
      <Segmented testID="document-kind" options={DOCUMENT_KINDS.map((k) => ({ value: k, label: t(`documents.kind_${k}`) }))} value={kind} onChange={setKind} />
      <TextField testID="document-date" label={t('documents.documentDate')} optional placeholder="YYYY-MM-DD" value={date} onChangeText={(v) => setDate(maskDate(v))} keyboardType="number-pad" ltr />
      {upload.error ? <Notice tone="danger" body={t(documentErrorKey(upload.error))} /> : null}
      <Button testID="document-upload" label={t('documents.save')} icon="upload" onPress={() => upload.mutate()} loading={upload.isPending} disabled={!file || !title.trim() || !dateOk} />
    </Sheet>
  );
}
