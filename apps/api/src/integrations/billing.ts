/**
 * Platform store adapters (server side). They VERIFY; they never simulate success.
 *
 *   Apple  — App Store Server Library (Apple's official Node library): verifies the JWS signature
 *            chain to Apple's root certificates, bundle id, app id and environment.
 *   Google — Play Developer API (purchases.subscriptionsv2.get / acknowledge) with a service
 *            account; Real-time developer notifications are authenticated by verifying the
 *            Pub/Sub push OIDC token.
 *
 * Without credentials each adapter reports NOT_CONFIGURED and every call throws
 * STORE_NOT_CONFIGURED — nothing is ever granted.
 */
import { Environment, SignedDataVerifier } from '@apple/app-store-server-library';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Env } from '../config/env';
import { AppError } from '../lib/errors';
import type { GoogleSubscriptionV2 } from '../modules/billing/events';

export type StoreStatus = 'CONFIGURED' | 'NOT_CONFIGURED';
const notConfigured = (store: string) => new AppError(503, 'STORE_NOT_CONFIGURED', `${store} billing is not configured on this server`);

// ---------------------------------------------------------------- Apple
type Decoded = Awaited<ReturnType<SignedDataVerifier['verifyAndDecodeTransaction']>>;
type DecodedNotification = Awaited<ReturnType<SignedDataVerifier['verifyAndDecodeNotification']>>;
type DecodedRenewal = Awaited<ReturnType<SignedDataVerifier['verifyAndDecodeRenewalInfo']>>;

export type AppleStore = {
  status: StoreStatus;
  verifyTransaction(signed: string): Promise<Decoded>;
  verifyNotification(signedPayload: string): Promise<{ notification: DecodedNotification; tx: Decoded | null; renewal: DecodedRenewal | null }>;
};

export function createAppleStore(env: Env): AppleStore {
  const configured = Boolean(env.APPLE_IAP_BUNDLE_ID && env.APPLE_ROOT_CERTS_DIR && (env.APPLE_IAP_APP_APPLE_ID || env.NODE_ENV !== 'production'));
  if (!configured) {
    return {
      status: 'NOT_CONFIGURED',
      verifyTransaction: async () => Promise.reject(notConfigured('Apple')),
      verifyNotification: async () => Promise.reject(notConfigured('Apple')),
    };
  }
  const dir = env.APPLE_ROOT_CERTS_DIR!;
  const roots = readdirSync(dir).filter((f) => /\.(cer|der)$/i.test(f)).map((f) => readFileSync(join(dir, f)));
  if (!roots.length) throw new Error(`APPLE_ROOT_CERTS_DIR (${dir}) contains no Apple root certificates (.cer)`);
  const appId = env.APPLE_IAP_APP_APPLE_ID;
  const online = env.APPLE_IAP_ONLINE_CHECKS;
  // Production first; Sandbox is still needed for App Review and TestFlight (policy limits who benefits).
  const verifiers = [new SignedDataVerifier(roots, online, Environment.PRODUCTION, env.APPLE_IAP_BUNDLE_ID!, appId), new SignedDataVerifier(roots, online, Environment.SANDBOX, env.APPLE_IAP_BUNDLE_ID!)];
  const firstOk = async <T>(fn: (v: SignedDataVerifier) => Promise<T>): Promise<T> => {
    let last: unknown;
    for (const v of verifiers) {
      try {
        return await fn(v);
      } catch (e) {
        last = e;
      }
    }
    throw new AppError(422, 'INVALID_STORE_SIGNATURE', 'The App Store transaction could not be verified', { cause: String((last as Error)?.message ?? last) });
  };
  return {
    status: 'CONFIGURED',
    verifyTransaction: (signed) => firstOk((v) => v.verifyAndDecodeTransaction(signed)),
    verifyNotification: (signedPayload) =>
      firstOk(async (v) => {
        const notification = await v.verifyAndDecodeNotification(signedPayload);
        const tx = notification.data?.signedTransactionInfo ? await v.verifyAndDecodeTransaction(notification.data.signedTransactionInfo) : null;
        const renewal = notification.data?.signedRenewalInfo ? await v.verifyAndDecodeRenewalInfo(notification.data.signedRenewalInfo) : null;
        return { notification, tx, renewal };
      }),
  };
}

// ---------------------------------------------------------------- Google
export type GoogleStore = {
  status: StoreStatus;
  getSubscription(purchaseToken: string): Promise<GoogleSubscriptionV2>;
  acknowledge(productId: string, purchaseToken: string): Promise<void>;
  /** Verifies the Authorization: Bearer <OIDC token> header of a Pub/Sub push request. */
  verifyPush(authorization: string | undefined): Promise<void>;
};

export function createGoogleStore(env: Env): GoogleStore {
  const pkg = env.GOOGLE_PLAY_PACKAGE_NAME;
  const sa = env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64;
  if (!pkg || !sa || !env.GOOGLE_RTDN_AUDIENCE || !env.GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL) {
    return {
      status: 'NOT_CONFIGURED',
      getSubscription: async () => Promise.reject(notConfigured('Google Play')),
      acknowledge: async () => Promise.reject(notConfigured('Google Play')),
      verifyPush: async () => Promise.reject(notConfigured('Google Play')),
    };
  }
  const credentials = JSON.parse(Buffer.from(sa, 'base64').toString('utf8')) as Record<string, string>;
  const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/androidpublisher'] });
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(pkg)}/purchases`;
  const oidc = new OAuth2Client();
  return {
    status: 'CONFIGURED',
    async getSubscription(purchaseToken) {
      const client = await auth.getClient();
      const res = await client.request<GoogleSubscriptionV2>({ url: `${base}/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}` });
      return res.data;
    },
    async acknowledge(productId, purchaseToken) {
      const client = await auth.getClient();
      await client.request({ url: `${base}/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`, method: 'POST', data: {} });
    },
    async verifyPush(authorization) {
      const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
      if (!token) throw new AppError(401, 'UNAUTHENTICATED_PUSH', 'Missing push token');
      const ticket = await oidc.verifyIdToken({ idToken: token, audience: env.GOOGLE_RTDN_AUDIENCE });
      const payload = ticket.getPayload();
      if (!payload?.email_verified || payload.email !== env.GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL) throw new AppError(401, 'UNAUTHENTICATED_PUSH', 'Unexpected push identity');
    },
  };
}

export type Stores = { apple: AppleStore; google: GoogleStore };
export function createStores(env: Env): Stores {
  return { apple: createAppleStore(env), google: createGoogleStore(env) };
}
