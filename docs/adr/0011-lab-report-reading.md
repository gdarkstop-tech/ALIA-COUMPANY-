# ADR 0011 — Medical documents and AI reading of lab reports

- Status: accepted (2026-10-28)
- Extends: [ADR 0008](0008-ai-gateway.md), [ADR 0009](0009-model-registry-routing-evaluation.md)

## Context
Patients in Egypt receive lab results mostly as PDFs or photos of printed reports. Typing results
by hand is slow and error-prone, and the next slice (health analytics) needs structured values.
Vision-capable models (Claude, GPT, Gemini, MedGemma) can read a results table, but they can also
misread a digit, invent a row, convert a unit, or add an interpretation. The project's rules say the
model is never the security or safety boundary, retrieved documents are data and not instructions,
measured data must be kept apart from AI output, and nothing unvalidated may be presented as a
clinical assessment.

## Decision
1. **Storage.** A document (PDF, JPEG, PNG or WebP, ≤ 10 MB) belongs to a patient profile and is
   stored in PostgreSQL (`bytea`) under the profile's row-level security: viewable by anyone who can
   view the profile, added/renamed/deleted by those who can edit it, and only with the current
   health-data consent. The type is identified from the bytes (PDF header and end marker, or a
   well-formed image header); a declared type that disagrees is refused. Lists never load the bytes.
   Object storage with server-side encryption is the path when volume requires it; the API contract
   does not change.
2. **Viewing.** A browser tab or native viewer cannot send the session, so the app asks for a
   **single-use 60-second link** (256-bit ticket, SHA-256 stored, ticket redacted from request logs).
   Claiming it re-checks access through row-level security at the moment of reading; responses are
   `no-store`, `nosniff` and cannot be framed.
3. **Reading with AI** is the gateway route `patient.document` (flag `ai.document_analysis`, HIGH risk,
   regulatory evidence required; weekly `ANALYSES` allowance; capability `DOCUMENT_EXTRACTION`;
   clinical approval required). It needs the assistant consent **and** a separate document consent
   (`AI_DOCUMENT_PROCESSING`), which the app asks for inline. Only providers whose adapter can send the
   file type are offered to the router (e.g. Chat Completions endpoints cannot take a PDF).
4. **Transcription only.** The model receives the file and a fixed policy that treats the document as
   data, and must return JSON matching a strict schema (Anthropic `output_config.format`, OpenAI
   `text.format` strict, Gemini `responseJsonSchema`, Chat Completions `response_format`). It copies
   test name, value, unit, printed reference range and printed flag **as printed**; it does not
   compute whether a value is normal, convert units or interpret.
5. **Deterministic derivation.** The API validates the output (bounded lengths, ≤ 80 rows); anything
   else is a failed reading. Numbers, the printed range and the in/out-of-range status are computed
   by shared code (`deriveLabRow`): Arabic-Indic digits and decimal commas are normalised; a bound such
   as `< 5` is **not** a measurement and never becomes a number; a missing or unparseable range means
   "not compared". Any status the model volunteers is ignored. A "critical" marker is repeated only
   when the lab printed one.
6. **Nothing is a record until the person confirms it.** AI rows are `PENDING_REVIEW`. The person
   confirms a row as read (provenance `IMPORTED_DOCUMENT`), corrects it (their own report, with the AI
   reading kept in `extracted`), or rejects it. Only confirmed rows are health records. The app role
   cannot insert AI rows directly (policy allows `MANUAL` + `CONFIRMED` only); AI rows come from
   definer functions. Manual entry exists for everything.
7. **Metering.** One reading = one weekly analysis, cost from the serving model's verified price. A
   refusal, a provider failure and an output that fails validation give the allowance back; the
   tokens of a failed validation are still recorded as company cost (`INVALID_OUTPUT`), and a person
   gets at most 5 paid failures per 24 h. A document is read successfully once
   (`DOCUMENT_ALREADY_READ`); one reading at a time per document.
8. **Evaluation.** Evaluation cases can target `patient.document` with a synthetic report definition
   that is rendered to a PDF at run time and sent with exactly the production request. Automated
   checks compare every expected row (test, value, unit, flag), the document type and extra rows; a
   clinical reviewer still scores every result before a model can be approved for the route. Ten
   English starter cases are seeded as DRAFT (including a prompt-injection line printed on a report
   and a non-lab document).

## Consequences
- Extraction accuracy is **not established**: no live provider has read a document in this build,
  and the synthetic cases are ASCII PDFs. Launch needs an evaluation on real, de-identified Egyptian
  lab reports (Arabic, bilingual, photos, multi-page), a clinical-safety review and the legal notice.
- Photos are read as sent (no on-device cropping, deskewing or redaction yet). Patients may photograph
  their name and ID; they are told the file is stored with the profile and sent to the provider.
- Health analytics (Slice 6) will build trends only from **confirmed** rows, labelling each value's
  provenance.
