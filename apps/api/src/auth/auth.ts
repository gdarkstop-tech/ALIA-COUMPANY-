import { expo } from '@better-auth/expo';
import { betterAuth } from 'better-auth';
import { phoneNumber, twoFactor } from 'better-auth/plugins';
import type { Pool } from 'pg';
import { webOrigins, type Env } from '../config/env';
import type { Messaging } from '../integrations/messaging';

const EGYPT_MOBILE = /^\+201[0125]\d{8}$/;
export const PHONE_ONLY_EMAIL_DOMAIN = 'phone.ghayarly.invalid';

/**
 * Better Auth instance. It talks to PostgreSQL through `authPool`, a dedicated role that can
 * only reach the `auth` schema — the domain API role cannot read password hashes or tokens.
 */
export function createAuth(env: Env, authPool: Pool, messaging: Messaging) {
  const isProd = env.NODE_ENV === 'production';
  const signInLimit = env.AUTH_SIGNIN_RATE_LIMIT ?? 5;
  return betterAuth({
    appName: 'Ghayarly',
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
      sendResetPassword: async ({ user, url, token }) => {
        await messaging.email.send({
          channel: 'email',
          to: user.email,
          subject: 'Reset your Ghayarly password',
          body: `Use this link to reset your password: ${url} (code: ${token}). It expires in 30 minutes.`,
          purpose: 'password-reset',
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        if (user.email.endsWith(`@${PHONE_ONLY_EMAIL_DOMAIN}`)) return;
        await messaging.email.send({
          channel: 'email',
          to: user.email,
          subject: 'Confirm your email for Ghayarly',
          body: `Confirm your email address: ${url}`,
          purpose: 'email-verification',
        });
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
    plugins: [
      expo(),
      phoneNumber({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 5,
        phoneNumberValidator: (value) => EGYPT_MOBILE.test(value),
        sendOTP: async ({ phoneNumber: to, code }) => {
          await messaging.sms.send({ channel: 'sms', to, body: `Your Ghayarly code is ${code}. It expires in 5 minutes.`, purpose: 'phone-otp' });
        },
        signUpOnVerification: {
          getTempEmail: (phone) => `${phone.replace('+', '')}@${PHONE_ONLY_EMAIL_DOMAIN}`,
          getTempName: () => 'Ghayarly user',
        },
      }),
      twoFactor({
        issuer: 'Ghayarly',
        accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 900 },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
