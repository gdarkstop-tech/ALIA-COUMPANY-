import { GOVERNORATES, SPECIALTIES, type Governorate, type ProviderType, type Specialty, type UpsertProviderProfileBody } from '@ghayarly/shared';
import { spacing } from '@ghayarly/tokens';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18n } from '@/providers/i18n';
import { Button, Segmented, Select, Text, TextField } from '@/ui';

type Props = {
  providerType: ProviderType;
  initial?: Partial<UpsertProviderProfileBody>;
  busy?: boolean;
  submitLabel: string;
  onSubmit: (body: UpsertProviderProfileBody) => void;
};

export function ProviderProfileForm({ providerType, initial, busy, submitLabel, onSubmit }: Props) {
  const { t } = useI18n();
  const [nameAr, setNameAr] = useState(initial?.displayNameAr ?? '');
  const [nameEn, setNameEn] = useState(initial?.displayNameEn ?? '');
  const [gender, setGender] = useState<'FEMALE' | 'MALE'>(initial?.gender ?? 'FEMALE');
  const [specialty, setSpecialty] = useState<Specialty | null>(initial?.specialty ?? null);
  const [subspecialty, setSubspecialty] = useState(initial?.subspecialty ?? '');
  const [years, setYears] = useState(String(initial?.yearsExperience ?? ''));
  const [governorate, setGovernorate] = useState<Governorate | null>(initial?.governorate ?? null);
  const [city, setCity] = useState(initial?.city ?? '');
  const [affiliation, setAffiliation] = useState(initial?.currentAffiliation ?? '');
  const [previous, setPrevious] = useState(initial?.previousExperience ?? '');
  const [bioAr, setBioAr] = useState(initial?.bioAr ?? '');
  const [bioEn, setBioEn] = useState(initial?.bioEn ?? '');
  const [fee, setFee] = useState(initial?.feePiasters ? String(initial.feePiasters / 100) : '');
  const [skills, setSkills] = useState((initial?.skills ?? []).join(', '));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = () => {
    const e: Record<string, string> = {};
    if (!nameAr.trim()) e.nameAr = t('errors.requiredField');
    if (!nameEn.trim()) e.nameEn = t('errors.requiredField');
    const y = Number(years);
    if (!years || !Number.isInteger(y) || y < 0 || y > 60) e.years = t('errors.requiredField');
    if (!governorate) e.governorate = t('errors.requiredField');
    if (!city.trim()) e.city = t('errors.requiredField');
    if (providerType === 'DOCTOR' && !specialty) e.specialty = t('errors.requiredField');
    const feeNum = fee ? Number(fee) : null;
    if (fee && (!Number.isFinite(feeNum) || (feeNum ?? 0) < 0)) e.fee = t('errors.requiredField');
    setErrors(e);
    if (Object.keys(e).length) return;
    onSubmit({
      providerType,
      displayNameAr: nameAr.trim(),
      displayNameEn: nameEn.trim(),
      gender,
      specialty: providerType === 'DOCTOR' ? specialty : null,
      subspecialty: subspecialty.trim() || null,
      yearsExperience: y,
      governorate: governorate!,
      city: city.trim(),
      currentAffiliation: affiliation.trim() || null,
      previousExperience: previous.trim() || null,
      bioAr: bioAr.trim() || null,
      bioEn: bioEn.trim() || null,
      feePiasters: feeNum !== null ? Math.round(feeNum * 100) : null,
      skills: skills.split(/[,،]/).map((s) => s.trim()).filter(Boolean).slice(0, 20),
    });
  };

  return (
    <View style={{ gap: spacing.lg }}>
      <TextField testID="prov-name-ar" label={t('provider.nameAr')} value={nameAr} onChangeText={setNameAr} error={errors.nameAr} />
      <TextField testID="prov-name-en" label={t('provider.nameEn')} value={nameEn} onChangeText={setNameEn} error={errors.nameEn} ltr />
      <View style={{ gap: spacing.xs }}>
        <Text variant="footnote" weight="semibold" color="textSecondary">
          {t('provider.gender')}
        </Text>
        <Segmented value={gender} onChange={setGender} options={[{ value: 'FEMALE', label: t('sex.FEMALE') }, { value: 'MALE', label: t('sex.MALE') }]} />
      </View>
      {providerType === 'DOCTOR' ? (
        <>
          <Select testID="prov-specialty" label={t('provider.specialty')} value={specialty} onChange={setSpecialty} options={SPECIALTIES.map((s) => ({ value: s, label: t(`specialty.${s}`) }))} error={errors.specialty} />
          <TextField label={t('provider.subspecialty')} optional value={subspecialty} onChangeText={setSubspecialty} />
        </>
      ) : null}
      <TextField testID="prov-years" label={t('provider.yearsExperience')} value={years} onChangeText={(v) => setYears(v.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" error={errors.years} ltr />
      <Select testID="prov-governorate" label={t('onboarding.governorate')} value={governorate} onChange={setGovernorate} options={GOVERNORATES.map((g) => ({ value: g, label: t(`governorate.${g}`) }))} error={errors.governorate} />
      <TextField testID="prov-city" label={t('onboarding.city')} value={city} onChangeText={setCity} error={errors.city} />
      <TextField label={t('provider.affiliation')} optional value={affiliation} onChangeText={setAffiliation} />
      <TextField label={t('provider.fee')} optional hint={providerType === 'DOCTOR' ? t('provider.feeDoctorHint') : t('provider.feeNurseHint')} value={fee} onChangeText={(v) => setFee(v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" error={errors.fee} ltr />
      {providerType === 'NURSE' ? <TextField label={t('provider.skills')} optional value={skills} onChangeText={setSkills} /> : null}
      <TextField label={t('provider.previousExperience')} optional value={previous} onChangeText={setPrevious} multiline />
      <TextField label={t('provider.bioAr')} optional value={bioAr} onChangeText={setBioAr} multiline />
      <TextField label={t('provider.bioEn')} optional value={bioEn} onChangeText={setBioEn} multiline ltr />
      <Button testID="prov-save" label={submitLabel} onPress={submit} loading={busy} />
    </View>
  );
}
