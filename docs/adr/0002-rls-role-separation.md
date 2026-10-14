# ADR 0002 — PostgreSQL RLS with three database roles

- Status: accepted (2026-10-14)

## Context
Medical records must stay isolated even if application code has a bug. RLS is ineffective if
the application connects as the table owner or a BYPASSRLS role.

## Decision
- `ghayarly_owner` owns all objects and is used only by migrations/seeds.
- `ghayarly_app` (domain API) is not an owner and has no BYPASSRLS; every `app` table has RLS.
- `ghayarly_auth` (Better Auth) can reach only the `auth` schema.
- Per request, the API sets transaction-local `app.user_id` / `app.demo_mode`; policies derive
  roles and patient access from tables through `SECURITY DEFINER` helpers with pinned
  `search_path`. Guard triggers (SECURITY INVOKER) enforce state machines and protected columns;
  owner-run AFTER triggers write tamper-proof history.
- The server refuses to boot if its role could bypass RLS.

## Consequences
Defence in depth with tests that connect as the app role. Every new table requires explicit
policies and grants in its migration (reviewed like code).
