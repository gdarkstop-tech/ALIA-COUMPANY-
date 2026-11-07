# ADR 0019 — AI provider states and a database-enforced kill switch

- Status: accepted (2026-11-07) — implemented; no real provider key exists in any environment yet, so every real provider is `NOT_CONFIGURED`
- Extends: [ADR 0008 AI gateway](0008-ai-gateway.md), [ADR 0018](0018-ai-finance-center.md)
- Code: migration `0029_ai_provider_states.sql`; `apps/api/src/modules/ai/admin.ts` (`providerState`, health check, `/providers/:code/control`); `apps/api/src/integrations/ai/index.ts` (`providerKeyFingerprints`); `apps/api/src/integrations/status.ts`; admin `src/app/ai/page.tsx`
- Tests: `apps/api/test/ai-providers.test.ts`; E2E `flow-e-ai` (E4b)

## Context
The console showed only "configured / not configured". It could not say whether a business key
actually works, whether a key was rotated since it was checked, or switch a misbehaving provider off
without redeploying. Health checks were audited but not remembered. System status also counted only
Anthropic, OpenAI and Gemini as real providers.

## Decision
1. **Five states**, derived by one function (`providerState`):
   - `NOT_CONFIGURED` — no business key / endpoint in this environment;
   - `DISABLED` — switched off by an administrator, with a required reason;
   - `VERIFIED` / `ERROR` — the latest console health check *with the current key* passed / failed,
     within the last 30 days;
   - `CONFIGURED` — otherwise (never checked, key changed since, or check older than 30 days).
   The development simulator is never `VERIFIED`.
2. **Checks are remembered** in `app.ai_provider_checks` (append-only): provider, model, outcome, a
   short detail and a 12-hex **HMAC fingerprint** of key + endpoint (keyed with a server secret) —
   never the key. A rotated key therefore shows as unverified again. An unconfigured provider leaves
   no check row.
3. **Kill switch enforced by PostgreSQL.** `app.ai_provider_controls` holds on/off per provider.
   The router entry points `app.ai_reserve`, `app.ai_route_status` and `app.ai_voice_start` keep
   their signatures but are now thin wrappers that pass the provider list through
   `app.ai_usable_providers()`; the original bodies (`*_unfiltered`) are not executable by the
   application role. Evaluation runs on a disabled provider are refused (`AI_PROVIDER_DISABLED`).
   Every enable/disable is audited.
4. **System status** reports `CONFIGURED` when any real provider is configured (Qwen, Grok, Kimi and
   MedGemma included).
5. **Smoke tests stay manual and synthetic**: `pnpm --filter @ghayarly/api ai:smoke --provider … --model …`
   sends one non-patient question with the production policy and prints the outcome, usage and
   latency; it needs the business-owned key in the environment and returns `NOT_CONFIGURED` otherwise.

## Not done
- Per-provider error rates from live traffic: provider errors are released without recording which
  provider failed, so a count would be misleading; it needs the release path to record the provider.
- Real verification of any provider: there is no business-owned key yet.

## Consequences
- Operators can see at a glance which providers are proven to work with the current key.
- A provider can be stopped instantly for every feature without a deploy, and an API bug cannot
  route around it.
- Future routing changes must replace the `*_unfiltered` functions, not the wrappers.
