import { ageInYears, RELATIONSHIPS, type ConsentBasis, type Relationship, type Sex } from '@ghayarly/shared';
import { radii, spacing } from '@ghayarly/tokens';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';
import { api, errorKey } from '@/lib/api';
import { FAMILY_CONSENT_VERSION } from '@/lib/config';
import { isValidIsoDate, maskDate } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { usePreferences } from '@/providers/preferences';
import { useTheme } from '@/providers/theme';
import { Button, Header, Icon, Notice, PressableScale, Screen, Segmented, Select, Text, TextField, useToast } from '@/ui';

/**
 * Adding a family member never grants unrestricted access silently:
 *  - minors → the user confirms they are the parent/legal guardian;
 *  - adults → the user attests the adult's consent (the adult can later claim and revoke),
 *    or attests legal authority when the adult cannot consent.
 */
export default function AddFamilyMember() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { setActivePatientId } = usePreferences();
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState<Relationship | null>(null);
  const [dob, setDob] = useState('');
  const [sex, setSex] = useState<Sex>('FEMALE');
  const [legalAuthority, setLegalAuthority] = useState(false);
  const [attested, setAttested] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validDob = isValidIsoDate(dob) && dob <= new Date().toISOString().slice(0, 10);
  const minor = validDob ? ageInYears(dob) < 18 : null;
  const basis: ConsentBasis | null = minor === null ? null : minor ? 'GUARDIAN_OF_MINOR' : legalAuthority ? 'LEGAL_AUTHORITY_ATTESTED' : 'ADULT_CONSENT_ATTESTED';
  const statement = minor ? t('family.consentMinor') : legalAuthority ? t('family.consentLegalAuthority') : t('family.consentAdult', { name: name.trim() || '…' });

  const create = useMutation({
    mutationFn: () =>
      api.patients.create({ displayName: name.trim(), dateOfBirth: dob, sex, relationship: relationship!, consentBasis: basis!, consentAttested: true, consentStatementVersion: FAMILY_CONSENT_VERSION }),
    onSuccess: async (p) => {
      await qc.invalidateQueries();
      setActivePatientId(p.id);
      toast(t('family.created', { name: p.displayName }));
      router.replace('/patient');
    },
    onError: (e) => setError(t(errorKey(e))),
  });

  const submit = () => {
    if (!name.trim() || !relationship) return setError(t('errors.requiredField'));
    if (!validDob) return setError(t('errors.invalidDate'));
    if (!attested) return setError(t('family.consentRequired'));
    setError(null);
    create.mutate();
  };

  return (
    <Screen testID="family-add-screen" header={<Header back title={t('family.addTitle')} subtitle={t('family.addBody')} />} footer={<Button testID="family-add-submit" label={t('common.save')} onPress={submit} loading={create.isPending} />}>
      {error ? <Notice tone="danger" body={error} testID="family-add-error" /> : null}
      <TextField testID="family-name" label={t('family.name')} value={name} onChangeText={setName} />
      <Select
        testID="family-relationship"
        label={t('family.relationship')}
        value={relationship}
        onChange={setRelationship}
        options={RELATIONSHIPS.filter((r) => r !== 'SELF').map((r) => ({ value: r, label: t(`family.rel_${r}`) }))}
      />
      <TextField testID="family-dob" label={t('onboarding.dateOfBirth')} placeholder={t('onboarding.dobPlaceholder')} value={dob} onChangeText={(v) => setDob(maskDate(v))} keyboardType="number-pad" ltr />
      <View style={{ gap: spacing.xs }}>
        <Text variant="footnote" weight="semibold" color="textSecondary">
          {t('onboarding.sex')}
        </Text>
        <Segmented value={sex} onChange={setSex} options={[{ value: 'FEMALE', label: t('sex.FEMALE') }, { value: 'MALE', label: t('sex.MALE') }, { value: 'UNSPECIFIED', label: t('sex.UNSPECIFIED') }]} />
      </View>

      {basis ? (
        <View style={{ gap: spacing.md, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Icon name="mci:shield-account-outline" color="primary" />
            <Text variant="callout" weight="semibold">{t('family.consentTitle')}</Text>
          </View>
          {!minor ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
              <Text variant="footnote" color="textSecondary" style={{ flex: 1 }}>{t('family.useLegalAuthority')}</Text>
              <Switch accessibilityLabel={t('family.useLegalAuthority')} value={legalAuthority} onValueChange={(v) => { setLegalAuthority(v); setAttested(false); }} trackColor={{ true: colors.accent, false: colors.border }} />
            </View>
          ) : null}
          <PressableScale testID="family-consent" accessibilityRole="checkbox" aria-checked={attested} onPress={() => setAttested((v) => !v)} scaleTo={0.99} style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
            <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: attested ? colors.accent : colors.borderStrong, backgroundColor: attested ? colors.accent : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
              {attested ? <Icon name="check" size={14} tint={colors.textOnAccent} /> : null}
            </View>
            <Text variant="footnote" style={{ flex: 1 }}>{statement}</Text>
          </PressableScale>
        </View>
      ) : null}
    </Screen>
  );
}
