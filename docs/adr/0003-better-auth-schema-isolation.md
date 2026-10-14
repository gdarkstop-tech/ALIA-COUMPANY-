# ADR 0003 — Better Auth in an isolated `auth` schema

- Status: accepted (2026-10-14)

## Decision
Use Better Auth 1.7 (email/password, phone OTP, TOTP 2FA, official Expo plugin) on its own
connection pool and role. Its tables are created by explicit SQL generated from the configuration
and committed as a migration. The domain role gets column-limited, RLS-filtered read access to
`auth.user` only — never to password hashes, sessions, OAuth tokens or 2FA secrets.

## Consequences
Auth upgrades that change the schema require regenerating and reviewing a migration. No custom
cryptography is implemented anywhere in the codebase.
