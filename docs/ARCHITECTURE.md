# Architecture

Status: Milestone 1 (foundation). Decisions are recorded in [`adr/`](adr).

## 1. Shape of the system

```
 ┌────────────────────┐   HTTPS (cookie / SecureStore)   ┌──────────────────────────────┐
 │ Mobile app (Expo)  │ ───────────────────────────────▶ │ API — Fastify modular monolith│
 │ iOS · Android · Web│                                   │                              │
 └────────────────────┘                                   │  /api/auth/*  Better Auth    │──▶ auth schema   (role ghayarly_auth)
 ┌────────────────────┐   same-origin proxy (rewrites)    │  /v1/*        domain modules │──▶ app schema    (role ghayarly_app, RLS)
 │ Admin (Next.js)    │ ───────────────────────────────▶ │  integrations: payments, SMS,│
 └────────────────────┘                                   │  email, storage, AI (adapters)│
                                                          └──────────────────────────────┘
                                                                    │ migrations / seed only
                                                                    ▼
                                                           role ghayarly_owner (schema owner)
```

- **Modular monolith.** One deployable API with domain modules (`apps/api/src/modules/*`):
  `me`, `patients`, `providers`, `services`, `store`, `dashboard`, `admin`, `system`, `dev`.
  Modules share the database and request context but not each other's internals.
- **Clients are separate apps** that share contracts (`@ghayarly/shared`), the typed client
  (`@ghayarly/api-client`), tokens (`@ghayarly/tokens`) and dictionaries (`@ghayarly/i18n`).

## 2. Request lifecycle (API)

1. Fastify plugins: helmet, CORS (allow-list, credentials), rate limit (Redis-backed when
   configured), CSRF origin guard for cookie-authenticated state-changing `/v1` requests.
2. `getPrincipal()` resolves the Better Auth session (`auth.api.getSession`) and loads the user's
   roles **from the database** (never from the client).
3. Route guards (`requireRole`, `requirePermission` + MFA enforcement) give fast, explicit 403s.
4. All domain SQL runs inside `withContext()`: a transaction that first executes
   `set_config('app.user_id', …, true)` and `set_config('app.demo_mode', …, true)`. These settings
   are transaction-local, so pooled connections cannot leak identity between requests.
5. PostgreSQL **Row Level Security** policies, column grants and guard triggers enforce the same
   rules again. A missing `WHERE` clause in application code cannot expose another patient.
6. Errors: Zod → 400, `AppError` → status, PostgreSQL rule violations (`42501`, `P0001`, `23505`…)
   → mapped 403/422/409 with stable error codes; unknown errors → generic 500 (logged, not leaked).

## 3. Data model (Milestone 1)

| Area | Tables | Notes |
| --- | --- | --- |
| Identity | `auth.user/session/account/verification/twoFactor/rateLimit` | Better Auth; only `ghayarly_auth` can touch secrets |
| Roles & profile | `app.user_roles`, `app.user_profiles`, `app.settings` | Internal roles granted only with `users.roles.grant` |
| Audit | `app.audit_log` | Append-only (trigger), readable with `audit.read` |
| Patients & family | `app.patients`, `app.patient_access`, `app.patient_health_entries` | Consent basis per grant; provenance per entry |
| Providers | `app.provider_profiles`, `app.provider_credentials`, `app.provider_verification_events`, `app.provider_working_hours` | State machine enforced in SQL |
| Services | `app.nursing_services`, `app.provider_services` | Scope, eligibility, duration, clinical authorization |
| Commerce | `app.products`, `app.product_variants`, `app.cart_items` | `brand = 'TetraSol'` CHECK; approval reference required |
| Earnings | `app.provider_ledger_entries` | Append-only; app role read-only |

Geography uses PostGIS (`provider_profiles.service_area geography(Point)`) holding an approximate
service-area centroid — never a home address. Health entries map to FHIR resources
(`AllergyIntolerance`, `Condition`, `MedicationStatement`, `Procedure`) for future interoperability.

## 4. Migrations

Explicit SQL files in `apps/api/db/migrations` are the source of truth (RLS, grants, triggers,
functions). `src/db/migrate.ts` applies them in order inside transactions, under an advisory lock,
and refuses to continue if an applied file's checksum changed. Drizzle (`src/db/schema.ts`)
mirrors the schema for type-safe queries; `drizzle-kit push` is never used against real databases.

## 5. Authentication

Better Auth 1.7 with plugins: email/password (min 10 chars, reset with session revocation),
phone number OTP (Egyptian mobiles only, sign-up on verification), two-factor (TOTP + backup
codes, lockout), Expo (deep-link scheme `ghayarly://`). Origin/CSRF checks are explicitly enabled.
Per-endpoint rate limits are stored in the database (multi-instance safe).

- **Mobile native:** `@better-auth/expo` stores the session cookie in iOS Keychain / Android
  Keystore via `expo-secure-store`; the API client attaches it explicitly.
- **Web (Expo web / admin):** HttpOnly `SameSite=Lax` cookies; the admin console proxies
  `/api/auth` and `/v1` through its own origin so cookies are first-party.

## 6. Mobile app

- Expo Router file routes: `welcome`, auth screens, `onboarding/*`, `patient/(tabs)/*` + stack
  screens, `clinician/(tabs)/*`, `settings/*`. `app/index.tsx` is the session gate.
- State: TanStack Query for server state; small React contexts for preferences (locale, theme,
  active family profile), i18n and theme. No tokens in AsyncStorage — preferences only.
- UI kit in `src/ui` consumes semantic tokens only; motion via Reanimated (press scale, entering
  fades), haptics on native.
- RTL: web sets `<html dir>`; native uses `I18nManager.forceRTL` + reload. Directional icons
  mirror automatically; left-to-right tokens (blood types, phone numbers) are bidi-isolated.

## 7. Integrations

Every external dependency sits behind an adapter that reports `CONFIGURED`, `NOT_CONFIGURED`,
`DEV_ADAPTER` or `DISABLED` (`GET /v1/system/status`). Unconfigured adapters fail loudly instead of
pretending (e.g. the Paymob gateway refuses to create intents until the real adapter is implemented
and verified). The dev outbox exists only with `DEV_TOOLS_ENABLED`, which production refuses.

## 8. Environments

`loadEnv()` validates configuration and **refuses to boot production** with demo mode, dev tools,
MFA in warn mode, no email verification, a weak sign-in rate limit, a placeholder secret or the
owner database URL. The server also refuses to start if its database role could bypass RLS.
