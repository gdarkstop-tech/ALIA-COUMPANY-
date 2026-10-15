import { BLOOD_TYPES, GOVERNORATES, HEALTH_ENTRY_KINDS, type BloodType, type Governorate, type HealthEntryKind, type Sex } from '@ghayarly/shared';
import { radii, spacing } from '@ghayarly/tokens';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { EG_PHONE_RE, normalizeEgyptPhone } from '@/features/auth/authErrors';
import { useConsents, useRecordConsents } from '@/features/compliance/hooks';
import { api, errorKey } from '@/lib/api';
import { FAMILY_CONSENT_VERSION } from '@/lib/config';
import { isValidIsoDate, maskDate } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { usePreferences } from '@/providers/preferences';
import { useMe } from '@/providers/session';
import { useTheme } from '@/providers/theme';
import { Badge, Button, Card, Checkbox, Header, Icon, Notice, PressableScale, Screen, Segmented, Select, Text, TextField } from '@/ui';

const QUICK_ADD: Record<HealthEntryKind, 'onboarding.quickAddAllergy' | 'onboarding.quickAddCondition' | 'onboarding.quickAddMedication' | 'onboarding.quickAddSurgery'> = {
  ALLERGY: 'onboarding.quickAddAllergy',
  CONDITION: 'onboarding.quickAddCondition',
  MEDICATION: 'onboarding.quickAddMedication',
  SURGERY: 'onboarding.quickAddSurgery',
};

function Progress({ step }: { step: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: spacing.xs }} accessibilityLabel={`${step + 1} / 3`}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? colors.accent : colors.border }} />
      ))}
    </View>
  );
}

/** Progressive patient onboarding: 1) basics → 2) optional health baseline → 3) emergency contact. */
export default function PatientOnboarding() {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const { setActivePatientId } = usePreferences();
  const existing = useQuery({ queryKey: ['patients'], queryFn: () => api.patients.list() });
  const self = existing.data?.find((p) => p.relationship === 'SELF');

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [sex, setSex] = useState<Sex>('FEMALE');
  const [governorate, setGovernorate] = useState<Governorate | null>(null);
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [blood, setBlood] = useState<BloodType>('UNKNOWN');
  const [drafts, setDrafts] = useState<Record<HealthEntryKind, string>>({ ALLERGY: '', CONDITION: '', MEDICATION: '', SURGERY: '' });
  const [added, setAdded] = useState<{ kind: HealthEntryKind; title: string }[]>([]);
  const [ecName, setEcName] = useState('');
  const [ecPhone, setEcPhone] = useState('');
  const [ecRelation, setEcRelation] = useState('');
  const patientId = self?.id;
  // Explicit, separate consent for sensitive health data — asked in context, never pre-ticked.
  const consents = useConsents();
  const recordConsents = useRecordConsents();
  const needsHealthConsent = consents.data ? !consents.data.healthDataConsented : false;
  const [healthConsent, setHealthConsent] = useState(false);

  const displayName = name || me.data?.user.name || '';

  const saveStep1 = async () => {
    if (!isValidIsoDate(dob) || dob > new Date().toISOString().slice(0, 10)) return setError(t('errors.invalidDate'));
    if (phone && !EG_PHONE_RE.test(normalizeEgyptPhone(phone))) return setError(t('errors.invalidPhone'));
    if (needsHealthConsent && !healthConsent) return setError(t('privacy.healthConsentRequired'));
    setBusy(true);
    setError(null);
    try {
      if (needsHealthConsent && consents.data) {
        await recordConsents.mutateAsync({ state: consents.data, answers: { HEALTH_DATA_PROCESSING: true } });
      }
      let id = patientId;
      if (!id) {
        const created = await api.patients.create({ displayName: displayName.trim(), dateOfBirth: dob, sex, relationship: 'SELF', consentBasis: 'SELF', consentAttested: true, consentStatementVersion: FAMILY_CONSENT_VERSION });
        id = created.id;
      }
      await api.patients.update(id, { governorate, city: city.trim() || null, phone: phone ? normalizeEgyptPhone(phone) : null });
      setActivePatientId(id);
      await qc.invalidateQueries({ queryKey: ['patients'] });
      setStep(1);
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  const addEntry = async (kind: HealthEntryKind) => {
    const title = drafts[kind].trim();
    if (!title || !patientId) return;
    try {
      await api.patients.addHealthEntry(patientId, { kind, title });
      setAdded((a) => [...a, { kind, title }]);
      setDrafts((d) => ({ ...d, [kind]: '' }));
    } catch (e) {
      setError(t(errorKey(e)));
    }
  };

  const saveStep2 = async () => {
    if (!patientId) return;
    setBusy(true);
    try {
      if (blood !== 'UNKNOWN') await api.patients.update(patientId, { bloodType: blood });
      setStep(2);
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  const finish = async (skip = false) => {
    if (!patientId) return;
    if (!skip && ecPhone && !EG_PHONE_RE.test(normalizeEgyptPhone(ecPhone))) return setError(t('errors.invalidPhone'));
    setBusy(true);
    setError(null);
    try {
      await api.patients.update(patientId, {
        baselineCompleted: true,
        ...(!skip && ecName ? { emergencyContactName: ecName.trim(), emergencyContactPhone: ecPhone ? normalizeEgyptPhone(ecPhone) : null, emergencyContactRelation: ecRelation.trim() || null } : {}),
      });
      await api.me.completeOnboarding();
      await qc.invalidateQueries();
      router.replace('/patient');
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  const titles = [
    [t('onboarding.patientStep1Title'), t('onboarding.patientStep1Body')],
    [t('onboarding.patientStep2Title'), t('onboarding.patientStep2Body')],
    [t('onboarding.patientStep3Title'), t('onboarding.patientStep3Body')],
  ] as const;

  return (
    <Screen
      testID="patient-onboarding"
      header={
        <View style={{ gap: spacing.md, paddingTop: spacing.md }}>
          <Progress step={step} />
          <Header large title={titles[step][0]} subtitle={titles[step][1]} />
        </View>
      }
      footer={
        step === 0 ? (
          <Button testID="onboarding-next" label={t('common.continue')} onPress={() => void saveStep1()} loading={busy} disabled={!displayName.trim() || !dob || (needsHealthConsent && !healthConsent)} />
        ) : step === 1 ? (
          <View style={{ gap: spacing.sm }}>
            <Button testID="onboarding-next" label={t('common.continue')} onPress={() => void saveStep2()} loading={busy} />
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            <Button testID="onboarding-finish" label={t('onboarding.finish')} onPress={() => void finish()} loading={busy} />
            <Button label={t('common.skip')} variant="ghost" onPress={() => void finish(true)} />
          </View>
        )
      }
    >
      {error ? <Notice tone="danger" body={error} /> : null}
      {step === 0 ? (
        <Animated.View entering={FadeIn.duration(300)} style={{ gap: spacing.lg }}>
          <TextField testID="onb-name" label={t('auth.fullName')} value={displayName} onChangeText={setName} />
          <TextField testID="onb-dob" label={t('onboarding.dateOfBirth')} placeholder={t('onboarding.dobPlaceholder')} value={dob} onChangeText={(v) => setDob(maskDate(v))} keyboardType="number-pad" ltr />
          <View style={{ gap: spacing.xs }}>
            <Text variant="footnote" weight="semibold" color="textSecondary">
              {t('onboarding.sex')}
            </Text>
            <Segmented
              testID="onb-sex"
              value={sex}
              onChange={setSex}
              options={[
                { value: 'FEMALE', label: t('sex.FEMALE') },
                { value: 'MALE', label: t('sex.MALE') },
                { value: 'UNSPECIFIED', label: t('sex.UNSPECIFIED') },
              ]}
            />
            <Text variant="caption" color="textTertiary">
              {t('onboarding.sexHint')}
            </Text>
          </View>
          <Select label={t('onboarding.governorate')} optional value={governorate} onChange={setGovernorate} options={GOVERNORATES.map((g) => ({ value: g, label: t(`governorate.${g}`) }))} />
          <TextField label={t('onboarding.city')} optional value={city} onChangeText={setCity} />
          <TextField label={t('auth.phone')} optional value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+2010…" ltr />
          {needsHealthConsent ? (
            <Card testID="health-consent-card" style={{ gap: spacing.sm }}>
              <Text variant="callout" weight="semibold">{t('privacy.healthConsentTitle')}</Text>
              <Text variant="footnote" color="textSecondary">{t('privacy.healthConsentBody')}</Text>
              <Checkbox testID="health-consent" checked={healthConsent} onChange={setHealthConsent} label={t('privacy.healthConsentAgree')}>
                <Button label={`${t('legal.read')} · ${t('legal.healthConsent')}`} variant="ghost" size="sm" fullWidth={false} onPress={() => router.push('/legal/health-consent')} />
              </Checkbox>
            </Card>
          ) : null}
        </Animated.View>
      ) : step === 1 ? (
        <Animated.View entering={FadeIn.duration(300)} style={{ gap: spacing.xl }}>
          <View style={{ gap: spacing.sm }}>
            <Select
              testID="onb-blood"
              label={t('onboarding.bloodType')}
              value={blood}
              onChange={setBlood}
              options={BLOOD_TYPES.map((b) => ({ value: b, label: b === 'UNKNOWN' ? t('onboarding.bloodTypeUnknown') : b }))}
            />
            <Notice tone="info" icon="mci:water-outline" body={t('onboarding.bloodTypeNotice')} />
          </View>
          {HEALTH_ENTRY_KINDS.map((kind) => (
            <View key={kind} style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
                <View style={{ flex: 1 }}>
                  <TextField testID={`onb-entry-${kind}`} label={t(QUICK_ADD[kind])} optional value={drafts[kind]} onChangeText={(v) => setDrafts((d) => ({ ...d, [kind]: v }))} onSubmitEditing={() => void addEntry(kind)} />
                </View>
                <QuickAddButton disabled={!drafts[kind].trim()} onPress={() => void addEntry(kind)} />
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {added.filter((a) => a.kind === kind).map((a, i) => (
                  <Badge key={i} label={a.title} tone="primary" icon="check" />
                ))}
              </View>
            </View>
          ))}
        </Animated.View>
      ) : (
        <Animated.View entering={FadeIn.duration(300)} style={{ gap: spacing.lg }}>
          <TextField label={t('onboarding.emergencyName')} value={ecName} onChangeText={setEcName} />
          <TextField label={t('onboarding.emergencyPhone')} value={ecPhone} onChangeText={setEcPhone} keyboardType="phone-pad" placeholder="+2010…" ltr />
          <TextField label={t('onboarding.emergencyRelation')} optional value={ecRelation} onChangeText={setEcRelation} />
        </Animated.View>
      )}
    </Screen>
  );
}

function QuickAddButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={t('common.add')} onPress={onPress} disabled={disabled} style={{ width: 52, height: 52, borderRadius: radii.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="plus" color="primary" />
    </PressableScale>
  );
}
