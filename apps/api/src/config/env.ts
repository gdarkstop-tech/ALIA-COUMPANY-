import { z } from 'zod';

/**
 * Environment configuration. Validated once at boot; the process refuses to start with an
 * unsafe production configuration (demo mode, MFA in warn mode, dev tools, weak secrets).
 */
const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** Public base URL of this API (used by Better Auth for callbacks). */
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
  /** Comma-separated browser origins allowed to call the API with credentials. */
  WEB_ORIGINS: z.string().default('http://localhost:8081,http://localhost:3001,http://127.0.0.1:3001'),
  /** Deep-link scheme of the mobile app (trusted by Better Auth's Expo plugin). */
  MOBILE_SCHEME: z.string().default('dressmywound'),

  /** Connection for domain queries — role WITHOUT ownership / BYPASSRLS. RLS applies. */
  DATABASE_URL_APP: z.string().min(1),
  /** Connection for Better Auth — role limited to the `auth` schema. */
  DATABASE_URL_AUTH: z.string().min(1),
  /** Schema owner. Used ONLY by the migration and seed scripts, never by the server. */
  DATABASE_URL_OWNER: z.string().optional(),

  REDIS_URL: z.string().optional(),

  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  AUTH_REQUIRE_EMAIL_VERIFICATION: bool(false),
  /** `required`: staff/clinician endpoints reject sessions without 2FA. `warn`: allowed with a warning (dev only). */
  MFA_ENFORCEMENT: z.enum(['required', 'warn']).default('warn'),

  /**
   * Reverse proxies in front of the API in production (load balancer, CDN). The client IP used by
   * every rate limit is taken this many hops back in X-Forwarded-For; `true`-style trust would let
   * clients spoof it. Set to the real number of hops for the hosting setup.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),

  /** Sign-in attempts per minute per IP. Defaults to 5 (production); development may raise it for E2E runs. */
  AUTH_SIGNIN_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).optional(),

  /**
   * General API limits (ADR 0016). Signed-in traffic is counted per account, so many people behind
   * one carrier-grade NAT address do not throttle each other; anonymous traffic per IP; and a
   * looser per-IP ceiling over all traffic stops one address flooding with many accounts. Tests
   * default to values that never trigger unless a test lowers them.
   */
  RATE_LIMIT_ACCOUNT_PER_MIN: z.coerce.number().int().min(1).max(100_000).optional(),
  RATE_LIMIT_ANON_IP_PER_MIN: z.coerce.number().int().min(1).max(100_000).optional(),
  RATE_LIMIT_IP_CEILING_PER_MIN: z.coerce.number().int().min(1).max(1_000_000).optional(),
  /** Photo and document uploads per account per 24 hours (storage-cost and abuse cap). */
  UPLOADS_PER_ACCOUNT_PER_DAY: z.coerce.number().int().min(1).max(10_000).optional(),

  DEMO_MODE: bool(false),
  DEV_TOOLS_ENABLED: bool(false),

  PAYMOB_API_KEY: z.string().optional(),
  PAYMOB_HMAC_SECRET: z.string().optional(),
  PAYMOB_INTEGRATION_ID: z.string().optional(),
  SMS_PROVIDER_API_KEY: z.string().optional(),
  EMAIL_PROVIDER_API_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** Encryption key for stored medical images (32 bytes, base64). From the secret manager; never committed. */
  OBJECT_STORAGE_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'OBJECT_STORAGE_KEY must be 32 bytes, base64-encoded')
    .optional(),
  /** Development / test object store directory (the local adapter is refused in production). */
  OBJECT_STORAGE_DIR: z.string().default('.data/objects'),
  /** Signs short-lived media links (≥ 32 chars). Development falls back to a key derived from BETTER_AUTH_SECRET. */
  MEDIA_LINK_SECRET: z.string().min(32).optional(),

  // Platform store billing (digital subscriptions). Unset → NOT_CONFIGURED, nothing purchasable.
  APPLE_IAP_BUNDLE_ID: z.string().optional(),
  /** Numeric App Store app id (App Store Connect → App Information). Required in production. */
  APPLE_IAP_APP_APPLE_ID: z.coerce.number().int().positive().optional(),
  /** Directory with Apple root certificates (AppleRootCA-G3.cer …) downloaded from apple.com/certificateauthority. */
  APPLE_ROOT_CERTS_DIR: z.string().optional(),
  APPLE_IAP_ONLINE_CHECKS: bool(true),
  GOOGLE_PLAY_PACKAGE_NAME: z.string().optional(),
  /** Service-account key JSON, base64-encoded. Supply from the secret manager — never commit. */
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64: z.string().optional(),
  /** Audience configured on the Pub/Sub push subscription for Real-time developer notifications. */
  GOOGLE_RTDN_AUDIENCE: z.string().optional(),
  GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  // AI providers: business-owned keys from the secret manager. Unset → NOT_CONFIGURED for that provider.
  AI_ANTHROPIC_API_KEY: z.string().min(10).optional(),
  AI_OPENAI_API_KEY: z.string().min(10).optional(),
  AI_GEMINI_API_KEY: z.string().min(10).optional(),
  /** Alibaba Cloud Model Studio: key and base URL belong to one workspace and region (no default). */
  AI_QWEN_API_KEY: z.string().min(10).optional(),
  AI_QWEN_BASE_URL: z.string().url().optional(),
  /** xAI API (Grok). */
  AI_GROK_API_KEY: z.string().min(10).optional(),
  AI_GROK_BASE_URL: z.string().url().optional(),
  /** Moonshot Kimi API (global endpoint by default; China-mainland keys need their own base URL). */
  AI_KIMI_API_KEY: z.string().min(10).optional(),
  AI_KIMI_BASE_URL: z.string().url().optional(),
  /** Company-operated MedGemma endpoint (OpenAI-compatible, e.g. vLLM) and its bearer key. */
  AI_MEDGEMMA_BASE_URL: z.string().url().optional(),
  AI_MEDGEMMA_API_KEY: z.string().min(16).optional(),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(600_000).default(120_000),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // A blank line copied from .env.example (`AI_QWEN_API_KEY=`) means "not set", not an invalid value.
  const parsed = schema.safeParse(Object.fromEntries(Object.entries(source).filter(([, v]) => v !== '')));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    const problems: string[] = [];
    if (env.DEMO_MODE) problems.push('DEMO_MODE must be false in production');
    if (env.DEV_TOOLS_ENABLED) problems.push('DEV_TOOLS_ENABLED must be false in production');
    if (env.MFA_ENFORCEMENT !== 'required') problems.push('MFA_ENFORCEMENT must be "required" in production');
    if (!env.AUTH_REQUIRE_EMAIL_VERIFICATION) problems.push('AUTH_REQUIRE_EMAIL_VERIFICATION must be true in production');
    if (env.AUTH_SIGNIN_RATE_LIMIT && env.AUTH_SIGNIN_RATE_LIMIT > 10) problems.push('AUTH_SIGNIN_RATE_LIMIT must be ≤ 10 in production');
    if (!env.REDIS_URL) problems.push('REDIS_URL is required in production (rate-limit counters shared by every API instance)');
    if (env.DATABASE_URL_OWNER) problems.push('DATABASE_URL_OWNER must not be provided to the production server process');
    if (/change-me|dev-only/i.test(env.BETTER_AUTH_SECRET)) problems.push('BETTER_AUTH_SECRET looks like a development placeholder');
    if (!env.MEDIA_LINK_SECRET) problems.push('MEDIA_LINK_SECRET is required in production (signs medical image links)');
    for (const [name, url] of [['AI_QWEN_BASE_URL', env.AI_QWEN_BASE_URL], ['AI_GROK_BASE_URL', env.AI_GROK_BASE_URL], ['AI_KIMI_BASE_URL', env.AI_KIMI_BASE_URL], ['AI_MEDGEMMA_BASE_URL', env.AI_MEDGEMMA_BASE_URL]] as const) {
      if (url && !url.startsWith('https://')) problems.push(`${name} must use https in production (patient data in transit)`);
    }
    if (problems.length) throw new Error(`Refusing to start with unsafe production configuration:\n  - ${problems.join('\n  - ')}`);
  }
  return env;
}

export function webOrigins(env: Env): string[] {
  return env.WEB_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
