import type { TranslationKey } from '@ghayarly/i18n';
import type { Appointment, AppointmentStatus } from '@ghayarly/shared';
import { radii, spacing } from '@ghayarly/tokens';
import { View } from 'react-native';
import { ApiError, errorKey } from '@/lib/api';
import { ltr, money } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { useTheme } from '@/providers/theme';
import { Badge, Card, Icon, PressableScale, Text, type Tone } from '@/ui';

/** Bookings are always shown in Cairo time (where every provider works), whatever the phone's zone. */
const TZ = 'Africa/Cairo';
const tag = (locale: string) => (locale === 'ar' ? 'ar-EG' : 'en-GB');

export const cairoDayKey = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
export const cairoDay = (iso: string, locale: string) => new Intl.DateTimeFormat(tag(locale), { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));
export const cairoShortDay = (iso: string, locale: string) => new Intl.DateTimeFormat(tag(locale), { timeZone: TZ, weekday: 'short', day: 'numeric' }).format(new Date(iso));
export const cairoTime = (iso: string, locale: string) => new Intl.DateTimeFormat(tag(locale), { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

export const STATUS_TONE: Record<AppointmentStatus, Tone> = {
  REQUESTED: 'warning',
  CONFIRMED: 'success',
  IN_PROGRESS: 'info',
  COMPLETED: 'primary',
  DECLINED: 'neutral',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
  NO_SHOW: 'danger',
  VISIT_FAILED: 'danger',
};

const BOOKING_ERRORS = new Set(['SLOT_TAKEN', 'SLOT_NOT_AVAILABLE', 'AREA_NOT_SERVED', 'OUTSIDE_PROVIDER_AREA', 'CLINICAL_AUTHORIZATION_REQUIRED', 'INVALID_PHONE', 'FEATURE_DISABLED', 'BOOKING_RESTRICTED']);

/** Booking refusals come back as stable codes; show the specific reason when we have one. */
export function bookingErrorKey(err: unknown): TranslationKey {
  if (err instanceof ApiError && BOOKING_ERRORS.has(err.code)) return `booking.err_${err.code}` as TranslationKey;
  return errorKey(err);
}

export function AppointmentCard({ a, onPress, testID }: { a: Appointment; onPress: () => void; testID?: string }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const counterpart = a.viewerRole === 'PROVIDER' ? a.patient.displayName : locale === 'ar' ? a.provider.displayNameAr : a.provider.displayNameEn;
  return (
    <PressableScale testID={testID} accessibilityRole="button" onPress={onPress} scaleTo={0.99}>
      <Card>
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
          <View style={{ width: 52, borderRadius: radii.md, backgroundColor: colors.primarySoft, alignItems: 'center', paddingVertical: spacing.sm }}>
            <Text variant="caption" color="primarySoftText" align="center">{cairoShortDay(a.startsAt, locale)}</Text>
            <Text variant="footnote" weight="semibold" color="primarySoftText" align="center">{cairoTime(a.startsAt, locale)}</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="callout" weight="semibold" numberOfLines={1}>{counterpart}</Text>
            <Text variant="footnote" color="textSecondary" numberOfLines={1}>
              {t(`booking.kind_${a.kind}`)}
              {a.service ? ` · ${locale === 'ar' ? a.service.nameAr : a.service.nameEn}` : ''}
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4, flexWrap: 'wrap' }}>
              <Badge label={t(`booking.status_${a.status}`)} tone={STATUS_TONE[a.status]} />
              <Badge label={ltr(a.reference)} tone="neutral" />
            </View>
          </View>
          <Icon name="chevron-right" size={18} color="textTertiary" />
        </View>
      </Card>
    </PressableScale>
  );
}

export function AppointmentFacts({ a }: { a: Appointment }) {
  const { t, locale } = useI18n();
  const rows: [string, string, string][] = [
    ['calendar', t('booking.chooseDay'), `${cairoDay(a.startsAt, locale)} · ${cairoTime(a.startsAt, locale)}`],
    ['mci:stethoscope', t('booking.chooseType'), t(`booking.kind_${a.kind}`) + (a.service ? ` · ${locale === 'ar' ? a.service.nameAr : a.service.nameEn}` : '')],
    ['user', t('booking.whoFor'), a.patient.displayName],
    ['credit-card', t('booking.price'), money(a.pricePiasters, locale)],
    ['hash', t('booking.reference'), ltr(a.reference)],
  ];
  const clinic = locale === 'ar' ? (a.clinicAddressAr ?? a.clinicAddressEn) : (a.clinicAddressEn ?? a.clinicAddressAr);
  if (clinic) rows.push(['map-pin', t('booking.clinicAddress'), clinic]);
  if (a.visit) {
    const where = [a.visit.address, a.visit.district, a.visit.city, t(`governorate.${a.visit.governorate}` as TranslationKey)].filter(Boolean).join('، ');
    rows.push(['home', t('booking.visitAddress'), where]);
    if (a.visit.contactPhone) rows.push(['phone', t('booking.contactPhone'), ltr(a.visit.contactPhone)]);
  }
  return (
    <Card>
      <View style={{ gap: spacing.md }}>
        {rows.map(([icon, label, value]) => (
          <View key={label} style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
            <Icon name={icon as 'calendar'} size={18} color="textTertiary" />
            <View style={{ flex: 1 }}>
              <Text variant="caption" color="textTertiary">{label}</Text>
              <Text variant="callout">{value}</Text>
            </View>
          </View>
        ))}
        {a.visit && !a.visit.address && a.viewerRole === 'PROVIDER' ? <Text variant="footnote" color="textSecondary">{t('booking.addressAfterAccept')}</Text> : null}
        <Text variant="footnote" color="textSecondary">{t('booking.payAtVisit')}</Text>
      </View>
    </Card>
  );
}

export function AppointmentHistory({ a }: { a: Appointment }) {
  const { t, locale } = useI18n();
  if (!a.events?.length) return null;
  return (
    <Card>
      <View style={{ gap: spacing.sm }}>
        {a.events.map((e, i) => (
          <View key={`${e.at}-${i}`} style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Text variant="footnote" color="textTertiary" style={{ minWidth: 92 }}>{`${cairoShortDay(e.at, locale)} ${cairoTime(e.at, locale)}`}</Text>
            <View style={{ flex: 1 }}>
              <Text variant="footnote" weight="medium">{`${t(`booking.status_${e.toStatus}`)} · ${t(`booking.by_${e.actorRole}`)}`}</Text>
              {e.newStartsAt && e.event === 'RESCHEDULED' ? <Text variant="caption" color="textSecondary">{`${cairoDay(e.newStartsAt, locale)} ${cairoTime(e.newStartsAt, locale)}`}</Text> : null}
              {e.note ? <Text variant="caption" color="textSecondary">{e.note}</Text> : null}
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}
