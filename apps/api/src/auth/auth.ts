import { expo } from '@better-auth/expo';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { phoneNumber, twoFactor } from 'better-auth/plugins';
import type { Pool } from 'pg';
import { BRAND_NAME_EN, PHONE_ONLY_EMAIL_DOMAIN } from '@ghayarly/shared';
import { webOrigins, type Env } from '../config/env';
import { normalizePhone } from '../notifications/phone';
import { NotificationRateLimited, NotificationUnavailable, type Notifier } from '../notifications/service';

export { PHONE_ONLY_EMAIL_DOMAIN };

/** What the auth flows need from the notification service (sign-in codes and links only). */
export type SecretSender = Pick<Notifier, 'sendSecret'>;

/** Delivery problems become clean API answers; the code or link is never part of an error. */
async function sendOrRefuse(send: () => Promise<void>) {
  try {
    await send();
  } catch (e) {
    if (e instanceof NotificationRateLimited) throw APIError.from('TOO_MANY_REQUESTS', { code: 'TOO_MANY_MESSAGES', message: 'Too many codes were sent to this destination. Try again later.' });
    if (e instanceof NotificationUnavailable) throw APIError.from('SERVICE_UNAVAILABLE', { code: 'DELIVERY_NOT_CONFIGURED', message: 'Messages cannot be sent right now.' });
    throw APIError.from('SERVICE_UNAVAILABLE', { code: 'DELIVERY_FAILED', message: 'The message could not be delivered. Try again shortly.' });
  }
}

/**
 * Better Auth instance. It talks to PostgreSQL through `authPool`, a dedicated role that can
 * only reach the `auth` schema — the domain API role cannot read password hashes or tokens.
 */
export function createAuth(env: Env, authPool: Pool, notifier: SecretSender) {
  const smsCountries = env.SMS_ALLOWED_COUNTRIES.split(',');
  const isProd = env.NODE_ENV === 'production';
  const signInLimit = env.AUTH_SIGNIN_RATE_LIMIT ?? 5;
  return betterAuth({
    appName: BRAND_NAME_EN,
    baseURL: env.API_PUBLIC_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: authPool,
    trustedOrigins: [...webOrigins(env), `${env.MOBILE_SCHEME}://`, ...(isProd ? [] : ['exp://'])],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      requireEmailVerification: env.AUTH_REQUIRE_EMAIL_VERIFICATION,
      resetPasswordTokenExpiresIn: 60 * 30,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        // Phone-only accounts have no mailbox: they reset through a phone code instead.
        if (user.email.endsWith(`@${PHONE_ONLY_EMAIL_DOMAIN}`)) return;
        await sendOrRefuse(() => notifier.sendSecret({ channel: 'EMAIL', to: user.email, userId: user.id, purpose: 'auth.password_reset', vars: { url } }));
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        if (user.email.endsWith(`@${PHONE_ONLY_EMAIL_DOMAIN}`)) return;
        await sendOrRefuse(() => notifier.sendSecret({ channel: 'EMAIL', to: user.email, userId: user.id, purpose: 'auth.email_verification', vars: { url } }));
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 15,
    },
    rateLimit: {
      enabled: env.NODE_ENV !== 'test',
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: signInLimit },
        '/sign-up/email': { window: 60, max: 5 },
        '/phone-number/send-otp': { window: 60, max: 3 },
        '/phone-number/verify': { window: 60, max: 5 },
        '/request-password-reset': { window: 300, max: 3 },
        '/two-factor/verify-totp': { window: 60, max: 5 },
      },
    },
    advanced: {
      // Explicit: Better Auth otherwise skips origin/CSRF checks when NODE_ENV=test.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      cookiePrefix: 'ghayarly',
      useSecureCookies: isProd,
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true, secure: isProd },
      ipAddress: { ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'] },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/phone-number/verify') return;
        const body = (ctx.body ?? {}) as { updatePhoneNumber?: boolean };
        // Re-binding the sign-in phone needs only a session plus a code sent to the NEW number, so a
        // stolen session could plant a permanent password-less way in. No app flow uses it.
        if (body.updatePhoneNumber) {
          throw APIError.from('FORBIDDEN', { code: 'PHONE_CHANGE_NOT_ALLOWED', message: 'Changing the sign-in phone number is not available' });
        }
      }),
      // A phone code is a single factor: accounts with two-step verification sign in with their
      // password and authenticator code instead. Checked AFTER the code is verified, so the answer
      // cannot be used to probe which numbers belong to protected accounts; the session the
      // verification just created is destroyed and its cookie is never sent.
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/phone-number/verify') return;
        const created = ctx.context.newSession;
        if (!created) return;
        const user = await ctx.context.adapter.findOne<{ twoFactorEnabled?: boolean | null }>({ model: 'user', where: [{ field: 'id', value: created.user.id }] });
        if (!user?.twoFactorEnabled) return;
        await ctx.context.internalAdapter.deleteSession(created.session.token);
        ctx.context.responseHeaders?.delete('set-cookie');
        throw APIError.from('FORBIDDEN', { code: 'USE_PASSWORD_SIGN_IN', message: 'Sign in with your email, password and authenticator code' });
      }),
    },
    plugins: [
      expo(),
      phoneNumber({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 5,
        // E.164 mobile numbers in the countries SMS may be sent to (Egypt by default).
        phoneNumberValidator: (value) => {
          const p = normalizePhone(value, { allowedCountries: smsCountries });
          return p.ok && p.e164 === value;
        },
        sendOTP: async ({ phoneNumber: to, code }) => {
          await sendOrRefuse(() => notifier.sendSecret({ channel: 'SMS', to, purpose: 'auth.phone_otp', vars: { code } }));
        },
        signUpOnVerification: {
          getTempEmail: (phone) => `${phone.replace('+', '')}@${PHONE_ONLY_EMAIL_DOMAIN}`,
          getTempName: () => `${BRAND_NAME_EN} user`,
        },
      }),
      twoFactor({
        issuer: BRAND_NAME_EN,
        accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 900 },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
