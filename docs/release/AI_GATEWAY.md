# DMW Medical AI — gateway status, setup and cost control

**Verified on:** 2026-10-27 · Design: [ADR 0008](../adr/0008-ai-gateway.md), [ADR 0009](../adr/0009-model-registry-routing-evaluation.md)

> **Status:** the multi-provider gateway, model registry, eligibility-based routing, evaluation
> suite, quotas, budgets, cost metering, admin control centre and the patient text chat are
> `CODE_READY`. **No AI provider is configured on any environment** — Anthropic, OpenAI, Gemini,
> Qwen, Grok, Kimi and MedGemma are all `NOT_CONFIGURED` — no model price is verified, no monthly
> cap is set, no model has patient-data or clinical approval, and `ai.assistant` is OFF. **No real
> AI answer has been produced by this system.** Every run so far used scripted providers in automated
> tests or the labelled development simulator.

## 1. What exists

| Part | Where | Verified by |
|---|---|---|
| Adapters: Anthropic (Messages API), OpenAI and xAI Grok (Responses API, `store: false`), Gemini (`@google/genai`), Qwen / Kimi / MedGemma endpoint (OpenAI-compatible Chat Completions), simulator | `apps/api/src/integrations/ai/` | `test/ai-adapters.test.ts` (15): real adapters against a **stubbed HTTP layer** (request shape, usage incl. cache, refusals, moderation errors, truncation, retries, health checks, env rules). Gemini: type checking only. **None verified against a live API** (no keys). |
| Model registry: capabilities, hosting, region, known limitations, verified prices, patient-data approval | `app.ai_models` (migrations 0011, 0013); Admin → AI → Models | `test/ai-routing.test.ts` |
| Router: ordered candidates per route and tier; eligibility (configured, active, capability, data approval, clinical approval, budgets); complexity and language preference; one fallback on a retryable failure, preferring another provider | `app.ai_route_candidates`, `app.ai_reserve()` | `ai-routing.test.ts` (complexity, language, unconfigured provider skipped, budgets, concurrency), `ai.test.ts` (fallback) |
| Evaluation suite: 25 synthetic EN/AR starter cases (DRAFT), deterministic screens, runs metered into company spend, clinical scoring, approval thresholds, revocation | `app.ai_eval_*`, `app.ai_model_route_approvals`; Admin → AI → Evaluation | `ai-routing.test.ts` (review by non-author, version bump on edit, unsafe answer blocks approval, approval enables STANDARD patients, revocation stops routing) |
| Weekly allowances (Silver 50 / Gold 150 / Platinum 400 messages; 5 / 15 / 35 analyses; 180 / 1,200 / 2,700 voice seconds), Monday 00:00 Cairo reset; per-person concurrency limit across devices | `app.ai_plan_quotas`, `app.ai_routes.max_concurrent_per_user` | `ai.test.ts`, `ai-routing.test.ts` |
| Budgets: company monthly cap, per-plan and per-person monthly caps, alerts at 50 / 80 / 100 % | `app.ai_budget`, `app.ai_plan_budgets`, `app.ai_budget_alerts` | `ai-routing.test.ts` |
| AI consent (off by default), privacy-centre switch, legal notice | migration 0010, `packages/shared/src/legal.ts` | `ai.test.ts`, E2E `flow-f-assistant` |
| Patient chat (mobile): availability from the server, allowance, opt-in profile summary, emergency card with call button, delete conversation | `apps/mobile/src/app/patient/assistant/` | E2E `flow-f-assistant` (**web harness only**) |
| AI control centre: Overview, Models, Routing, Evaluation, Safety reports | `apps/admin/src/app/ai/` | E2E `flow-e-ai` |
| Report AI response (mobile) → reviewer queue (Trust & Safety, clinical reviewers): snapshot of the answer (question only if the person chooses), audited content access, append-only history, redaction on account deletion | migration 0015; `apps/mobile/src/app/patient/assistant/[id].tsx`; Admin → AI → Safety reports | `test/ai-reports.test.ts`, E2E F3 + E4 |
| Assistant preferences (reply language, detail) and assistant name, sent as validated settings after the fixed policy (they cannot change the rules) | `app.ai_preferences`; mobile Assistant settings | `ai-reports.test.ts` |
| Deterministic emergency detection (EN + Egyptian/MSA Arabic, typographic apostrophes, diacritics) before any model call | `apps/api/src/modules/ai/safety.ts` | `ai-reports.test.ts` (23 emergency and 6 routine phrases) — **not a clinical validation** of coverage |
| Curated medical knowledge: editors write sourced articles (EN/AR); a clinical reviewer who did not write the revision approves it into an immutable version; drafts and retired articles are never retrieved; Arabic-aware full-text retrieval; the assistant receives approved passages as labelled data and cites them as [K1]…; citations are stored and shown with their source | migration 0016; `apps/api/src/modules/knowledge/`; Admin → AI → Medical knowledge; mobile source screen | `test/knowledge.test.ts` (6), E2E F3 (citation → source) — retrieval quality is **not** clinically evaluated |
| Operator smoke test with a real key: one short non-patient question, prints outcome, usage and latency | `pnpm --filter @ghayarly/api ai:smoke -- --provider <CODE> --model <id>` | Run on 2026-10-27: `NOT_CONFIGURED` for every provider (no keys) |

Not built yet (later slices): realtime voice, lab/document scanning, health analytics, clinician
copilots, product knowledge, wound and imaging research. No medical articles are seeded: the
clinical team must write (or import) and approve them, each with its real source. MedSigLIP (image/text embeddings, research use) and MedASR (English medical dictation)
have no adapter yet.

## 2. Configure a provider (exact steps)

1. **Business-owned account** (an Alia Group organisation, never a personal Claude / ChatGPT
   subscription): Anthropic Console, OpenAI Platform, Google AI Studio or Vertex AI (**paid tier**:
   the free tier may use content to improve Google products), Alibaba Cloud Model Studio (choose
   the region; keys and endpoints are workspace- and region-specific), xAI Console, Kimi platform
   (global or China-mainland — keys are region-locked). Set billing, a provider-side spending limit
   and rate limits there. With legal, review the commercial terms, DPA, retention options and
   processing region; they go into the AI notice placeholder and the privacy policy.
2. **Secrets — API server's secret manager only**, one value per environment:

   | Variables | Provider |
   |---|---|
   | `AI_ANTHROPIC_API_KEY` | Anthropic |
   | `AI_OPENAI_API_KEY` | OpenAI |
   | `AI_GEMINI_API_KEY` | Google Gemini |
   | `AI_QWEN_API_KEY` + `AI_QWEN_BASE_URL` (e.g. `https://<WorkspaceId>.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`) | Alibaba Qwen |
   | `AI_GROK_API_KEY` (optional `AI_GROK_BASE_URL`, default `https://api.x.ai/v1`) | xAI Grok |
   | `AI_KIMI_API_KEY` (optional `AI_KIMI_BASE_URL`, default `https://api.moonshot.ai/v1`) | Moonshot Kimi |
   | `AI_MEDGEMMA_BASE_URL` + `AI_MEDGEMMA_API_KEY` | MedGemma endpoint |
   | `AI_REQUEST_TIMEOUT_MS` (default 120000) | all |

   Never in the repository, `EXPO_PUBLIC_*` / EAS variables, the apps, the admin console or the
   database. Production refuses non-https AI base URLs. `pnpm release:check` scans tracked files
   for Anthropic, OpenAI and Google key patterns.
3. Restart the API. Admin → AI → Overview shows the provider `Configured`; **Check connection** makes
   a model-metadata request (no generation, not billed). Then prove a real answer from the server:
   `pnpm --filter @ghayarly/api ai:smoke -- --provider ANTHROPIC --model claude-haiku-5-5`
   (one short non-patient question; costs a few tokens; exit 2 = NOT_CONFIGURED).
4. **Models** (Admin → AI → Models). Reference rows are seeded *inactive and unverified* from the
   providers' pages (fetched 2026-10-27): Anthropic Opus/Sonnet/Haiku 5.5; OpenAI `gpt-6.1-terra`,
   `gpt-6-luna`; Gemini `gemini-3.8-flash`, `gemini-3.1-flash-lite`; xAI `grok-4.3`, `grok-4.7`;
   Kimi `kimi-k3`, `kimi-k3.1-pro` (no price); Qwen `qwen-plus` (no price); MedGemma
   `google/medgemma-1.5-4b-it` (self-hosted; no price). Confirm each model is available to the
   company account, enter or correct prices with their source, **Mark prices verified**, **Activate**.
5. **Patient-data approval** (holder of `ai.data.approve`): enter the DPA / privacy-terms reference.
   Without it a model never serves a real patient on a route that carries patient data.
6. **Evaluation and clinical approval**: a clinical reviewer reviews (and may rewrite) the starter
   cases; an administrator runs the evaluation on the model (spends budget); the reviewer scores
   every answer and, if the thresholds are met with no unsafe answer, approves the model for
   `patient.chat`. Only then can STANDARD accounts be routed to it.
7. **Routing** (Admin → AI → Routing): add the model as a candidate per tier (priority, optional
   language / SIMPLE-COMPLEX tag, effort), enable the route. The table shows why any candidate would
   be skipped.
8. **Budgets**: set the company monthly cap (required for any paid model), optionally per-plan and
   per-person caps.
9. **Launch** of `ai.assistant` for everyone still needs the evidence reference the database asks for
   (clinical-safety and AI-governance review R3, EDA position R2, PDPC licence / cross-border permit
   R13 if processing is outside Egypt), legal approval of the AI notice, and store disclosures.

### MedGemma specifics
- Model card (HAI-DEF terms): outputs are preliminary and not intended to directly inform diagnosis,
  patient management or treatment; **not evaluated for multi-turn use**; safety evaluated mainly in
  English. Distribution as a hosted service brings obligations under the HAI-DEF terms (legal review).
- Hosting: run it on company infrastructure behind an OpenAI-compatible server (e.g. vLLM) with a
  bearer key, or a managed endpoint exposing the same API. Vertex AI endpoints authenticate with
  short-lived Google credentials, which this adapter does not mint — put an authenticating gateway
  in front, or extend the adapter. GPU size, cost and region must be decided before deployment;
  nothing was downloaded or deployed in this build.
- Intended first use: structured extraction from lab reports (later slice), only after evaluation on
  that task. It is not routed to multi-turn patient chat by default.

## 3. Cost metering

- Cost per request = provider-reported tokens × verified price of the model that served it (input,
  output, cache-read; all Anthropic server-side fallback attempts metered). Without a verified price
  the cost is marked *estimated*. Evaluation runs count toward company spend.
- Refusals and failures release the allowance; emergencies never reach a model.
- Caps are checked when a request is reserved, so requests already in flight can exceed a cap by at
  most one answer each.
- **Missing billing data:** no verified prices, no caps, no provider invoices to reconcile against;
  Kimi, Qwen and MedGemma prices are unknown. Prices are not assumed free and are not final until verified.
