import type { WoundCaseDetail, WoundFollowUp, WoundImage, WoundSimilarCase } from '@ghayarly/shared';
import { radii, spacing } from '@ghayarly/tokens';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { MedicalDisclaimer } from '@/features/compliance/Safety';
import { api } from '@/lib/api';
import { confirmDestructive } from '@/lib/confirm';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Badge, Button, Card, Chip, Icon, Notice, PressableScale, Section, Sheet, Text, useToast, type Tone } from '@/ui';
import { useInvalidateWounds, woundErrorKey } from './hooks';
import { cameraAvailable, pickWoundPhoto, woundPhotosAvailable } from './pick';
import { ClinicianReviewSheet, ObservationSheet, TreatmentSheet } from './Sheets';
import { WoundPhoto } from './WoundPhoto';

const PLAN_TONE: Record<WoundFollowUp['status'], Tone> = { DONE: 'success', DUE: 'accent', UPCOMING: 'neutral', MISSED: 'warning' };
const SOURCE_TONE: Record<string, Tone> = { PROFESSIONALLY_VERIFIED: 'success', PATIENT_REPORTED: 'info', CAREGIVER_REPORTED: 'info' };

function PlanStrip({ plan }: { plan: WoundFollowUp[] }) {
  const { t, locale } = useI18n();
  if (!plan.length) return null;
  return (
    <Section title={t('wounds.planTitle')} testID="wound-plan">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {plan.map((p) => (
          <View key={p.day} testID={`wound-plan-${p.day}-${p.status}`} style={{ gap: 2, alignItems: 'center' }}>
            <Badge label={`${t('wounds.photoDay', { day: p.day })} · ${t(`wounds.plan_${p.status}`)}`} tone={PLAN_TONE[p.status]} />
            <Text variant="caption" color="textTertiary">{formatDate(p.date, locale)}</Text>
          </View>
        ))}
      </View>
    </Section>
  );
}

function Guidance() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <Card style={{ gap: spacing.sm }}>
      <PressableScale accessibilityRole="button" accessibilityLabel={t('wounds.guidanceTitle')} onPress={() => setOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Icon name="mci:camera-outline" color="primary" />
        <Text variant="callout" weight="semibold" style={{ flex: 1 }}>{t('wounds.guidanceTitle')}</Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} color="textTertiary" />
      </PressableScale>
      {open ? (['guidance1', 'guidance2', 'guidance3', 'guidance4', 'guidance5'] as const).map((k) => <Text key={k} variant="footnote" color="textSecondary">{`• ${t(`wounds.${k}`)}`}</Text>) : null}
    </Card>
  );
}

function PhotoSheet({ image, onClose }: { image: WoundImage | null; onClose: () => void }) {
  const { t, locale } = useI18n();
  const invalidate = useInvalidateWounds();
  const remove = useMutation({
    mutationFn: (id: string) => api.wounds.removeImage(id),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });
  return (
    <Sheet visible={Boolean(image)} onClose={onClose} title={image ? t('wounds.photoDay', { day: image.day }) : ''} testID="wound-photo-sheet">
      {image ? (
        <>
          <WoundPhoto imageId={image.id} label={t('wounds.photoDay', { day: image.day })} aspect={image.width / image.height} />
          <Text variant="footnote" color="textSecondary">
            {formatDate(image.capturedAt, locale)} · {t(`wounds.captured_${image.capturedAtSource}`)} · {t(`wounds.photoBy_${image.uploaderRole}`)}
          </Text>
          {image.metadataRemoved.length ? <Badge label={t('wounds.metadataRemoved')} tone="success" icon="mci:shield-check-outline" /> : null}
          {image.note ? <Text variant="footnote">{image.note}</Text> : null}
          {remove.error ? <Notice tone="danger" body={t(woundErrorKey(remove.error))} /> : null}
          {image.canDelete ? (
            <Button
              testID="wound-photo-delete"
              label={t('wounds.deletePhoto')}
              variant="ghost"
              icon="trash-2"
              loading={remove.isPending}
              onPress={() => confirmDestructive(t('wounds.deletePhotoConfirm'), { cancel: t('common.cancel'), confirm: t('common.remove') }, () => remove.mutate(image.id))}
            />
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}

function Compare({ images }: { images: WoundImage[] }) {
  const { t } = useI18n();
  const [from, setFrom] = useState(images[0]!.id);
  const [to, setTo] = useState(images.at(-1)!.id);
  useEffect(() => {
    setFrom(images[0]!.id);
    setTo(images.at(-1)!.id);
  }, [images]);
  const a = images.find((i) => i.id === from) ?? images[0]!;
  const b = images.find((i) => i.id === to) ?? images.at(-1)!;
  const pick = (current: string, set: (id: string) => void, testID: string) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
      {images.map((i) => <Chip key={i.id} testID={`${testID}-${i.day}`} label={t('wounds.photoDay', { day: i.day })} selected={current === i.id} onPress={() => set(i.id)} />)}
    </View>
  );
  return (
    <Section title={t('wounds.compareTitle')} testID="wound-compare">
      <Card style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="caption" weight="semibold" color="textSecondary">{`${t('wounds.compareFrom')} · ${t('wounds.photoDay', { day: a.day })}`}</Text>
            <WoundPhoto imageId={a.id} label={t('wounds.photoDay', { day: a.day })} testID="wound-compare-from" />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="caption" weight="semibold" color="textSecondary">{`${t('wounds.compareTo')} · ${t('wounds.photoDay', { day: b.day })}`}</Text>
            <WoundPhoto imageId={b.id} label={t('wounds.photoDay', { day: b.day })} testID="wound-compare-to" />
          </View>
        </View>
        {pick(from, setFrom, 'wound-compare-from-pick')}
        {pick(to, setTo, 'wound-compare-to-pick')}
        <Text variant="caption" color="textTertiary" testID="wound-compare-note">{t('wounds.compareNote')}</Text>
      </Card>
    </Section>
  );
}

function Measurements({ wound }: { wound: WoundCaseDetail }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const max = Math.max(1, ...wound.measurements.map((m) => m.areaMm2 ?? 0));
  return (
    <Section title={t('wounds.measurementsTitle')} testID="wound-measurements">
      <Card style={{ gap: spacing.sm }}>
        {wound.measurements.length === 0 ? <Text variant="footnote" color="textTertiary">{t('wounds.measurementsEmpty')}</Text> : null}
        {wound.measurements.map((m, i) => (
          <View key={i} style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
              <Text variant="footnote" weight="semibold">{t('wounds.photoDay', { day: m.day })}</Text>
              <Text variant="caption" color="textTertiary">{formatDate(m.observedOn, locale)}</Text>
              <Badge label={t(`wounds.source_${m.provenance}`)} tone={SOURCE_TONE[m.provenance] ?? 'neutral'} />
            </View>
            <Text variant="caption" color="textSecondary">
              {[m.lengthMm != null && m.widthMm != null ? t('wounds.size', { length: m.lengthMm, width: m.widthMm }) : null, m.areaMm2 != null ? t('wounds.area', { value: m.areaMm2 }) : null, m.painScore != null ? t('wounds.pain', { value: m.painScore }) : null]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {m.areaMm2 != null ? <View style={{ height: 8, width: `${Math.max(4, (m.areaMm2 / max) * 100)}%`, borderRadius: radii.pill, backgroundColor: m.provenance === 'PROFESSIONALLY_VERIFIED' ? colors.success : colors.primary }} /> : null}
          </View>
        ))}
        <Text variant="caption" color="textTertiary">{t('wounds.measurementsNote')}</Text>
      </Card>
    </Section>
  );
}

function Similar({ wound }: { wound: WoundCaseDetail }) {
  const { t } = useI18n();
  const q = useMutation({ mutationFn: () => api.wounds.similar(wound.id) });
  const rows: WoundSimilarCase[] = q.data ?? [];
  return (
    <Section title={t('wounds.similarTitle')} testID="wound-similar">
      <Card style={{ gap: spacing.sm }}>
        <Text variant="footnote" color="textSecondary">{t('wounds.similarBody')}</Text>
        {q.error ? <Notice tone="info" body={woundErrorKey(q.error) === 'wounds.error_FEATURE_DISABLED' ? t('wounds.similarOff') : t(woundErrorKey(q.error))} /> : null}
        {q.isSuccess && !rows.length ? <Text variant="footnote" color="textTertiary">{t('wounds.similarEmpty')}</Text> : null}
        {rows.map((r) => (
          <View key={r.ref} style={{ gap: 2 }}>
            <Text variant="footnote" weight="semibold">{`${r.ref} · ${t(`wounds.category_${r.category}`)}`}</Text>
            <Text variant="caption" color="textSecondary">
              {t('wounds.similarRow', { region: t(`wounds.region_${r.region as 'FOOT'}`), ageBand: r.ageBand.replace('_PLUS', '+').replace('_', '–'), days: r.followUpDays ?? 0 })}
              {r.outcome ? ` · ${t(`wounds.outcome_${r.outcome}`)}` : ''}
            </Text>
          </View>
        ))}
        <Button testID="wound-similar-show" label={t('wounds.similarShow')} variant="secondary" size="sm" fullWidth={false} icon="search" loading={q.isPending} onPress={() => q.mutate()} />
      </Card>
    </Section>
  );
}

/** The whole wound: status, plan, photos, comparison, measurements, notes, treatments (patient and clinician views). */
export function WoundCaseView({ wound }: { wound: WoundCaseDetail }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const toast = useToast();
  const router = useRouter();
  const invalidate = useInvalidateWounds();
  const [photo, setPhoto] = useState<WoundImage | null>(null);
  const [observing, setObserving] = useState(false);
  const [treating, setTreating] = useState(false);
  const [review, setReview] = useState<'category' | 'outcome' | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const clinician = wound.access.asClinician;

  const upload = useMutation({
    mutationFn: async (source: 'camera' | 'library') => {
      const r = await pickWoundPhoto(source);
      if (!r) return null;
      if (!r.ok) {
        setPickError(r.reason === 'unavailable' ? t('wounds.photoUnavailable') : r.reason === 'tooLarge' ? t('wounds.error_IMAGE_TOO_LARGE') : r.reason === 'unsupported' ? t('wounds.error_IMAGE_TYPE_INVALID') : t('wounds.error_IMAGE_UNREADABLE'));
        return null;
      }
      setPickError(null);
      return api.wounds.upload(wound.id, { contentType: r.photo.contentType, dataBase64: r.photo.base64, ...(r.photo.capturedAt ? { capturedAt: r.photo.capturedAt } : {}) });
    },
    onSuccess: async (detail) => {
      if (!detail) return;
      await invalidate();
      const added = detail.images.at(-1);
      const tips = added?.quality.warnings.map((w) => t(`wounds.warning_${w}`)) ?? [];
      toast(tips.length ? t('wounds.photoTips', { tips: tips.join(locale === 'ar' ? '، ' : ', ') }) : t('wounds.photoSaved'));
    },
  });
  const update = useMutation({ mutationFn: (status: 'OPEN' | 'CLOSED') => api.wounds.update(wound.id, { status }), onSuccess: () => invalidate() });
  const remove = useMutation({
    mutationFn: () => api.wounds.remove(wound.id),
    onSuccess: async () => {
      await invalidate();
      router.back();
    },
  });
  const endTreatment = useMutation({ mutationFn: (id: string) => api.wounds.updateTreatment(id, { endedOn: new Date().toISOString().slice(0, 10) }), onSuccess: () => invalidate() });
  const removeObservation = useMutation({ mutationFn: (id: string) => api.wounds.removeObservation(id), onSuccess: () => invalidate() });
  const canAdd = wound.access.canEdit && wound.status === 'OPEN';

  return (
    <>
      <Card style={{ gap: spacing.sm }} testID="wound-status">
        <Text variant="footnote" color="textSecondary">
          {t(`wounds.site_${wound.bodySite}`)}
          {wound.bodySide !== 'NOT_APPLICABLE' ? ` · ${t(`wounds.side_${wound.bodySide}`)}` : ''}
          {wound.onsetDate ? ` · ${formatDate(wound.onsetDate, locale)}` : ''}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          <Badge label={t('wounds.reported', { category: t(`wounds.category_${wound.reportedCategory}`) })} tone="info" />
          {wound.clinical ? (
            <Badge testID="wound-clinical-badge" label={t('wounds.reviewed', { category: t(`wounds.category_${wound.clinical.category}`) })} tone="success" icon="check" />
          ) : (
            <Badge testID="wound-not-reviewed" label={t('wounds.notReviewed')} tone="neutral" />
          )}
          {wound.outcome ? <Badge testID="wound-outcome-badge" label={t('wounds.outcomeBadge', { outcome: t(`wounds.outcome_${wound.outcome.outcome}`) })} tone="success" /> : null}
          {wound.status === 'CLOSED' ? <Badge label={t('wounds.closed')} tone="neutral" /> : null}
        </View>
        <Notice tone="info" icon="mci:robot-off-outline" testID="wound-ai-off" body={t('wounds.aiOff')} />
      </Card>

      {clinician ? (
        <Card style={{ gap: spacing.sm }} testID="wound-clinician-actions">
          <Text variant="callout" weight="semibold">{t('wounds.clinicianTitle')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <Button testID="wound-confirm-category" label={t('wounds.confirmCategory')} size="sm" fullWidth={false} icon="check-circle" onPress={() => setReview('category')} />
            <Button testID="wound-record-outcome" label={t('wounds.recordOutcome')} variant="secondary" size="sm" fullWidth={false} icon="flag" disabled={!wound.clinical} onPress={() => setReview('outcome')} />
          </View>
        </Card>
      ) : null}

      <PlanStrip plan={wound.plan} />

      {canAdd ? (
        woundPhotosAvailable() ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {cameraAvailable() ? (
              <View style={{ flex: 1 }}>
                <Button testID="wound-take-photo" label={t('wounds.takePhoto')} icon="camera" loading={upload.isPending && upload.variables === 'camera'} onPress={() => upload.mutate('camera')} />
              </View>
            ) : null}
            <View style={{ flex: 1 }}>
              <Button testID="wound-choose-photo" label={t('wounds.choosePhoto')} icon="image" variant={cameraAvailable() ? 'secondary' : 'primary'} loading={upload.isPending && upload.variables === 'library'} onPress={() => upload.mutate('library')} />
            </View>
          </View>
        ) : (
          <Notice tone="info" body={t('wounds.photoUnavailable')} />
        )
      ) : null}
      {pickError ? <Notice tone="danger" body={pickError} /> : null}
      {upload.error ? <Notice tone="danger" testID="wound-upload-error" body={t(woundErrorKey(upload.error))} /> : null}
      {canAdd ? <Guidance /> : null}

      <Section title={t('wounds.photos', { count: wound.images.length })} testID="wound-photos">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {wound.images.map((i) => (
            <PressableScale key={i.id} testID={`wound-photo-day-${i.day}`} accessibilityRole="button" accessibilityLabel={t('wounds.photoDay', { day: i.day })} onPress={() => setPhoto(i)} style={{ width: '31%', gap: 4 }}>
              <WoundPhoto imageId={i.id} label={t('wounds.photoDay', { day: i.day })} aspect={1} />
              <Text variant="caption" weight="semibold">{t('wounds.photoDay', { day: i.day })}</Text>
              <Text variant="caption" color="textTertiary">{formatDate(i.capturedAt, locale)}</Text>
            </PressableScale>
          ))}
        </View>
      </Section>

      {wound.images.length >= 2 ? <Compare images={wound.images} /> : null}
      <Measurements wound={wound} />

      <Section title={t('wounds.observationsTitle')} testID="wound-observations" action={canAdd ? <Button testID="wound-add-observation" label={t('wounds.addObservation')} icon="plus" variant="ghost" size="sm" fullWidth={false} onPress={() => setObserving(true)} /> : undefined}>
        <Card padded={false}>
          {wound.observations.length === 0 ? (
            <View style={{ padding: spacing.lg }}>
              <Text variant="footnote" color="textTertiary">—</Text>
            </View>
          ) : (
            [...wound.observations].reverse().map((o, idx) => (
              <View key={o.id} style={{ padding: spacing.lg, gap: 4, borderTopWidth: idx ? 1 : 0, borderTopColor: colors.divider }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
                  <Text variant="footnote" weight="semibold">{o.day ? t('wounds.photoDay', { day: o.day }) : formatDate(o.observedOn, locale)}</Text>
                  <Badge label={t(`wounds.source_${o.provenance}`)} tone={SOURCE_TONE[o.provenance] ?? 'neutral'} />
                  {o.mine ? (
                    <PressableScale accessibilityRole="button" accessibilityLabel={t('common.remove')} onPress={() => confirmDestructive(t('wounds.deleteNoteConfirm'), { cancel: t('common.cancel'), confirm: t('common.remove') }, () => removeObservation.mutate(o.id))} style={{ marginStart: 'auto', minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="trash-2" size={16} color="textTertiary" />
                    </PressableScale>
                  ) : null}
                </View>
                <Text variant="caption" color="textSecondary">
                  {[o.painScore != null ? t('wounds.pain', { value: o.painScore }) : null, o.exudate ? `${t('wounds.exudate')}: ${t(`wounds.exudate_${o.exudate}`)}` : null, ...o.signs.map((s) => t(`wounds.sign_${s}`))].filter(Boolean).join(' · ')}
                </Text>
                {o.note ? <Text variant="footnote">{o.note}</Text> : null}
              </View>
            ))
          )}
        </Card>
      </Section>

      <Section title={t('wounds.treatmentsTitle')} testID="wound-treatments" action={canAdd ? <Button testID="wound-add-treatment" label={t('wounds.addTreatment')} icon="plus" variant="ghost" size="sm" fullWidth={false} onPress={() => setTreating(true)} /> : undefined}>
        <Card padded={false}>
          {wound.treatments.length === 0 ? (
            <View style={{ padding: spacing.lg }}>
              <Text variant="footnote" color="textTertiary">—</Text>
            </View>
          ) : (
            wound.treatments.map((tr, idx) => (
              <View key={tr.id} testID={`wound-treatment-${tr.kind}`} style={{ padding: spacing.lg, gap: 4, borderTopWidth: idx ? 1 : 0, borderTopColor: colors.divider }}>
                <Text variant="footnote" weight="semibold">{tr.product ? (locale === 'en' ? tr.product.nameEn : tr.product.nameAr) : tr.description}</Text>
                <Text variant="caption" color="textSecondary">
                  {[t(`wounds.kind_${tr.kind}`), tr.frequency, `${formatDate(tr.startedOn, locale)} → ${tr.endedOn ? formatDate(tr.endedOn, locale) : t('wounds.ongoing')}`].filter(Boolean).join(' · ')}
                </Text>
                <Badge label={t(`wounds.source_${tr.provenance}`)} tone={SOURCE_TONE[tr.provenance] ?? 'neutral'} />
                {!tr.endedOn && wound.access.canEdit ? <Button label={t('wounds.endTreatment')} variant="ghost" size="sm" fullWidth={false} icon="square" onPress={() => endTreatment.mutate(tr.id)} /> : null}
              </View>
            ))
          )}
        </Card>
        <Text variant="caption" color="textTertiary">{t('wounds.treatmentNote')}</Text>
      </Section>

      {clinician ? <Similar wound={wound} /> : null}

      {!clinician && wound.access.canEdit ? (
        <Section title={t('wounds.settingsTitle')}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <Button testID="wound-close" label={wound.status === 'OPEN' ? t('wounds.closeCase') : t('wounds.reopenCase')} variant="secondary" size="sm" fullWidth={false} icon={wound.status === 'OPEN' ? 'archive' : 'rotate-ccw'} loading={update.isPending} onPress={() => update.mutate(wound.status === 'OPEN' ? 'CLOSED' : 'OPEN')} />
            {wound.access.canDelete ? (
              <Button testID="wound-delete" label={t('wounds.deleteCase')} variant="ghost" size="sm" fullWidth={false} icon="trash-2" loading={remove.isPending} onPress={() => confirmDestructive(t('wounds.deleteCaseConfirm'), { cancel: t('common.cancel'), confirm: t('common.remove') }, () => remove.mutate())} />
            ) : null}
          </View>
        </Section>
      ) : null}

      <MedicalDisclaimer />
      <PhotoSheet image={photo} onClose={() => setPhoto(null)} />
      <ObservationSheet wound={wound} visible={observing} onClose={() => setObserving(false)} clinician={clinician} />
      <TreatmentSheet wound={wound} visible={treating} onClose={() => setTreating(false)} />
      <ClinicianReviewSheet wound={wound} mode={review} onClose={() => setReview(null)} />
    </>
  );
}
