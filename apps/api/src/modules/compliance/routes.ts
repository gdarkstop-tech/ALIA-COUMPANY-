import {
  CONSENT_TYPES,
  FEATURE_KEYS,
  REQUIRED_ACCOUNT_CONSENTS,
  clientErrorReportBody,
  deleteAccountBody,
  recordConsentBody,
  updateFeatureFlagBody,
  type ConsentState,
  type ConsentType,
  type ConsentsResponse,
  type DeleteAccountResponse,
  type FeatureFlagAdmin,
  type FeatureFlags,
} from '@ghayarly/shared';
import { desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db/client';
import { consentEvents, featureFlags, settings } from '../../db/schema';
import { AppError, forbidden, notFound, unprocessable } from '../../lib/errors';
import { enforceMfa, getPrincipal, inContext, requirePrincipal, requireRole } from '../../lib/principal';
import { sessionKey } from '../../lib/rateLimitKey';
import { parse } from '../../lib/validate';

/** Re-authentication window for accounts without a password (phone OTP sign-in). */
const FRESH_SESSION_MS = 15 * 60 * 1000;

async function currentVersions(tx: Tx): Promise<Record<ConsentType, string>> {
  const [row] = await tx.select({ value: settings.value }).from(settings).where(eq(settings.key, 'consent.current_versions'));
  if (!row) throw new AppError(500, 'CONSENT_VERSIONS_MISSING', 'Consent configuration missing');
  return row.value as Record<ConsentType, string>;
}

async function consentState(tx: Tx, userId: string): Promise<ConsentsResponse> {
  const versions = await currentVersions(tx);
  const events = await tx
    .select()
    .from(consentEvents)
    .where(eq(consentEvents.userId, userId))
    .orderBy(desc(consentEvents.occurredAt), desc(consentEvents.id));
  const consents: ConsentState[] = CONSENT_TYPES.map((type) => {
    const latest = events.find((e) => e.consentType === type);
    return {
      type,
      currentVersion: versions[type],
      granted: Boolean(latest?.granted && latest.documentVersion === versions[type]),
      answeredVersion: latest?.documentVersion ?? null,
      answeredAt: latest?.occurredAt ?? null,
      required: REQUIRED_ACCOUNT_CONSENTS.includes(type),
    };
  });
  return {
    consents,
    missingRequired: consents.filter((c) => c.required && !c.granted).map((c) => c.type),
    healthDataConsented: consents.find((c) => c.type === 'HEALTH_DATA_PROCESSING')!.granted,
  };
}

/** Strips obvious personal data from free-text client error messages before logging. */
/** Strips what a crash report must never carry: contact details, numbers (ASCII or Arabic-Indic
 *  digits), JWT-like tokens and the VALUE after any credential keyword. */
export function redact(text: string | undefined): string | undefined {
  return text
    ?.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]')
    .replace(/(token|cookie|authorization|password|passcode|secret|bearer|otp)\S*\s*[:=]?\s*(bearer\s+)?\S+/giu, '[redacted]')
    .replace(/[+\d\u0660-\u0669\u06F0-\u06F9][\d\u0660-\u0669\u06F0-\u06F9\s-]{6,}[\d\u0660-\u0669\u06F0-\u06F9]/gu, '[number]');
}

export async function complianceRoutes(app: FastifyInstance) {
  const { auth, pools, env } = app.services;

  // ---------------------------------------------------------------- consents
  app.get('/me/consents', async (request) => {
    const principal = await requirePrincipal(request);
    return inContext(request, principal, (tx) => consentState(tx, principal.userId));
  });

  app.post('/me/consents', async (request) => {
    const principal = await requirePrincipal(request);
    const body = parse(recordConsentBody, request.body);
    return inContext(request, principal, async (tx) => {
      const versions = await currentVersions(tx);
      for (const c of body.consents) {
        if (c.version !== versions[c.type]) throw unprocessable('STALE_CONSENT_VERSION', `Current ${c.type} version is ${versions[c.type]}`);
        if (!c.granted && REQUIRED_ACCOUNT_CONSENTS.includes(c.type)) {
          // Terms / privacy cannot be "withdrawn" while keeping the account: that is account deletion.
          throw unprocessable('REQUIRED_CONSENT_USE_ACCOUNT_DELETION', 'Delete the account to stop all processing');
        }
      }
      await tx.insert(consentEvents).values(
        body.consents.map((c) => ({ userId: principal.userId, consentType: c.type, documentVersion: c.version, granted: c.granted, source: body.source, locale: body.locale })),
      );
      return consentState(tx, principal.userId);
    });
  });

  // ---------------------------------------------------------------- account deletion
  app.post('/me/account-deletion', { config: { rateLimit: { max: 5, timeWindow: '15 minutes', keyGenerator: sessionKey } } }, async (request): Promise<DeleteAccountResponse> => {
    const principal = await requirePrincipal(request);
    const body = parse(deleteAccountBody, request.body);

    // Re-authentication: password when the account has one, otherwise a recent sign-in.
    const { rows: creds } = await pools.authPool.query<{ password: string | null }>(
      `select "password" from auth."account" where "userId" = $1 and "providerId" = 'credential' and "password" is not null limit 1`,
      [principal.userId],
    );
    const hash = creds[0]?.password;
    if (hash) {
      if (!body.password) throw unprocessable('PASSWORD_REQUIRED', 'Enter your password to confirm');
      const ctx = await auth.$context;
      const ok = await ctx.password.verify({ password: body.password, hash });
      if (!ok) throw forbidden('INVALID_PASSWORD', 'Password is incorrect');
    } else {
      const { rows } = await pools.authPool.query<{ createdAt: Date }>(`select "createdAt" from auth."session" where "id" = $1`, [principal.sessionId]);
      const createdAt = rows[0]?.createdAt;
      if (!createdAt || Date.now() - new Date(createdAt).getTime() > FRESH_SESSION_MS) {
        throw forbidden('RECENT_SIGN_IN_REQUIRED', 'Sign in again, then delete your account within 15 minutes');
      }
    }

    const summary = await inContext(request, principal, async (tx) => {
      const result = await tx.execute<{ summary: DeleteAccountResponse['summary'] }>(sql`select app.delete_my_account('IN_APP') as summary`);
      return result.rows[0]!.summary;
    });
    request.log.info({ event: 'account.deleted' }, 'account deleted by user');
    return {
      deleted: true,
      summary: {
        deletedPatientProfiles: summary.deletedPatientProfiles,
        detachedSharedProfiles: summary.detachedSharedProfiles,
        providerProfileDeleted: summary.providerProfileDeleted,
        providerRecordsRetainedForLegalObligations: summary.providerRecordsRetainedForLegalObligations,
      },
    };
  });

  // ---------------------------------------------------------------- feature flags
  /** Effective flags for the caller. Review / internal-test accounts may use store subscriptions
   *  while they are off for everyone else, so App Review can buy the submitted products. */
  app.get('/system/features', async (request): Promise<FeatureFlags> => {
    const principal = await getPrincipal(request);
    const { rows, storeSubscriptions } = await inContext(request, principal, async (tx) => ({
      rows: await tx.select({ key: featureFlags.key, enabled: featureFlags.enabled }).from(featureFlags),
      storeSubscriptions: (await tx.execute<{ ok: boolean }>(sql`select app.store_subscriptions_available() as ok`)).rows[0]?.ok ?? false,
    }));
    const map = new Map(rows.map((r) => [r.key, r.enabled]));
    map.set('billing.store_subscriptions', storeSubscriptions);
    return Object.fromEntries(FEATURE_KEYS.map((k) => [k, map.get(k) ?? false])) as FeatureFlags;
  });

  const toAdmin = (r: typeof featureFlags.$inferSelect): FeatureFlagAdmin => ({
    key: r.key,
    enabled: r.enabled,
    risk: r.risk,
    requiresRegulatoryEvidence: r.requiresRegulatoryEvidence,
    evidenceRef: r.evidenceRef,
    description: r.description,
    updatedAt: r.updatedAt,
  });

  app.get('/admin/features', async (request) => {
    const principal = await requireRole(request, 'ADMIN');
    enforceMfa(request, principal);
    const rows = await inContext(request, principal, (tx) => tx.select().from(featureFlags).orderBy(featureFlags.key));
    return rows.map(toAdmin);
  });

  app.patch<{ Params: { key: string } }>('/admin/features/:key', async (request) => {
    const principal = await requireRole(request, 'ADMIN');
    enforceMfa(request, principal);
    const body = parse(updateFeatureFlagBody, request.body);
    const row = await inContext(request, principal, async (tx) => {
      const [existing] = await tx.select().from(featureFlags).where(eq(featureFlags.key, request.params.key));
      if (!existing) throw notFound('Feature flag');
      if (body.enabled && existing.requiresRegulatoryEvidence && !(body.evidenceRef ?? existing.evidenceRef)) {
        throw unprocessable('REGULATORY_EVIDENCE_REQUIRED', 'This feature needs a documented regulatory evidence reference before it can be enabled');
      }
      const [updated] = await tx
        .update(featureFlags)
        .set({ enabled: body.enabled, ...(body.evidenceRef !== undefined ? { evidenceRef: body.evidenceRef } : {}) })
        .where(eq(featureFlags.key, request.params.key))
        .returning();
      return updated!;
    });
    return toAdmin(row);
  });

  // ---------------------------------------------------------------- client error intake (crash baseline)
  app.post('/telemetry/client-errors', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request) => {
    const body = parse(clientErrorReportBody, request.body);
    // Deliberately NOT linked to the user: no user id, no session, no IP in the log line.
    request.log.warn(
      {
        clientError: {
          name: redact(body.name),
          message: redact(body.message),
          stack: env.NODE_ENV === 'production' ? redact(body.stack)?.slice(0, 2000) : redact(body.stack),
          route: redact(body.route?.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')),
          platform: body.platform,
          appVersion: body.appVersion,
          appVariant: body.appVariant,
          fatal: body.fatal,
        },
      },
      'client error report',
    );
    return { ok: true };
  });
}
