import {
  WOUND_BODY_SIDES,
  WOUND_BODY_SITES,
  WOUND_CATEGORIES,
  WOUND_EXUDATE_LEVELS,
  WOUND_OUTCOMES,
  WOUND_REPORTED_CATEGORIES,
  WOUND_SIGNS,
  WOUND_SIGNS_NEEDING_CLINICIAN,
  WOUND_TREATMENT_KINDS,
  type WoundCaseDetail,
  type WoundSign,
} from '@ghayarly/shared';
import { spacing } from '@ghayarly/tokens';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { isValidIsoDate, maskDate } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { Button, Chip, Notice, Segmented, Select, Sheet, Text, TextField, useToast } from '@/ui';
import { useInvalidateWounds, woundErrorKey } from './hooks';

const today = () => new Date().toISOString().slice(0, 10);
const num = (v: string) => (v.trim() ? Number(v.replace(',', '.')) : null);
const FOLLOW_UP_CHOICES = [3, 7, 14, 21, 28];

export function NewWoundSheet({ patientId, visible, onClose }: { patientId: string; visible: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const invalidate = useInvalidateWounds();
  const [label, setLabel] = useState('');
  const [site, setSite] = useState<(typeof WOUND_BODY_SITES)[number] | null>(null);
  const [side, setSide] = useState<(typeof WOUND_BODY_SIDES)[number]>('NOT_APPLICABLE');
  const [category, setCategory] = useState<(typeof WOUND_REPORTED_CATEGORIES)[number] | null>(null);
  const [onset, setOnset] = useState('');
  const [days, setDays] = useState<number[]>([3, 7]);
  useEffect(() => {
    if (!visible) return;
    setLabel('');
    setSite(null);
    setSide('NOT_APPLICABLE');
    setCategory(null);
    setOnset('');
    setDays([3, 7]);
  }, [visible]);
  const create = useMutation({
    mutationFn: () => api.wounds.create({ patientId, label: label.trim(), bodySite: site!, bodySide: side, reportedCategory: category!, onsetDate: onset || null, followUpDays: days }),
    onSuccess: async (w) => {
      await invalidate();
      onClose();
      router.push(`/patient/wounds/${w.id}` as Href);
    },
  });
  return (
    <Sheet visible={visible} onClose={onClose} title={t('wounds.newWoundTitle')} testID="wound-new-sheet">
      <TextField testID="wound-label" label={t('wounds.label')} value={label} onChangeText={setLabel} maxLength={60} />
      <Select testID="wound-site" label={t('wounds.bodySite')} value={site} options={WOUND_BODY_SITES.map((s) => ({ value: s, label: t(`wounds.site_${s}`) }))} onChange={setSite} />
      <Text variant="footnote" weight="semibold" color="textSecondary">{t('wounds.bodySide')}</Text>
      <Segmented testID="wound-side" options={WOUND_BODY_SIDES.map((s) => ({ value: s, label: t(`wounds.side_${s}`) }))} value={side} onChange={setSide} />
      <Select testID="wound-category" label={t('wounds.reportedCategory')} value={category} options={WOUND_REPORTED_CATEGORIES.map((c) => ({ value: c, label: t(`wounds.category_${c}`) }))} onChange={setCategory} />
      <Text variant="caption" color="textTertiary">{t('wounds.reportedHint')}</Text>
      <TextField testID="wound-onset" label={t('wounds.onsetDate')} optional placeholder="YYYY-MM-DD" value={onset} onChangeText={(v) => setOnset(maskDate(v))} keyboardType="number-pad" ltr />
      <Text variant="footnote" weight="semibold" color="textSecondary">{t('wounds.followUp')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {FOLLOW_UP_CHOICES.map((d) => (
          <Chip key={d} testID={`wound-followup-${d}`} label={t('wounds.photoDay', { day: d })} selected={days.includes(d)} onPress={() => setDays((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d].sort((p, q) => p - q)))} />
        ))}
      </View>
      <Text variant="caption" color="textTertiary">{t('wounds.followUpHint')}</Text>
      {create.error ? <Notice tone="danger" body={t(woundErrorKey(create.error))} /> : null}
      <Button testID="wound-create" label={t('wounds.create')} icon="plus" loading={create.isPending} disabled={!label.trim() || !site || !category || (Boolean(onset) && !isValidIsoDate(onset))} onPress={() => create.mutate()} />
    </Sheet>
  );
}

export function ObservationSheet({ wound, visible, onClose, clinician }: { wound: WoundCaseDetail; visible: boolean; onClose: () => void; clinician?: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const invalidate = useInvalidateWounds();
  const [date, setDate] = useState(today());
  const [pain, setPain] = useState<number | null>(null);
  const [exudate, setExudate] = useState<(typeof WOUND_EXUDATE_LEVELS)[number] | null>(null);
  const [signs, setSigns] = useState<WoundSign[]>([]);
  const [length, setLength] = useState('');
  const [width, setWidth] = useState('');
  const [depth, setDepth] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!visible) return;
    setDate(today());
    setPain(null);
    setExudate(null);
    setSigns([]);
    setLength('');
    setWidth('');
    setDepth('');
    setNote('');
  }, [visible]);
  const save = useMutation({
    mutationFn: () => api.wounds.addObservation(wound.id, { observedOn: date, painScore: pain, exudate, signs, lengthMm: num(length), widthMm: num(width), depthMm: num(depth), note: note.trim() || null }),
    onSuccess: async () => {
      await invalidate();
      toast(t('common.saved'));
      onClose();
    },
  });
  const urgent = signs.some((s) => WOUND_SIGNS_NEEDING_CLINICIAN.includes(s));
  const any = pain != null || exudate || signs.length || length || width || depth || note.trim();
  return (
    <Sheet visible={visible} onClose={onClose} title={t('wounds.observationTitle')} testID="wound-observation-sheet">
      <TextField testID="wound-obs-date" label={t('wounds.observedOn')} value={date} onChangeText={(v) => setDate(maskDate(v))} keyboardType="number-pad" ltr />
      <Text variant="footnote" weight="semibold" color="textSecondary">{t('wounds.painScore')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {Array.from({ length: 11 }, (_, i) => <Chip key={i} testID={`wound-pain-${i}`} label={String(i)} selected={pain === i} onPress={() => setPain(pain === i ? null : i)} />)}
      </View>
      <Text variant="footnote" weight="semibold" color="textSecondary">{t('wounds.exudate')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {WOUND_EXUDATE_LEVELS.map((e) => <Chip key={e} label={t(`wounds.exudate_${e}`)} selected={exudate === e} onPress={() => setExudate(exudate === e ? null : e)} />)}
      </View>
      <Text variant="footnote" weight="semibold" color="textSecondary">{t('wounds.signs')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {WOUND_SIGNS.map((s) => <Chip key={s} testID={`wound-sign-${s}`} label={t(`wounds.sign_${s}`)} selected={signs.includes(s)} onPress={() => setSigns((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))} />)}
      </View>
      {urgent && !clinician ? <Notice tone="warning" testID="wound-needs-clinician" body={t('wounds.needsClinician')} /> : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1 }}><TextField testID="wound-length" label={t('wounds.lengthMm')} optional value={length} onChangeText={setLength} keyboardType="decimal-pad" ltr /></View>
        <View style={{ flex: 1 }}><TextField testID="wound-width" label={t('wounds.widthMm')} optional value={width} onChangeText={setWidth} keyboardType="decimal-pad" ltr /></View>
      </View>
      <TextField label={t('wounds.depthMm')} optional value={depth} onChangeText={setDepth} keyboardType="decimal-pad" ltr />
      <TextField testID="wound-obs-note" label={t('wounds.note')} optional value={note} onChangeText={setNote} multiline maxLength={1000} />
      {save.error ? <Notice tone="danger" body={t(woundErrorKey(save.error))} /> : null}
      <Button testID="wound-obs-save" label={t('wounds.save')} icon="check" loading={save.isPending} disabled={!any || !isValidIsoDate(date)} onPress={() => save.mutate()} />
    </Sheet>
  );
}

export function TreatmentSheet({ wound, visible, onClose }: { wound: WoundCaseDetail; visible: boolean; onClose: () => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const invalidate = useInvalidateWounds();
  const products = useQuery({ queryKey: ['store', 'products'], queryFn: () => api.store.products(), enabled: visible });
  const [kind, setKind] = useState<(typeof WOUND_TREATMENT_KINDS)[number] | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [frequency, setFrequency] = useState('');
  const [started, setStarted] = useState(today());
  useEffect(() => {
    if (!visible) return;
    setKind(null);
    setProductId(null);
    setDescription('');
    setFrequency('');
    setStarted(today());
  }, [visible]);
  const save = useMutation({
    mutationFn: () => api.wounds.addTreatment(wound.id, { kind, productId: kind === 'COMPANY_PRODUCT' ? productId : null, description: description.trim(), frequency: frequency.trim() || null, startedOn: started }),
    onSuccess: async () => {
      await invalidate();
      toast(t('common.saved'));
      onClose();
    },
  });
  const product = products.data?.find((p) => p.id === productId);
  return (
    <Sheet visible={visible} onClose={onClose} title={t('wounds.treatmentTitle')} testID="wound-treatment-sheet">
      <Notice tone="info" body={t('wounds.treatmentNote')} />
      <Select testID="wound-treatment-kind" label={t('wounds.kind')} value={kind} options={WOUND_TREATMENT_KINDS.map((k) => ({ value: k, label: t(`wounds.kind_${k}`) }))} onChange={setKind} />
      {kind === 'COMPANY_PRODUCT' ? (
        <Select
          testID="wound-treatment-product"
          label={t('wounds.product')}
          value={productId}
          options={(products.data ?? []).map((p) => ({ value: p.id, label: locale === 'en' ? p.nameEn : p.nameAr }))}
          onChange={(v) => {
            setProductId(v);
            const p = products.data?.find((x) => x.id === v);
            if (p && !description.trim()) setDescription(locale === 'en' ? p.nameEn : p.nameAr);
          }}
        />
      ) : null}
      <TextField testID="wound-treatment-description" label={t('wounds.description')} value={description} onChangeText={setDescription} maxLength={200} />
      <TextField label={t('wounds.frequency')} optional value={frequency} onChangeText={setFrequency} maxLength={60} />
      <TextField label={t('wounds.startedOn')} value={started} onChangeText={(v) => setStarted(maskDate(v))} keyboardType="number-pad" ltr />
      {save.error ? <Notice tone="danger" body={t(woundErrorKey(save.error))} /> : null}
      <Button
        testID="wound-treatment-save"
        label={t('wounds.save')}
        icon="check"
        loading={save.isPending}
        disabled={!kind || !description.trim() || !isValidIsoDate(started) || (kind === 'COMPANY_PRODUCT' && !product)}
        onPress={() => save.mutate()}
      />
    </Sheet>
  );
}

/** Clinician only: their own classification (never from a photo) and the outcome they confirm. */
export function ClinicianReviewSheet({ wound, mode, onClose }: { wound: WoundCaseDetail; mode: 'category' | 'outcome' | null; onClose: () => void }) {
  const { t } = useI18n();
  const invalidate = useInvalidateWounds();
  const [category, setCategory] = useState<(typeof WOUND_CATEGORIES)[number] | null>(null);
  const [diabetes, setDiabetes] = useState<'YES' | 'NO' | 'UNKNOWN'>('UNKNOWN');
  const [outcome, setOutcome] = useState<(typeof WOUND_OUTCOMES)[number] | null>(null);
  const [on, setOn] = useState(today());
  useEffect(() => {
    if (!mode) return;
    setCategory(wound.clinical?.category ?? null);
    setDiabetes(wound.clinical?.diabetes ?? 'UNKNOWN');
    setOutcome(wound.outcome?.outcome ?? null);
    setOn(today());
  }, [mode, wound]);
  const save = useMutation({
    mutationFn: () => (mode === 'category' ? api.wounds.confirm(wound.id, { category: category!, diabetes }) : api.wounds.outcome(wound.id, { outcome: outcome!, on })),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });
  return (
    <Sheet visible={mode !== null} onClose={onClose} title={mode === 'category' ? t('wounds.confirmCategory') : t('wounds.recordOutcome')} testID="wound-clinical-sheet">
      {mode === 'category' ? (
        <>
          <Select testID="wound-clinical-category" label={t('wounds.confirmCategory')} value={category} options={WOUND_CATEGORIES.map((c) => ({ value: c, label: t(`wounds.category_${c}`) }))} onChange={setCategory} />
          <Text variant="footnote" weight="semibold" color="textSecondary">{t('wounds.diabetes')}</Text>
          <Segmented options={(['YES', 'NO', 'UNKNOWN'] as const).map((d) => ({ value: d, label: t(`wounds.diabetes_${d}`) }))} value={diabetes} onChange={setDiabetes} />
        </>
      ) : (
        <>
          <Select testID="wound-clinical-outcome" label={t('wounds.recordOutcome')} value={outcome} options={WOUND_OUTCOMES.map((o) => ({ value: o, label: t(`wounds.outcome_${o}`) }))} onChange={setOutcome} />
          <TextField label={t('wounds.outcomeOn')} value={on} onChangeText={(v) => setOn(maskDate(v))} keyboardType="number-pad" ltr />
        </>
      )}
      {save.error ? <Notice tone="danger" body={t(woundErrorKey(save.error))} /> : null}
      <Button testID="wound-clinical-save" label={t('wounds.save')} icon="check" loading={save.isPending} disabled={mode === 'category' ? !category : !outcome || !isValidIsoDate(on)} onPress={() => save.mutate()} />
    </Sheet>
  );
}
