import { GOVERNORATES, SPECIALTIES, type Governorate, type ProviderType, type Specialty } from '@ghayarly/shared';
import { spacing } from '@ghayarly/tokens';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { ProviderCardView } from '@/features/provider/ProviderCard';
import { api, errorKey } from '@/lib/api';
import { useI18n } from '@/providers/i18n';
import { Chip, EmptyState, ErrorState, Header, LoadingScreen, Screen, Segmented, Select, TextField } from '@/ui';

export default function FindCare() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string; specialty?: string }>();
  const [type, setType] = useState<ProviderType>(params.type === 'NURSE' ? 'NURSE' : 'DOCTOR');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [acceptingOnly, setAcceptingOnly] = useState(false);
  const [gender, setGender] = useState<'FEMALE' | 'MALE' | null>(null);
  const [specialty, setSpecialty] = useState<Specialty | null>((params.specialty as Specialty) ?? null);
  const [governorate, setGovernorate] = useState<Governorate | null>(null);
  const [sort, setSort] = useState<'recommended' | 'experience' | 'price_low'>('recommended');

  useEffect(() => {
    if (params.type === 'NURSE' || params.type === 'DOCTOR') setType(params.type);
    if (params.specialty) setSpecialty(params.specialty as Specialty);
  }, [params.type, params.specialty]);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(h);
  }, [q]);

  const query = {
    type,
    q: debounced || undefined,
    acceptingOnly: acceptingOnly ? ('true' as const) : undefined,
    gender: gender ?? undefined,
    specialty: type === 'DOCTOR' ? (specialty ?? undefined) : undefined,
    governorate: governorate ?? undefined,
    sort,
  };
  const results = useQuery({ queryKey: ['providers', query], queryFn: () => api.providers.search(query) });

  return (
    <Screen testID="find-care" header={<Header title={t('care.title')} subtitle={t('care.subtitle')} />} refreshing={results.isRefetching} onRefresh={() => void results.refetch()}>
      <Segmented testID="care-type" value={type} onChange={setType} options={[{ value: 'DOCTOR', label: t('care.doctors') }, { value: 'NURSE', label: t('care.nurses') }]} />
      <TextField testID="care-search" label={t('common.search')} placeholder={t('care.searchPlaceholder')} value={q} onChangeText={setQ} returnKeyType="search" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
        <Chip testID="filter-accepting" label={t('care.acceptingOnly')} icon="check-circle" selected={acceptingOnly} onPress={() => setAcceptingOnly((v) => !v)} />
        <Chip label={t('care.female')} selected={gender === 'FEMALE'} onPress={() => setGender((g) => (g === 'FEMALE' ? null : 'FEMALE'))} />
        <Chip label={t('care.male')} selected={gender === 'MALE'} onPress={() => setGender((g) => (g === 'MALE' ? null : 'MALE'))} />
        <Chip label={t('care.sortExperience')} icon="award" selected={sort === 'experience'} onPress={() => setSort((s) => (s === 'experience' ? 'recommended' : 'experience'))} />
        <Chip label={t('care.sortPriceLow')} icon="trending-down" selected={sort === 'price_low'} onPress={() => setSort((s) => (s === 'price_low' ? 'recommended' : 'price_low'))} />
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        {type === 'DOCTOR' ? (
          <View style={{ flex: 1 }}>
            <Select
              testID="filter-specialty"
              label={t('care.specialty')}
              value={specialty ?? ('ALL' as Specialty)}
              onChange={(v) => setSpecialty(v === ('ALL' as Specialty) ? null : v)}
              options={[{ value: 'ALL' as Specialty, label: t('common.all') }, ...SPECIALTIES.map((s) => ({ value: s, label: t(`specialty.${s}`) }))]}
            />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Select
            label={t('care.area')}
            value={governorate ?? ('ALL' as Governorate)}
            onChange={(v) => setGovernorate(v === ('ALL' as Governorate) ? null : v)}
            options={[{ value: 'ALL' as Governorate, label: t('common.all') }, ...GOVERNORATES.map((g) => ({ value: g, label: t(`governorate.${g}`) }))]}
          />
        </View>
      </View>

      {results.isPending ? (
        <LoadingScreen />
      ) : results.error ? (
        <ErrorState message={t(errorKey(results.error))} onRetry={() => void results.refetch()} />
      ) : results.data.length === 0 ? (
        <EmptyState icon="search" title={t('care.emptyTitle')} body={t('care.emptyBody')} actionLabel={t('common.clear')} onAction={() => { setQ(''); setAcceptingOnly(false); setGender(null); setSpecialty(null); setGovernorate(null); }} />
      ) : (
        <Animated.View entering={FadeIn.duration(250)} style={{ gap: spacing.md }} testID="provider-results">
          {results.data.map((p) => (
            <ProviderCardView key={p.userId} p={p} onPress={() => router.push({ pathname: '/patient/provider/[id]', params: { id: p.userId } })} />
          ))}
        </Animated.View>
      )}
    </Screen>
  );
}
