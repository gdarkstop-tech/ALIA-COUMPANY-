import { listSeparator } from '@ghayarly/i18n';
import { radii, spacing } from '@ghayarly/tokens';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { availabilityTone } from '@/features/provider/ProviderCard';
import { api, errorKey } from '@/lib/api';
import { formatDate, minutesToTime, money } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { ShareSheet } from '@/features/shares/ShareSheet';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Header, Icon, LoadingScreen, Notice, Screen, Section, Sheet, Text } from '@/ui';

export default function ProviderProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, pickL, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const [sheet, setSheet] = useState<null | 'book' | 'waitlist'>(null);
  const [sharing, setSharing] = useState(false);
  const q = useQuery({ queryKey: ['provider', id], queryFn: () => api.providers.get(id) });

  if (q.isPending) return <Screen header={<Header back title="" large={false} />}><LoadingScreen /></Screen>;
  if (q.error) return <Screen header={<Header back title="" large={false} />}><ErrorState message={t(errorKey(q.error))} onRetry={() => void q.refetch()} /></Screen>;
  const p = q.data;
  const name = pickL(p, 'displayName');
  const bio = pickL(p, 'bio');
  const unavailable = p.availabilityStatus === 'FULLY_BOOKED' || p.availabilityStatus === 'AWAY';

  return (
    <Screen
      testID="provider-profile"
      header={<Header back title="" large={false} />}
      footer={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
          <View>
            <Text variant="caption" color="textTertiary">{t('care.fee')}</Text>
            <Text variant="title3" tabular>{money(p.feePiasters, locale)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Button testID="book-now" label={t('care.bookNow')} icon="calendar" onPress={() => setSheet('book')} />
          </View>
        </View>
      }
    >
      <Animated.View entering={FadeInDown.duration(400)} style={{ alignItems: 'center', gap: spacing.md }}>
        <Avatar name={name} size={96} />
        <View style={{ alignItems: 'center', gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <Text variant="title2" align="center" testID="provider-name">{name}</Text>
            <Icon name="mci:check-decagram" size={20} color="primary" />
          </View>
          <Text variant="callout" color="textSecondary" align="center">
            {p.specialty ? t(`specialty.${p.specialty}`) : t('roles.NURSE')}
            {p.subspecialty ? ` · ${p.subspecialty}` : ''}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Badge label={t('care.verified')} tone="primary" icon="shield" />
          <Badge label={t(`availability.${p.availabilityStatus as 'AWAY'}`)} tone={availabilityTone(p.availabilityStatus, p.acceptingNewPatients)} />
          {p.isDemo ? <Badge label={t('app.demoData')} tone="demo" icon="mci:flask-outline" /> : null}
        </View>
      </Animated.View>

      {unavailable ? (
        <Notice tone="warning" title={p.availabilityStatus === 'AWAY' && p.awayUntil ? t('care.awayNotice', { name, date: formatDate(p.awayUntil, locale) }) : t('care.fullyBookedNotice', { name })} testID="fully-booked-notice">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
            <Button label={t('care.joinWaitlist')} size="sm" variant="secondary" fullWidth={false} onPress={() => setSheet('waitlist')} />
            <Button label={t('care.notifyMe')} size="sm" variant="secondary" fullWidth={false} onPress={() => setSheet('waitlist')} />
            <Button label={t('care.findSimilar')} size="sm" variant="ghost" fullWidth={false} onPress={() => router.push({ pathname: '/patient/care', params: { type: p.providerType, specialty: p.specialty ?? undefined } })} />
          </View>
        </Notice>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {[
          [t('common.years', { count: p.yearsExperience }), t('provider.yearsExperience'), 'award'],
          [String(p.verifiedCredentialCount), t('care.verifiedCredentials'), 'shield'],
          [p.completedVisits > 0 ? String(p.completedVisits) : '—', p.completedVisits > 0 ? t('care.completedVisitsLabel') : t('care.newOnPlatform'), 'check-circle'],
        ].map(([value, label, icon]) => (
          <Card key={label} style={{ flex: 1, padding: spacing.md, alignItems: 'center' }}>
            <Icon name={icon as 'award'} size={18} color="primary" />
            <Text variant="callout" weight="semibold" tabular>{value}</Text>
            <Text variant="micro" color="textTertiary" align="center">{label}</Text>
          </Card>
        ))}
      </View>

      <Section title={t('care.about')}>
        <Card>
          <View style={{ gap: spacing.md }}>
            {bio ? <Text variant="callout" color="textSecondary">{bio}</Text> : null}
            {p.currentAffiliation ? (
              <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                <Icon name="mci:hospital-building" size={18} color="textTertiary" />
                <Text variant="footnote">{p.currentAffiliation}</Text>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
              <Icon name="map-pin" size={16} color="textTertiary" />
              <Text variant="footnote">{p.city}{listSeparator(locale)}{t(`governorate.${p.governorate}`)}</Text>
            </View>
            {p.skills.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {p.skills.map((s) => <Badge key={s} label={s} tone="neutral" />)}
              </View>
            ) : null}
          </View>
        </Card>
      </Section>

      <Section title={t('care.verifiedCredentials')}>
        <Card padded={false}>
          {p.verifiedCredentials.map((c, i) => (
            <View key={`${c.kind}-${i}`} style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center', padding: spacing.lg, borderTopWidth: i ? 1 : 0, borderTopColor: colors.divider }}>
              <View style={{ width: 36, height: 36, borderRadius: radii.md, backgroundColor: colors.successSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="check" size={18} color="success" />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="callout" weight="semibold">{t(`provider.cred_${c.kind}`)}</Text>
                <Text variant="caption" color="textTertiary">{c.issuer} · {formatDate(c.verifiedAt, locale)}</Text>
              </View>
            </View>
          ))}
        </Card>
      </Section>

      {p.services.length ? (
        <Section title={t('care.services')}>
          <Card padded={false}>
            {p.services.map((s, i) => (
              <View key={s.serviceId} style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center', padding: spacing.lg, borderTopWidth: i ? 1 : 0, borderTopColor: colors.divider }}>
                <Icon name="mci:medical-bag" color="primary" />
                <View style={{ flex: 1 }}>
                  <Text variant="callout" weight="medium">{pickL(s, 'name')}</Text>
                  <Text variant="caption" color="textTertiary">{t('common.minutes', { count: s.durationMinutes })}</Text>
                </View>
                <Text variant="callout" weight="semibold" tabular>{money(s.pricePiasters, locale)}</Text>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title={t('care.workingHours')}>
        <Card>
          <View style={{ gap: spacing.sm }}>
            {[6, 0, 1, 2, 3, 4, 5].map((d) => {
              const slots = p.workingHours.filter((h) => h.weekday === d);
              return (
                <View key={d} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text variant="footnote" color="textSecondary">{t(`availability.weekday${d}` as 'availability.weekday0')}</Text>
                  <Text variant="footnote" weight="medium" color={slots.length ? 'text' : 'textTertiary'}>
                    {slots.length ? slots.map((s) => `${minutesToTime(s.startMinute, locale)} – ${minutesToTime(s.endMinute, locale)}`).join(listSeparator(locale)) : t('care.closed')}
                  </Text>
                </View>
              );
            })}
          </View>
        </Card>
      </Section>

      <Section title={t('care.reviewsTitle')}>
        <Card>
          <EmptyState compact icon="message-circle" title={t('care.reviewsTitle')} body={t('care.noReviewsYet')} />
        </Card>
      </Section>

      <Button testID="share-record" label={t('shares.shareRecord')} icon="share-2" variant="secondary" onPress={() => setSharing(true)} />
      <ShareSheet providerUserId={p.userId} providerName={name} visible={sharing} onClose={() => setSharing(false)} />
      <Sheet visible={sheet !== null} onClose={() => setSheet(null)} title={sheet === 'book' ? t('care.bookingSoonTitle') : t('care.joinWaitlist')} testID="booking-sheet">
        <Notice tone="info" icon="calendar" body={t('care.bookingSoonBody')} />
        <Button label={t('common.close')} variant="secondary" onPress={() => setSheet(null)} />
      </Sheet>
    </Screen>
  );
}
