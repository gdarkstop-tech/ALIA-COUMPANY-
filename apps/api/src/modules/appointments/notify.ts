import type { AppointmentKind } from '@ghayarly/shared';
import { sql } from 'drizzle-orm';
import type { Env } from '../../config/env';
import type { Tx } from '../../db/client';
import { normalizePhone } from '../../notifications/phone';
import type { Notifier, QueueRequest } from '../../notifications/service';
import type { Locale } from '../../notifications/templates';

/**
 * Booking messages (ADR 0021). Queued in the same transaction as the booking change, so a message
 * exists only if the change commits. Content: who, when, kind of visit and reference — never the
 * reason for the visit, the service's clinical name or any note.
 */
type Context = {
  id: string;
  reference: string;
  kind: AppointmentKind;
  status: string;
  startsAt: string;
  cancelledBy: 'PATIENT' | 'PROVIDER' | 'ADMIN' | null;
  providerNameAr: string;
  providerNameEn: string;
  contacts: { side: 'PATIENT' | 'PROVIDER'; userId: string; email: string | null; phone: string | null; locale: string }[];
};

export type BookingEvent = 'REQUESTED' | 'CONFIRMED' | 'DECLINED' | 'CANCELLED' | 'RESCHEDULED_BY_PATIENT' | 'RESCHEDULED_BY_PROVIDER' | 'EXPIRED' | 'COMPLETED';

const KIND_LABEL: Record<AppointmentKind, Record<Locale, string>> = {
  DOCTOR_CLINIC: { ar: 'كشف في العيادة', en: 'clinic consultation' },
  DOCTOR_HOME_VISIT: { ar: 'كشف منزلي', en: 'doctor home visit' },
  DOCTOR_ONLINE: { ar: 'استشارة عن بعد', en: 'online consultation' },
  NURSE_HOME_VISIT: { ar: 'زيارة تمريض منزلية', en: 'home nursing visit' },
};

export function cairoDateTime(iso: string, locale: Locale) {
  const d = new Date(iso);
  const tag = locale === 'ar' ? 'ar-EG' : 'en-GB';
  return {
    date: new Intl.DateTimeFormat(tag, { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d),
    time: new Intl.DateTimeFormat(tag, { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit' }).format(d),
  };
}

export async function messageContext(tx: Tx, id: string): Promise<Context | null> {
  const r = await tx.execute<{ c: Context | null }>(sql`select app.appointment_message_context(${id}::uuid) as c`);
  return r.rows[0]?.c ?? null;
}

async function send(tx: Tx, notifier: Notifier, env: Env, ctx: Context, side: 'PATIENT' | 'PROVIDER', purpose: QueueRequest['purpose'], extra: Partial<QueueRequest> = {}) {
  const contact = ctx.contacts.find((c) => c.side === side);
  if (!contact) return;
  const locale: Locale = contact.locale === 'en' ? 'en' : 'ar';
  const { date, time } = cairoDateTime(ctx.startsAt, locale);
  const vars = { type: KIND_LABEL[ctx.kind][locale], date, time, reference: ctx.reference, provider: locale === 'ar' ? ctx.providerNameAr : ctx.providerNameEn };
  const related = { type: 'appointment', id: ctx.id };
  const allowed = env.SMS_ALLOWED_COUNTRIES.split(',');
  const phone = contact.phone ? normalizePhone(contact.phone, { allowedCountries: allowed }) : null;
  if (phone?.ok) {
    await notifier.queue(tx, { channel: 'SMS', to: phone.e164, userId: contact.userId, purpose, locale, vars, related, ...extra, dedupeKey: extra.dedupeKey ? `${extra.dedupeKey}:sms` : undefined });
  }
  if (contact.email) {
    await notifier.queue(tx, { channel: 'EMAIL', to: contact.email, userId: contact.userId, purpose, locale, vars, related, ...extra, dedupeKey: extra.dedupeKey ? `${extra.dedupeKey}:email` : undefined });
  }
}

/** Reminders 24 h and 2 h before a confirmed booking; they expire at the start time. */
async function queueReminders(tx: Tx, notifier: Notifier, env: Env, ctx: Context) {
  const start = new Date(ctx.startsAt).getTime();
  for (const [label, before] of [['24h', 24 * 3_600_000], ['2h', 2 * 3_600_000]] as const) {
    const at = start - before;
    if (at <= Date.now()) continue;
    await send(tx, notifier, env, ctx, 'PATIENT', 'booking.reminder', { sendAfter: new Date(at), expiresAt: new Date(start), dedupeKey: `appt:${ctx.id}:${start}:${label}` });
  }
}

export async function notifyBooking(tx: Tx, notifier: Notifier, env: Env, id: string, event: BookingEvent): Promise<void> {
  const ctx = await messageContext(tx, id);
  if (!ctx) return;
  switch (event) {
    case 'REQUESTED':
      await send(tx, notifier, env, ctx, 'PROVIDER', 'booking.requested');
      await send(tx, notifier, env, ctx, 'PATIENT', 'booking.awaiting');
      break;
    case 'CONFIRMED':
      await send(tx, notifier, env, ctx, 'PATIENT', 'booking.confirmed');
      await queueReminders(tx, notifier, env, ctx);
      break;
    case 'DECLINED':
      await send(tx, notifier, env, ctx, 'PATIENT', 'booking.declined');
      break;
    case 'EXPIRED':
      await send(tx, notifier, env, ctx, 'PATIENT', 'booking.expired');
      break;
    case 'CANCELLED':
      await notifier.cancelRelated(tx, 'appointment', id, ['booking.reminder']);
      if (ctx.cancelledBy !== 'PROVIDER') await send(tx, notifier, env, ctx, 'PROVIDER', 'booking.cancelled');
      if (ctx.cancelledBy !== 'PATIENT') await send(tx, notifier, env, ctx, 'PATIENT', 'booking.cancelled');
      break;
    case 'RESCHEDULED_BY_PATIENT':
      await notifier.cancelRelated(tx, 'appointment', id, ['booking.reminder']);
      await send(tx, notifier, env, ctx, 'PROVIDER', 'booking.rescheduled');
      break;
    case 'RESCHEDULED_BY_PROVIDER':
      await notifier.cancelRelated(tx, 'appointment', id, ['booking.reminder']);
      await send(tx, notifier, env, ctx, 'PATIENT', 'booking.rescheduled');
      await queueReminders(tx, notifier, env, ctx);
      break;
    case 'COMPLETED':
      await notifier.cancelRelated(tx, 'appointment', id, ['booking.reminder']);
      if (ctx.kind === 'NURSE_HOME_VISIT' || ctx.kind === 'DOCTOR_HOME_VISIT') await send(tx, notifier, env, ctx, 'PATIENT', 'visit.completed');
      break;
  }
}
