import { BRAND_NAME_AR, BRAND_NAME_EN } from '@ghayarly/shared';

/**
 * Message templates (Arabic and English). Health content never goes into a message: no diagnosis,
 * symptom, result or product-for-condition — only who, when and what kind of appointment or order.
 * Sign-in messages (`auth.*`) are bilingual because the sign-in flow does not know the reader's
 * language yet.
 */
export type Locale = 'ar' | 'en';
type Text = { subject: string; body: string; sms: string };

const AR = BRAND_NAME_AR;
const EN = BRAND_NAME_EN;

export const TEMPLATES = {
  'auth.email_verification': {
    secret: true,
    ar: { subject: `تأكيد بريدك الإلكتروني — ${AR}`, body: `مرحباً،\n\nاضغط الرابط لتأكيد بريدك الإلكتروني في ${AR}:\n{url}\n\nالرابط صالح لمدة 24 ساعة. إذا لم تنشئ حساباً، تجاهل هذه الرسالة.`, sms: '' },
    en: { subject: `Confirm your e-mail — ${EN}`, body: `Hello,\n\nOpen this link to confirm your e-mail address for ${EN}:\n{url}\n\nThe link expires in 24 hours. If you did not create an account, ignore this message.`, sms: '' },
  },
  'auth.password_reset': {
    secret: true,
    ar: { subject: `إعادة تعيين كلمة المرور — ${AR}`, body: `طلب أحدهم إعادة تعيين كلمة مرور حسابك في ${AR}.\n\nلإعادة التعيين افتح الرابط:\n{url}\n\nالرابط صالح لمدة 30 دقيقة ويُستخدم مرة واحدة. إذا لم تطلب ذلك، تجاهل هذه الرسالة؛ كلمة مرورك لم تتغير.`, sms: '' },
    en: { subject: `Reset your password — ${EN}`, body: `Someone asked to reset the password of your ${EN} account.\n\nTo reset it, open:\n{url}\n\nThe link expires in 30 minutes and works once. If this was not you, ignore this message; your password has not changed.`, sms: '' },
  },
  'auth.phone_otp': {
    secret: true,
    ar: { subject: '', body: '', sms: `${AR}: رمز التحقق {code}. صالح 5 دقائق. لا تشاركه مع أحد.` },
    en: { subject: '', body: '', sms: `${EN}: your code is {code}. Valid for 5 minutes. Never share it.` },
  },
  'booking.requested': {
    secret: false,
    ar: { subject: `طلب حجز جديد — ${AR}`, body: `لديك طلب حجز جديد ({type}) يوم {date} الساعة {time}.\nافتح التطبيق للقبول أو الرفض.`, sms: `${AR}: طلب حجز جديد ({type}) {date} {time}. افتح التطبيق للرد.` },
    en: { subject: `New booking request — ${EN}`, body: `You have a new booking request ({type}) on {date} at {time}.\nOpen the app to accept or decline it.`, sms: `${EN}: new booking request ({type}) {date} {time}. Open the app to respond.` },
  },
  'booking.confirmed': {
    secret: false,
    ar: { subject: `تم تأكيد موعدك — ${AR}`, body: `تم تأكيد موعدك مع {provider} ({type}) يوم {date} الساعة {time} بتوقيت القاهرة.\nرقم الحجز: {reference}.`, sms: `${AR}: تم تأكيد موعدك مع {provider} {date} {time}. رقم الحجز {reference}.` },
    en: { subject: `Your appointment is confirmed — ${EN}`, body: `Your appointment with {provider} ({type}) on {date} at {time} Cairo time is confirmed.\nBooking reference: {reference}.`, sms: `${EN}: appointment with {provider} confirmed for {date} {time}. Ref {reference}.` },
  },
  'booking.awaiting': {
    secret: false,
    ar: { subject: `تم استلام طلب الحجز — ${AR}`, body: `أُرسل طلبك إلى {provider} ({type}) ليوم {date} الساعة {time}. سنبلغك عند الرد.\nرقم الحجز: {reference}.`, sms: `${AR}: أُرسل طلب الحجز إلى {provider} ({date} {time}). سنبلغك بالرد.` },
    en: { subject: `Booking request sent — ${EN}`, body: `Your request was sent to {provider} ({type}) for {date} at {time}. We will tell you when they respond.\nBooking reference: {reference}.`, sms: `${EN}: request sent to {provider} for {date} {time}. We will tell you their answer.` },
  },
  'booking.declined': {
    secret: false,
    ar: { subject: `تعذّر قبول طلب الحجز — ${AR}`, body: `لم يتمكن {provider} من قبول طلبك ليوم {date} الساعة {time}. يمكنك اختيار موعد آخر من التطبيق.`, sms: `${AR}: لم يُقبل طلب الحجز مع {provider} ({date} {time}). اختر موعداً آخر.` },
    en: { subject: `Booking request declined — ${EN}`, body: `{provider} could not accept your request for {date} at {time}. You can choose another time in the app.`, sms: `${EN}: {provider} could not accept {date} {time}. Please choose another time.` },
  },
  'booking.cancelled': {
    secret: false,
    ar: { subject: `أُلغي الموعد — ${AR}`, body: `أُلغي الموعد ({type}) يوم {date} الساعة {time}. رقم الحجز: {reference}.`, sms: `${AR}: أُلغي الموعد {date} {time} (رقم {reference}).` },
    en: { subject: `Appointment cancelled — ${EN}`, body: `The appointment ({type}) on {date} at {time} was cancelled. Booking reference: {reference}.`, sms: `${EN}: appointment on {date} {time} cancelled (ref {reference}).` },
  },
  'booking.rescheduled': {
    secret: false,
    ar: { subject: `تغيّر موعد الحجز — ${AR}`, body: `تغيّر الموعد ({type}) إلى يوم {date} الساعة {time} بتوقيت القاهرة. رقم الحجز: {reference}.`, sms: `${AR}: الموعد الجديد {date} {time} (رقم {reference}).` },
    en: { subject: `Appointment rescheduled — ${EN}`, body: `The appointment ({type}) is now on {date} at {time} Cairo time. Booking reference: {reference}.`, sms: `${EN}: appointment moved to {date} {time} (ref {reference}).` },
  },
  'booking.reminder': {
    secret: false,
    ar: { subject: `تذكير بموعدك — ${AR}`, body: `تذكير: موعدك مع {provider} ({type}) يوم {date} الساعة {time} بتوقيت القاهرة.`, sms: `${AR}: تذكير بموعدك مع {provider} {date} {time}.` },
    en: { subject: `Appointment reminder — ${EN}`, body: `Reminder: your appointment with {provider} ({type}) is on {date} at {time} Cairo time.`, sms: `${EN}: reminder — {provider}, {date} {time}.` },
  },
  'visit.completed': {
    secret: false,
    ar: { subject: `اكتملت الزيارة — ${AR}`, body: `سجّل مقدم الخدمة اكتمال الزيارة المنزلية (رقم {reference}). يمكنك التقييم أو الإبلاغ عن مشكلة من التطبيق.`, sms: `${AR}: اكتملت الزيارة (رقم {reference}).` },
    en: { subject: `Home visit completed — ${EN}`, body: `The provider marked the home visit (ref {reference}) as completed. You can review it or report a problem in the app.`, sms: `${EN}: home visit {reference} completed.` },
  },
  'order.confirmed': {
    secret: false,
    ar: { subject: `تم استلام طلبك {reference} — ${AR}`, body: `شكراً لك. استلمنا طلبك رقم {reference} بإجمالي {total}.\n{payment}`, sms: `${AR}: استلمنا طلبك {reference} ({total}).` },
    en: { subject: `Order {reference} received — ${EN}`, body: `Thank you. We received order {reference}, total {total}.\n{payment}`, sms: `${EN}: order {reference} received ({total}).` },
  },
  'order.status': {
    secret: false,
    ar: { subject: `تحديث الطلب {reference} — ${AR}`, body: `حالة طلبك رقم {reference}: {status}.`, sms: `${AR}: الطلب {reference}: {status}.` },
    en: { subject: `Order {reference} update — ${EN}`, body: `Your order {reference} is now: {status}.`, sms: `${EN}: order {reference}: {status}.` },
  },
  'payment.received': {
    secret: false,
    ar: { subject: `تم الدفع — ${AR}`, body: `تأكد استلام دفعتك بقيمة {amount} للطلب {reference}.`, sms: `${AR}: تأكد الدفع {amount} للطلب {reference}.` },
    en: { subject: `Payment received — ${EN}`, body: `Your payment of {amount} for {reference} is confirmed.`, sms: `${EN}: payment of {amount} for {reference} confirmed.` },
  },
  'payment.failed': {
    secret: false,
    ar: { subject: `لم تكتمل عملية الدفع — ${AR}`, body: `لم تكتمل عملية الدفع للطلب {reference}. لم يُخصم أي مبلغ نهائي؛ يمكنك المحاولة مرة أخرى من التطبيق.`, sms: `${AR}: لم يكتمل الدفع للطلب {reference}. حاول مجدداً من التطبيق.` },
    en: { subject: `Payment not completed — ${EN}`, body: `The payment for {reference} did not complete. No final charge was made; you can try again in the app.`, sms: `${EN}: payment for {reference} not completed. Try again in the app.` },
  },
  'payment.refunded': {
    secret: false,
    ar: { subject: `تم رد المبلغ — ${AR}`, body: `تم رد {amount} للطلب {reference}. قد يستغرق ظهوره في حسابك بضعة أيام حسب البنك.`, sms: `${AR}: تم رد {amount} للطلب {reference}.` },
    en: { subject: `Refund issued — ${EN}`, body: `A refund of {amount} for {reference} was issued. Your bank may take a few days to show it.`, sms: `${EN}: refund of {amount} for {reference} issued.` },
  },
} as const satisfies Record<string, { secret: boolean; ar: Text; en: Text }>;

export type Purpose = keyof typeof TEMPLATES;
export type Rendered = { subject: string; text: string; html: string; sms: string };

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function fill(template: string, vars: Record<string, string>, missing: Set<string>): string {
  return template.replace(/\{([a-z]+)\}/g, (_, k: string) => {
    if (vars[k] === undefined) missing.add(k);
    return vars[k] ?? '';
  });
}

/** The HTML part of an e-mail is derived from its text (escaped, right-to-left for Arabic). */
export function textToHtml(text: string, locale: Locale): string {
  return `<div dir="${locale === 'ar' ? 'rtl' : 'ltr'}" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
}

/** Renders a template; every placeholder must be provided (a missing value is a programming error). */
export function render(purpose: Purpose, locale: Locale | 'both', vars: Record<string, string>): Rendered {
  const t = TEMPLATES[purpose];
  const missing = new Set<string>();
  const one = (l: Locale) => ({ subject: fill(t[l].subject, vars, missing), text: fill(t[l].body, vars, missing), sms: fill(t[l].sms, vars, missing) });
  const parts = locale === 'both' ? [one('ar'), one('en')] : [one(locale)];
  if (missing.size) throw new Error(`Template ${purpose} is missing ${[...missing].join(', ')}`);
  const dirs: Locale[] = locale === 'both' ? ['ar', 'en'] : [locale];
  const html = parts.map((p, i) => textToHtml(p.text, dirs[i]!)).join('<hr style="border:none;border-top:1px solid #ddd;margin:24px 0">');
  return {
    subject: parts.map((p) => p.subject).filter(Boolean).join(' | '),
    text: parts.map((p) => p.text).join('\n\n———\n\n'),
    html,
    sms: parts.map((p) => p.sms).join('\n'),
  };
}
