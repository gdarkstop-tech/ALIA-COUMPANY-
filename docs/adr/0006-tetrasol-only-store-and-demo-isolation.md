# ADR 0006 — TetraSol-only commerce and synthetic-data isolation

- Status: accepted (2026-10-14)

## Decision
The store schema enforces `brand = 'TetraSol'`; customer visibility requires `APPROVED` content
with a brand approval reference. Development placeholders are `is_demo`, must use `demo-*` slugs,
can never be `APPROVED`, and are visible only when the request runs in demo mode (which production
refuses). The same `is_demo` flag marks synthetic providers, services, patients and ledger lines, and
every client renders a visible "Demo / synthetic" label.

## Consequences
The production catalogue stays empty until the brand supplies approved data — by design.
