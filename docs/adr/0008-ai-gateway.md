# ADR 0008 — Provider-independent AI gateway; the database is the quota and budget boundary

- Status: accepted (2026-10-27)

## Context
The product needs AI features (text assistant first, later voice, document analysis and clinician
drafting) from several vendors (Anthropic, OpenAI, Google) with business-owned keys, weekly plan
allowances, cost control and strict medical safety rules. The model must never be the security or
safety boundary, and the apps must never hold a provider key.

## Decision
1. **Adapters behind one interface** (`apps/api/src/integrations/ai`): `complete()` and a free
   `healthCheck()` per provider, using each vendor's official SDK. A missing key makes the adapter
   `NOT_CONFIGURED`; nothing outside this folder knows which vendor answered. A `SIMULATED` adapter
   exists for development only and is unavailable whenever `NODE_ENV=production` or dev tools are off.
2. **Configuration lives in the database** (migration `0011_ai_gateway.sql`): models with prices in
   micro-USD per 1M tokens, routes (`patient.chat`), a model + fallback + effort per plan tier, plan
   and clinician weekly quotas, and a single monthly spending cap. A paid model can only be active
   with a **verified** price (who and when are recorded by a trigger; editing a price clears the
   verification). Every change writes the audit log.
3. **Reserve → call → settle.** `app.ai_reserve()` runs every gate in one transaction under an
   advisory lock (account active, feature flag or INTERNAL_TEST account, route enabled, AI consent,
   active model, cap set and not reached for paid models, weekly allowance) and commits *before* the
   provider is called, so concurrent requests cannot overspend. The provider call happens outside
   any transaction. `app.ai_settle()` records provider-reported usage and the cost from the serving
   model's verified price (otherwise flagged `cost_estimated`); a refusal or a failure releases the
   unit. Stale reservations stop counting after 10 minutes.
4. **Deterministic safety in code, before the model**: emergency red flags (EN + Arabic) return
   fixed guidance to call 123 without any model call or quota use; the operator policy forbids
   diagnosis, wound assessment, prescribing and product recommendations; the shared profile summary
   is minimal (age, sex, allergies, conditions, medications — no name or contacts), opt-in per
   conversation, read through RLS, and framed as data, not instructions.
5. **Privacy**: AI processing needs its own consent (`AI_ASSISTANT_PROCESSING`, off by default).
   Conversations are readable only by their owner (RLS); staff and the control centre see counts,
   tokens and costs, never content. Account deletion deletes conversations; usage rows (no content)
   are kept for billing. The provider receives an HMAC-derived end-user reference, not the user ID.
6. **Launch gate**: `ai.assistant` is a HIGH-risk regulated flag that the database refuses to enable
   without an evidence reference. Until then only INTERNAL_TEST accounts can use the route.

## Consequences
- Switching or adding a provider is a configuration change plus, for a new vendor, one adapter.
- Cost figures are only as good as the verified prices; unverified prices are labelled estimates.
- The monthly cap is checked at reservation time, so requests already in flight when the cap is
  reached can exceed it by at most (concurrent requests × cost of one answer).
- Provider-side data retention and processing location are contractual and must be confirmed by
  legal before launch (placeholder in the AI consent text).
