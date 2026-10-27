# AI gateway — status, setup and cost control

**Verified on:** 2026-10-27 · Design: [ADR 0008](../adr/0008-ai-gateway.md)

> **Status:** the gateway, quotas, cost metering, admin control centre and the patient text chat
> are `CODE_READY`. **No AI provider is configured** (`NOT_CONFIGURED` for Anthropic, OpenAI and
> Gemini), no model price has been verified, no monthly cap is set, and `ai.assistant` is OFF.
> No real AI answer has been produced by this system. The chat has only been exercised with the
> development simulator, whose answers are labelled "SIMULATED".

## 1. What exists

| Part | Where | Verified by |
|---|---|---|
| Provider adapters: Anthropic (Messages API, official SDK), OpenAI (Responses API), Gemini (`@google/genai`), simulator | `apps/api/src/integrations/ai/` | `apps/api/test/ai-adapters.test.ts` (8): real Anthropic/OpenAI adapters against a stubbed HTTP layer (request shape, usage, refusals, truncation, retries). Gemini: type checking only. **Not verified against the live APIs** (no keys). |
| Gateway: reserve → call → settle, fallback model, emergency short-circuit | `apps/api/src/modules/ai/routes.ts`, migration `0011_ai_gateway.sql` | `apps/api/test/ai.test.ts` (13) |
| Weekly allowances (Silver 50 / Gold 150 / Platinum 400 chat messages; 5 / 15 / 35 analyses; 180 / 1,200 / 2,700 voice seconds), Monday 00:00 Cairo reset, clinicians 0 by default | `app.ai_plan_quotas`, `app.ai_role_quotas` | `ai.test.ts`: concurrent requests at the limit — exactly the allowance succeeds |
| Monthly spending cap, verified prices, audit of every change | `app.ai_budget`, `app.ai_models`, trigger `app.ai_config_audit` | `ai.test.ts` |
| AI consent (off by default), privacy-centre switch, legal notice | migration `0010_ai_consent.sql`, `packages/shared/src/legal.ts` (`ai-assistant-consent`) | `ai.test.ts`, E2E `flow-f-assistant` |
| Patient chat (mobile): availability from the server, allowance, opt-in profile summary, emergency card with call button, delete conversation | `apps/mobile/src/app/patient/assistant/` | E2E `flow-f-assistant` (web harness) |
| AI control centre (admin) | `apps/admin/src/app/ai/page.tsx` | E2E `flow-e-ai` |

Only analyses and voice **quotas** exist; analysis (documents, lab reports) and voice features are
not built.

## 2. Configure a provider (exact steps)

Each provider shows `NOT_CONFIGURED` until its key is present in the API's environment.

1. **Business-owned account.** Create (or use) an organisation account owned by Alia Group, not a
   personal one:
   - Anthropic: Claude Console → organisation → workspace for this app → API key.
   - OpenAI: OpenAI Platform → organisation → project for this app → API key.
   - Google: Google AI Studio or Vertex AI in a company Google Cloud project → API key / service.
   Set billing, a provider-side spending limit and rate limits in that console. Review the provider's
   commercial terms, data-processing addendum, data-retention options and processing region with
   legal (they go into the `ai-assistant-consent` placeholder and the privacy policy).
2. **Store the key only in the API server's secret manager**, one value per environment:

   | Variable | Provider |
   |---|---|
   | `AI_ANTHROPIC_API_KEY` | Anthropic |
   | `AI_OPENAI_API_KEY` | OpenAI |
   | `AI_GEMINI_API_KEY` | Google Gemini |
   | `AI_REQUEST_TIMEOUT_MS` (optional, default 120000) | all |

   Never put a key in the repository, in `EXPO_PUBLIC_*` / EAS variables, in the mobile app, in the
   admin console or in the database. `pnpm release:check` fails if a key pattern is committed.
3. Restart the API. In **Admin → AI control centre → Providers** the row turns `Configured`.
   Use **Check connection**: it calls the provider's model-metadata endpoint (no generation, not billed).
4. **Models and prices.** The Anthropic rows are seeded *inactive and unverified* with reference
   prices (USD per 1M tokens, cached 2026-10-06: Opus 5.5 $4 in / $20 out / $0.20 cache read;
   Sonnet 5.5 $2 / $10 / $0.20; Haiku 5.5 $0.10 / $0.50). Compare each price with the provider's
   current price list or your contract, fix it if needed, record the source, then **Mark prices
   verified** and **Activate**. The database refuses to activate a paid model without a verified price.
   Add OpenAI/Gemini models with **Add model** (they start inactive and unverified).
5. **Routing.** For `patient.chat`, pick the model, optional fallback (used when the provider fails
   or is overloaded) and effort for each tier (Silver = Basic, Gold = Advanced, Platinum = Premium),
   then enable the route.
6. **Monthly cap.** Set a cap in US dollars. Until one is set, paid models are blocked
   (`AI_BUDGET_NOT_SET`); when metered spend reaches it they stop for everyone (`AI_BUDGET_EXHAUSTED`).
7. **Internal testing.** Only `INTERNAL_TEST` accounts can use the assistant while `ai.assistant`
   is off. In development the seed creates `ai.tester@demo.ghayarly.test` (synthetic). In other
   environments an operator sets `account_kind` with the owner database role (never via the app).
8. **Launch.** Enabling `ai.assistant` for everyone needs the evidence reference the database asks
   for: clinical-safety and AI-governance review (HEALTHCARE_REVIEW R3), EDA position (R2), PDPC
   licence / cross-border permit if the provider processes data outside Egypt (R13), legal approval
   of the AI notice, and store disclosures (Apple 5.1.2(i) explicit permission before sharing data
   with third-party AI — implemented as the AI consent switch; Google Play AI-generated content rules).

## 3. Cost metering

- Cost per request = provider-reported tokens × verified price of the model that actually served it
  (input, output and cache-read priced separately; Anthropic server-side fallback attempts are all
  metered). Without a verified price the cost is the requested model's price, marked *estimated*.
- Refusals by the provider and failures release the allowance; emergencies never reach a model.
- The cap is checked when a request is reserved, so requests already in flight can exceed it by
  at most one answer each.
- **Missing billing data:** no verified prices, no monthly cap, no provider invoices to reconcile
  against. Provider prices are not assumed free and are not hard-coded as final.
