# ADR 0009 — Model registry, eligibility-based routing and clinician-gated evaluation

- Status: accepted (2026-10-27)
- Extends: [ADR 0008](0008-ai-gateway.md)

## Context
DMW Medical AI must use several providers (Anthropic, OpenAI, Google Gemini, Alibaba Qwen, xAI
Grok, Moonshot Kimi) and medical models (Google MedGemma, later MedSigLIP / MedASR) behind one
assistant. Choosing a model must take cost, language, capability and availability into account, but
must never send patient data to a provider without an approved data-processing basis, and must never
put an unevaluated model in front of patients on a medical route. Specialised medical models are not
clinically validated by being specialised (MedGemma's own model card says so).

## Decision
1. **Adapters.** One interface; Anthropic (Messages API), OpenAI and xAI (Responses API, `store:
   false`), Gemini (`@google/genai`), and a shared OpenAI-compatible Chat Completions adapter for
   Qwen (workspace/region base URL, no default), Kimi and a company-operated MedGemma endpoint
   (bearer key, https in production). Only documented request fields are sent.
2. **Registry** (`app.ai_models`): capabilities, hosting, data region, known limitations, verified
   prices, and a **patient-data approval** (DPA / privacy-terms reference) that only
   `ai.data.approve` can set; changing region or hosting clears it.
3. **Routing** (`app.ai_route_candidates`): ordered candidates per route and plan tier, optionally
   tagged by language and complexity. The database router returns up to three *eligible* candidates:
   enabled, active, provider configured on this server, required capability, data-processing approval
   (patient-data routes) and **clinical approval** (gated routes). Order: complexity match, language
   match, priority, then price. Paid candidates drop out when the company, plan or personal monthly
   budget is unset or spent. The API tries the first; only on a retryable failure it tries one
   fallback, preferring another provider. The router sees request size and language, never content.
4. **Evaluation suite.** Synthetic cases (DRAFT until a clinical reviewer — not the author — reviews
   them), deterministic screens (emergency number present, forbidden phrases absent, answer language),
   runs executed against a model with the production policy and metered into company spend, every
   answer scored by a clinical reviewer (accuracy, hallucination, unsafe, Arabic quality). A reviewer
   can approve a model for a route only when every result is reviewed, none is unsafe and the
   thresholds in `app.settings['ai.eval.thresholds']` are met. Approvals record the policy version
   and can be revoked at once.
5. **Internal test accounts** skip the two approval gates (never the flag-less, consent, budget or
   quota gates) so the pipeline can be exercised before launch; they must never hold real patient data.

## Consequences
- A cheaper or newer model reaches patients only through the same evidence path as any other.
- Evaluation spends real budget once a provider is configured; it is capped by the company budget.
- Automated screens are not a measure of medical accuracy; clinicians remain the judges.
- MedSigLIP (embeddings) and MedASR (English dictation) need their own adapters and use cases
  (imaging research, clinician dictation) and are not part of this decision's implementation.
