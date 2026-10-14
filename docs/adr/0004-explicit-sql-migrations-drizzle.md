# ADR 0004 — Explicit SQL migrations; Drizzle for queries

- Status: accepted (2026-10-14)

## Decision
SQL migration files are the schema source of truth (types, RLS, grants, triggers, functions).
A small runner applies them transactionally with checksums and an advisory lock. Drizzle ORM
mirrors the schema for typed queries (`apps/api/src/db/schema.ts`); `timestamptz` values are
normalised to ISO-8601 strings for all clients.

## Consequences
Security-relevant DDL is always visible in review. The Drizzle mirror must be updated with each
migration; integration tests exercise both.
