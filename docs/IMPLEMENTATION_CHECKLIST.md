# Implementation checklist

Legend: **DONE** (implemented, tested) · **PARTIAL** (works, scope incomplete) ·
**NOT_CONFIGURED** (adapter exists, external service/credentials missing — labelled in UI) ·
**NOT STARTED**. Last updated: 2026-10-14 (end of Milestone 1).

## Milestone 1 — Foundation

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| 1 | Monorepo structure | DONE | pnpm workspaces + Turborepo; shared, tokens, i18n, api-client packages |
| 2 | Mobile app initialisation | DONE | Expo SDK 57 + Expo Router; web verified in browser; Android/iOS JS bundles compile (`expo export`). Not launched on a device/simulator (none available in the build environment). |
| 3 | Backend API | DONE | Fastify 5 modular monolith |
| 4 | PostgreSQL schema & migrations | DONE | 5 explicit SQL migrations, checksummed runner, PostGIS |
| 5 | Better Auth integration | DONE | Email/password, phone OTP, TOTP 2FA, sessions/devices, reset, Expo plugin |
| 6 | Role permissions | DONE | Shared matrix mirrored in SQL (consistency test) |
| 7 | Initial RLS policies & tests | DONE | All `app` tables; 24 direct-DB security tests as the app role |
| 8 | Shared design system | DONE | Tokens (light/dark) + mobile UI kit + admin CSS variables |
| 9 | Arabic / English | DONE | Type-safe dictionaries (parity tested); RTL on web and native |
| 10 | Welcome / onboarding | DONE | Welcome, progressive 3-step patient onboarding, provider profile onboarding |
| 11 | Patient/Doctor/Nurse role selection | DONE | Self-selection limited to the three primary roles (API + RLS) |
| 12 | Sign-in / sign-up | DONE | Plus phone OTP, password reset, 2FA verification screens |
| 13 | Patient profile & family switching | DONE | Consent/guardianship model, profile switcher, access management/revocation |
| 14 | Doctor & nurse onboarding | DONE | Profile, credentials, submission |
| 15 | Provider verification states | DONE | SQL-enforced state machine, history, audit |
| 16 | Doctor/Nurse listing (synthetic data) | DONE | Filters: type, specialty, area, gender, accepting-only, search, sort |
| 17 | Provider capacity/status controls | DONE | Status, stop new patients, daily capacity, radius, pause, away-until, working hours |
| 18 | Patient dashboard | DONE | Real data only; future sections shown as "coming next" |
| 19 | Doctor dashboard | DONE | Verification, availability, net earnings, placeholders for M2/M3 sections |
| 20 | Nurse dashboard | DONE | Plus services and earnings screens |
| 21 | Basic admin verification screen | DONE | Next.js console: queue, review, credential decisions, decisions with reasons |
| 22 | TetraSol-only store UI on approved-data-ready schema | DONE | Catalogue, detail, variants, family purchase, cart, simulated checkout preview |
| 23 | Navigation between screens | DONE | Session gate, stacks, tabs, stack reset on auth boundaries |
| 24 | Environment templates | DONE | `apps/*/.env.example` |
| 25 | Local startup commands | DONE | See README |
| 26 | Automated smoke tests | DONE | 94 unit/API/auth/RLS tests (24 direct-DB security tests) + 6 Playwright E2E (flows A–E, Arabic RTL) |

### Cross-cutting status after M1

| Area | Status | Notes |
| --- | --- | --- |
| Payments (Paymob) | NOT_CONFIGURED | Gateway abstraction in place; refuses to create intents; checkout is preview only |
| SMS / email delivery | NOT_CONFIGURED | Dev outbox adapter only (development); production sends fail loudly |
| Private object storage (documents, wound photos) | NOT_CONFIGURED | MinIO in compose; adapter + signed URLs not yet wired; credential documents not uploadable |
| Medical AI | NOT_CONFIGURED (multi-provider gateway built, no provider key) | `ai.assistant` OFF; internal test accounts only; development simulator only. Setup: `docs/release/AI_GATEWAY.md` |
| Push notifications, maps | NOT_CONFIGURED | |
| MFA enforcement | PARTIAL | Enforced on staff endpoints when `MFA_ENFORCEMENT=required` (mandatory in prod); clinician enforcement on patient-data endpoints arrives with M3 |
| Email verification | PARTIAL | Emails sent to dev outbox; required in production config |
| Redis | PARTIAL | Used for API rate limiting when configured; no background jobs yet |
| Realtime / WebSocket | NOT STARTED | Needed for chat & arrival tracking (M2/M3) |
| Docker Compose | PARTIAL | File provided; not executed in this build environment (no Docker daemon) — native PostgreSQL/PostGIS and Redis were used |
| CI | PARTIAL | GitHub Actions workflow committed; not yet observed running on GitHub |
| Field-level encryption, backups | NOT STARTED | Milestone 6 |

## Milestone 2 — Core bookings — NOT STARTED
Search & matching (distance via PostGIS), availability slots, waitlists & notify-me, booking,
Nurse Now, pricing rules, visit verification (rotating PIN/QR + multi-signal), Paymob integration
with verified webhooks and idempotency, double-entry earnings ledger & settlement, reviews and fair
ranking, recurring visits, backup nurse matching, document upload with signed URLs.

## Milestone 3 — Continuous care — NOT STARTED
Care teams & relationships, care plans, doctor–nurse collaboration, secure chat, vitals and
observations, medical timeline, calendar, adult profile claiming & consent receipts, notifications.

## Milestone 4 — Commerce & monetization — PARTIAL
Done: admin product management (products, images, variants, stock ledger, prices, discounts/promo
codes, bundles, categories, approval gates, analytics), store subscriptions with server-verified
entitlements (flag OFF). Not started: orders & tracking, Buy Again, QR onboarding, health credits,
care programs, paid checkout (Paymob not configured).

## Milestone 5 — Medical AI (DMW Medical AI) — IN PROGRESS
Scope correction (2026-10-27): medical AI only; the creative / marketing image-generation studio and
Midjourney are out of scope for this phase.

| Slice | Status | Notes |
| --- | --- | --- |
| 0 — Gateway foundation (ADR 0008) | DONE | Reserve → call → settle, quotas, cap, consent, patient text chat, control centre |
| 1 — Multi-model gateway (ADR 0009) | DONE (no live provider) | Qwen, Grok, Kimi, MedGemma adapters; registry; eligibility routing; budgets; concurrency; evaluation suite with clinical approval. All providers NOT_CONFIGURED |
| 2 — Real patient AI | DONE (no live provider) | Report AI response + reviewer queue, preferences and assistant name, stronger emergency detection, operator smoke test (`ai:smoke`). A real answer still needs a business key |
| 3 — Curated medical knowledge | TODO | Approved articles, retrieval with citations |
| 4 — Realtime voice | TODO | |
| 5 — Lab and document AI | TODO | |
| 6 — Health analytics | TODO | |
| 7 — Clinician copilots | TODO | Needs care relationships (Milestone 3) |
| 8 — Company-product knowledge | TODO | |
| 10 — Admin cost / finance | PARTIAL | Spend, plan caps and alerts done; finance views TODO |
| 11 — Wound and imaging research | TODO | Diagnostic features stay behind disabled flags |

## Milestone 6 — Production hardening — NOT STARTED
Security testing, performance, accessibility audit, device testing, CI/CD, observability,
deployment docs, backup/restore drills, clinical safety review, integration verification.
