# Dress My Wound | غير لي

Premium healthcare & home-care platform for Egypt: **One patient. One care team. One medical timeline.**

| Document | Purpose |
| --- | --- |
| [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) | Product source of truth (full specification) |
| [`docs/IMPLEMENTATION_CHECKLIST.md`](docs/IMPLEMENTATION_CHECKLIST.md) | What is done / partial / not configured / not started |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System architecture and module map |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Security & privacy model (RLS, roles, MFA, audit) |
| [`docs/adr/`](docs/adr) | Architecture decision records |
| [`docs/release/`](docs/release) | App Store / Google Play readiness: checklists, privacy, payments, healthcare, brand, signing, **release status** |

## Monorepo

```
apps/
  api/        Fastify 5 + Better Auth 1.7 + Drizzle — modular monolith (PostgreSQL 16 + PostGIS, RLS)
  mobile/     Expo SDK 57 + Expo Router — iOS, Android and web (Arabic RTL / English, light / dark)
  admin/      Next.js 16 — staff console (provider verification, users, audit log, MFA)
packages/
  shared/     Domain enums, permission matrix, verification state machine, Zod contracts
  tokens/     Design tokens (colour, type, spacing, motion) for mobile and admin
  i18n/       Arabic + English dictionaries with type-safe keys
  api-client/ Typed API client used by mobile and admin
apps/site/    Static public site: support, privacy, terms, web account deletion (store URLs)
store/        Store listing metadata (EN/AR) and provisional store graphics
e2e/          Playwright acceptance flows A–E against the running stack
infra/        Docker Compose (PostGIS, Redis, MinIO, Mailpit)
scripts/      Database role bootstrap
```

## Prerequisites

- Node.js ≥ 22.12 and pnpm 10 (`corepack enable`)
- PostgreSQL 16 with PostGIS 3 — either Docker (`infra/docker-compose.yml`) or a native install
- Redis 7 (optional locally; used for distributed rate limiting)

## Run it locally

```bash
pnpm install

# 1) Database roles + databases (ghayarly, ghayarly_test) — choose one:
docker compose -f infra/docker-compose.yml up -d          # runs the bootstrap automatically
# or, with a native PostgreSQL superuser:
PSQL="psql -U postgres" pnpm db:bootstrap

# 2) Configuration
cp apps/api/.env.example apps/api/.env          # set BETTER_AUTH_SECRET: openssl rand -base64 48
cp apps/mobile/.env.example apps/mobile/.env
cp apps/admin/.env.example apps/admin/.env.local

# 3) Schema + synthetic demo data (development only)
pnpm db:reset            # = drop project schemas → migrate → seed

# 4) Start everything (three terminals, or `pnpm dev`)
pnpm dev:api             # http://localhost:4000
pnpm dev:web             # Expo web          http://localhost:8081
pnpm dev:admin           # Admin console     http://127.0.0.1:3001
pnpm dev:mobile          # Expo dev server for iOS/Android (Expo Go / dev build)
```

> Open the admin console on **127.0.0.1** and the Expo web app on **localhost**: browsers scope
> cookies by host, so the two sessions stay separate during development.
> Android emulator: set `EXPO_PUBLIC_API_URL=http://10.0.2.2:4000` in `apps/mobile/.env`.

### Demo accounts (synthetic — development showcase only)

All use password `DressMyWound-Demo-2026`. Emails use the reserved `.test` TLD.

| Role | Email | Notes |
| --- | --- | --- |
| Patient | `patient.demo@demo.ghayarly.test` | Self + mother profiles, health baseline |
| Doctor | `doctor.demo@demo.ghayarly.test` | Verified (synthetic credentials) |
| Nurse | `nurse.demo@demo.ghayarly.test` | Verified; synthetic ledger shows the earnings UI |
| Admin + clinical reviewer | `admin.demo@demo.ghayarly.test` | Admin console |
| Pending doctor / nurse | `doctor.pending@…`, `nurse.pending@…` | Waiting in the verification queue |

Phone OTP and password-reset messages are **not delivered** in development: they appear in the API
log and at `GET /dev/outbox` (only when `DEV_TOOLS_ENABLED=true`, refused in production).

## Quality gates

```bash
pnpm typecheck    # TypeScript (all packages)
pnpm lint         # ESLint (flat config, zero warnings)
pnpm test         # unit + API + auth + migration + RLS/security tests (needs ghayarly_test DB)
pnpm e2e          # Playwright flows A–E + Arabic RTL (needs the stack running and `pnpm db:reset`)
```

If Playwright's bundled Chromium is not installed, point it at an existing build with
`PW_CHROMIUM_PATH=/path/to/chrome pnpm e2e`.

## Native builds (iOS & Android)

The product ships as native apps built from `apps/mobile` (Expo SDK 57 / React Native 0.86).
Variants are selected with `APP_VARIANT` (`development` | `preview` | `production`) in
`apps/mobile/app.config.ts`; store builds run on EAS (`apps/mobile/eas.json`). See
[`docs/release/SIGNING_AND_SECRETS.md`](docs/release/SIGNING_AND_SECRETS.md).

```bash
# Local Android verification build (debug-signed — not distributable)
cd apps/mobile && APP_VARIANT=production EXPO_PUBLIC_API_URL=https://api.example.com \
  npx expo prebuild --platform android --clean && (cd android && ./gradlew bundleRelease assembleRelease)
bash scripts/release/verify-android.sh apps/mobile/android/app/build/outputs/apk/release/app-release.apk

pnpm release:check        # brand spelling, store metadata limits, icons, native config, no committed keys
pnpm brand:assets         # regenerate the PROVISIONAL icon / splash / store graphics
pnpm --filter @ghayarly/api review:seed   # App Store / Play review accounts (isolated synthetic data)
pnpm --filter @ghayarly/site build        # public support / privacy / delete-account pages
```

## What is real vs. simulated in this build

- **Real:** authentication (Better Auth), sessions, phone OTP flow, 2FA (TOTP), RLS-enforced
  persistence, family consent model, provider onboarding & verification workflow, capacity
  controls, discovery, cart and server-side totals, audit log.
- **Real, but switched off by server-side feature flags until accounts/approvals exist:** store
  subscriptions (server-verified Apple/Google entitlements; `NOT_CONFIGURED` without store
  credentials), regulated clinical/AI features (cannot be enabled without a regulatory-evidence
  reference — enforced by the database).
- **Simulated / not configured (labelled in the UI):** payments (Paymob adapter reports
  `NOT_CONFIGURED`; checkout is a preview only — no order, no charge), SMS/email delivery (dev
  outbox), file storage, medical AI, push notifications, maps. Every TetraSol catalogue item,
  provider, price and ledger entry in the seed is synthetic and flagged `is_demo`.
