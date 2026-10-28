# DMW Medical AI — gateway status, setup and cost control

**Verified on:** 2026-10-28 · Design: [ADR 0008](../adr/0008-ai-gateway.md), [ADR 0009](../adr/0009-model-registry-routing-evaluation.md), [ADR 0010](../adr/0010-realtime-voice-relay.md), [ADR 0011](../adr/0011-lab-report-reading.md), [ADR 0012](../adr/0012-health-analytics.md)

> **Status:** the multi-provider gateway, model registry, eligibility-based routing, evaluation
> suite, quotas, budgets, cost metering, admin control centre, the patient text chat, realtime
> voice (server relay), lab-report reading (transcription + person-confirmed rows) and grounded health
> summaries are `CODE_READY`. **No AI provider is configured on any environment** — Anthropic, OpenAI, Gemini,
> Qwen, Grok, Kimi and MedGemma are all `NOT_CONFIGURED` — no model price is verified, no monthly
> cap is set, no model has patient-data or clinical approval, and `ai.assistant`, `ai.voice`, `ai.document_analysis` and `ai.health_summary` are OFF. **No real
> AI answer has been produced by this system.** Every run so far used scripted providers in automated
> tests or the labelled development simulator.

## 1. What exists

| Part | Where | Verified by |
|---|---|---|
| Adapters: Anthropic (Messages API), OpenAI and xAI Grok (Responses API, `store: false`), Gemini (`@google/genai`), Qwen / Kimi / MedGemma endpoint (OpenAI-compatible Chat Completions), simulator. Document attachments (PDF / images, per-adapter support table) and strict JSON-schema output | `apps/api/src/integrations/ai/` | `test/ai-adapters.test.ts` (19): real adapters against a **stubbed HTTP layer** (request shape, usage incl. cache, refusals, moderation errors, truncation, retries, health checks, env rules; document / image blocks and JSON-schema formats for Anthropic, OpenAI, Gemini and Chat Completions; PDF refused before any call on Chat Completions). **None verified against a live API** (no keys). |
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
| Realtime voice (route `patient.voice`): server-side WebSocket relay with the business key; single-use 60 s ticket sent as a subprotocol (hash stored, header redacted from logs, origin checked); separate voice consent; every transcribed turn checked for emergencies **before** the model may answer (provider VAD never answers on its own); barge-in with truncation to what was heard; seconds reserved in 30 s blocks with a hard stop; ≤ 10 min per session; settlement with audio/text/cached tokens + input transcription priced from the registry; reaper for abandoned sessions; only text transcripts stored (`channel = VOICE`) | migrations 0017–0018; `apps/api/src/modules/ai/voice.ts`; `apps/api/src/integrations/ai/realtime/` | `test/ai-voice.test.ts` (13: gates, tickets, emergency EN/AR, interruption, refusal, quota hard stop, block extension and consent withdrawal, idle, disconnect, concurrency, isolation), `test/ai-realtime-adapter.test.ts` (7: OpenAI Realtime wire format against a **local stand-in server**, usage aggregation, handshake errors, text-mode evaluation, simulator) |
| Voice client: microphone capture and playback (native: `react-native-audio-api`, development / preview builds only; web harness: Web Audio), live transcript, remaining time, stop answer, end, emergency card, voice consent inline; voice-marked transcripts in the conversation | `apps/mobile/src/features/assistant/voice/`, `apps/mobile/src/app/patient/assistant/voice.tsx` | E2E `flow-f-voice` (**web harness only**, Chromium fake microphone fed a synthetic signal + simulator). **Not run on any iOS or Android device.** |
| Lab reports (route `patient.document`, flag `ai.document_analysis` OFF): documents stored per profile under RLS with the health-data consent (type from the bytes, ≤ 10 MB); single-use 60 s view links (hash stored, ticket redacted from logs); separate document consent asked inline; the model only **transcribes** the results table into strict JSON; numbers, printed ranges and in/out-of-range status computed by deterministic code (a bound like `< 5` is never a number; the model cannot set a status); rows stay `PENDING_REVIEW` until the person confirms / corrects / rejects each one; one reading per document, ≤ 5 paid failed readings a day; manual entry | migrations 0020–0021; `apps/api/src/modules/documents/`; `packages/shared/src/documents.ts`; mobile `app/patient/documents/` | `test/documents.test.ts` (15: sniffing, RLS, view tickets, gates, request shape, deterministic status, review and provenance, invalid output cost, not-a-lab-report, refusal, fallback, concurrency, re-read, deletion, manual entry, evaluation run, log redaction), shared parser tests, E2E `flow-f-documents` (**web harness only**, simulator). Extraction accuracy **not evaluated** with any real model or real report |
| Document evaluation: cases on route `patient.document` carry a synthetic report rendered to a PDF at run time and sent exactly like a patient upload; automated row-by-row checks (test, value, unit, flag, document type, extra rows); 10 English DRAFT starter cases incl. a printed prompt injection and a non-lab document | migration 0021; `apps/api/src/modules/ai/evaluation.ts`; Admin → AI → Evaluation | `documents.test.ts` (perfect reader passes 10/10; a reader that drops flags and invents a row fails 9/10) |
| Health summaries (route `patient.health_summary`, flag `ai.health_summary` OFF): the model receives only numbered facts the app calculated from readings and **confirmed** lab results (no names, notes or free text) and returns JSON points citing them; the API rejects any number not in the cited facts, numbers in questions, and judgements of progress, normality, conditions, medicines or treatment (EN/AR); rejected answers are never shown, recorded as cost (`INVALID_OUTPUT`), not counted, ≤ 5 a day; facts and summary stored together and shown side by side | migration 0022; `apps/api/src/modules/analytics/`; `packages/shared/src/analytics.ts`; mobile `app/patient/readings.tsx` | `test/analytics.test.ts` (8: readings validation / provenance / immutability / RLS / consent, trends from confirmed data only and unmixed units, gates, request contents, rejection reasons and metering, refusal, evaluation run with grounded vs judgemental writers), shared validator tests, E2E `flow-f-readings` (**web harness only**, simulator). Summary quality **not evaluated** with any real model |
| Operator smoke test with a real key: one short non-patient question, prints outcome, usage and latency | `pnpm --filter @ghayarly/api ai:smoke -- --provider <CODE> --model <id>` | Run on 2026-10-27: `NOT_CONFIGURED` for every provider (no keys) |

Not built yet (later slices): clinician copilots, product
knowledge, wound and imaging research. Voice gaps: no Gemini Live / xAI voice adapter (they are
`NOT_CONFIGURED` for voice), no approved-knowledge retrieval in voice answers, no device testing. No medical articles are seeded: the
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

### Realtime voice specifics
- Uses the OpenAI key (`AI_OPENAI_API_KEY`); no extra secret. Models seeded inactive/unverified:
  `gpt-realtime-2.1` and `gpt-realtime-2.1-mini` (text **and audio** prices from the pricing page,
  2026-10-27) and `gpt-4o-mini-transcribe` (input transcription, needed for the emergency check and
  the transcript). Verify all three, approve data processing, run the evaluation on route
  `patient.voice` (text mode, voice policy), clinically approve, add candidates, enable the route.
- Launch also needs: `ai.voice` evidence, the voice notice reviewed by legal (provider audio retention),
  App Store / Play disclosures for audio, a production build variant that links the audio module
  (today only development / preview builds do), device testing (echo, Bluetooth, Android audio), and
  an Arabic (Egyptian) speech-recognition and emergency-detection evaluation on real speech.

### Lab report reading specifics
- Candidates seeded inactive for `patient.document` (all tiers): `claude-sonnet-5-5` (priority 10),
  `gemini-3.8-flash` (20), `gpt-6.1-terra` (30). Each needs verified prices, patient-data approval, an
  evaluation run on `patient.document` (extraction policy, its own policy version) and clinical
  approval for that route. Grok, Qwen, Kimi and MedGemma adapters cannot send PDFs (images only) and
  are not offered PDFs by the router; MedGemma is not registered for this route until evaluated.
- Launch also needs: `ai.document_analysis` evidence, an evaluation on **real, de-identified Egyptian
  lab reports** (Arabic and bilingual, phone photos, multi-page) — the seeded cases are ASCII PDFs —,
  a clinical-safety review of the row-review flow, the document notice reviewed by legal (provider
  retention of files), App Store / Play disclosures for health documents, and native testing of the
  document picker and the original viewer on iOS and Android.

### Health summary specifics
- Candidates seeded inactive for `patient.health_summary` (all tiers, effort `low`): `claude-sonnet-5-5`
  (10), `gemini-3.8-flash` (20), `gpt-6.1-terra` (30). Each needs verified prices, patient-data approval,
  an evaluation run on the route (summary policy, its own policy version) and clinical approval.
- Launch also needs: `ai.health_summary` evidence, a clinical evaluation of real summaries in Arabic and
  English, clinically approved alert thresholds for extreme readings (not built), and legal approval of
  the updated AI notice.

## 3. Cost metering

- Cost per request = provider-reported tokens × verified price of the model that served it (input,
  output, cache-read; all Anthropic server-side fallback attempts metered). Without a verified price
  the cost is marked *estimated*. Evaluation runs count toward company spend.
- Refusals and failures release the allowance; emergencies never reach a model.
- Caps are checked when a request is reserved, so requests already in flight can exceed a cap by at
  most one answer each.
- Voice: cost = text, audio and cached tokens × the model's verified text/audio prices + input
  transcription tokens × the transcription model's price (cost marked *estimated* while that row is
  unverified). **Estimate, not measured** (assumes ~600 audio tokens per minute of the person
  speaking and ~1,200 per minute of the assistant speaking — confirm against real usage):
  `gpt-realtime-2.1-mini` ≈ US$0.02–0.05 per conversation minute; `gpt-realtime-2.1` ≈ US$0.10–0.20;
  transcription ≈ US$0.003 per minute. Weekly allowance ceilings per person with mini: Silver 3 min ≈
  ≤ US$0.15, Gold 20 min ≈ ≤ US$1.00, Platinum 45 min ≈ ≤ US$2.25 (about 3–4× with the full model).
- Lab reports: cost = input tokens (policy + the file; a PDF page is sent as text and image) and
  output tokens (the JSON) × the serving model's verified price. Failed validations are paid and
  recorded but not counted against the allowance; at most 5 per person per day. **Estimate, not
  measured** (assumes ~1,500–3,000 input tokens per page and ~600–1,500 output tokens per report,
  at the registry's unverified prices): `claude-sonnet-5-5` ≈ US$0.01–0.02 per page;
  `gpt-6.1-terra` ≈ US$0.005–0.01; `gemini-3.8-flash` ≈ US$0.004–0.008. Weekly allowance ceilings
  per person with Sonnet and 3-page reports: Silver 5 readings ≈ ≤ US$0.30, Gold 15 ≈ ≤ US$0.90,
  Platinum 35 ≈ ≤ US$2.10 (plus up to 5 failed readings a day).
- Health summaries: small requests (policy ~400 tokens + up to ~40 facts ≈ 600–1,500 input tokens,
  ~200–500 output). **Estimate, not measured**: `claude-sonnet-5-5` ≈ US$0.004–0.008 per summary,
  `gemini-3.8-flash` ≈ US$0.002–0.003, `gpt-6.1-terra` ≈ US$0.002–0.004. Summaries share the weekly
  `ANALYSES` allowance with lab-report reading.
- **Missing billing data:** no verified prices, no caps, no provider invoices to reconcile against;
  Kimi, Qwen and MedGemma prices are unknown. Prices are not assumed free and are not final until verified.
