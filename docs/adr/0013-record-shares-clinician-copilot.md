# ADR 0013 — Record shares and the clinician documentation copilot

- Status: accepted (2026-10-28)
- Extends: [ADR 0005](0005-family-consent-model.md), [ADR 0008](0008-ai-gateway.md), [ADR 0012](0012-health-analytics.md)

## Context
Doctors and nurses want help turning their own visit notes into a tidy note, and patients want to
read what their clinician wrote. Until now a clinician could not see any patient record: there was
no care relationship (Milestone 3). The project's rules require that AI clinical documentation stays
a **draft until the authorised clinician accepts it**, that nurses never issue physician-only
orders, that the AI never prescribes, changes a dose or makes a diagnosis, and that real patient
data never reaches a model without the permissions and terms in place. A language model asked to
"write up this visit" will add a diagnosis, a dose or a plan the clinician never wrote.

## Decision
1. **Record shares** (`app.care_shares`) are the first care-relationship primitive. Someone who
   manages a profile (ADR 0005) shares it with **one verified clinician** (`APPROVED`, active
   account) for 7, 30 or 90 days, with the health-data consent; sharing again replaces the earlier
   share; the person or the clinician can end it at any time; every grant and revoke is audited.
   Expiry, revocation, suspension of the clinician or of the account end access at once — access is
   evaluated on every read (`app.has_care_access`), not cached.
2. **What a clinician reads**: through additive, read-only row-level policies only — age, sex,
   blood type and governorate (`app.care_patient_summary`, no contact details, address, family links
   or documents), active allergies / conditions / medicines, readings, and lab results the person
   **confirmed**. Nothing is writable. Each record view is audited (`clinician.record.viewed`).
3. **Test and real data never meet.** A share is *test data* when the profile is a demo profile or
   the person sharing is a review / internal-test account; a clinician is a *test clinician* when
   their directory profile is a demo profile or their account is review / internal-test
   (`app.is_test_clinician`). A share is only possible between the same kind, and access re-checks
   it on every read — so an internal-test clinician (who may use AI features that are off for
   everyone else) can never receive a real record, and a real clinician never receives test data.
4. **AI permission is separate and per share** (`ai_allowed`, off by default). The clinician must
   also accept the clinician AI terms (`AI_CLINICAL_DOCUMENTATION` consent, legal placeholder). The
   gateway now checks a **per-route consent** (`ai_routes.required_consent`): the clinician route
   requires the clinician terms instead of the patient assistant consent.
5. **The copilot only organises the clinician's own notes** (route `clinician.documentation`, flag
   `ai.clinician_copilot` OFF and regulated, weekly `CLINICAL_DRAFTS` allowance of 40, clinical
   approval per model). Notes are sent between delimiters as data, with a minimal context (age band,
   sex, allergies, conditions, medicines, latest readings — no names, contacts, documents or the
   person's own notes). The model returns strict JSON with fixed sections for the note type plus
   "checks for the clinician" (e.g. a recorded allergy that may relate to a medicine in the notes).
6. **Deterministic guard** (`checkClinicalDraft`, shared code): the draft is rejected unless its
   shape matches the note type, **every dose** (EN/AR units, Arabic digits) appears in the notes or
   the recorded medicines, and no diagnosis / prescribing / order / dose-change / start / stop word
   appears unless the clinician used it (EN/AR stems). Rejected drafts are never shown; their tokens
   are recorded as company cost (`INVALID_OUTPUT`), the allowance is given back, ≤ 5 a day.
7. **Role scope**: doctors draft visit notes and patient instructions; nurses draft nursing notes,
   wound-care notes and patient instructions — enforced by the API, a database constraint, the
   prompt (nursing scope: escalation is "report to the physician", never an order) and the guard.
8. **Drafts stay drafts.** A draft is visible only to its author, who edits, signs or discards it;
   signing is audited (`clinical.note.signed`), freezes the note and records whether it was edited.
   Only **signed** notes are visible to the people who manage the profile — with the signer's name
   as signed, an "AI-assisted, reviewed and signed by the clinician" label, and never the
   clinician's working notes. A draft cannot be signed after the share ends.
9. **Evaluation**: clinician cases carry synthetic notes, medicines and allergies; the executor builds
   the request exactly as production does and screens answers with the same guard, plus language and
   forbidden-phrase checks. Six starter cases (doctor visit notes EN / AR, nurse wound-care note, a
   nurse note that must not contain orders, Arabic patient instructions, and notes carrying a prompt
   injection) are seeded as DRAFT.

## Consequences
- Draft quality is **not evaluated** with any real model; no clinical evaluation has been done.
- The guard is conservative: a clinician who writes "stop" or a dose in their notes can get it back;
  a model that paraphrases a dose into another unit is rejected rather than trusted.
- Shares are the base for later care workflows (bookings, clinician-verified readings,
  `PROFESSIONALLY_VERIFIED` provenance), which are not built yet.
- Internal-test clinicians live in the demo directory (the only directory review and internal-test
  accounts can see); the seeded `clinician.tester@demo.ghayarly.test` exists for development only.
